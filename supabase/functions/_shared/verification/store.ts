// feat-003: the writes every verification function shares. Service role only.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { normaliseDocumentNumber, standardResult, stripImages } from "./standard.ts";
import { startPremiumChecks } from "./premium.ts";

type Sb = SupabaseClient;

export const OPEN = ["link_sent", "in_progress"];
export const PHOTO_BUCKET = "verification-documents";

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Record a moment (spec 05.14). With `providerEventId`, a retried webhook is recorded once (spec 07.10):
 * returns false when that provider event was already recorded.
 */
export async function addEvent(
  sb: Sb, session: { id: string; tenant_id: string }, kind: string,
  detail: Record<string, unknown> = {}, providerEventId?: string,
): Promise<boolean> {
  const row = { session_id: session.id, tenant_id: session.tenant_id, kind,
    detail: providerEventId ? { ...detail, provider_event_id: providerEventId } : detail };
  const { error } = await sb.from("verification_session_events").insert(row);
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`event ${kind}: ${error.message}`);
  }
  return true;
}

/** The one place both customer status columns move (spec 03.8, 05.16). A replaced session cannot move them. */
export async function setCustomerStatus(sb: Sb, customerId: string, sessionId: string, status: string): Promise<void> {
  const { error } = await sb.rpc("verification_v2_set_customer_status", { p_customer: customerId, p_session: sessionId, p_status: status });
  if (error) throw new Error(`customer status: ${error.message}`);
}

export async function audit(sb: Sb, a: { tenantId: string; actorId: string | null; isSuperAdmin?: boolean; action: string; entityId: string; details?: Record<string, unknown> }): Promise<void> {
  const { error } = await sb.from("audit_logs").insert({
    tenant_id: a.tenantId,
    actor_id: a.actorId,
    action: a.action,
    entity_type: "customer",
    entity_id: a.entityId,
    details: a.details ?? {},
    is_super_admin_action: !!a.isSuperAdmin,
    activity_source: a.isSuperAdmin ? "super_admin" : a.actorId ? "tenant_user" : "system",
  });
  if (error) console.error("[verification] audit insert failed", error.message);
}

/** Copy Didit's short-lived images into our private bucket (spec 07.28, 12.2). Returns the storage paths. */
async function copyPhotos(sb: Sb, base: string, images: Record<string, string | null>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, url] of Object.entries(images)) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const ext = type.includes("png") ? "png" : "jpg";
      const path = `${base}/${name}.${ext}`;
      const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, await res.arrayBuffer(), { contentType: type, upsert: true });
      if (!error) out[name] = path;
      else console.error("[verification] photo upload failed", name, error.message);
    } catch (e) {
      console.error("[verification] photo copy failed", name, String(e));
    }
  }
  return out;
}

/** Map Didit's same-face links to other customers of THIS company (spec 07.19). */
async function sameFaceNames(sb: Sb, decision: any, tenantId: string, customerId: string): Promise<string[]> {
  // Didit: linked_records.same_face = { count, best_match } (a list is also accepted, to be safe).
  const sf = decision?.linked_records?.same_face;
  const rows = Array.isArray(sf) ? sf : sf?.count ? [sf.best_match, ...(Array.isArray(sf.matches) ? sf.matches : [])] : [];
  const ids = rows
    .map((r: any) => r?.vendor_data ?? r?.session?.vendor_data)
    .filter((v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v));
  if (!ids.length) return [];
  const { data } = await sb.from("verification_sessions")
    .select("customer_id, customers(name)").in("id", ids).eq("tenant_id", tenantId).neq("customer_id", customerId);
  return [...new Set((data ?? []).map((r: any) => r.customers?.name).filter(Boolean))] as string[];
}

/**
 * Finish the standard check from Didit's decision (spec 07.12 to 07.30). Safe to call twice: a session
 * that is no longer open is left alone (spec 07.9).
 */
