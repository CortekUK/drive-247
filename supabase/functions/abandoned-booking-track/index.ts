// abandoned-booking-track — PUBLIC (verify_jwt = false).
//
// POST  from the booking sites (V1 wizard and V2 vehicle page) via
//       apps/booking/src/lib/abandoned-booking-tracker.ts, as the renter moves
//       through the steps. Upserts one abandoned_bookings row per
//       (tenant, browser session). Never creates a row for "completed" alone —
//       a completion only closes a session we already know about.
// POST  { action: "resume", token, tenantId }  from the booking site when the
//       renter opens "Finish your booking" (?resume=<recovery_token>): returns
//       what they had entered so the site reopens their step.
// GET   ?unsubscribe=<recovery_token>  the link in the recovery email's footer.
//
// Anyone can call this, so it trusts nothing: the tenant must exist, the car
// and the rental must belong to that tenant, strings are clipped, and a session
// that is already converted is never reopened. Sending is decided elsewhere
// (abandoned-recovery-run), with its own limits.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { STAGE_RANK } from "../_shared/abandoned-recovery.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const clip = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);

/**
 * The V1 wizard fields kept for "Finish your booking" (resume_state), with the
 * longest value each may hold. Only fields with no column of their own: the
 * car, dates and contact details are in their checked columns, and a copy here
 * must not be able to override them. An allow-list, so date of birth, licence,
 * home address and verification ids can never be stored however the payload is
 * built — the renter re-enters those on the Details step.
 */
const RESUME_STRINGS: Record<string, number> = {
  dropoffLocation: 300,
  pickupLocationId: 80,
  returnLocationId: 80,
  promoCode: 60,
  customerTimezone: 80,
  specialRequests: 1000,
};
const RESUME_NUMBERS = ["pickupDeliveryFee", "returnDeliveryFee"];

function resumeStateFrom(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, max] of Object.entries(RESUME_STRINGS)) {
    const s = clip(src[key], max);
    if (s) out[key] = s;
  }
  for (const key of RESUME_NUMBERS) {
    const n = src[key];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100_000) out[key] = Math.round(n * 100) / 100;
  }
  // The wizard keeps extras as { extraId: quantity } (its store types it loosely).
  const extrasSrc = src.selectedExtras;
  if (extrasSrc && typeof extrasSrc === "object" && !Array.isArray(extrasSrc)) {
    const extras: Record<string, number> = {};
    for (const [id, qty] of Object.entries(extrasSrc as Record<string, unknown>).slice(0, 50)) {
      if (uuid(id) && typeof qty === "number" && Number.isInteger(qty) && qty > 0 && qty < 100) extras[id] = qty;
    }
    if (Object.keys(extras).length) out.selectedExtras = extras;
  }
  return Object.keys(out).length ? out : null;
}

