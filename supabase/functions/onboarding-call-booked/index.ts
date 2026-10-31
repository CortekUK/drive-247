// =============================================================================
// onboarding-call-booked — LeadConnector tells us about Brian's calendar.
//
// Brian's onboarding calls are booked on a LeadConnector (GoHighLevel)
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
// Every request is kept in onboarding_call_events, matched or not, so Brian
// can place a booking we could not. Always 200 once authenticated —
// LeadConnector retries anything else, and a retry would not match any better.
//
// Auth: verify_jwt = false (LeadConnector has no Supabase JWT). The `key`
// query parameter must equal private.platform_config.onboarding_call_webhook_key.
// =============================================================================

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const LOG = "[onboarding-call-booked]";

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

    // One email can own more than one tenant: the newest V2 one is the one
    // that was offered the call.
    const { data: candidates } = await supabase
      .from("tenants")
      .select("id, created_at, portal_experience")
      .in("id", [...ids])
      .order("created_at", { ascending: false });
    const tenant = (candidates ?? []).find((t: any) => t.portal_experience === "v2") ?? (candidates ?? [])[0];
    if (!tenant) return await record("no tenant with that email", null);

    const { data: row } = await supabase
      .from("tenant_onboarding_calls")
      .select("call_booked_at, call_booked_via, call_completed_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    let values: Record<string, unknown>;
    let outcome: string;
    if (kind === "booked") {
      values = {
        call_booked_at: row?.call_booked_at ?? new Date().toISOString(),
        call_booked_via: "calendar",
        call_scheduled_for: startsAt,
      };
      outcome = row?.call_booked_at ? "booking updated" : "booked";
    } else if (kind === "showed") {
      values = { call_completed_at: row?.call_completed_at ?? new Date().toISOString() };
      outcome = "call done";
    } else {
      // Cancelled or no-show: offer the calendar again. Never undo a call
      // already marked done, and never a booking Brian entered by hand.
      if (row?.call_completed_at) return await record(`${kind} ignored: call already done`, tenant.id);
      if (row?.call_booked_via === "admin") return await record(`${kind} ignored: booking was entered in admin`, tenant.id);
      values = { call_booked_at: null, call_booked_via: null, call_scheduled_for: null };
      outcome = kind === "noshow" ? "no-show: open to book again" : "cancelled: open to book again";
    }

    const { error } = await supabase
      .from("tenant_onboarding_calls")
      .upsert({ tenant_id: tenant.id, ...values }, { onConflict: "tenant_id" });
    if (error) throw error;
    return await record(outcome, tenant.id);
  } catch (e) {
    console.error(`${LOG} error`, e);
    return await record(`error: ${e instanceof Error ? e.message : String(e)}`, null);
  }
});
