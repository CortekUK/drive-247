// =============================================================================
// onboarding-call-booked — LeadConnector tells us about Bryan's calendar.
//
// Bryan's onboarding calls are booked on a LeadConnector (GoHighLevel)
// calendar, embedded in the Portal V2 home card. LeadConnector sends nothing
// back on its own, so a LeadConnector workflow ("Customer Booked Appointment"
// and "Appointment Status" triggers → Webhook action) POSTs here:
//
//   POST /functions/v1/onboarding-call-booked?key=<onboarding_call_webhook_key>
//
// and we find the tenant by the booker's email (tenant contact email, or the
// email of one of its admin logins — the portal pre-fills the calendar with
// the signed-in user's email so this matches) and update its row:
//
//   booked / confirmed / rescheduled  → booked, with the call time
//   cancelled / no-show               → not booked again, so the card offers
//                                       the calendar again (only when the
//                                       booking came from the calendar)
//   showed                            → call done
//
// Only tenants being offered the onboarding call (Portal V2) are touched; a
// V1 customer booking on the shared Support calendar is logged and ignored.
// Every request is kept in onboarding_call_events, matched or not, so Bryan
// can place a booking we could not. Always 200 once authenticated —
// LeadConnector retries anything else, and a retry would not match any better.
//
// Auth: verify_jwt = false (LeadConnector has no Supabase JWT). The `key`
// query parameter must equal private.platform_config.onboarding_call_webhook_key.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { buildBookingNoticeHtml, callEventValues } from "../_shared/onboarding-call-journey.ts";

const LOG = "[onboarding-call-booked]";

/**
 * Email Bryan the customer's account details for a new or moved booking. Never
 * throws: the booking is already saved, and a failed notice must not undo that.
 * Recipients come from the ONBOARDING_CALL_NOTIFY_EMAILS secret (comma separated).
 */
