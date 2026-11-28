// feat-003: running and finishing the premium checks (spec 08).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createCharge } from "./billing.ts";
import { premiumLine } from "./rentid-map.ts";
import { getResult, isConfigured, startCheck, type Subject } from "./rentid.ts";
import { addEvent } from "./store.ts";

type Sb = SupabaseClient;

function webhookUrl(checkId: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/verification-v2-rentid-webhook/${checkId}`;
}

async function notRun(sb: Sb, checkId: string, result: "not_run" | "could_not_check", reason: string) {
  await sb.from("verification_session_checks")
    .update({ result, reason, lines: [{ check: "premium", result, reason }], finished_at: new Date().toISOString() })
    .eq("id", checkId).eq("result", "pending");
}

/** The subject RentID needs, from the verified details (spec 08.5). */
async function subjectFor(sb: Sb, _sessionId: string, customerId: string): Promise<Subject> {
  const [{ data: c }, { data: std }] = await Promise.all([
    sb.from("customers").select("name, date_of_birth, license_number, license_state").eq("id", customerId).single(),
    // The customer's latest passed standard check: a re-run premium check has none of its own (spec 08.19).
    sb.from("verification_session_checks").select("raw, verification_sessions!inner(customer_id)")
      .eq("verification_sessions.customer_id", customerId).eq("service_key", "standard").eq("result", "pass")
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const id = (std?.raw as any)?.decision?.id_verifications?.[0] ?? {};
  const parts = String(c?.name ?? "").trim().split(/\s+/);
  return {
    first_name: id.first_name || parts[0] || "",
    last_name: id.last_name || parts.slice(1).join(" ") || "",
    dob: c?.date_of_birth ?? null,
    licence_number: c?.license_number ?? null,
    licence_state: c?.license_state ?? null,
  };
}

/** Start every pending premium check of a Verified session (spec 08.1 to 08.10). */
export async function startPremiumChecks(sb: Sb, sessionId: string): Promise<void> {
  const { data: session } = await sb.from("verification_sessions").select("id, tenant_id, customer_id, status").eq("id", sessionId).single();
  if (!session) return;
  const { data: checks } = await sb.from("verification_session_checks")
    .select("id, service_key, consent, provider_ref").eq("session_id", sessionId).neq("service_key", "standard").eq("result", "pending");
  if (!checks?.length) return;

  if (session.status !== "verified") {
    for (const c of checks) await notRun(sb, c.id, "not_run", "The standard check did not pass");
    return;
  }
  const { data: services } = await sb.from("verification_services").select("key, availability");
  const avail = Object.fromEntries((services ?? []).map((s: any) => [s.key, s.availability]));
  const subject = await subjectFor(sb, sessionId, session.customer_id);

  for (const c of checks) {
    if (c.provider_ref) continue; // already sent; the webhook or the sweep finishes it
    if (c.consent === "refused") { await notRun(sb, c.id, "not_run", "The customer did not agree"); continue; }
    if (avail[c.service_key] !== "live") { await notRun(sb, c.id, "not_run", "Not available yet"); continue; }
    if (!isConfigured()) continue; // left pending; the sweep retries once RentID is set up

    const out = await startCheck(c.service_key, subject, webhookUrl(c.id), c.id);
    switch (out.kind) {
      case "started":
        await sb.from("verification_session_checks").update({ provider_ref: out.requestId, started_at: new Date().toISOString() }).eq("id", c.id);
        await addEvent(sb, session, "premium_started", { service: c.service_key });
        if (out.status === "complete" && out.report) await finishPremium(sb, c.id, "complete", out.report);
        break;
      case "state_not_supported":
        await notRun(sb, c.id, "could_not_check", "Not available in this state yet");
        break;
      case "out_of_credit":
        console.error(`[verification] RentID refused for credit (${out.code}): premium checks are unavailable for every company`);
        await notRun(sb, c.id, "could_not_check", "Not available right now");
        break;
      case "missing_details":
        await notRun(sb, c.id, "could_not_check", `Could not check: the ${out.field} is missing`);
        break;
      case "not_configured":
        break;
      default:
        await notRun(sb, c.id, "could_not_check", "Could not check, try again");
    }
  }
}

/**
 * Finish one premium check from RentID's answer (spec 08.15 to 08.18). Safe to call twice: only a pending
 * check moves. A complete answer creates the charge, whatever it says; failed is not charged.
 */
export async function finishPremium(sb: Sb, checkId: string, status: string, report: any): Promise<boolean> {
  const { data: check } = await sb.from("verification_session_checks")
    .select("id, session_id, tenant_id, service_key, result, verification_sessions(customer_id)").eq("id", checkId).single();
  if (!check || check.result !== "pending") return false;
  const now = new Date().toISOString();
  const session = { id: check.session_id, tenant_id: check.tenant_id };

  if (status === "failed") {
    await notRun(sb, check.id, "could_not_check", "Could not check, try again");
    await addEvent(sb, session, "premium_result", { service: check.service_key, result: "could_not_check" });
    return true;
  }
  if (status !== "complete") return false;

  const line = premiumLine(check.service_key, report, now);
  const { data: moved } = await sb.from("verification_session_checks").update({
    result: line.result,
    reason: line.result === "pass" ? null : line.line,
    lines: [{ check: check.service_key, result: line.result, reason: line.line }],
    raw: report,
    finished_at: now,
  }).eq("id", check.id).eq("result", "pending").select("id");
  if (!moved?.length) return false;

  const customerId = (check as any).verification_sessions?.customer_id;
  if (line.warning && customerId) {
    await sb.from("customers").update({ verification_warning: line.warning }).eq("id", customerId); // stays Verified (08.17)
  }
  await addEvent(sb, session, "premium_result", { service: check.service_key, result: line.result, line: line.line });
  await createCharge(sb, check.id);
  return true;
}

/** The sweep's fallback for a missed webhook (spec 08.14). */
export async function pollPremium(sb: Sb, checkId: string, requestId: string): Promise<void> {
  const r = await getResult(requestId);
  if (r && (r.status === "complete" || r.status === "failed")) await finishPremium(sb, checkId, r.status, r.report);
}
