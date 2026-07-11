// Auto-Extend Rentals cron.
//
// For each rental with auto_extend_enabled=true whose current paid period is ending
// (auto_extend_next_charge_at <= now), renew the rental for one more period and charge
// the customer UPFRONT. Built on the existing rental_extensions rails:
//
//   1. create a rental_extensions row for the next period (+ Extension* ledger charges)
//   2a. auto_charge mode: off-session PaymentIntent on the saved card -> settle FIFO
//       (payment_apply_fifo_v2, isolated by extension_id) -> finalize_rental_extension
//       rolls rentals.end_date forward.
//   2b. pay_link mode (or no saved card): create a Checkout session, email the customer a
//       "pay for next period" link, park auto_extend_pending_extension_id. The existing
//       stripe webhook -> finalize path rolls the date forward when they pay.
//
// Idempotent: only acts when next_charge_at <= now and advances the pointer in the same
// write. A pending unpaid pay-link extension blocks creating another (no double-billing).
//
// See docs/AUTO_EXTENSION.md.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type PlatformAccount } from "../_shared/stripe-client.ts";
// Vendored inline so the function deploys as a single self-contained file.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-slug",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
async function sendEmailInline(to: string, subject: string, html: string, slug: string): Promise<{ success: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.log("[auto-extend] RESEND_API_KEY not set — simulating send"); return { success: true }; }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Drive247 <${slug || "noreply"}@drive-247.com>`, to: [to], subject, html }),
    });
    if (!res.ok) return { success: false, error: `Resend ${res.status}` };
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ---------------------------------------------------------------------------
// Stripe context (mirrors send-payg-reminders / place-deposit-hold resolution)
// ---------------------------------------------------------------------------
interface StripeContext {
  stripe: Stripe;
  mode: "test" | "live";
  platformAccount: PlatformAccount;
  connectAccountId: string | null;
  options: { stripeAccount: string } | undefined;
  currencyCode: string;
}

async function getStripeContext(supabase: any, tenant: any): Promise<StripeContext | null> {
  const mode: "test" | "live" = tenant?.stripe_mode === "live" ? "live" : "test";
  // NEW charges go to the tenant's current platform account
  // ('managed' → legacy UK keys, 'own' → UAE keys).
  const platformAccount = getChargePlatformAccount(tenant ?? {});
  let stripe: Stripe;
  try {
    stripe = getStripeClientForAccount(platformAccount, mode);
  } catch (keyErr: any) {
    console.warn(`[auto-extend] ${keyErr?.message ?? keyErr}`);
    return null;
  }
  const connectAccountId = tenant ? getConnectAccountId(tenant) : null;
  const options = connectAccountId ? { stripeAccount: connectAccountId } : undefined;
  return { stripe, mode, platformAccount, connectAccountId, options, currencyCode: tenant?.currency_code || "USD" };
}

function deriveBookingOrigin(tenantSlug: string): string {
  const fullOverride = Deno.env.get("BOOKING_BASE_URL");
  if (fullOverride) return fullOverride.replace(/\/+$/, "");
  const baseDomain = Deno.env.get("BOOKING_BASE_DOMAIN") || "drive-247.com";
  return `https://${tenantSlug}.${baseDomain}`;
}

// ---------------------------------------------------------------------------
// Period math + money helpers
// ---------------------------------------------------------------------------
function addPeriod(endDate: string, unit: string, count = 1): { newEndDate: string; days: number } {
  // endDate is a YYYY-MM-DD DATE. Advance by `count` units (e.g. 2 weeks, 10 days, 3 months).
  const n = Math.max(1, Math.floor(count || 1));
  const d = new Date(`${endDate}T00:00:00Z`);
  const before = d.getTime();
  if (unit === "Daily") {
    d.setUTCDate(d.getUTCDate() + n);
  } else if (unit === "Monthly") {
    d.setUTCMonth(d.getUTCMonth() + n);
  } else {
    d.setUTCDate(d.getUTCDate() + n * 7); // Weekly
  }
  const days = Math.round((d.getTime() - before) / (24 * 60 * 60 * 1000));
  return { newEndDate: d.toISOString().split("T")[0], days };
}