export async function finishStandard(sb: Sb, sessionId: string, decision: any, providerEventId?: string): Promise<{ done: boolean; outcome?: string }> {
  const { data: session } = await sb.from("verification_sessions")
    .select("id, tenant_id, customer_id, status").eq("id", sessionId).maybeSingle();
  if (!session || !OPEN.includes(session.status)) return { done: false };

  const [{ data: tenant }, { data: customer }] = await Promise.all([
    sb.from("tenants").select("minimum_rental_age, accepted_verification_document").eq("id", session.tenant_id).single(),
    sb.from("customers").select("name").eq("id", session.customer_id).single(),
  ]);

  const docNumber = normaliseDocumentNumber(decision?.id_verifications?.[0]?.document_number);
  let blockedReason: string | null = null;
  if (docNumber) {
    const { data: rows } = await sb.from("blocked_identities").select("identity_number, reason")
      .eq("tenant_id", session.tenant_id).eq("is_active", true).in("identity_type", ["license", "id_card", "passport"]);
    blockedReason = (rows ?? []).find((r: any) => normaliseDocumentNumber(r.identity_number) === docNumber)?.reason ?? null;
  }

  const result = standardResult(decision, {
    customerName: customer?.name ?? "",
    minimumAge: tenant?.minimum_rental_age ?? null,
    acceptedDocument: tenant?.accepted_verification_document ?? "drivers_license",
    today: todayUtc(),
    blockedReason,
    sameFaceNames: await sameFaceNames(sb, decision, session.tenant_id, session.customer_id),
  });

  const photos = await copyPhotos(sb, `${session.tenant_id}/${session.customer_id}/${session.id}`, result.details.images);
  const now = new Date().toISOString();
  const status = result.outcome === "verified" ? "verified" : result.outcome === "needs_review" ? "needs_review" : "failed";

  // Claim the session first, so two deliveries racing each other finish it once.
  const { data: claimed } = await sb.from("verification_sessions")
    .update({ status, finished_at: now }).eq("id", session.id).in("status", OPEN).select("id");
  if (!claimed?.length) return { done: false };

  await sb.from("verification_session_checks").update({
    result: result.outcome === "verified" ? "pass" : result.outcome === "failed" ? "fail" : "could_not_check",
    lines: result.lines,
    reason: result.reason,
    raw: { decision: stripImages(decision), photos },
    finished_at: now,
  }).eq("session_id", session.id).eq("service_key", "standard");

  const d = result.details;
  const readSomething = !!(d.first_name || d.last_name || d.document_number || d.date_of_birth || d.expiry);
  if (status !== "failed" && readSomething) {
    await sb.from("customers").update({
      ...(d.date_of_birth ? { date_of_birth: d.date_of_birth } : {}),
      ...(d.document_number ? { license_number: d.document_number } : {}),
      ...(d.region ? { license_state: d.region } : {}),
      ...(d.expiry ? { licence_expiry_date: d.expiry } : {}),
      licence_document_type: d.document_type,
      licence_document_subtype: d.document_subtype,
      licence_issuing_country: d.country,
      ...(d.address?.street ? { address_street: d.address.street } : {}),
      ...(d.address?.city ? { address_city: d.address.city } : {}),
      ...(d.address?.state ? { address_state: d.address.state } : {}),
      ...(d.address?.zip ? { address_zip: d.address.zip } : {}),
      identity_details_source: "verified",
      verification_warning: null,
    }).eq("id", session.customer_id);
  }
  if (blockedReason) {
    await sb.from("customers").update({ is_blocked: true, blocked_reason: blockedReason, blocked_at: now }).eq("id", session.customer_id);
  }

  await addEvent(sb, session, "standard_result", { outcome: result.outcome, reason: result.reason }, providerEventId);
  await setCustomerStatus(sb, session.customer_id, session.id, status);

  // Premium checks run only after Verified; otherwise they are never sent (spec 08.1, 08.2).
  if (status === "verified") {
    await startPremiumChecks(sb, session.id);
  } else {
    await sb.from("verification_session_checks").update({ result: "not_run", reason: "The standard check did not pass", finished_at: now })
      .eq("session_id", session.id).neq("service_key", "standard").eq("result", "pending");
  }
  return { done: true, outcome: result.outcome };
}