const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function page(title: string, message: string, status = 200) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#080812;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">` +
    `<div style="max-width:420px;background:#fff;border:1px solid #f1f5f9;border-radius:12px;padding:32px;text-align:center">` +
    `<h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#404040;font-size:14px;margin:0">${message}</p></div></body></html>`;
  return new Response(html, { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (req.method === "GET") {
      const token = uuid(new URL(req.url).searchParams.get("unsubscribe"));
      if (!token) return page("Link not recognised", "This unsubscribe link is not valid.", 400);
      const { data: row } = await supabase
        .from("abandoned_bookings")
        .select("id, tenant_id, customer_email")
        .eq("recovery_token", token)
        .maybeSingle();
      if (!row) return page("Link not recognised", "This unsubscribe link is not valid.", 404);
      const now = new Date().toISOString();
      // Every session of this email at this tenant, so no later one emails them either.
      if (row.customer_email) {
        await supabase
          .from("abandoned_bookings")
          .update({ unsubscribed_at: now })
          .eq("tenant_id", row.tenant_id)
          .ilike("customer_email", row.customer_email)
          .is("unsubscribed_at", null);
      } else {
        await supabase.from("abandoned_bookings").update({ unsubscribed_at: now }).eq("id", row.id);
      }
      return page("You're unsubscribed", "You won't get any more booking reminders from us.");
    }

    if (req.method !== "POST") return errorResponse("Method not allowed", 405);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return errorResponse("Invalid body");

    // "Finish your booking" from the recovery email: trade the token for what
    // the renter had entered, so the site can reopen their step on any device.
    // The token is a bearer secret mailed only to that renter, and this returns
    // only what they typed themselves — never DOB, licence or home address,
    // which are never stored. A booking already made, or a month old, is not
    // reopened.
    if (body.action === "resume") {
      const token = uuid(body.token);
      if (!token) return jsonResponse({ ok: false, reason: "invalid" });
      const { data: row } = await supabase
        .from("abandoned_bookings")
        .select("tenant_id, session_id, site, stage, status, started_at, vehicle_id, vehicle_name, pickup_date, pickup_time, dropoff_date, dropoff_time, pickup_location, customer_name, customer_email, customer_phone, resume_state")
        .eq("recovery_token", token)
        .maybeSingle();
      if (!row) return jsonResponse({ ok: false, reason: "invalid" });
      // The link only works on the tenant's own site.
      if (uuid(body.tenantId) !== row.tenant_id) return jsonResponse({ ok: false, reason: "invalid" });
      if (row.status === "converted") return jsonResponse({ ok: false, reason: "completed" });
      if (Date.now() - new Date(row.started_at).getTime() > RESUME_MAX_AGE_MS) return jsonResponse({ ok: false, reason: "expired" });
      return jsonResponse({
        ok: true,
        site: row.site,
        stage: row.stage,
        sessionId: row.session_id,
        vehicleId: row.vehicle_id,
        vehicleName: row.vehicle_name,
        state: {
          // resume_state holds only keys with no column, so neither overrides the other.
          ...(row.resume_state ?? {}),
          ...Object.fromEntries(Object.entries({
            vehicleId: row.vehicle_id,
            pickupDate: row.pickup_date,
            pickupTime: row.pickup_time,
            dropoffDate: row.dropoff_date,
            dropoffTime: row.dropoff_time,
            pickupLocation: row.pickup_location,
            customerName: row.customer_name,
            customerEmail: row.customer_email,
            customerPhone: row.customer_phone,
          }).filter(([, v]) => v !== null)),
        },
      });
    }

    const tenantId = uuid(body.tenantId);
    const sessionId = clip(body.sessionId, 80);
    const site = body.site === "v2" ? "v2" : body.site === "v1" ? "v1" : null;
    const stage = typeof body.stage === "string" && STAGE_RANK[body.stage] ? body.stage : null;
    if (!tenantId || !sessionId || sessionId.length < 8 || !site || !stage) return errorResponse("Invalid tracking payload");

    const { data: tenant } = await supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle();
    if (!tenant) return errorResponse("Unknown tenant", 404);

    // The car and the rental must be this tenant's, or they are dropped.
    let vehicleId = uuid(body.vehicleId);
    if (vehicleId) {
      const { data: v } = await supabase.from("vehicles").select("id").eq("id", vehicleId).eq("tenant_id", tenantId).maybeSingle();
      if (!v) vehicleId = null;
    }
    let rentalId = uuid(body.rentalId);
    if (rentalId) {
      const { data: r } = await supabase.from("rentals").select("id").eq("id", rentalId).eq("tenant_id", tenantId).maybeSingle();
      if (!r) rentalId = null;
    }

    const emailRaw = clip(body.customerEmail, 254);
    const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw.toLowerCase() : null;
    const total = typeof body.estimatedTotal === "number" && Number.isFinite(body.estimatedTotal) && body.estimatedTotal >= 0
      ? Math.round(body.estimatedTotal * 100) / 100
      : null;

    const fields: Record<string, unknown> = {
      vehicle_id: vehicleId,
      vehicle_name: clip(body.vehicleName, 120),
      pickup_date: clip(body.pickupDate, 40),
      pickup_time: clip(body.pickupTime, 20),
      dropoff_date: clip(body.dropoffDate, 40),
      dropoff_time: clip(body.dropoffTime, 20),
      pickup_location: clip(body.pickupLocation, 300),
      customer_name: clip(body.customerName, 120),
      customer_email: email,
      customer_phone: clip(body.customerPhone, 40),
      estimated_total: total,
      rental_id: rentalId,
      resume_state: resumeStateFrom(body.resumeState),
    };
    // Only overwrite with what we actually got; a later step never blanks an earlier one.
    const known = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));

    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from("abandoned_bookings")
      .select("id, status, stage_rank, email_status")
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (stage === "completed") {
      if (!existing || existing.status === "converted") return jsonResponse({ ok: true });
      await supabase
        .from("abandoned_bookings")
        .update({
          ...known,
          stage: "completed",
          stage_rank: STAGE_RANK.completed,
          status: "converted",
          converted_at: now,
          converted_rental_id: rentalId,
          converted_after_email: existing.email_status === "sent",
          last_activity_at: now,
        })
        .eq("id", existing.id);
      return jsonResponse({ ok: true });
    }

    if (!existing) {
      const { error } = await supabase.from("abandoned_bookings").insert({
        tenant_id: tenantId,
        session_id: sessionId,
        site,
        stage,
        stage_rank: STAGE_RANK[stage],
        ...known,
        status: "in_progress",
        started_at: now,
        last_activity_at: now,
      });
      // A parallel first call won the insert; this one's data arrives with the next step.
      if (error && (error as { code?: string }).code !== "23505") throw error;
      return jsonResponse({ ok: true });
    }

    if (existing.status === "converted") return jsonResponse({ ok: true });

    const rank = STAGE_RANK[stage];
    const update: Record<string, unknown> = { ...known, last_activity_at: now };
    if (rank > (existing.stage_rank ?? 0)) {
      update.stage = stage;
      update.stage_rank = rank;
    }
    // Back on the site before we wrote to them: not abandoned after all (yet).
    // Once emailed it stays emailed — one recovery email per session, ever.
    if (existing.status === "abandoned" || existing.status === "expired") {
      update.status = existing.email_status === "sent" ? "emailed" : "in_progress";
      if (update.status === "in_progress") {
        update.abandoned_at = null;
        update.email_status = null;
        update.email_detail = null;
      }
    }
    await supabase.from("abandoned_bookings").update(update).eq("id", existing.id);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("abandoned-booking-track error:", (error as { message?: string })?.message ?? error);
    return errorResponse("Internal server error", 500);
  }
});
