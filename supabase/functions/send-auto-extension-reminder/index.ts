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
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type PlatformAccount } from "../_shared/stripe-client.ts";

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

interface Ctx { stripe: Stripe; platformAccount: PlatformAccount; options: { stripeAccount: string } | undefined; currency: string; }

async function stripeCtx(tenant: any): Promise<Ctx | null> {
  const mode = tenant?.stripe_mode === "live" ? "live" : "test";
  // NEW charges use the tenant's current platform account ('managed' → UK keys, 'own' → UAE keys).
  const platformAccount = getChargePlatformAccount(tenant ?? {});
  let stripe: Stripe;
  try { stripe = getStripeClientForAccount(platformAccount, mode); } catch { return null; }
  const acct = tenant ? getConnectAccountId(tenant) : null;
  return { stripe, platformAccount, options: acct ? { stripeAccount: acct } : undefined, currency: (tenant?.currency_code || "USD").toLowerCase() };
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

/**
 * EVERY charge type an extension pay-link settles — this is what goes in the
 * Stripe metadata and on the payments row. It MUST include "Extension Add-on":
 * auto-extend-rentals stamps all five, and stripe-webhook-live allocates from
 * the session metadata in preference to the row, so a four-entry metadata on a
 * re-minted session leaves any Add-on charge unallocated and apply-payment turns
 * the remainder into a Credit — the customer pays in full and the extension
 * still reads as outstanding.
 */
const EXT_CATEGORIES_ALL = [
  "Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Add-on", "Extension Insurance",
];

/**
 * The MINIMUM a Pending row must cover to count as a whole-period row and be
 * safe to repoint at a new session. Deliberately excludes "Extension Add-on":
 * legacy rows (and this function's own older inserts) carry only these four, and
 * demanding all five would refuse every one of them and insert a duplicate on
 * every send. A five-entry row is a superset and still qualifies.
 */
const EXT_CATEGORIES_CORE = ["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Insurance"];

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

  // The nudge cap is meant to be PER WEEK, but auto_extend_reminder_count lives on
  // the RENTAL and only ever advances. The reset added to auto-extend-rentals sits
  // inside the pay-link park, which is unreachable while a pending extension is
  // parked — so for a customer who has NOT paid (exactly the population dunning is
  // for) it stayed a lifetime cap. Two live RevTek rentals are stuck at 3/2 and 3/1
  // and can never be reminded again about any future week.
  //
  // So count what actually matters: reminders already sent FOR THIS EXTENSION.
  // Self-scoping per week, no reset needed, and immune to a stale rental counter.
  // The manual path (isNudge false) is deliberately uncapped — an operator asking
  // for a link must always get one.
  if (opts.isNudge && ext?.id) {
    const { count: sentForThisWeek } = await supabase
      .from("auto_extension_reminders")
      .select("id", { count: "exact", head: true })
      .eq("extension_id", ext.id)
      .eq("status", "sent");
    const max = Number(rental.auto_extend_reminder_max) || 3;
    if ((sentForThisWeek ?? 0) >= max) {
      return { ok: false, reason: `reminder cap reached for this period (${sentForThisWeek}/${max})` };
    }
  }

  const ctx = await stripeCtx(tenant);
  if (!ctx) return { ok: false, reason: "no stripe context" };

  // Reuse the existing checkout link ONLY IF STRIPE STILL CONSIDERS IT OPEN.
  //
  // This used to reuse whatever `checkout_url` was stored, creating a fresh
  // session only when the column was empty. Stripe Checkout Sessions expire 24
  // hours after creation, and these reminders go out days apart — so the stored
  // link was essentially always dead by the time it was emailed. Four live
  // RevTek rentals are in exactly that state, three of them having already had
  // three reminders each, every one carrying a link the customer could not use.
  //
  // A stale-but-non-null URL is also how a migrated tenant keeps mailing links
  // for an account they no longer trade on: the rental stays anchored to the old
  // platform while new charges follow the tenant. Retrieving the session with
  // the tenant's CURRENT keys fails for exactly those rows, which is the right
  // answer — it forces a fresh link on the account that actually works.
  //
  // Checking rather than always recreating matters: creating a second session
  // does not invalidate the first, so a customer holding a still-valid link
  // could be handed a second one and pay twice.
  let url = ext?.checkout_url as string | undefined;
  let sessionId = ext?.stripe_checkout_session_id as string | undefined;
  // The previous session, killed only after its replacement is safely delivered.
  let supersededSessionId: string | null = null;

  let storedLinkStillOpen = false;
  if (url && sessionId && opts.customAmount == null) {
    try {
      const existing = await ctx.stripe.checkout.sessions.retrieve(sessionId, ctx.options);
      storedLinkStillOpen = existing?.status === "open" && !!existing?.url;
      if (storedLinkStillOpen) url = existing.url as string;
      else console.log(`[auto-ext-reminder] stored session ${sessionId} is ${existing?.status} — creating a fresh link`);
    } catch (retrieveErr) {
      // Not found on these keys (migrated tenant), or Stripe unreachable.
      // Either way we cannot vouch for the link, so replace it.
      console.log(
        `[auto-ext-reminder] could not verify stored session ${sessionId} ` +
        `(${(retrieveErr as { message?: string })?.message || "unknown"}) — creating a fresh link`
      );
    }
  }

  const needFresh = !storedLinkStillOpen;
  if (needFresh) {
    const o = origin(tenant.slug || "app");
    // This throw is what an operator on a not-yet-chargeable Stripe account
    // actually hits when they press "send reminder" — getConnectAccountId
    // returns their connected account and Stripe refuses. Unwrapped, it escapes
    // to the 500 handler and the portal shows a raw Stripe string with no hint
    // that the fix is in their own Stripe dashboard. Every other failure in this
    // function returns { ok, reason }; this one has to as well.
    let session: { id: string; url: string | null };
    try {
      session = await ctx.stripe.checkout.sessions.create({
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
        target_categories: JSON.stringify(EXT_CATEGORIES_ALL),
      },
      }, ctx.options);
    } catch (stripeErr) {
      const raw = (stripeErr as { message?: string })?.message || String(stripeErr);
      console.error(`[auto-ext-reminder] rental ${rental.id}: Stripe refused a checkout session: ${raw}`);
      return {
        ok: false,
        reason:
          `Stripe would not create a payment link (${raw}). ` +
          `If your Stripe account setup is not finished, complete it in your Stripe dashboard — ` +
          `the reminder will send as soon as Stripe accepts charges.`,
      };
    }
    // Creating a session does not invalidate the previous one. The open-check
    // above is skipped entirely for custom amounts, so a still-open old link can
    // survive alongside the new one; the customer pays the old one, the webhook
    // finds no row for that session id, and nothing settles.
    //
    // We must still kill it — but NOT here. Expiring before the email means a
    // Resend outage or a bad address destroys the only link the customer holds
    // and delivers no replacement, and since the counter only advances on a
    // successful send, the next tick mints and destroys another. Both manual
    // sends run during today's verification failed at Resend AFTER this point.
    // So remember it, and expire it only once the replacement is delivered.
    supersededSessionId = sessionId && sessionId !== session.id ? sessionId : null;
    url = session.url || url;
    sessionId = session.id;
    if (ext) {
      await supabase.from("rental_extensions").update({ checkout_url: url, stripe_checkout_session_id: sessionId }).eq("id", ext.id);
      // booking_source is 'website', not 'auto_extend': the latter violates
      // payments_booking_source_check (admin|website only), so this insert failed
      // every single time and zero such rows have ever existed. The old comment
      // here worried that fixing it "could double up with the row the webhook
      // creates" — but the webhook is UPDATE-only and creates no row, so the
      // real duplicate risk is our OWN pay-link row from auto-extend-rentals.
      // We therefore point the existing row at the fresh session rather than
      // inserting a second one: the reminder always mints a NEW Stripe session,
      // and the webhook finds the payment by session id.
      const today = new Date().toISOString().split("T")[0];
      // Reuse a Pending row ONLY if it already covers this whole period.
      //
      // 18 extensions carry more than one Pending row (one has 6), so a pick is
      // needed at all; but "newest" alone is wrong. A customer can pay a single
      // category from the portal breakdown, which leaves a Pending row scoped to
      // e.g. ["Extension Rental"] — and 46 of the 50 extensions holding a Pending
      // row today have a NEWEST row that is exactly such a partial (92%).
      // Repointing one of those at a full-period session makes the customer pay
      // the full amount while only that one charge settles, because
      // process-pending-payment reads target_categories off the ROW.
      //
      // So: require the row's categories to CONTAIN every category we are about
      // to charge. Order-insensitive — prod holds the 4-category set in a
      // different order than we write it. Containment rather than equality so a
      // 5-category row from auto-extend-rentals (which also carries
      // "Extension Add-on") still qualifies. No match => insert a fresh row,
      // which is simply the old behaviour and is always safe.
      const covers = (rowCats: unknown): boolean => {
        const have = new Set((Array.isArray(rowCats) ? rowCats : []).map(String));
        return EXT_CATEGORIES_CORE.every((c) => have.has(c));
      };
      const { data: pendingCandidates } = await supabase
        .from("payments")
        .select("id, target_categories")
        .eq("extension_id", ext.id)
        .eq("status", "Pending")
        .order("created_at", { ascending: false })
        .limit(20);
      const existingPending =
        (pendingCandidates ?? []).find((r: any) => covers(r.target_categories)) ?? null;

      const { error: pendingErr } = existingPending?.id
        ? await supabase
            .from("payments")
            .update({
              stripe_checkout_session_id: sessionId,
              // The session was just minted on ctx's account. Leaving a stale
              // platform_account behind means process-pending-payment and
              // recover-pending-stripe-payments both pick the WRONG Stripe keys
              // (they derive the client from this column), the retrieve throws,
              // and a customer who paid settles nothing. Every covering row in
              // prod today still says 'uk' while its tenant charges on 'uae'.
              platform_account: ctx.platformAccount,
              amount,
              remaining_amount: amount,
              payment_date: today,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingPending.id)
        : await supabase.from("payments").insert({
            rental_id: rental.id, customer_id: rental.customer_id, vehicle_id: rental.vehicle_id, tenant_id: rental.tenant_id,
            extension_id: ext.id, amount, remaining_amount: amount, payment_date: today, method: "Card", payment_type: "Payment",
            status: "Pending", verification_status: "pending", capture_status: "requires_capture",
            stripe_checkout_session_id: sessionId, booking_source: "website", platform_account: ctx.platformAccount,
            target_categories: EXT_CATEGORIES_ALL,
          });
      if (pendingErr) {
        // If this fails the customer can still pay the Stripe link, but nothing
        // will record it — so it must be loud, never swallowed.
        console.error(
          `[auto-ext-reminder] pending payment row NOT created for extension ${ext.id}: ${pendingErr.message}`
        );
      }
    }
  }

  const amtStr = money(amount, ctx.currency);
  const vehicleName = vehicle ? `${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() || vehicle.reg : "your vehicle";
  const period = ext ? `${ext.previous_end_date} → ${ext.new_end_date}` : "current period";
  const subject = opts.isNudge ? `Reminder — ${amtStr} due for your rental` : `Pay ${amtStr} to renew your rental`;
  const html = emailHtml({ name: customer.name, company: tenant.company_name || "us", vehicle: vehicleName, amount: amtStr, url: url!, period, isNudge: opts.isNudge });

  const sendRes = await sendEmail(customer.email, subject, html, tenant.slug || "noreply");

  // Exactly ONE payable link must exist, and it must be the one the customer
  // actually holds. Which session that is depends on whether the email landed.
  if (supersededSessionId) {
    if (sendRes.success) {
      // They have the new link. Kill the old one.
      await ctx.stripe.checkout.sessions
        .expire(supersededSessionId, ctx.options)
        .catch((e: { message?: string }) =>
          console.log(`[auto-ext-reminder] could not expire superseded session ${supersededSessionId}: ${e?.message || "unknown"}`)
        );
    } else {
      // The replacement never reached them, so the link in their inbox is still
      // the OLD one. Simply leaving the new session alive would strand them: the
      // payments row now points at the undelivered session, so paying the link
      // they DO hold would match no row and settle nothing — the original bug,
      // reintroduced on the failure path. Expire the undelivered session and
      // point the bookkeeping back at the live one.
      await ctx.stripe.checkout.sessions
        .expire(sessionId!, ctx.options)
        .catch((e: { message?: string }) =>
          console.log(`[auto-ext-reminder] could not expire undelivered session ${sessionId}: ${e?.message || "unknown"}`)
        );
      if (ext) {
        await supabase.from("rental_extensions")
          .update({ stripe_checkout_session_id: supersededSessionId })
          .eq("id", ext.id);
        await supabase.from("payments")
          .update({ stripe_checkout_session_id: supersededSessionId, updated_at: new Date().toISOString() })
          .eq("extension_id", ext.id)
          .eq("stripe_checkout_session_id", sessionId!);
      }
      console.error(
        `[auto-ext-reminder] send failed for rental ${rental.id}; reverted bookkeeping to still-live session ${supersededSessionId}`
      );
    }
  }

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
  tenants ( id, slug, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, timezone, payment_model, own_stripe_account_id, own_stripe_test_account_id )
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
      .eq("auto_extend_enabled", true)
      // Include paused rentals. Excluding them made pause a terminal state: the
      // customer stops being asked at exactly the point the operator most needs
      // them to pay, and only a human could ever break the loop.
      .in("auto_extend_status", ["awaiting_payment", "paused"])
      .eq("auto_extend_reminder_enabled", true)
      // The sweep never checked the rental itself was live. A Closed rental
      // (returned vehicle) with an outstanding balance sat in it, spared only by
      // its reminder cap — and the cap is exactly what the counter reset relaxes.
      .eq("status", "Active");
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
      // NOTE: no auto_extend_reminder_count gate here any more. That column is a
      // per-rental lifetime tally that nothing reliably resets, and gating on it
      // permanently muted rentals whose customer never paid. The real per-week cap
      // is enforced inside sendForRental against auto_extension_reminders for the
      // specific extension being chased.
      const res = await sendForRental(supabase, r, { isNudge: true });
      res.ok ? sent++ : skipped++;
    }
    return new Response(JSON.stringify({ success: true, sent, skipped }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
