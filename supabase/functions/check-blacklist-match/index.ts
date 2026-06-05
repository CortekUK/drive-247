/**
 * check-blacklist-match — Spec Section 6.7
 *
 * Given { tenantId, phone, email, licenceNumber, fullName }, normalises identifiers
 * and exact-matches against blacklist_entries. Returns:
 *
 *   matchType: 'none' | 'hard' | 'soft'
 *   entries:   [{ id, reason, ... }]
 *
 * Hard match = phone OR email OR licence equals an entry (any of three).
 * Soft match = same tenant, similar name (Levenshtein ≤ 2) AND any partial phone/email match.
 *
 * Cross-tenant matching (Phase 2) gated by tenants.cross_tenant_blacklist_enabled.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  tenantId?: string;
  phone?: string;
  email?: string;
  licenceNumber?: string;
  fullName?: string;
}

interface BlacklistEntry {
  id: string;
  tenant_id: string;
  reason: string;
  phone_normalised: string | null;
  email_lower: string | null;
  licence_number: string | null;
  full_name: string | null;
}

function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function normaliseLicence(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function normaliseName(raw: string): string {
  return raw.toLowerCase().replace(/[^\w\s]/g, "").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.tenantId) return errorResponse("tenantId is required");

    const phoneNorm = body.phone ? normalisePhone(body.phone) : null;
    const emailNorm = body.email ? normaliseEmail(body.email) : null;
    const licenceNorm = body.licenceNumber ? normaliseLicence(body.licenceNumber) : null;
    const nameNorm = body.fullName ? normaliseName(body.fullName) : null;

    if (!phoneNorm && !emailNorm && !licenceNorm) {
      return jsonResponse({ matchType: "none", entries: [] });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Check tenant cross-tenant flag for Phase 2 cross-tenant scan
    const { data: tenant } = await supabase
      .from("tenants")
      .select("cross_tenant_blacklist_enabled")
      .eq("id", body.tenantId)
      .maybeSingle();

    const crossTenant = tenant?.cross_tenant_blacklist_enabled === true;

    // Pull candidate entries — same tenant always; all tenants only when cross_tenant enabled
    let query = supabase
      .from("blacklist_entries")
      .select("id, tenant_id, reason, phone_normalised, email_lower, licence_number, full_name");

    if (!crossTenant) {
      query = query.eq("tenant_id", body.tenantId);
    }

    const { data: candidates, error } = await query.limit(500);

    if (error) {
      console.error("check-blacklist-match query error:", error);
      return errorResponse("Failed to query blacklist", 500);
    }

    const hardMatches: BlacklistEntry[] = [];
    const softMatches: BlacklistEntry[] = [];

    for (const entry of (candidates ?? []) as BlacklistEntry[]) {
      // Hard match: phone OR email OR licence equal
      if (
        (phoneNorm && entry.phone_normalised && entry.phone_normalised === phoneNorm) ||
        (emailNorm && entry.email_lower && entry.email_lower === emailNorm) ||
        (licenceNorm && entry.licence_number && entry.licence_number.toUpperCase() === licenceNorm)
      ) {
        hardMatches.push(entry);
        continue;
      }

      // Soft match: same tenant + similar name (Levenshtein ≤ 2) AND any partial phone/email
      if (entry.tenant_id !== body.tenantId) continue;
      if (!nameNorm || !entry.full_name) continue;

      const entryNameNorm = normaliseName(entry.full_name);
      if (entryNameNorm.length < 3) continue;
      if (levenshtein(nameNorm, entryNameNorm) > 2) continue;

      const phoneMatchPartial = phoneNorm &&
        entry.phone_normalised &&
        (entry.phone_normalised.endsWith(phoneNorm.slice(-7)) ||
          phoneNorm.endsWith(entry.phone_normalised.slice(-7)));
      const emailMatchPartial = emailNorm &&
        entry.email_lower &&
        entry.email_lower.split("@")[0] === emailNorm.split("@")[0];

      if (phoneMatchPartial || emailMatchPartial) {
        softMatches.push(entry);
      }
    }

    if (hardMatches.length > 0) {
      return jsonResponse({
        matchType: "hard",
        entries: hardMatches.map(({ id, reason, tenant_id }) => ({
          id,
          reason,
          // Mask origin tenant on cross-tenant matches
          tenantId: crossTenant && tenant_id !== body.tenantId ? null : tenant_id,
        })),
      });
    }

    if (softMatches.length > 0) {
      return jsonResponse({
        matchType: "soft",
        entries: softMatches.map(({ id, reason, tenant_id }) => ({
          id,
          reason,
          tenantId: tenant_id,
        })),
      });
    }

    return jsonResponse({ matchType: "none", entries: [] });
  } catch (err) {
    console.error("check-blacklist-match error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