async function notifyBryan(
  supabase: any,
  tenantId: string,
  booker: { name: string; email: string; startsAt: string; timezone: string },
): Promise<void> {
  const to = (Deno.env.get("ONBOARDING_CALL_NOTIFY_EMAILS") ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  if (to.length === 0) {
    console.warn(`${LOG} ONBOARDING_CALL_NOTIFY_EMAILS is not set, no booking notice sent`);
    return;
  }
  try {
    const [{ data: t }, { data: sub }, { count }, { data: signup }] = await Promise.all([
      supabase.from("tenants")
        .select("slug, company_name, contact_phone, phone, created_at, logo_url, subscription_plan")
        .eq("id", tenantId).maybeSingle(),
      supabase.from("tenant_subscriptions").select("status, trial_end").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      // "*" rather than a column list: fleet_size and exit_offer_seen_at
      // arrive with a migration, and naming them would fail the whole read
      // (and the notice) until it is applied.
      supabase.from("signup_attribution").select("*").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!t) return;
    const companyName = t.company_name || t.slug;
    const result = await sendResendEmail({
      to,
      subject: `New onboarding call: ${companyName}`,
      html: buildBookingNoticeHtml({
        companyName,
        slug: t.slug,
        bookerName: booker.name,
        bookerEmail: booker.email,
        phone: t.contact_phone || t.phone || signup?.phone,
        startsAt: booker.startsAt,
        timezone: booker.timezone,
        subscriptionStatus: sub?.status,
        trialEnd: sub?.trial_end,
        plan: t.subscription_plan,
        signedUpAt: t.created_at,
        vehicleCount: count ?? 0,
        hasLogo: !!String(t.logo_url ?? "").trim(),
        heardAbout: signup?.heard_about_other || signup?.heard_about,
        fleetSize: signup?.fleet_size,
        exitOfferSeenAt: signup?.exit_offer_seen_at,
      }),
      fromName: "Drive247",
      replyTo: booker.email,
      tenantId,
      source: "onboarding-call-booked",
      idempotencyKey: `onboarding-call-notice-${tenantId}-${booker.startsAt}`,
    });
    if (!result.success) {
      console.error(`${LOG} booking notice failed:`, result.error);
      return;
    }
    const { error } = await supabase.from("tenant_onboarding_calls")
      .update({ booking_notified_for: booker.startsAt }).eq("tenant_id", tenantId);
    if (error) console.error(`${LOG} notice sent but not recorded:`, error.message);
  } catch (e) {
    console.error(`${LOG} booking notice threw:`, e);
  }
}

type Kind = "booked" | "cancelled" | "noshow" | "showed" | "unknown";

function kindOf(raw: string): Kind {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!s || ["booked", "confirmed", "new", "rescheduled", "scheduled"].includes(s)) return "booked";
  if (s === "cancelled" || s === "canceled" || s === "invalid") return "cancelled";
  if (s === "noshow") return "noshow";
  if (s === "showed" || s === "completed") return "showed";
  return "unknown";
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/**
 * LeadConnector sends `startTime` as wall-clock time in `selectedTimezone`
 * ("2026-11-04T15:00:00"), sometimes with an offset. Turn either into UTC.
 */
function toUtc(value: string, tz: string): string | null {
  if (!value) return null;
  const normalised = value.includes("T") ? value : value.replace(" ", "T");
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(normalised)) {
    const t = Date.parse(normalised);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const asUtc = Date.parse(`${normalised}Z`);
  if (!Number.isFinite(asUtc)) return null;
  try {
    // How far `tz` is from UTC at that moment, then shift back by it.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(asUtc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return new Date(asUtc - (wall - asUtc)).toISOString();
  } catch {
    return new Date(asUtc).toISOString();
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const key = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-webhook-key");
  const { data: ok, error: keyErr } = await supabase.rpc("verify_onboarding_call_webhook_key", { p_key: key });
  if (keyErr) console.error(`${LOG} key check failed`, keyErr.message);
  if (ok !== true) return errorResponse("Unauthorized", 401);

  let payload: Record<string, any> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, outcome: "unreadable body" });
  }

  const cal = (payload.calendar && typeof payload.calendar === "object" ? payload.calendar : {}) as Record<string, any>;
  const email = (str(payload.email) || str(payload.contact?.email) || str(cal.email)).toLowerCase();
  const name = str(payload.full_name) || [str(payload.first_name), str(payload.last_name)].filter(Boolean).join(" ");
  const statusRaw =
    str(cal.appointmentStatus) || str(cal.appoinmentStatus) || str(cal.status) || str(payload.appointment_status) || str(payload.status);
  const kind = kindOf(statusRaw);
  const startsAt = toUtc(str(cal.startTime) || str(payload.start_time) || str(payload.startTime), str(cal.selectedTimezone) || str(payload.timezone));

  const record = async (outcome: string, tenantId: string | null) => {
    const { error } = await supabase.from("onboarding_call_events").insert({
      email: email || null,
      name: name || null,
      status: statusRaw || null,
      starts_at: startsAt,
      tenant_id: tenantId,
      outcome,
      payload,
    });
    if (error) console.error(`${LOG} could not log event`, error.message);
    console.log(`${LOG} ${email || "(no email)"} ${statusRaw || "(no status)"} → ${outcome}`);
    return jsonResponse({ ok: true, outcome });
  };

  try {
    if (!email) return await record("no email in payload", null);
    if (kind === "unknown") return await record(`ignored status "${statusRaw}"`, null);

    // --- which tenant? contact email first, then an admin login's email ---
    const [{ data: byContact }, { data: byLogin }] = await Promise.all([
      supabase.from("tenants").select("id, created_at, portal_experience").ilike("contact_email", email),
      supabase.from("app_users").select("tenant_id").ilike("email", email).not("tenant_id", "is", null)
        .in("role", ["head_admin", "admin"]),
    ]);
    const ids = new Set<string>([
      ...(byContact ?? []).map((t: any) => t.id),
      ...(byLogin ?? []).map((u: any) => u.tenant_id),
    ]);
    if (ids.size === 0) return await record("no tenant with that email", null);

    // Portal V2 only. The calendar is the shared "Drive247 Support" one, so
    // V1 customers book on it too: only a tenant that is being offered the
    // onboarding call right now (onboarding_call_eligible — the same rule as
    // the portal card: V2, first 30 days or trialing, plus the canary) is
    // touched. Anything else is logged and left alone. One email can own more
    // than one tenant, so the newest eligible one wins.
    const { data: candidates } = await supabase
      .from("tenants")
      .select("id, created_at, portal_experience")
      .in("id", [...ids])
      .order("created_at", { ascending: false });
    let tenant: { id: string } | null = null;
    for (const t of candidates ?? []) {
      const { data: eligible, error: eErr } = await supabase.rpc("onboarding_call_eligible", { p_tenant_id: t.id });
      if (eErr) throw eErr;
      if (eligible === true) {
        tenant = t;
        break;
      }
    }
    if (!tenant) return await record("ignored: not a Portal V2 operator in onboarding", null);

    const { data: row } = await supabase
      .from("tenant_onboarding_calls")
      .select("call_booked_at, call_booked_via, call_completed_at, booking_notified_for")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    let outcome: string;
    if (kind === "booked") {
      outcome = row?.call_booked_at ? "booking updated" : "booked";
    } else if (kind === "showed") {
      outcome = "call done";
    } else {
      // Cancelled or no-show: offer the calendar again. Never undo a call
      // already marked done, and never a booking Bryan entered by hand.
      if (row?.call_completed_at) return await record(`${kind} ignored: call already done`, tenant.id);
      if (row?.call_booked_via === "admin") return await record(`${kind} ignored: booking was entered in admin`, tenant.id);
      outcome = kind === "noshow" ? "no-show: open to book again" : "cancelled: open to book again";
    }

    const { error } = await supabase
      .from("tenant_onboarding_calls")
      .upsert({ tenant_id: tenant.id, ...callEventValues(kind, row, startsAt, new Date().toISOString()) }, { onConflict: "tenant_id" });
    if (error) throw error;

    // A repeated webhook for the same call time must not email Bryan twice.
    const alreadyTold =
      !!row?.booking_notified_for && !!startsAt &&
      new Date(row.booking_notified_for).getTime() === new Date(startsAt).getTime();
    if (kind === "booked" && startsAt && !alreadyTold) {
      await notifyBryan(supabase, tenant.id, { name, email, startsAt, timezone: str(cal.selectedTimezone) || str(payload.timezone) });
    }
    return await record(outcome, tenant.id);
  } catch (e) {
    console.error(`${LOG} error`, e);
    return await record(`error: ${e instanceof Error ? e.message : String(e)}`, null);
  }
});
