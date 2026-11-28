/**
 * verification-v2 · feat-003 driver verification, part 1 (specs 03, 04, 05, 08.19, 10.15, 12.4).
 *
 * The portal's one door into the new module. Staff JWT required; the company always comes from the
 * caller's own app_users row (or, for a super admin, the portal they are acting in), never the body.
 * A NEW function beside the old flow: create-ai-verification-session and friends are untouched (spec 12.9).
 *
 * Actions: context, start, resend, cancel, status, photos, run-premium, usage.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { resolveTenantId } from "../_shared/resolve-tenant.ts";
import { deleteSession } from "../_shared/verification/didit.ts";
import { bookingOriginFor, newToken, renterUrl } from "../_shared/verification/link.ts";
import { canStart, canTickPremium, isVerificationEnabled, premiumAllowedBySubscription } from "../_shared/verification/permissions.ts";
import { startPremiumChecks } from "../_shared/verification/premium.ts";
import { isTestAddress, sendLinkEmail, sendLinkSms, smsAvailable } from "../_shared/verification/send.ts";
import { addEvent, audit, OPEN, PHOTO_BUCKET, setCustomerStatus } from "../_shared/verification/store.ts";

type Sb = SupabaseClient;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_HOUR = 10;      // spec 05.9
const MAX_REMINDERS = 3;      // spec 05.11
const REMINDER_GAP_MS = 60_000;

const fail = (status: number, error: string, message?: string) => jsonResponse({ error, message: message ?? error }, status);

interface Caller {
  appUserId: string;
  role: string;
  isSuperAdmin: boolean;
  tenantId: string;
  slug: string;
  company: string;
  canEditCustomers: boolean;
}

async function callerFor(sb: Sb, req: Request, body: any): Promise<Caller | Response> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "unauthorized");
  const { data: { user } } = await sb.auth.getUser(jwt);
  if (!user) return fail(401, "unauthorized");
  const { data: appUser } = await sb.from("app_users")
    .select("id, tenant_id, role, is_super_admin, is_active").eq("auth_user_id", user.id).maybeSingle();
  if (!appUser || appUser.is_active === false) return fail(403, "not_allowed");
  const t = await resolveTenantId(sb, req, appUser, body?.tenantSlug ?? null);
  if (!t.tenantId) return fail(t.errorStatus || 403, "no_tenant", t.errorMessage ?? undefined);
  const { data: tenant } = await sb.from("tenants").select("slug, company_name").eq("id", t.tenantId).single();
  if (!tenant || !isVerificationEnabled(tenant.slug)) return fail(403, "not_enabled", "Verification is not switched on for this company");
  let canEditCustomers = appUser.role !== "viewer";
  if (appUser.role === "manager") {
    const { data: grant } = await sb.from("manager_permissions").select("access_level")
      .eq("app_user_id", appUser.id).eq("tab_key", "customers").maybeSingle();
    canEditCustomers = grant?.access_level === "editor";
  }
  return {
    appUserId: appUser.id, role: appUser.role, isSuperAdmin: !!appUser.is_super_admin, tenantId: t.tenantId,
    slug: tenant.slug, company: (tenant.company_name || "Drive 247").trim(), canEditCustomers,
  };
}

async function subscriptionStatus(sb: Sb, tenantId: string): Promise<string | null> {
  const { data } = await sb.from("tenant_subscriptions").select("status").eq("tenant_id", tenantId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.status ?? null;
}

async function customerOf(sb: Sb, c: Caller, customerId: unknown) {
  if (typeof customerId !== "string") return null;
  const { data } = await sb.from("customers")
    .select("id, name, email, phone, license_state, verification_status, verification_session_id")
    .eq("id", customerId).eq("tenant_id", c.tenantId).maybeSingle();
  return data;
}

async function sessionOf(sb: Sb, c: Caller, sessionId: unknown) {
  if (typeof sessionId !== "string") return null;
  const { data } = await sb.from("verification_sessions").select("*").eq("id", sessionId).eq("tenant_id", c.tenantId).maybeSingle();
  return data;
}

function isOpen(s: { status: string; expires_at: string }): boolean {
  return OPEN.includes(s.status) && new Date(s.expires_at).getTime() > Date.now();
}

/** Spec 03.2: an open session past its end shows as expired before the sweep writes it. */
function shownStatus(s: { status: string; expires_at: string } | null): string {
  if (!s) return "not_verified";
  if (OPEN.includes(s.status) && new Date(s.expires_at).getTime() <= Date.now()) return "expired";
  return s.status;
}

