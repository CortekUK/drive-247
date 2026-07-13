import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

// reconcile-orphaned-registrations
// --------------------------------
// Safety net for the booking invite-registration flow. A customer is only created
// by submit-customer-registration on the FINAL "Complete Registration" click. If a
// renter passes identity verification (review_result='GREEN') but never completes
// that final step, their verification sits with customer_id=NULL and NO customer row
// is ever created — so the operator never sees them (this is exactly what happened to
// Flow Auto Rentals' "Mary J Davis", who had to be added by hand).
//
// This job materialises those orphaned-but-verified registrations into customers,
// mirroring submit-customer-registration's guards (global blacklist, blocked email,
// blocked document, per-tenant (email, tenant_id) email dedup). It is:
//   - WINDOWED: MIN_AGE avoids racing an in-progress registration; MAX_AGE avoids a
//     one-time historical flood on first run.
//   - IDEMPOTENT: skips (and back-links) any verification whose email is already a
//     customer, so re-runs never duplicate.
//   - SIDE-EFFECT FREE: creates data only — it sends NO email/SMS/webhook.
//   - phone is form-only and unavailable here, so it is left null for the operator to
//     complete; the customer lands with identity_verification_status='verified'.
//
// dryRun=true returns what WOULD be created without writing. tenantId scopes a run to
// one tenant (safe staged rollout / testing).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// A verification must be at least MIN_AGE old before we reconcile it. Registration
// invites live 7 days, so MIN_AGE is set BEYOND that window: reconcile only ever
// materialises a customer once the renter's invite has already EXPIRED. That makes it
// impossible to collide with a renter who is still (or later) self-completing — if the
// invite were still live, submit-customer-registration would hit our reconcile-created
// customer, error 'email already exists', and permanently block the renter. MAX_AGE
// bounds how far back a run looks so it never resurrects ancient attempts across every
// tenant. (Invite TTL verified in DB = 7 days for all invites.)
const MIN_AGE_MS = 8 * 24 * 60 * 60 * 1000; // 8 days (> 7-day invite TTL — collision-free)
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (default look-back)
const MAX_AGE_CAP_MS = 30 * 24 * 60 * 60 * 1000; // hard ceiling for caller-supplied maxAgeDays
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

