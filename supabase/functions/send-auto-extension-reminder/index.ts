// Auto-Extension reminder sender.
//
// Two modes:
//   • Manual (body has rentalId): admin clicks "Resend link" / "Send reminder" /
//     "Bill custom amount". Resolves the rental's outstanding week (or uses a
//     custom amount), (re)creates a Stripe Checkout pay-link, emails it, and logs
//     a row in auto_extension_reminders.
//   • Cron nudge (body { cron: true } or empty): sweeps auto-extend rentals that
//     have an unpaid pending pay-link extension older than the reminder interval,
//     and sends a nudge (respecting auto_extend_reminder_max).
//
// All sends are recorded in auto_extension_reminders so the control panel can show
// the full history, the calendar, and the exact recipient + paid-through-link time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

// Vendored inline (keeps this function self-contained for MCP single-file deploys).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-slug",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function sendEmail(to: string, subject: string, html: string, slug: string): Promise<{ success: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.log("[auto-ext-reminder] RESEND_API_KEY not set — simulating send"); return { success: true }; }
  const from = `${slug || "noreply"}@drive-247.com`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Drive247 <${from}>`, to: [to], subject, html }),
    });
    if (!res.ok) return { success: false, error: `Resend ${res.status}: ${await res.text()}` };
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

interface Ctx { stripe: Stripe; options: { stripeAccount: string } | undefined; currency: string; }

async function stripeCtx(tenant: any): Promise<Ctx | null> {
  const mode = tenant?.stripe_mode === "live" ? "live" : "test";
  const key = mode === "live" ? Deno.env.get("STRIPE_LIVE_SECRET_KEY") : Deno.env.get("STRIPE_TEST_SECRET_KEY");
  if (!key) return null;
  const stripe = new Stripe(key, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });
  let acct: string | null = null;
  if (mode === "test") acct = Deno.env.get("STRIPE_TEST_CONNECT_ACCOUNT_ID") || null;
  else if (tenant?.stripe_onboarding_complete && tenant?.stripe_account_id) acct = tenant.stripe_account_id;
  return { stripe, options: acct ? { stripeAccount: acct } : undefined, currency: (tenant?.currency_code || "USD").toLowerCase() };
}

function origin(slug: string): string {
  const o = Deno.env.get("BOOKING_BASE_URL");
  if (o) return o.replace(/\/+$/, "");
  return `https://${slug}.${Deno.env.get("BOOKING_BASE_DOMAIN") || "drive-247.com"}`;
}

function money(n: number, c: string) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c.toUpperCase() }).format(n); }
  catch { return `${c.toUpperCase()} ${n.toFixed(2)}`; }
}