// ── context (spec 04.17) ──────────────────────────────────────────────────────
async function context(sb: Sb, c: Caller, body: any) {
  const customer = await customerOf(sb, c, body.customerId);
  if (!customer) return fail(404, "not_found");
  const [{ data: services }, { data: prefs }, subStatus, sms, { data: latest }, { data: lastVerified }] = await Promise.all([
    sb.from("verification_services").select("key, name, description, kind, availability, provider_cost_cents, margin_cents, has_state_fee, sort_order").order("sort_order"),
    sb.from("verification_tenant_prefs").select("last_ticks").eq("tenant_id", c.tenantId).maybeSingle(),
    subscriptionStatus(sb, c.tenantId),
    smsAvailable(sb, c.tenantId),
    sb.from("verification_sessions").select("id, status, expires_at, token, booking_origin, sent_via, sent_to")
      .eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("verification_sessions").select("finished_at").eq("customer_id", customer.id).eq("status", "verified")
      .order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const knownState = customer.license_state && /^[A-Za-z]{2}$/.test(customer.license_state) ? customer.license_state.toUpperCase() : null;
  const stateFees: Record<string, number> = {};
  if (knownState) {
    const { data: fees } = await sb.from("verification_state_fees").select("service_key, fee_cents").eq("state", knownState);
    for (const f of fees ?? []) stateFees[f.service_key] = f.fee_cents;
  }
  const open = latest && isOpen(latest)
    ? { id: latest.id, status: latest.status, expiresAt: latest.expires_at, link: renterUrl(latest.booking_origin, latest.token), sentVia: latest.sent_via, sentTo: latest.sent_to }
    : null;
  return jsonResponse({
    services: services ?? [],
    lastTicks: prefs?.last_ticks ?? ["standard"],
    canStart: canStart(c.role, c.canEditCustomers, c.isSuperAdmin),
    canTickPremium: canTickPremium(c.role, c.canEditCustomers, c.isSuperAdmin),
    premiumBySubscription: premiumAllowedBySubscription(subStatus),
    subscriptionStatus: subStatus,
    smsAvailable: sms,
    knownState,
    stateFees,
    openSession: open,
    status: shownStatus(latest ?? null),
    lastVerifiedAt: lastVerified?.finished_at ?? null,
    customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
  });
}

// ── sending one link (spec 05.2 to 05.6) ─────────────────────────────────────
async function deliver(sb: Sb, c: Caller, session: any, customer: any, sentVia: string, sendTo: string | null, kindForSend: "first" | "reminder") {
  const url = renterUrl(session.booking_origin, session.token);
  if (sentVia === "email") {
    const r = await sendLinkEmail(sb, c.tenantId, sendTo!, customer.name ?? "", url, session.expires_at);
    if (!r.ok) return { ok: false, error: r.error };
    await addEvent(sb, session, kindForSend === "first" ? "link_emailed" : "reminder_sent", { via: "email", to: sendTo, delivered: r.delivered });
  } else if (sentVia === "sms") {
    const r = await sendLinkSms(sb, c.tenantId, sendTo!, c.company, url);
    if (!r.ok) return { ok: false, error: r.error };
    await addEvent(sb, session, kindForSend === "first" ? "link_texted" : "reminder_sent", { via: "sms", to: sendTo });
  } else if (sentVia === "qr") {
    await addEvent(sb, session, kindForSend === "first" ? "code_shown" : "reminder_sent", { via: "qr" });
  } else {
    await addEvent(sb, session, kindForSend === "first" ? "link_copied" : "reminder_sent", { via: "copy" });
  }
  return { ok: true, url };
}

async function resolveSendTo(sb: Sb, c: Caller, customer: any, sentVia: string, sendTo: unknown): Promise<{ to: string | null } | Response> {
  if (sentVia === "email") {
    const to = (typeof sendTo === "string" && sendTo.trim() ? sendTo : customer.email ?? "").trim().toLowerCase();
    if (!to) return fail(400, "no_email", "Add an email address to send the link to");
    if (!EMAIL_RE.test(to)) return fail(400, "bad_email", "That email address doesn't look right");
    return { to };
  }
  if (sentVia === "sms") {
    const to = (typeof sendTo === "string" && sendTo.trim() ? sendTo : customer.phone ?? "").trim();
    if (!to || !(await smsAvailable(sb, c.tenantId))) return fail(400, "sms_not_available", "Texts are not available for this customer");
    return { to };
  }
  if (sentVia === "qr" || sentVia === "copy") return { to: null };
  return fail(400, "bad_sent_via");
}

// ── start (spec 05.1 to 05.9, 04.9) ──────────────────────────────────────────
async function start(sb: Sb, c: Caller, body: any, req: Request) {
  if (!canStart(c.role, c.canEditCustomers, c.isSuperAdmin)) return fail(403, "not_allowed");
  const customer = await customerOf(sb, c, body.customerId);
  if (!customer) return fail(404, "not_found");

  const wanted: string[] = Array.isArray(body.services) ? [...new Set(["standard", ...body.services.map(String)])] : ["standard"];
  const { data: services } = await sb.from("verification_services").select("key, kind, availability, provider_cost_cents, margin_cents").in("key", wanted);
  if ((services ?? []).length !== wanted.length) return fail(400, "bad_services");
  if (services!.some((s: any) => s.availability !== "live")) return fail(400, "bad_services", "A ticked check is not available");
  const premium = services!.filter((s: any) => s.kind === "premium");
  if (premium.length) {
    if (!canTickPremium(c.role, c.canEditCustomers, c.isSuperAdmin)) return fail(403, "premium_not_allowed");
    if (!premiumAllowedBySubscription(await subscriptionStatus(sb, c.tenantId))) {
      return fail(402, "subscription_required", "Subscribe to use premium checks");
    }
  }

  const sentVia = String(body.sentVia ?? "");
  const target = await resolveSendTo(sb, c, customer, sentVia, body.sendTo);
  if (target instanceof Response) return target;

  // Spec 05.9: refused on an error, never let through.
  const { count, error: countError } = await sb.from("verification_sessions").select("id", { count: "exact", head: true })
    .eq("customer_id", customer.id).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if (countError || count === null) return fail(503, "try_again");
  if (count >= MAX_PER_HOUR) return fail(429, "too_many", "Too many checks for this customer in the last hour");

  // Spec 05.8: end the open one first (the index allows one open session per customer).
  const { data: old } = await sb.from("verification_sessions").select("id, didit_session_id")
    .eq("customer_id", customer.id).in("status", OPEN).maybeSingle();
  if (old) {
    await sb.from("verification_sessions").update({ status: "not_verified" }).eq("id", old.id);
    await sb.from("verification_session_checks").update({ result: "not_run", reason: "Replaced by a newer check" })
      .eq("session_id", old.id).eq("result", "pending");
  }

  const now = Date.now();
  const { data: session, error } = await sb.from("verification_sessions").insert({
    tenant_id: c.tenantId, customer_id: customer.id, started_by: c.appUserId, status: "link_sent", token: newToken(),
    expires_at: new Date(now + DAY_MS).toISOString(), sent_via: sentVia, sent_to: target.to,
    booking_origin: bookingOriginFor(c.slug, req),
  }).select("*").single();
  if (error || !session) {
    console.error("[verification-v2] start insert failed", error?.message);
    return fail(503, "try_again");
  }
  await sb.from("verification_session_checks").insert(services!.map((s: any) => ({
    session_id: session.id, tenant_id: c.tenantId, service_key: s.key,
    provider_cost_cents: s.provider_cost_cents, margin_cents: s.margin_cents, // frozen (spec 09.5)
  })));
  await addEvent(sb, session, "session_created", { services: wanted, by: c.appUserId });
  if (old) {
    await sb.from("verification_sessions").update({ replaced_by: session.id }).eq("id", old.id);
    await addEvent(sb, { id: old.id, tenant_id: c.tenantId }, "replaced", { by: session.id });
    if (old.didit_session_id) await deleteSession(old.didit_session_id);
  }
  await setCustomerStatus(sb, customer.id, session.id, "link_sent");
  await sb.from("verification_tenant_prefs").upsert({ tenant_id: c.tenantId, last_ticks: wanted, updated_at: new Date().toISOString() });

  if (sentVia === "email" && body.saveEmail !== false && target.to && target.to !== (customer.email ?? "").toLowerCase() && !isTestAddress(target.to)) {
    await sb.from("customers").update({ email: target.to }).eq("id", customer.id); // spec 05.3
  }

  const sent = await deliver(sb, c, session, customer, sentVia, target.to, "first");
  await audit(sb, { tenantId: c.tenantId, actorId: c.appUserId, isSuperAdmin: c.isSuperAdmin, action: "verification_started",
    entityId: customer.id, details: { session_id: session.id, services: wanted, sent_via: sentVia } });
  return jsonResponse({
    sessionId: session.id, link: renterUrl(session.booking_origin, session.token), expiresAt: session.expires_at,
    ...(sent.ok ? {} : { sendError: sent.error }),
  });
}

// ── resend (spec 05.10, 05.11) ───────────────────────────────────────────────
async function resend(sb: Sb, c: Caller, body: any) {
  if (!canStart(c.role, c.canEditCustomers, c.isSuperAdmin)) return fail(403, "not_allowed");
  const session = await sessionOf(sb, c, body.sessionId);
  if (!session) return fail(404, "not_found");
  if (!isOpen(session)) return fail(409, "not_open");
  if (session.reminders_sent >= MAX_REMINDERS) return fail(429, "too_many", "Three reminders have been sent already");
  const { data: last } = await sb.from("verification_session_events").select("at").eq("session_id", session.id)
    .in("kind", ["link_emailed", "link_texted", "reminder_sent", "session_created"]).order("at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.at).getTime() < REMINDER_GAP_MS) return fail(429, "too_soon", "Wait a minute before sending again");
  const { data: customer } = await sb.from("customers").select("id, name, email, phone").eq("id", session.customer_id).single();
  const sentVia = String(body.sentVia ?? session.sent_via);
  const target = await resolveSendTo(sb, c, customer, sentVia, body.sendTo ?? session.sent_to);
  if (target instanceof Response) return target;
  const sent = await deliver(sb, c, session, customer, sentVia, target.to, "reminder");
  if (!sent.ok) return fail(502, "send_failed", sent.error);
  await sb.from("verification_sessions").update({ reminders_sent: session.reminders_sent + 1 }).eq("id", session.id);
  await audit(sb, { tenantId: c.tenantId, actorId: c.appUserId, isSuperAdmin: c.isSuperAdmin, action: "verification_reminded",
    entityId: session.customer_id, details: { session_id: session.id, sent_via: sentVia } });
  return jsonResponse({ ok: true, link: sent.url });
}

// ── cancel (spec 05.12) ──────────────────────────────────────────────────────
async function cancel(sb: Sb, c: Caller, body: any) {
  if (!canStart(c.role, c.canEditCustomers, c.isSuperAdmin)) return fail(403, "not_allowed");
  const session = await sessionOf(sb, c, body.sessionId);
  if (!session) return fail(404, "not_found");
  const { data: moved } = await sb.from("verification_sessions")
    .update({ status: "not_verified", cancelled_at: new Date().toISOString(), cancelled_by: c.appUserId })
    .eq("id", session.id).in("status", OPEN).select("id");
  if (!moved?.length) return fail(409, "not_open");
  await sb.from("verification_session_checks").update({ result: "not_run", reason: "Cancelled" }).eq("session_id", session.id).eq("result", "pending");
  await addEvent(sb, session, "cancelled", { by: c.appUserId });
  if (session.didit_session_id) await deleteSession(session.didit_session_id);
  await setCustomerStatus(sb, session.customer_id, session.id, "not_verified");
  await audit(sb, { tenantId: c.tenantId, actorId: c.appUserId, isSuperAdmin: c.isSuperAdmin, action: "verification_cancelled",
    entityId: session.customer_id, details: { session_id: session.id } });
  return jsonResponse({ ok: true });
}

// ── status (spec 05.14, 03.7) ────────────────────────────────────────────────
async function status(sb: Sb, c: Caller, body: any) {
  let session = await sessionOf(sb, c, body.sessionId);
  if (!session && typeof body.customerId === "string") {
    const customer = await customerOf(sb, c, body.customerId);
    if (!customer) return fail(404, "not_found");
    const { data } = await sb.from("verification_sessions").select("*").eq("customer_id", customer.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    session = data;
    if (!session) return jsonResponse({ status: "not_verified", session: null, events: [], checks: [] });
  }
  if (!session) return fail(404, "not_found");
  const [{ data: events }, { data: checks }] = await Promise.all([
    sb.from("verification_session_events").select("kind, detail, at").eq("session_id", session.id).order("at"),
    sb.from("verification_session_checks").select("service_key, result, lines, reason, finished_at, provider_cost_cents, margin_cents, state_fee_cents").eq("session_id", session.id),
  ]);
  return jsonResponse({
    status: shownStatus(session),
    session: {
      id: session.id, createdAt: session.created_at, expiresAt: session.expires_at, finishedAt: session.finished_at,
      sentVia: session.sent_via, sentTo: session.sent_to, remindersSent: session.reminders_sent,
      link: isOpen(session) ? renterUrl(session.booking_origin, session.token) : null,
    },
    events: (events ?? []).map((e: any) => ({ kind: e.kind, at: e.at, detail: { ...e.detail, provider_event_id: undefined } })),
    checks: checks ?? [],
  });
}

// ── photos (spec 12.4) ───────────────────────────────────────────────────────
async function photos(sb: Sb, c: Caller, body: any) {
  const session = await sessionOf(sb, c, body.sessionId);
  if (!session) return fail(404, "not_found");
  const { data: std } = await sb.from("verification_session_checks").select("raw").eq("session_id", session.id).eq("service_key", "standard").maybeSingle();
  const paths: Record<string, string> = (std?.raw as any)?.photos ?? {};
  const out: Record<string, string | null> = { front: null, back: null, selfie: null };
  for (const [name, path] of Object.entries(paths)) {
    const { data } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 600);
    out[name] = data?.signedUrl ?? null;
  }
  await audit(sb, { tenantId: c.tenantId, actorId: c.appUserId, isSuperAdmin: c.isSuperAdmin, action: "verification_photos_viewed",
    entityId: session.customer_id, details: { session_id: session.id } });
  return jsonResponse(out);
}

// ── run-premium (spec 08.19) ─────────────────────────────────────────────────
async function runPremium(sb: Sb, c: Caller, body: any, req: Request) {
  const customer = await customerOf(sb, c, body.customerId);
  if (!customer) return fail(404, "not_found");
  if (!canTickPremium(c.role, c.canEditCustomers, c.isSuperAdmin)) return fail(403, "premium_not_allowed");
  if (!premiumAllowedBySubscription(await subscriptionStatus(sb, c.tenantId))) return fail(402, "subscription_required");
  if (customer.verification_status !== "verified") return fail(409, "not_verified", "Verify the customer first");
  const { data: service } = await sb.from("verification_services").select("key, kind, availability, provider_cost_cents, margin_cents")
    .eq("key", String(body.service ?? "")).maybeSingle();
  if (!service || service.kind !== "premium" || service.availability !== "live") return fail(400, "bad_services");

  const now = new Date();
  const { data: session, error } = await sb.from("verification_sessions").insert({
    tenant_id: c.tenantId, customer_id: customer.id, started_by: c.appUserId, status: "verified", token: newToken(),
    expires_at: new Date(now.getTime() + DAY_MS).toISOString(), sent_via: "copy", finished_at: now.toISOString(),
    booking_origin: bookingOriginFor(c.slug, req),
  }).select("*").single();
  if (error || !session) return fail(503, "try_again");
  await sb.from("verification_session_checks").insert({
    session_id: session.id, tenant_id: c.tenantId, service_key: service.key,
    provider_cost_cents: service.provider_cost_cents, margin_cents: service.margin_cents,
  });
  await addEvent(sb, session, "session_created", { services: [service.key], rerun: true, by: c.appUserId });
  await setCustomerStatus(sb, customer.id, session.id, "verified");
  await startPremiumChecks(sb, session.id);
  await audit(sb, { tenantId: c.tenantId, actorId: c.appUserId, isSuperAdmin: c.isSuperAdmin, action: "verification_premium_rerun",
    entityId: customer.id, details: { session_id: session.id, service: service.key } });
  return jsonResponse({ sessionId: session.id });
}

// ── usage (spec 10.14, 10.15) ────────────────────────────────────────────────
async function usage(sb: Sb, c: Caller, body: any) {
  const from = typeof body.periodStart === "string" ? body.periodStart : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const to = typeof body.periodEnd === "string" ? body.periodEnd : new Date().toISOString();
  const { data: checks } = await sb.from("verification_session_checks")
    .select("id, service_key, result, finished_at, verification_sessions!inner(customer_id, customers(name))")
    .eq("tenant_id", c.tenantId).gte("finished_at", from).lt("finished_at", to).in("result", ["pass", "fail", "could_not_check"])
    .order("finished_at", { ascending: false });
  const { data: charges } = await sb.from("verification_charges")
    .select("session_id, service_key, total_cents, sent_at, last_error, customer_name, created_at")
    .eq("tenant_id", c.tenantId).gte("created_at", from).lt("created_at", to);
  const standardCount = (checks ?? []).filter((k: any) => k.service_key === "standard").length;
  return jsonResponse({
    standardCount,
    checks: (checks ?? []).map((k: any) => ({
      service: k.service_key, result: k.result, at: k.finished_at, customer: k.verification_sessions?.customers?.name ?? null,
    })),
    charges: (charges ?? []).map((ch: any) => ({
      service: ch.service_key, customer: ch.customer_name, at: ch.created_at, cents: ch.total_cents,
      billed: !!ch.sent_at, held: ch.last_error === "state_fee_unknown",
    })),
  });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const caller = await callerFor(sb, req, body);
    if (caller instanceof Response) return caller;
    switch (body.action) {
      case "context": return await context(sb, caller, body);
      case "start": return await start(sb, caller, body, req);
      case "resend": return await resend(sb, caller, body);
      case "cancel": return await cancel(sb, caller, body);
      case "status": return await status(sb, caller, body);
      case "photos": return await photos(sb, caller, body);
      case "run-premium": return await runPremium(sb, caller, body, req);
      case "usage": return await usage(sb, caller, body);
      default: return fail(400, "unknown_action");
    }
  } catch (e) {
    console.error("[verification-v2]", String((e as Error)?.message ?? e));
    return fail(500, "server_error", "Something went wrong");
  }
});
