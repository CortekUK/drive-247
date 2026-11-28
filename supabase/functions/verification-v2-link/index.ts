/**
 * verification-v2-link · feat-003 · the renter's page (spec 06, 07.1 to 07.4).
 *
 * Public (verify_jwt = false). The session token in the link is the only key. It returns nothing private
 * (spec 06.3, 12.7): no licence number, date of birth or photo, only the company's name and logo, the
 * renter's first name, what will be checked and the state of the session.
 *
 * Actions: open, consent, start-didit.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { CONSENT_VERSION, licenceStatusConsentLine, PREMIUM_CONSENT, standardConsent } from "../_shared/verification/consent.ts";
import { createSession, DiditUnavailable } from "../_shared/verification/didit.ts";
import { addEvent, OPEN, setCustomerStatus } from "../_shared/verification/store.ts";

type Sb = SupabaseClient;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 30; // spec 06.20

const fail = (status: number, error: string) => jsonResponse({ error }, status);

async function sessionFor(sb: Sb, token: unknown) {
  if (typeof token !== "string" || token.length < 43 || token.length > 128) return null;
  const { data } = await sb.from("verification_sessions").select("*").eq("token", token).maybeSingle();
  return data;
}

/** Counts this token's requests in a 10-minute window; false when over the limit. */
async function withinLimit(sb: Sb, s: any): Promise<boolean> {
  const started = s.link_window_started_at ? new Date(s.link_window_started_at).getTime() : 0;
  if (!started || Date.now() - started > WINDOW_MS) {
    await sb.from("verification_sessions").update({ link_hits: 1, link_window_started_at: new Date().toISOString() }).eq("id", s.id);
    return true;
  }
  if (s.link_hits >= MAX_HITS) return false;
  await sb.from("verification_sessions").update({ link_hits: s.link_hits + 1 }).eq("id", s.id);
  return true;
}

function stateOf(s: any): string {
  if (s.replaced_by) return "replaced";
  if (s.cancelled_at) return "ended";
  if (OPEN.includes(s.status)) return new Date(s.expires_at).getTime() > Date.now() ? "open" : "ended";
  if (s.status === "expired" || s.status === "not_verified") return "ended";
  return s.status; // verified, needs_review, failed
}

async function pageModel(sb: Sb, s: any) {
  const [{ data: tenant }, { data: customer }, { data: checks }, { data: services }] = await Promise.all([
    sb.from("tenants").select("company_name, logo_url").eq("id", s.tenant_id).single(),
    sb.from("customers").select("name").eq("id", s.customer_id).single(),
    sb.from("verification_session_checks").select("service_key, consent").eq("session_id", s.id),
    sb.from("verification_services").select("key, name, description"),
  ]);
  const company = (tenant?.company_name || "Drive 247").trim();
  const names = Object.fromEntries((services ?? []).map((x: any) => [x.key, x]));
  const ticked = (checks ?? []).map((c: any) => c.service_key);
  return {
    state: stateOf(s),
    company: { name: company, logoUrl: tenant?.logo_url ?? null },
    firstName: String(customer?.name ?? "").trim().split(/\s+/)[0] || null,
    expiresAt: s.expires_at,
    consentGiven: !!s.consent_at,
    checkStarted: !!s.didit_session_id,
    standardConsent: standardConsent(company) + (ticked.includes("licence_status") ? ` ${licenceStatusConsentLine(company)}` : ""),
    premiumConsents: ticked.filter((k: string) => PREMIUM_CONSENT[k]).map((k: string) => ({
      key: k, name: names[k]?.name ?? k, text: PREMIUM_CONSENT[k](company),
    })),
    checks: ticked.map((k: string) => ({ key: k, name: names[k]?.name ?? k, description: names[k]?.description ?? "" })),
    consentVersion: CONSENT_VERSION,
  };
}

async function open(sb: Sb, s: any) {
  if (s.status === "link_sent" && stateOf(s) === "open") {
    const { data: moved } = await sb.from("verification_sessions")
      .update({ status: "in_progress", opened_at: new Date().toISOString() }).eq("id", s.id).eq("status", "link_sent").select("id");
    if (moved?.length) {
      await addEvent(sb, s, "link_opened");
      await setCustomerStatus(sb, s.customer_id, s.id, "in_progress");
      s.status = "in_progress";
    }
  }
  return jsonResponse(await pageModel(sb, s));
}