function emailHtml(a: { name: string; company: string; vehicle: string; amount: string; url: string; period: string; isNudge: boolean }) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#374151;">
    <h2 style="color:#111827;">${a.isNudge ? "Reminder: your rental payment is due" : "Time to renew your rental"}</h2>
    <p>Hi ${a.name || "there"},</p>
    <p>Your rental of <strong>${a.vehicle}</strong> with <strong>${a.company}</strong> ${a.isNudge ? "still has an outstanding payment" : "renews for another period"} (<strong>${a.period}</strong>).</p>
    <p>Please pay <strong>${a.amount}</strong> to continue:</p>
    <p style="text-align:center;margin:24px 0;"><a href="${a.url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;">Pay ${a.amount} Now</a></p>
    <p style="font-size:12px;color:#64748b;">If you've already paid or returned the vehicle, please disregard this message.</p>
  </div>`;
}

async function sendForRental(supabase: any, rental: any, opts: { customAmount?: number; isNudge: boolean; sentBy?: string }) {
  const tenant = rental.tenants;
  const customer = rental.customers;
  const vehicle = rental.vehicles;
  if (!customer?.email) return { ok: false, reason: "no customer email" };

  // Outstanding week: latest extension not yet paid.
  const { data: exts } = await supabase
    .from("rental_extension_totals")
    .select("id, sequence_number, previous_end_date, new_end_date, total_amount, outstanding_amount, display_status, checkout_url, stripe_checkout_session_id")
    .eq("rental_id", rental.id)
    .order("sequence_number", { ascending: false });
  const outstanding = (exts || []).find((e: any) => e.display_status === "awaiting_payment" || e.display_status === "partial");
  if (!outstanding && !opts.customAmount) return { ok: false, reason: "no outstanding week to remind about" };

  const ext = outstanding;
  const amount = opts.customAmount ?? Number(ext?.outstanding_amount || ext?.total_amount || 0);
  if (amount <= 0) return { ok: false, reason: "amount is zero" };

  const ctx = await stripeCtx(tenant);
  if (!ctx) return { ok: false, reason: "no stripe context" };

  // Reuse the existing checkout link when one is live and the amount is unchanged;
  // otherwise create a fresh session.
  let url = ext?.checkout_url as string | undefined;
  let sessionId = ext?.stripe_checkout_session_id as string | undefined;
  const needFresh = !url || opts.customAmount != null;
  if (needFresh) {
    const o = origin(tenant.slug || "app");
    const session = await ctx.stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price_data: { currency: ctx.currency, product_data: { name: "Rental payment", description: ext ? `Renew ${ext.previous_end_date} → ${ext.new_end_date}` : "Rental payment" }, unit_amount: Math.round(amount * 100) }, quantity: 1 }],
      mode: "payment",
      customer_email: customer.email,
      payment_intent_data: { setup_future_usage: "off_session" },
      client_reference_id: rental.id,
      success_url: `${o}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
      cancel_url: `${o}/portal/bookings/${rental.id}`,
      metadata: {
        type: "extension", rental_id: rental.id, customer_id: rental.customer_id, tenant_id: rental.tenant_id,
        ...(ext ? { extension_id: ext.id, new_end_date: ext.new_end_date, previous_end_date: ext.previous_end_date } : {}),
        source: "auto_extend_reminder",
        target_categories: JSON.stringify(["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Insurance"]),
      },
    }, ctx.options);
    url = session.url || url;
    sessionId = session.id;
    if (ext) {
      await supabase.from("rental_extensions").update({ checkout_url: url, stripe_checkout_session_id: sessionId }).eq("id", ext.id);
      // Pre-create a Pending payment so the webhook can settle it (mirrors create-extension-checkout).
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("payments").insert({
        rental_id: rental.id, customer_id: rental.customer_id, vehicle_id: rental.vehicle_id, tenant_id: rental.tenant_id,
        extension_id: ext.id, amount, remaining_amount: amount, payment_date: today, method: "Card", payment_type: "Payment",
        status: "Pending", verification_status: "pending", capture_status: "requires_capture",
        stripe_checkout_session_id: sessionId, booking_source: "auto_extend",
        target_categories: ["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Insurance"],
      });
    }
  }

  const amtStr = money(amount, ctx.currency);
  const vehicleName = vehicle ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || vehicle.reg : "your vehicle";
  const period = ext ? `${ext.previous_end_date} → ${ext.new_end_date}` : "current period";
  const subject = opts.isNudge ? `Reminder — ${amtStr} due for your rental` : `Pay ${amtStr} to renew your rental`;
  const html = emailHtml({ name: customer.name, company: tenant.company_name || "us", vehicle: vehicleName, amount: amtStr, url: url!, period, isNudge: opts.isNudge });

  const sendRes = await sendEmail(customer.email, subject, html, tenant.slug || "noreply");

  await supabase.from("auto_extension_reminders").insert({
    rental_id: rental.id, extension_id: ext?.id ?? null, tenant_id: rental.tenant_id,
    reminder_type: opts.isNudge ? "nudge" : "manual", channel: "email",
    recipient: customer.email, subject, amount, stripe_checkout_session_id: sessionId ?? null,
    status: sendRes.success ? "sent" : "failed", error_message: sendRes.success ? null : (sendRes.error || "send failed"),
    sent_by: opts.sentBy ?? null,
  });

  if (sendRes.success) {
    await supabase.from("rentals").update({
      auto_extend_reminder_count: (rental.auto_extend_reminder_count || 0) + 1,
      auto_extend_last_reminder_at: new Date().toISOString(),
    }).eq("id", rental.id);
  }
  return { ok: sendRes.success, reason: sendRes.success ? "sent" : (sendRes.error || "send failed"), recipient: customer.email, amount, url };
}