// Apply per-occurrence schedule exceptions to the next renewal's grid date:
// skip past skipped dates (advancing one period each time), then relocate if moved.
function applyExceptions(gridYmd: string, unit: string, count: number, ex: any): string {
  let g = gridYmd, guard = 0;
  const skips: string[] = Array.isArray(ex?.skips) ? ex.skips : [];
  const moves: Record<string, string> = (ex && typeof ex.moves === "object") ? ex.moves : {};
  while (skips.includes(g) && guard < 500) { g = addPeriod(g, unit, count).newEndDate; guard++; }
  return moves[g] || g;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeBreakdown(rentalAmount: number, tenant: any): {
  rental: number; tax: number; serviceFee: number; total: number;
} {
  const rental = round2(Number(rentalAmount) || 0);
  const taxPct = tenant?.tax_enabled ? Number(tenant?.tax_percentage || 0) : 0;
  const tax = round2(rental * (taxPct / 100));
  let serviceFee = 0;
  if (tenant?.service_fee_enabled) {
    if (tenant?.service_fee_type === "percentage") {
      serviceFee = round2(rental * (Number(tenant?.service_fee_value || 0) / 100));
    } else {
      serviceFee = round2(Number(tenant?.service_fee_value ?? tenant?.service_fee_amount ?? 0));
    }
  }
  return { rental, tax, serviceFee, total: round2(rental + tax + serviceFee) };
}

function fmtCurrency(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(amount);
  } catch {
    return `${code || "USD"} ${Number(amount).toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const nowIso = now.toISOString();

  // Optional sandbox scoping — restrict to one rental so a manual dispatch can
  // never charge another tenant. Null = global cron (unchanged).
  let onlyRentalId: string | null = null;
  try {
    const reqBody = await req.json();
    onlyRentalId = typeof reqBody?.only_rental_id === "string" ? reqBody.only_rental_id : null;
  } catch { /* no body — global cron run */ }

  let renewed = 0, linked = 0, paused = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  try {
    console.log(`[auto-extend] run at ${nowIso}`);

    // ── RECONCILE PASS ───────────────────────────────────────────────────────
    // Heal rentals whose parked renewal was PAID on the ledger but never
    // finalized. A renewal is two things: a rental_extensions record and its
    // Extension* ledger charges. finalize_rental_extension — which flips the
    // record to 'paid', rolls end_date, and is the precondition for un-pausing —
    // only runs when a payment carries the extension_id. But money paid via a
    // GENERIC payment (extension_id=NULL — e.g. an operator-recorded offline
    // payment, or any non-extension checkout) FIFO-settles the extension's ledger
    // charges WITHOUT ever finalizing the record. The record stays 'approved',
    // this cron pauses on the record status (never the ledger), and — because the
    // main query below skips paused rentals — never revisits it: a paid week stuck
    // paused forever. This pass finds "ledger fully settled by REAL payments AND
    // record still not paid" (find_autoextend_reconcile_candidates is NOT filtered
    // by auto_extend_paused, so it reaches paused rentals), finalizes each, and
    // un-pauses — mirroring the apply-payment un-pause block. It only ever acts when
    // money is already collected, so it can never charge anyone; the RPC's guards
    // skip a charge-less or write-off-zeroed extension. Best-effort: a failure here
    // must never break the normal renewal run below.
    try {
      const { data: reconcileCandidates, error: reconcileErr } = await supabase.rpc(
        "find_autoextend_reconcile_candidates",
        { p_only_rental_id: onlyRentalId },
      );
      if (reconcileErr) {
        console.error("[auto-extend][reconcile] candidate query failed:", reconcileErr.message);
      } else {
        for (const c of (reconcileCandidates ?? []) as any[]) {
          try {
            const { error: finErr } = await supabase.rpc("finalize_rental_extension", {
              p_extension_id: c.pending_ext_id,
              p_payment_id: c.paying_payment_id,
            });
            if (finErr) {
              console.error("[auto-extend][reconcile] finalize failed", c.rental_id, finErr.message);
              continue;
            }
            // Un-pause only AFTER finalize succeeds (mirrors apply-payment's
            // finalizeOk gate). Gated on the still-parked pending id so a
            // concurrent webhook/apply-payment that already cleared it no-ops —
            // this is the latch that prevents any double charge_count increment.
            const { error: syncErr } = await supabase
              .from("rentals")
              .update({
                auto_extend_pending_extension_id: null,
                auto_extend_status: "active",
                auto_extend_paused: false,
                auto_extend_paused_at: null,
                auto_extend_charge_count: (c.charge_count || 0) + 1,
                auto_extend_failed_attempts: 0,
                updated_at: nowIso,
              })
              .eq("id", c.rental_id)
              .eq("auto_extend_pending_extension_id", c.pending_ext_id);
            if (syncErr) {
              console.error("[auto-extend][reconcile] un-pause update failed", c.rental_id, syncErr.message);
            } else {
              console.log(`[auto-extend][reconcile] healed ${c.rental_id}: ext ${c.pending_ext_id} finalized, end_date -> ${c.new_end_date}, un-paused`);
            }
          } catch (perErr: any) {
            console.error("[auto-extend][reconcile] error healing", c.rental_id, perErr?.message ?? perErr);
          }
        }
      }
    } catch (reconcileFatal: any) {
      console.error("[auto-extend][reconcile] pass failed (non-fatal):", reconcileFatal?.message ?? reconcileFatal);
    }
    // ── end reconcile pass ───────────────────────────────────────────────────

    let rentalQuery = supabase
      .from("rentals")
      .select(`
        id, tenant_id, customer_id, vehicle_id, end_date, monthly_amount,
        auto_extend_enabled, auto_extend_charge_mode, auto_extend_period_unit, auto_extend_interval_count, auto_extend_exceptions, auto_extend_overrides,
        auto_extend_next_charge_at, auto_extend_lead_hours, auto_extend_charge_count,
        auto_extend_max_periods, auto_extend_failed_attempts, auto_extend_pending_extension_id,
        auto_extend_status, status,
        deposit_hold_stripe_customer_id, deposit_hold_payment_method_id,
        customers!rentals_customer_id_fkey ( id, name, email, address_state ),
        vehicles ( make, model, reg )
      `)
      .eq("auto_extend_enabled", true)
      .eq("status", "Active")
      .eq("auto_extend_paused", false)
      .not("auto_extend_next_charge_at", "is", null)
      .lte("auto_extend_next_charge_at", nowIso);
    // Sandbox scoping — hard-restrict to one rental when requested.
    if (onlyRentalId) rentalQuery = rentalQuery.eq("id", onlyRentalId);
    const { data: rentals, error: rentalErr } = await rentalQuery;

    if (rentalErr) throw rentalErr;
    if (!rentals || rentals.length === 0) {
      return new Response(JSON.stringify({ success: true, renewed, linked, paused, skipped, failed, errors }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tenant config cache
    const tenantIds = [...new Set(rentals.map((r: any) => r.tenant_id))];
    const { data: tenants } = await supabase
      .from("tenants")
      .select(`id, slug, company_name, contact_email, contact_phone, currency_code,
               tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, service_fee_amount,
               stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id,
               auto_extend_grace_hours, auto_extend_max_retries`)
      .in("id", tenantIds);
    const tenantMap = new Map<string, any>((tenants ?? []).map((t: any) => [t.id, t]));

    for (const r of rentals as any[]) {
      try {
        const tenant = tenantMap.get(r.tenant_id);
        if (!tenant) { skipped++; continue; }

        // Safety cap: max periods reached -> stop auto-extending.
        if (r.auto_extend_max_periods && r.auto_extend_charge_count >= r.auto_extend_max_periods) {
          await supabase.from("rentals").update({ auto_extend_status: "ended", updated_at: nowIso }).eq("id", r.id);
          skipped++; continue;
        }

        // A pay-link extension is still awaiting payment -> don't create another.
        if (r.auto_extend_pending_extension_id) {
          const { data: pending } = await supabase
            .from("rental_extensions").select("id, status").eq("id", r.auto_extend_pending_extension_id).maybeSingle();
          if (pending && pending.status === "paid") {
            // Webhook already settled it; clear the flag and let next cron renew.
            await supabase.from("rentals").update({
              auto_extend_pending_extension_id: null, auto_extend_status: "active", updated_at: nowIso,
            }).eq("id", r.id);
          } else {
            // Still unpaid. Pause past the grace window; otherwise leave it parked.
            const graceMs = (Number(tenant.auto_extend_grace_hours) || 48) * 3600 * 1000;
            const dueMs = new Date(r.auto_extend_next_charge_at).getTime();
            if (now.getTime() - dueMs > graceMs) {
              await supabase.from("rentals").update({
                auto_extend_paused: true, auto_extend_paused_at: nowIso, auto_extend_status: "paused", updated_at: nowIso,
              }).eq("id", r.id);
              paused++;
            } else {
              skipped++;
            }
          }
          continue;
        }

        if (!r.end_date) { skipped++; continue; }

        const customer = r.customers;
        if (!customer?.email) { skipped++; continue; }

        // 1. Next period + breakdown
        const { newEndDate, days } = addPeriod(r.end_date, r.auto_extend_period_unit || "Weekly", r.auto_extend_interval_count || 1);

        // Per-occurrence override (keyed by the current renewal date = end_date):
        // custom price, extras, insurance, and email content for just this renewal.
        const occ = (r.auto_extend_overrides && r.auto_extend_overrides[r.end_date]) || {};

        // Price: when overridden, the value is tax-inclusive — back out the pre-tax rental.
        let bd: { rental: number; tax: number; serviceFee: number; total: number };
        if (occ.priceOverride != null && Number(occ.priceOverride) >= 0) {
          const taxPct = tenant?.tax_enabled ? Number(tenant?.tax_percentage || 0) : 0;
          const incl = round2(Number(occ.priceOverride));
          const rental = taxPct > 0 ? round2(incl / (1 + taxPct / 100)) : incl;
          bd = { rental, tax: round2(incl - rental), serviceFee: 0, total: incl };
        } else {
          bd = computeBreakdown(r.monthly_amount, tenant);
        }

        // Extras + insurance ride on top of the period price (all tax-inclusive flat amounts).
        const occExtras: { label: string; amount: number }[] = Array.isArray(occ.extras)
          ? occ.extras.filter((e: any) => e && Number(e.amount) > 0).map((e: any) => ({ label: String(e.label || "Extra"), amount: round2(Number(e.amount)) }))
          : [];
        const extrasTotal = round2(occExtras.reduce((s, e) => s + e.amount, 0));

        // Insurance: the operator pre-selected which Bonzah coverage to buy; price it
        // NOW (at creation) for this period's trip dates, then bill it on this renewal.
        const cov = (occ.buyInsurance && occ.insuranceCoverage) ? occ.insuranceCoverage : null;
        let insurancePremium = 0;
        if (cov && (cov.cdw || cov.rcli || cov.sli || cov.pai)) {
          try {
            const { data: prem } = await supabase.functions.invoke("bonzah-calculate-premium", {
              body: {
                trip_start_date: r.end_date,
                trip_end_date: newEndDate,
                pickup_state: customer?.address_state || "FL",
                cdw_cover: !!cov.cdw, rcli_cover: !!cov.rcli, sli_cover: !!cov.sli, pai_cover: !!cov.pai,
              },
            });
            insurancePremium = round2(Number(prem?.total_premium) || 0);
          } catch (premErr: any) {
            console.error(`[auto-extend] bonzah premium failed ${r.id}: ${premErr?.message}`);
            insurancePremium = 0;
          }
        }
        const chargeTotal = round2(bd.total + extrasTotal + insurancePremium);
        if (chargeTotal <= 0) { skipped++; continue; }

        // 2. rental_extensions row (next sequence number)
        const { data: maxRow } = await supabase
          .from("rental_extensions").select("sequence_number")
          .eq("rental_id", r.id).order("sequence_number", { ascending: false }).limit(1).maybeSingle();
        const seq = (maxRow?.sequence_number ?? 0) + 1;

        const { data: ext, error: extErr } = await supabase
          .from("rental_extensions")
          .insert({
            rental_id: r.id, tenant_id: r.tenant_id, sequence_number: seq, status: "approved",
            previous_end_date: r.end_date, new_end_date: newEndDate, extension_days: days,
            rental_amount: bd.rental, tax_amount: bd.tax, service_fee_amount: bd.serviceFee, insurance_amount: insurancePremium,
            requested_at: nowIso, approved_at: nowIso,
          })
          .select("id").single();
        if (extErr) throw extErr;

        // 3. Extension* ledger charges (mirror AdminExtendRentalDialog)
        const today = nowIso.split("T")[0];
        const baseLedger = {
          rental_id: r.id, customer_id: r.customer_id, vehicle_id: r.vehicle_id, tenant_id: r.tenant_id,
          type: "Charge" as const, entry_date: today, due_date: newEndDate, extension_id: ext.id,
        };
        const ledgerRows: any[] = [
          { ...baseLedger, category: "Extension Rental", reference: `Auto-extend #${seq}: ${days}d (${r.end_date} → ${newEndDate})`, amount: bd.rental, remaining_amount: bd.rental },
        ];
        if (bd.tax > 0) ledgerRows.push({ ...baseLedger, category: "Extension Tax", reference: `Auto-extend #${seq}: Tax`, amount: bd.tax, remaining_amount: bd.tax });
        if (bd.serviceFee > 0) ledgerRows.push({ ...baseLedger, category: "Extension Service Fee", reference: `Auto-extend #${seq}: Service Fee`, amount: bd.serviceFee, remaining_amount: bd.serviceFee });
        for (const ex of occExtras) ledgerRows.push({ ...baseLedger, category: "Extension Add-on", reference: `Auto-extend #${seq}: ${ex.label}`, amount: ex.amount, remaining_amount: ex.amount });
        if (insurancePremium > 0) ledgerRows.push({ ...baseLedger, category: "Extension Insurance", reference: `Auto-extend #${seq}: Insurance`, amount: insurancePremium, remaining_amount: insurancePremium });
        const { error: ledgerErr } = await supabase.from("ledger_entries").insert(ledgerRows);
        if (ledgerErr) throw ledgerErr;

        const ctx = await getStripeContext(supabase, tenant);
        // Next renewal grid date is newEndDate; apply skip/move exceptions to it.
        const nextGrid = applyExceptions(newEndDate, r.auto_extend_period_unit || "Weekly", r.auto_extend_interval_count || 1, r.auto_extend_exceptions);
        const nextChargeAt = new Date(`${nextGrid}T00:00:00Z`);
        nextChargeAt.setUTCHours(nextChargeAt.getUTCHours() - (Number(r.auto_extend_lead_hours) || 0));
        const hasSavedCard = !!(r.deposit_hold_stripe_customer_id && r.deposit_hold_payment_method_id);
        const mode = r.auto_extend_charge_mode || "pay_link";

        // 4a. AUTO-CHARGE path — off-session on the saved card
        if (mode === "auto_charge" && hasSavedCard && ctx) {
          try {
            const pi = await ctx.stripe.paymentIntents.create({
              amount: Math.round(chargeTotal * 100),
              currency: ctx.currencyCode.toLowerCase(),
              customer: r.deposit_hold_stripe_customer_id,
              payment_method: r.deposit_hold_payment_method_id,
              off_session: true,
              confirm: true,
              description: `Auto-extension #${seq} for rental ${String(r.id).slice(0, 8).toUpperCase()}`,
              metadata: { rental_id: r.id, tenant_id: r.tenant_id, extension_id: ext.id, type: "auto_extension" },
            }, ctx.options);

            if (pi.status !== "succeeded") throw new Error(`PaymentIntent status ${pi.status}`);

            const { data: pay, error: payErr } = await supabase
              .from("payments").insert({
                rental_id: r.id, customer_id: r.customer_id, vehicle_id: r.vehicle_id, tenant_id: r.tenant_id,
                extension_id: ext.id, amount: chargeTotal, remaining_amount: chargeTotal,
                payment_date: today, method: "Card", payment_type: "Payment",
                status: "Completed", verification_status: "approved", capture_status: "captured",
                stripe_payment_intent_id: pi.id, booking_source: "auto_extend", platform_account: ctx.platformAccount,
                target_categories: ["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Add-on", "Extension Insurance"],
                created_at: nowIso, updated_at: nowIso,
              }).select("id").single();
            if (payErr) throw payErr;

            // Settle FIFO (isolated to this extension via payment.extension_id) then roll the date.
            await supabase.rpc("payment_apply_fifo_v2", { p_id: pay.id });
            await supabase.rpc("finalize_rental_extension", { p_extension_id: ext.id, p_payment_id: pay.id });

            await supabase.from("rentals").update({
              auto_extend_charge_count: (r.auto_extend_charge_count || 0) + 1,
              auto_extend_last_charge_at: nowIso,
              auto_extend_next_charge_at: nextChargeAt.toISOString(),
              auto_extend_failed_attempts: 0,
              auto_extend_status: "active",
              updated_at: nowIso,
            }).eq("id", r.id);
            renewed++;
            console.log(`[auto-extend] renewed ${r.id} ext#${seq} ${fmtCurrency(chargeTotal, ctx.currencyCode)}`);
            continue;
          } catch (chargeErr: any) {
            // Decline / network. Roll back the unpaid extension + its charges so we retry cleanly.
            await supabase.from("ledger_entries").delete().eq("extension_id", ext.id);
            await supabase.from("rental_extensions").delete().eq("id", ext.id);
            const attempts = (r.auto_extend_failed_attempts || 0) + 1;
            const maxRetries = Number(tenant.auto_extend_max_retries) || 3;
            if (attempts >= maxRetries) {
              await supabase.from("rentals").update({
                auto_extend_failed_attempts: attempts, auto_extend_paused: true,
                auto_extend_paused_at: nowIso, auto_extend_status: "paused", updated_at: nowIso,
              }).eq("id", r.id);
              paused++;
            } else {
              // Space out retries across the grace window instead of every cron tick.
              const graceHrs = Number(tenant.auto_extend_grace_hours) || 48;
              const retry = new Date(now.getTime() + (graceHrs / maxRetries) * 3600 * 1000);
              await supabase.from("rentals").update({
                auto_extend_failed_attempts: attempts,
                auto_extend_next_charge_at: retry.toISOString(), updated_at: nowIso,
              }).eq("id", r.id);
              failed++;
            }
            console.error(`[auto-extend] charge failed ${r.id}: ${chargeErr?.message}`);
            errors.push(`${String(r.id).slice(0, 8)}: ${chargeErr?.message ?? chargeErr}`);
            continue;
          }
        }

        // 4b. PAY-LINK path — email a checkout link, park the pending extension
        if (ctx) {
          const origin = deriveBookingOrigin(tenant.slug || "app");
          const session = await ctx.stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
              price_data: {
                currency: ctx.currencyCode.toLowerCase(),
                product_data: { name: "Rental Renewal", description: `Renew ${r.end_date} → ${newEndDate}` },
                unit_amount: Math.round(chargeTotal * 100),
              },
              quantity: 1,
            }],
            mode: "payment",
            customer_email: customer.email,
            payment_intent_data: { setup_future_usage: "off_session" },
            client_reference_id: r.id,
            success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${r.id}&type=invoice`,
            cancel_url: `${origin}/portal/bookings/${r.id}`,
            metadata: {
              type: "extension", extension_id: ext.id, rental_id: r.id, customer_id: r.customer_id,
              tenant_id: r.tenant_id, extension_days: String(days), new_end_date: newEndDate,
              previous_end_date: r.end_date, source: "auto_extend",
              target_categories: JSON.stringify(["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Add-on", "Extension Insurance"]),
            },
          }, ctx.options);

          await supabase.from("rental_extensions").update({
            stripe_checkout_session_id: session.id, checkout_url: session.url,
          }).eq("id", ext.id);

          await supabase.from("payments").insert({
            rental_id: r.id, customer_id: r.customer_id, vehicle_id: r.vehicle_id, tenant_id: r.tenant_id,
            extension_id: ext.id, amount: chargeTotal, remaining_amount: chargeTotal,
            payment_date: today, method: "Card", payment_type: "Payment",
            status: "Pending", verification_status: "pending", capture_status: "requires_capture",
            stripe_checkout_session_id: session.id, booking_source: "auto_extend", platform_account: ctx.platformAccount,
            target_categories: ["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Add-on", "Extension Insurance"],
            created_at: nowIso, updated_at: nowIso,
          });

          const total = fmtCurrency(chargeTotal, ctx.currencyCode);
          const vehicle = r.vehicles ? `${r.vehicles.make ?? ""} ${r.vehicles.model ?? ""}`.trim() : "your vehicle";
          // Per-occurrence override email (subject/body) was resolved above as `occ`.
          if (occ.sendEmail !== false) {
            const bodyHtml = occ.emailBody
              ? String(occ.emailBody).split("\n").map((p: string) => `<p>${p}</p>`).join("")
              : `<p>Hi ${customer.name || "there"},</p><p>Your rental of <strong>${vehicle}</strong> with <strong>${tenant.company_name || "us"}</strong> is due to renew for another period (<strong>${r.end_date} → ${newEndDate}</strong>).</p><p>Please pay <strong>${total}</strong> upfront to continue:</p>`;
            // Itemised breakdown when extras / insurance ride on this renewal.
            const breakdownRows: string[] = [];
            if (occExtras.length > 0 || insurancePremium > 0) {
              breakdownRows.push(`<tr><td style="padding:4px 0;">Period</td><td style="padding:4px 0;text-align:right;">${fmtCurrency(bd.total, ctx.currencyCode)}</td></tr>`);
              for (const ex of occExtras) breakdownRows.push(`<tr><td style="padding:4px 0;color:#64748b;">${ex.label}</td><td style="padding:4px 0;text-align:right;color:#64748b;">${fmtCurrency(ex.amount, ctx.currencyCode)}</td></tr>`);
              if (insurancePremium > 0) breakdownRows.push(`<tr><td style="padding:4px 0;color:#64748b;">Insurance</td><td style="padding:4px 0;text-align:right;color:#64748b;">${fmtCurrency(insurancePremium, ctx.currencyCode)}</td></tr>`);
              breakdownRows.push(`<tr><td style="padding:6px 0;border-top:1px solid #e2e8f0;font-weight:600;">Total</td><td style="padding:6px 0;border-top:1px solid #e2e8f0;text-align:right;font-weight:600;">${total}</td></tr>`);
            }
            const breakdownHtml = breakdownRows.length
              ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">${breakdownRows.join("")}</table>`
              : "";
            const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#374151;">${bodyHtml}${breakdownHtml}<p style="text-align:center;margin:24px 0;"><a href="${session.url}" style="display:inline-block;background:#0f172a;color:#fff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;">Pay ${total} & Renew</a></p><p style="font-size:12px;color:#64748b;">If you've returned the vehicle, you can ignore this message.</p></div>`;
            await sendEmailInline(customer.email, occ.emailSubject || `Renew your rental — ${total} due`, html, tenant.slug || "noreply");
          }

          await supabase.from("rentals").update({
            auto_extend_pending_extension_id: ext.id,
            auto_extend_status: "awaiting_payment",
            auto_extend_next_charge_at: nextChargeAt.toISOString(),
            updated_at: nowIso,
          }).eq("id", r.id);
          linked++;
          console.log(`[auto-extend] pay-link sent ${r.id} ext#${seq} ${total}`);
          continue;
        }

        // No Stripe context — roll back and skip.
        await supabase.from("ledger_entries").delete().eq("extension_id", ext.id);
        await supabase.from("rental_extensions").delete().eq("id", ext.id);
        skipped++;
      } catch (perRentalErr: any) {
        console.error(`[auto-extend] error on rental ${r.id}:`, perRentalErr?.message ?? perRentalErr);
        failed++;
      }
    }

    console.log(`[auto-extend] done renewed=${renewed} linked=${linked} paused=${paused} skipped=${skipped} failed=${failed}`);
    return new Response(JSON.stringify({ success: true, renewed, linked, paused, skipped, failed, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[auto-extend] fatal:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