interface Body {
  dryRun?: boolean;
  tenantId?: string;
  maxAgeDays?: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      // Empty body (cron / GET) is fine.
    }
    const dryRun = body.dryRun === true;
    // Clamp the caller-supplied window: never look back further than MAX_AGE_CAP_MS
    // (so a huge maxAgeDays can't defeat the flood guard) and never inside MIN_AGE
    // (which would invert the window). Default look-back is MAX_AGE_MS.
    const requestedMaxAgeMs = body.maxAgeDays ? body.maxAgeDays * DAY_MS : MAX_AGE_MS;
    const maxAgeMs = Math.min(Math.max(requestedMaxAgeMs, MIN_AGE_MS + DAY_MS), MAX_AGE_CAP_MS);

    const now = Date.now();
    const minAgeIso = new Date(now - MIN_AGE_MS).toISOString(); // updated_at <= this (old enough)
    const maxAgeIso = new Date(now - maxAgeMs).toISOString(); // updated_at >= this (recent enough)

    // 1. Candidate orphaned, verified, booking-flow verifications.
    let query = supabase
      .from("identity_verifications")
      .select(
        "id, tenant_id, customer_email, first_name, last_name, document_number, date_of_birth, review_result, updated_at",
      )
      .eq("review_result", "GREEN")
      .is("customer_id", null)
      .not("customer_email", "is", null)
      .not("tenant_id", "is", null)
      .gte("updated_at", maxAgeIso)
      .lte("updated_at", minAgeIso)
      .order("updated_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (body.tenantId) {
      query = query.eq("tenant_id", body.tenantId);
    }

    const { data: candidates, error: candError } = await query;
    if (candError) {
      return json({ success: false, error: candError.message }, 500);
    }

    const created: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    for (const v of candidates ?? []) {
      const email = (v.customer_email ?? "").trim().toLowerCase();
      const name = [v.first_name, v.last_name]
        .filter(Boolean)
        .map((s: string) => s.trim())
        .join(" ")
        .trim();

      if (!email) {
        skipped.push({ id: v.id, reason: "no email on verification" });
        continue;
      }
      if (!name) {
        // Cannot create a customer without a name (NOT NULL). Leave for manual handling.
        skipped.push({ id: v.id, reason: "no name on verification" });
        continue;
      }

      // Idempotency + dedup. customers.email is unique PER TENANT
      // (idx_customers_email_tenant_unique on (email, tenant_id)) — NOT global — so the
      // match MUST be tenant-scoped, else we would back-link the renter to a DIFFERENT
      // tenant's customer. We match case-INSENSITIVELY (the raw unique index is
      // case-sensitive, so a lowercase insert would otherwise slip past a mixed-case
      // existing row), and escape LIKE metacharacters so an '_'/'%' in the local part
      // (e.g. john_doe@x.com) is matched literally rather than as a wildcard. If a
      // same-tenant customer already exists, back-link this orphaned verification to it
      // and skip creation.
      const emailPattern = email.replace(/[\\%_]/g, "\\$&");
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .ilike("email", emailPattern)
        .eq("tenant_id", v.tenant_id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        if (!dryRun) {
          await supabase
            .from("identity_verifications")
            .update({ customer_id: existing.id, customer_email: email })
            .eq("id", v.id)
            .is("customer_id", null);
        }
        skipped.push({ id: v.id, reason: "email already a customer", customerId: existing.id, linked: !dryRun });
        continue;
      }

      // Guards mirrored from submit-customer-registration — never materialise a
      // blacklisted / blocked identity.
      const { data: blacklisted } = await supabase.rpc("is_globally_blacklisted", { p_email: email });
      if (blacklisted) {
        skipped.push({ id: v.id, reason: "globally blacklisted" });
        continue;
      }

      const { data: blockedEmail } = await supabase
        .from("blocked_identities")
        .select("id")
        .eq("tenant_id", v.tenant_id)
        .eq("identity_number", email)
        .eq("identity_type", "email")
        .eq("is_active", true)
        .maybeSingle();
      if (blockedEmail) {
        skipped.push({ id: v.id, reason: "blocked email" });
        continue;
      }

      if (v.document_number) {
        const { data: blockedDoc } = await supabase
          .from("blocked_identities")
          .select("id")
          .eq("tenant_id", v.tenant_id)
          .eq("identity_number", v.document_number)
          .eq("is_active", true)
          .maybeSingle();
        if (blockedDoc) {
          skipped.push({ id: v.id, reason: "blocked document" });
          continue;
        }
      }

      if (dryRun) {
        created.push({ verificationId: v.id, wouldCreate: { name, email, tenant_id: v.tenant_id } });
        continue;
      }

      // Create the customer from the verified data. phone is collected in the (never
      // submitted) registration form, so it is intentionally left null.
      const payload: Record<string, unknown> = {
        tenant_id: v.tenant_id,
        customer_type: "Individual",
        type: "Individual",
        name,
        email,
        status: "Active",
        identity_verification_status: "verified",
      };
      if (v.document_number) payload.license_number = v.document_number;
      if (v.date_of_birth) payload.date_of_birth = v.date_of_birth;

      const { data: newCustomer, error: insertError } = await supabase
        .from("customers")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !newCustomer) {
        // Most likely a concurrent create of the same email — non-fatal, skip.
        skipped.push({ id: v.id, reason: "insert failed: " + (insertError?.message ?? "unknown") });
        continue;
      }

      // Link the verification to the new customer (proper linkage + idempotency).
      await supabase
        .from("identity_verifications")
        .update({ customer_id: newCustomer.id, customer_email: email })
        .eq("id", v.id)
        .is("customer_id", null);

      created.push({
        verificationId: v.id,
        customerId: newCustomer.id,
        name,
        email,
        tenant_id: v.tenant_id,
      });
    }

    return json({
      success: true,
      dryRun,
      scanned: candidates?.length ?? 0,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped,
      window: { fromUpdatedAt: maxAgeIso, toUpdatedAt: minAgeIso },
    });
  } catch (error) {
    console.error("reconcile-orphaned-registrations error:", error);
    return json({ success: false, error: (error as { message?: string })?.message ?? "Unexpected error" }, 500);
  }
});