const RENTAL_SELECT = `
  id, customer_id, vehicle_id, tenant_id, auto_extend_enabled, auto_extend_status,
  auto_extend_reminder_enabled, auto_extend_reminder_interval_days, auto_extend_reminder_max,
  auto_extend_reminder_count, auto_extend_reminder_send_weekday, auto_extend_last_reminder_at, auto_extend_pending_extension_id,
  customers!rentals_customer_id_fkey ( id, name, email ),
  vehicles ( make, model, reg ),
  tenants ( id, slug, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, timezone )
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* cron with empty body */ }

  try {
    // ── Manual ─────────────────────────────────────────────
    if (body.rentalId) {
      const { data: rental, error } = await supabase.from("rentals").select(RENTAL_SELECT).eq("id", body.rentalId).single();
      if (error || !rental) throw new Error("rental not found");
      const res = await sendForRental(supabase, rental, { customAmount: body.customAmount ? Number(body.customAmount) : undefined, isNudge: false, sentBy: body.sentBy });
      return new Response(JSON.stringify(res), { status: res.ok ? 200 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Cron nudge sweep ───────────────────────────────────
    const nowMs = Date.now();
    const { data: rentals } = await supabase.from("rentals").select(RENTAL_SELECT)
      .eq("auto_extend_enabled", true).eq("auto_extend_status", "awaiting_payment")
      .eq("auto_extend_reminder_enabled", true).eq("auto_extend_paused", false);
    let sent = 0, skipped = 0;
    // Intl weekday name -> number (0=Sunday .. 6=Saturday), matches DB convention.
    const WEEKDAY_NUM: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
    };
    for (const r of (rentals as any[]) || []) {
      const weekday = r.auto_extend_reminder_send_weekday;
      if (weekday !== null && weekday !== undefined) {
        // Weekday mode: nudge only on the operator-chosen day, evaluated in the
        // tenant's local timezone, at most once that day. The N-day interval is
        // not used here — the weekday itself is the (weekly) cadence.
        const tz = r.tenants?.timezone || "UTC";
        const localWeekday = WEEKDAY_NUM[
          new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(new Date())
        ];
        if (localWeekday !== Number(weekday)) { skipped++; continue; }
        if (r.auto_extend_last_reminder_at) {
          const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // YYYY-MM-DD
          if (dayFmt.format(new Date(r.auto_extend_last_reminder_at)) === dayFmt.format(new Date())) {
            skipped++; continue; // already nudged today (tenant-local)
          }
        }
      } else {
        // Interval mode (unchanged): nudge every N days since the last reminder.
        const interval = (Number(r.auto_extend_reminder_interval_days) || 2) * 86400000;
        const last = r.auto_extend_last_reminder_at ? new Date(r.auto_extend_last_reminder_at).getTime() : 0;
        if (nowMs - last < interval) { skipped++; continue; }
      }
      if ((r.auto_extend_reminder_count || 0) >= (Number(r.auto_extend_reminder_max) || 3)) { skipped++; continue; }
      const res = await sendForRental(supabase, r, { isNudge: true });
      res.ok ? sent++ : skipped++;
    }
    return new Response(JSON.stringify({ success: true, sent, skipped }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