async function consent(sb: Sb, s: any, body: any, req: Request) {
  if (stateOf(s) !== "open") return fail(409, "not_open");
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  const now = new Date().toISOString();

  if (body.standard !== true) {
    // Spec 06.13: no photo and face consent, no check.
    await addEvent(sb, s, "consent_refused", { what: "standard", ip, ua, version: CONSENT_VERSION });
    await sb.from("verification_sessions").update({ status: "failed", finished_at: now }).eq("id", s.id).in("status", OPEN);
    await sb.from("verification_session_checks").update({ result: "not_run", reason: "The customer did not agree to the check", finished_at: now })
      .eq("session_id", s.id).eq("result", "pending");
    await setCustomerStatus(sb, s.customer_id, s.id, "failed");
    return jsonResponse({ ok: true, state: "failed" });
  }

  const premium = (body.premium && typeof body.premium === "object") ? body.premium : {};
  const { data: checks } = await sb.from("verification_session_checks").select("id, service_key").eq("session_id", s.id);
  const given: string[] = [];
  const refused: string[] = [];
  for (const c of checks ?? []) {
    if (c.service_key === "standard") {
      await sb.from("verification_session_checks").update({ consent: "given" }).eq("id", c.id);
    } else if (c.service_key === "licence_status") {
      // Covered by the line inside the standard consent (spec 06.9).
      await sb.from("verification_session_checks").update({ consent: "given" }).eq("id", c.id);
      given.push(c.service_key);
    } else if (premium[c.service_key] === true) {
      await sb.from("verification_session_checks").update({ consent: "given" }).eq("id", c.id);
      given.push(c.service_key);
    } else {
      // Spec 06.12: refused premium consent is never run, never charged.
      await sb.from("verification_session_checks")
        .update({ consent: "refused", result: "not_run", reason: "The customer did not agree", finished_at: now }).eq("id", c.id);
      refused.push(c.service_key);
    }
  }
  await sb.from("verification_sessions").update({ consent_at: now, consent_text_version: CONSENT_VERSION }).eq("id", s.id);
  await addEvent(sb, s, "consent_given", { version: CONSENT_VERSION, ip, ua, premium_given: given, premium_refused: refused });
  return jsonResponse({ ok: true });
}

async function startDidit(sb: Sb, s: any, body: any) {
  if (stateOf(s) !== "open") return fail(409, "not_open");
  if (!s.consent_at) return fail(409, "no_consent");
  const secondsLeft = (new Date(s.expires_at).getTime() - Date.now()) / 1000;
  try {
    // Same vendor_data returns Didit's existing unfinished session, so reopening carries on (spec 06.16).
    const didit = await createSession({
      sessionId: s.id, tenantId: s.tenant_id, customerId: s.customer_id,
      callback: `${String(s.booking_origin).replace(/\/+$/, "")}/id/${s.token}?done=1`, secondsLeft,
      // Evals pick Didit's test outcome; didit.ts drops it unless the key is a sandbox key.
      sandboxScenario: typeof body.sandboxScenario === "string" ? body.sandboxScenario.slice(0, 80) : undefined,
    });
    if (!s.didit_session_id) {
      await sb.from("verification_sessions").update({ didit_session_id: didit.session_id }).eq("id", s.id);
      await sb.from("verification_session_checks").update({ provider_ref: didit.session_id, started_at: new Date().toISOString() })
        .eq("session_id", s.id).eq("service_key", "standard");
      // The "check started" moment comes from Didit's own In Progress webhook (brief 6.3).
    }
    return jsonResponse({ url: didit.url });
  } catch (e) {
    if (e instanceof DiditUnavailable) return fail(503, "provider_unavailable");
    throw e;
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const s = await sessionFor(sb, body.token);
    if (!s) return fail(404, "unknown");
    if (!(await withinLimit(sb, s))) return fail(429, "too_many");
    switch (body.action) {
      case "open": return await open(sb, s);
      case "consent": return await consent(sb, s, body, req);
      case "start-didit": return await startDidit(sb, s, body);
      default: return fail(400, "unknown_action");
    }
  } catch (e) {
    console.error("[verification-v2-link]", String((e as Error)?.message ?? e));
    return fail(500, "server_error");
  }
});
