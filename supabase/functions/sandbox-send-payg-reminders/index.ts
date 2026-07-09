import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/resend-service.ts";
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type PlatformAccount } from "../_shared/stripe-client.ts";

/**
 * SANDBOX copy of `send-payg-reminders` — Dev Panel "Time Machine" ONLY.
 *
 * This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
 * has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
 * and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
 * owned by that one designated test tenant. A `preview: true` request performs
 * ZERO writes / ZERO Stripe / ZERO RPC / ZERO email and just reports which
 * rentals its driver query would match (used by route.ts for the blast-radius
 * pre-check).
 *
 * The real `send-payg-reminders` cron is never modified and keeps serving every
 * customer on its schedule. A bug here therefore cannot reach a real customer:
 * this function only ever touches the single rental id it is handed, in the
 * designated test tenant.
 *
 * Reminder + Stripe + email logic below is copied VERBATIM from
 * send-payg-reminders so the sandbox exercises the same behaviour; the ONLY
 * differences are the fail-closed guard, the tenant-lock, the preview branch,
 * the tenant read being scoped to the target's tenant (audit fix), and the
 * `[Sandbox...]` log prefixes.
 */

// --- Stripe Checkout session helpers for reminder pay-now button.
// The reminder email embeds a Stripe Checkout link so the customer can pay with
// one click. To avoid stale links being usable, when we send a NEW reminder we
// expire the prior reminder's session (only if not already completed). The
// session metadata carries `payg_accrual_id` + `target_categories` so the
// existing webhook + DB-trigger settlement chain (auto_fifo_on_payment_completed,
// auto_settle_payg_on_ledger_drain, settle_ghost_paid_payg_on_payment_*) flips
// the right invoice to 'paid' the moment the customer pays.

interface StripeContext {
  stripe: Stripe;
  mode: "test" | "live";
  platformAccount: PlatformAccount;
  connectAccountId: string | null;
  currencyCode: string;
}

async function getStripeContext(supabase: any, tenantId: string): Promise<StripeContext | null> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
    .eq("id", tenantId)
    .single();
  const mode: "test" | "live" = tenant?.stripe_mode === "live" ? "live" : "test";
  // NEW charges use the tenant's current platform account
  // ('managed' → legacy UK keys, 'own' → UAE keys).
  const platformAccount = getChargePlatformAccount(tenant ?? {});
  let stripe: Stripe;
  try {
    stripe = getStripeClientForAccount(platformAccount, mode);
  } catch (keyErr: any) {
    console.warn(`[SandboxPaygReminder] ${keyErr?.message ?? keyErr} — skipping payment link`);
    return null;
  }
  const connectAccountId = tenant ? getConnectAccountId(tenant) : null;
  return { stripe, mode, platformAccount, connectAccountId, currencyCode: tenant?.currency_code || "USD" };
}

// Find the most recent reminder for this rental that still has a live Stripe
// session, retrieve it from Stripe to inspect status, and expire it ONLY if it's
// safe to do so (no payment in flight). Stamping expired_at on our row prevents
// future reminders from re-checking the same session.
//
// Why the safety check: in test mode the reminder cadence is 5 minutes. If a
// customer is mid-checkout when the next reminder fires, blindly calling expire()
// would cancel their in-flight payment. Stripe's session has both a `status`
// (open/expired/complete) and a `payment_intent` reference — if the latter is
// set, the customer has reached the "click pay" step. We skip expire in that
// case and let them finish; the session naturally completes and Stripe's webhook
// commits the payment via the existing trigger chain.
async function expirePriorReminderSession(
  supabase: any,
  rentalId: string,
  ctx: StripeContext,
): Promise<void> {
  const { data: prior } = await supabase
    .from("payg_reminder_log")
    .select("id, stripe_checkout_session_id")
    .eq("rental_id", rentalId)
    .not("stripe_checkout_session_id", "is", null)
    .is("stripe_session_expired_at", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prior?.stripe_checkout_session_id) return;

  const opts = ctx.connectAccountId ? { stripeAccount: ctx.connectAccountId } : undefined;
  let canStampExpired = false;

  try {
    const session = await ctx.stripe.checkout.sessions.retrieve(prior.stripe_checkout_session_id, opts);

    if (session.status === "complete" || session.payment_status === "paid" || session.payment_status === "no_payment_required") {
      // Already paid (or finalised); no expire needed, just stamp our row.
      canStampExpired = true;
    } else if (session.status === "expired") {
      // Already expired by Stripe; just stamp our row.
      canStampExpired = true;
    } else if (session.payment_intent) {
      // Customer is mid-checkout — payment_intent has been created. DO NOT expire.
      // Leave expired_at NULL so we re-check on the next reminder. If the customer
      // abandons, Stripe naturally expires the session after ~24h and we'll stamp
      // it then. If they finish paying, the webhook + DB triggers settle the right
      // invoice (idempotently).
      console.log(`[SandboxPaygReminder] skipping expire — payment_intent in flight on ${prior.stripe_checkout_session_id}`);
      return;
    } else {
      // Open, no in-flight payment → safe to expire.
      await ctx.stripe.checkout.sessions.expire(prior.stripe_checkout_session_id, opts);
      console.log(`[SandboxPaygReminder] expired prior session ${prior.stripe_checkout_session_id}`);
      canStampExpired = true;
    }
  } catch (err: any) {
    // If retrieve/expire fails (Stripe transient error, missing session), be
    // conservative — DON'T stamp expired_at, so we re-check next reminder. Old
    // links left alive cannot double-bill the customer because payg_settle_invoice
    // is idempotent and FIFO routes excess money to the next open accrual.
    console.log(`[SandboxPaygReminder] could not retrieve/expire ${prior.stripe_checkout_session_id}: ${err?.message}`);
    return;
  }

  if (canStampExpired) {
    await supabase
      .from("payg_reminder_log")
      .update({ stripe_session_expired_at: new Date().toISOString() })
      .eq("id", prior.id);
  }
}

// Build the booking-app origin used for Stripe success/cancel URLs.
// Resolution order:
//   1. BOOKING_BASE_URL — full URL override (for local/dev testing or single-domain setups)
//   2. {slug}.{BOOKING_BASE_DOMAIN} — multi-tenant subdomain pattern (default)
function deriveBookingOrigin(tenantSlug: string): string {
  const fullOverride = Deno.env.get("BOOKING_BASE_URL");
  if (fullOverride) return fullOverride.replace(/\/+$/, "");
  const baseDomain = Deno.env.get("BOOKING_BASE_DOMAIN") || "drive-247.com";
  return `https://${tenantSlug}.${baseDomain}`;
}

async function createReminderCheckoutSession(args: {
  ctx: StripeContext;
  rentalId: string;
  tenantId: string;
  tenantSlug: string;
  customerEmail: string;
  customerName: string;
  amount: number;
  paygAccrualId: string;
  invoiceRef: string;
  // Supabase client + denormalised IDs needed to mirror create-checkout-session's
  // Pending payment-row insert. Without that row, process-pending-payment can't
  // find the session when the customer pays and bails out with "Payment not found".
  supabase: any;
  customerId: string;
  vehicleId: string | null;
}): Promise<{ id: string; url: string } | null> {
  try {
    const opts = args.ctx.connectAccountId ? { stripeAccount: args.ctx.connectAccountId } : undefined;
    const origin = deriveBookingOrigin(args.tenantSlug);
    const session = await args.ctx.stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: args.ctx.currencyCode.toLowerCase(),
              product_data: {
                name: "Pay-As-You-Go Charge",
                description: `Settle invoice ${args.invoiceRef}`,
              },
              unit_amount: Math.round(args.amount * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        customer_email: args.customerEmail,
        payment_intent_data: { setup_future_usage: "off_session" },
        client_reference_id: args.rentalId,
        success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${args.rentalId}&type=invoice`,
        cancel_url: `${origin}/portal/bookings/${args.rentalId}`,
        metadata: {
          rental_id: args.rentalId,
          customer_name: args.customerName,
          tenant_id: args.tenantId,
          tenant_slug: args.tenantSlug,
          source: "payg_reminder",
          target_categories: JSON.stringify(["Rental", "Tax", "Service Fee"]),
          payg_accrual_id: args.paygAccrualId,
        },
      },
      opts,
    );

    // Mirror create-checkout-session: pre-create a Pending payment row so the
    // booking-success page's process-pending-payment call can find this session
    // by stripe_checkout_session_id. Without this row, process-pending-payment
    // returns 404 ("Payment not found") and the customer's payment never lands
    // in our DB even though Stripe captured the money.
    const today = new Date().toISOString().split("T")[0];
    const { error: paymentInsertErr } = await args.supabase.from("payments").insert({
      rental_id: args.rentalId,
      customer_id: args.customerId,
      vehicle_id: args.vehicleId,
      tenant_id: args.tenantId,
      amount: args.amount,
      remaining_amount: args.amount,
      payment_date: today,
      method: "Card",
      payment_type: "Payment",
      status: "Pending",
      verification_status: "pending",
      stripe_checkout_session_id: session.id,
      capture_status: "requires_capture",
      platform_account: args.ctx.platformAccount,
      booking_source: "website",
      target_categories: ["Rental", "Tax", "Service Fee"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (paymentInsertErr) {
      console.error("[SandboxPaygReminder] failed to pre-create Pending payment row:", paymentInsertErr.message ?? paymentInsertErr);
    }

    return { id: session.id, url: session.url || "" };
  } catch (err: any) {
    console.error("[SandboxPaygReminder] failed to create Checkout session:", err?.message);
    return null;
  }
}
// --- End Stripe helpers

// --- Inline email template helpers (vendored from _shared/email-template-service.ts).
// Kept in-file so MCP deploys don't have to upload the 34KB shared file. The
// functions match `getEmailTemplate` + `replaceTemplateVariables` exactly so
// `import { ... } from "../_shared/email-template-service.ts"` in the disk source
// is interchangeable with these local copies — pick whichever path is convenient
// at deploy time.
const DEFAULT_PAYG_REMINDER_TEMPLATE = {
  subject: "Payment Reminder — {{outstanding_amount}} outstanding ({{rental_number}})",
  content: `<h1>Payment Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder that your Pay-As-You-Go rental with <strong>{{company_name}}</strong> currently has an outstanding balance. With Pay-As-You-Go, charges accrue automatically each day the vehicle is in your possession and are added to a single rolling invoice until you pay.</p>

<hr>

<h2>Outstanding Balance</h2>

<table>
  <tr><td><strong>Current Balance:</strong></td><td>{{outstanding_amount}}</td></tr>
  <tr><td><strong>Latest Invoice:</strong></td><td>{{invoice_ref}}</td></tr>
  <tr><td><strong>Days Active:</strong></td><td>{{days_active}}</td></tr>
</table>

<hr>

<h2>Rental Details</h2>

<table>
  <tr><td><strong>Rental Reference:</strong></td><td>{{rental_number}}</td></tr>
  <tr><td><strong>Vehicle:</strong></td><td>{{vehicle_make}} {{vehicle_model}}</td></tr>
  <tr><td><strong>Registration:</strong></td><td>{{vehicle_reg}}</td></tr>
</table>

<hr>

<h2>Pay Now</h2>

<p>Click the button below to settle invoice <strong>{{invoice_ref}}</strong> for <strong>{{outstanding_amount}}</strong>. Your saved card on file will be used.</p>

<p style="text-align:center; margin:24px 0;">
  <a href="{{payment_url}}" style="display:inline-block; background:#0f172a; color:#ffffff; padding:14px 28px; border-radius:8px; font-weight:600; text-decoration:none;">Pay {{outstanding_amount}} Now</a>
</p>

<p style="font-size:12px; color:#64748b;">This payment link is valid until your next reminder is sent. After that, this link is suspended and you'll need to use the latest reminder or log into your customer portal.</p>

<p><em>Already paid? You can disregard this message — your payment may still be processing and will reconcile shortly.</em></p>

<hr>

<h2>Need Help?</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for renting with {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
};

async function getEmailTemplate(
  client: any,
  tenantId: string,
  templateKey: string,
): Promise<{ subject: string; content: string; isCustom: boolean }> {
  try {
    const { data, error } = await client
      .from("email_templates")
      .select("subject, template_content")
      .eq("tenant_id", tenantId)
      .eq("template_key", templateKey)
      .eq("is_active", true)
      .maybeSingle();
    if (!error && data?.subject && data?.template_content) {
      console.log(`[SandboxPaygReminder] using custom template for tenant ${tenantId}`);
      return { subject: data.subject, content: data.template_content, isCustom: true };
    }
  } catch (err) {
    console.warn(`[SandboxPaygReminder] template lookup failed, using default:`, err);
  }
  // Default fallback (only payg_reminder is implemented inline; other keys NA here)
  if (templateKey === "payg_reminder") {
    return { ...DEFAULT_PAYG_REMINDER_TEMPLATE, isCustom: false };
  }
  return { subject: "", content: "", isCustom: false };
}

function replaceTemplateVariables(template: string, data: Record<string, string | undefined>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value ?? "");
  }
  // Strip any remaining {{unknown_var}} placeholders so they don't leak to the email.
  result = result.replace(/\{\{[^}]+\}\}/g, "");
  return result;
}
// --- End inline email template helpers

/**
 * Pay-As-You-Go payment reminder cron.
 *
 * Simplified model: one reminder per 24h from rental activation, open-ended,
 * email-only. Respects the tenant-level `payg_auto_reminders_enabled` toggle.
 * Each log row is tagged with the accrual/invoice that was open at send time
 * so the UI can show which invoice nudged the customer.
 */

interface Rental {
  id: string;
  rental_number: string | null;
  tenant_id: string;
  customer_id: string;
  vehicle_id: string | null;
  monthly_amount: number;
  payg_start_ts: string;
  payg_last_reminder_sent_at: string | null;
  payg_reminder_count: number;
  payg_paused: boolean;
  payg_reminder_interval_days: number | null;
  is_pay_as_you_go: boolean;
  status: string;
  payg_closed_at: string | null;
  customers: { id: string; name: string | null; email: string | null } | null;
  vehicles: { make: string | null; model: string | null; reg: string | null } | null;
}

interface Tenant {
  id: string;
  slug: string | null;
  payg_auto_reminders_enabled: boolean | null;
  payg_reminder_interval_days: number | null;
  currency_code: string | null;
  company_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// One real day. Used to compute the minimum-gap between successive reminders.
// HISTORICAL BUG: previously hardcoded to `5 * 60 * 1000` (5 minutes) with a
// "TEST MODE — Revert for production" comment that was never reverted. That
// gate was so trivial every daily cron tick passed it, so customers received
// a reminder every day even when the tenant configured every 4 days. Fixed by
// (a) using a real 24h value here, and (b) multiplying by the resolved
// interval (rental override → tenant setting → 4-day default).
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function fmtCurrency(amount: number, code: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
    }).format(amount);
  } catch {
    return `${(code || "USD")} ${Number(amount).toFixed(2)}`;
  }
}

function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / ONE_DAY_MS);
}

function buildEmailHtml(args: {
  customerName: string;
  rentalRef: string;
  invoiceRef: string;
  daysActive: number;
  totalOutstanding: number;
  currencyCode: string | null;
  companyName: string;
}): string {
  const safeCustomer = escapeHtml(args.customerName);
  const safeRef = escapeHtml(args.rentalRef);
  const safeInvoice = escapeHtml(args.invoiceRef);
  const safeCompany = escapeHtml(args.companyName);
  const totalFmt = escapeHtml(fmtCurrency(args.totalOutstanding, args.currencyCode));

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Payment Reminder</title>
    </head>
    <body style="margin:0; padding:24px; background:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#374151;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:32px;">
        <h1 style="margin:0 0 8px; color:#111827; font-size:24px; font-weight:600;">Payment Reminder</h1>
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Rental ${safeRef} · Invoice ${safeInvoice}</p>
        <p style="margin:0 0 16px;">Hi ${safeCustomer},</p>
        <p style="margin:0 0 16px;">
          Your Pay-As-You-Go rental with <strong>${safeCompany}</strong> has been active for
          <strong>${args.daysActive} day${args.daysActive === 1 ? "" : "s"}</strong> and has an outstanding balance.
        </p>
        <p style="margin:0 0 16px; padding:16px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb;">
          Current balance: <strong style="font-size:18px; color:#111827;">${totalFmt}</strong>
        </p>
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">
          Please log in to your customer portal to settle the outstanding invoice. If you have already paid, please disregard this message.
        </p>
        <p style="margin:24px 0 0; color:#9ca3af; font-size:12px;">— ${safeCompany}</p>
      </div>
    </body>
    </html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  // Unlike the production cron there is NO global path: the sandbox only ever
  // acts on the exact rental id it is handed.
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === "string" ? body.only_rental_id.trim() : "";
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: "sandbox: a valid only_rental_id (UUID) is required" }, 400);
  }

  const now = new Date();
  const nowMs = now.getTime();

  try {
    console.log(`[SandboxPaygReminderCron] Running at ${now.toISOString()} for rental ${onlyRentalId}`);

    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from("rentals").select("id, tenant_id").eq("id", onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: "sandbox: rental not found" }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: "sandbox: rental is not in the designated test tenant" }, 403);
    }

    // ── Tenant config — scoped read (audit fix): only the target's tenant,
    //    instead of the production cron's global `select` over all tenants. ──
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, slug, payg_auto_reminders_enabled, payg_reminder_interval_days, currency_code, company_name, contact_email, contact_phone")
      .eq("id", target.tenant_id);

    if (tenantErr) throw tenantErr;

    const tenantMap = new Map<string, Tenant>();
    for (const t of (tenants as Tenant[]) ?? []) {
      tenantMap.set(t.id, t);
    }

    // ── Driver query — IDENTICAL to the real cron, ALWAYS hard-scoped to the
    //    one rental id (there is no code path that omits this filter). ───────
    const { data: rentals, error: rentalErr } = await supabase
      .from("rentals")
      .select(`
        id,
        rental_number,
        tenant_id,
        customer_id,
        vehicle_id,
        monthly_amount,
        payg_start_ts,
        payg_last_reminder_sent_at,
        payg_reminder_count,
        payg_paused,
        payg_auto_reminders_enabled,
        payg_reminder_interval_days,
        is_pay_as_you_go,
        status,
        payg_closed_at,
        customers!rentals_customer_id_fkey ( id, name, email ),
        vehicles ( make, model, reg )
      `)
      .eq("is_pay_as_you_go", true)
      .eq("status", "Active")
      .eq("payg_paused", false)
      .eq("payg_auto_reminders_enabled", true)
      .is("payg_closed_at", null)
      .not("payg_start_ts", "is", null)
      .eq("id", onlyRentalId);

    if (rentalErr) throw rentalErr;

    const matchedRentalIds = ((rentals as Rental[]) ?? []).map((r) => r.id);

    // ── PREVIEW (blast-radius) — zero writes / Stripe / RPC / email, just
    //    report which rental(s) the scoped driver query would process. ───────
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    if (!rentals || rentals.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0, matchedRentalIds: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Defensive: scoped by unique id, so this must be exactly the target.
    if (rentals.length !== 1 || (rentals[0] as Rental).id !== onlyRentalId) {
      return json({ success: false, error: "sandbox: blast-radius assertion failed" }, 500);
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const r of rentals as Rental[]) {
      try {
        const tenant = tenantMap.get(r.tenant_id);
        if (!tenant) {
          skipped++;
          continue;
        }

        // Respect the tenant toggle. (Per-rental toggle
        // `rentals.payg_auto_reminders_enabled = true` is already enforced
        // by the SQL filter on the rentals select above — no need to
        // re-check it here.)
        if (tenant.payg_auto_reminders_enabled === false) {
          skipped++;
          continue;
        }

        // Cadence anchored to rental activation (or last send). The
        // effective interval is per-rental override → tenant default → 4-day
        // fallback. This mirrors what use-payg-invoices.ts displays in the UI
        // so the "next reminder at" text matches what the cron will actually
        // do. Previously the gate used a hardcoded 5-minute test constant
        // which every daily cron tick trivially passed — customers got
        // reminders daily instead of on the configured cadence.
        const startTs = new Date(r.payg_start_ts);
        const anchor = r.payg_last_reminder_sent_at
          ? new Date(r.payg_last_reminder_sent_at)
          : startTs;
        const rentalOverride = Number(r.payg_reminder_interval_days);
        const tenantDefault = Number(tenant.payg_reminder_interval_days);
        const intervalDays = Number.isFinite(rentalOverride) && rentalOverride > 0
          ? rentalOverride
          : (Number.isFinite(tenantDefault) && tenantDefault > 0 ? tenantDefault : 4);
        const cadenceGapMs = intervalDays * ONE_DAY_MS;
        if (nowMs < anchor.getTime() + cadenceGapMs) {
          skipped++;
          continue;
        }

        // Find the latest open PAYG invoice on this rental; skip if none
        const { data: openAccruals } = await supabase
          .from("payg_accruals")
          .select("id, accrual_day_index, daily_rate, tax_amount, service_fee_amount")
          .eq("rental_id", r.id)
          .eq("invoice_status", "open")
          .order("accrual_day_index", { ascending: false });

        const latestOpen = openAccruals && openAccruals.length > 0 ? openAccruals[0] : null;
        if (!latestOpen) {
          skipped++;
          continue;
        }

        // Outstanding must come from the ledger's remaining_amount on PAYG
        // charge rows, NOT the gross accrual totals. An accrual stays
        // invoice_status='open' until *every* category (rental + tax + fee)
        // for that day is drained — but a partial FIFO payment (e.g. customer
        // pays $360 against 7 days of rent, tax still owed) leaves the accrual
        // 'open' while the ledger correctly shows rent=0 / tax=$3.60. Summing
        // gross accruals here billed the customer for already-paid rent.
        const { data: openCharges, error: chargesErr } = await supabase
          .from("ledger_entries")
          .select("remaining_amount")
          .eq("rental_id", r.id)
          .eq("type", "Charge")
          .like("reference", "payg-%");
        if (chargesErr) throw chargesErr;
        const totalOutstanding = (openCharges ?? []).reduce(
          (sum, e: any) => sum + Number(e.remaining_amount || 0),
          0,
        );

        if (totalOutstanding <= 0.005) {
          skipped++;
          continue;
        }

        const customer = r.customers;
        if (!customer || !customer.email) {
          skipped++;
          continue;
        }

        const daysActive = Math.max(0, daysBetween(now, startTs));
        const invoiceRef = `pg-${String(latestOpen.accrual_day_index).padStart(3, "0")}`;

        // 1. Expire the prior reminder's Stripe Checkout session (if any) so an
        //    older link can no longer be used to pay (avoids stale-link races).
        // 2. Create a fresh Stripe Checkout session for THIS reminder, scoped to
        //    the latest open accrual via metadata.payg_accrual_id. The webhook +
        //    DB triggers will settle the right invoice when the customer pays.
        // 3. Embed the new session URL in the email via {{payment_url}}. If
        //    Stripe creation fails (no key, network), we fall back to the
        //    customer portal URL so the email's button still works.
        const stripeCtx = await getStripeContext(supabase, r.tenant_id);
        let paymentUrl = `${deriveBookingOrigin(tenant.slug || "app")}/portal/bookings/${r.id}`;
        let stripeSessionId: string | null = null;

        if (stripeCtx) {
          await expirePriorReminderSession(supabase, r.id, stripeCtx);
          const session = await createReminderCheckoutSession({
            ctx: stripeCtx,
            rentalId: r.id,
            tenantId: r.tenant_id,
            tenantSlug: tenant.slug || "app",
            customerEmail: customer.email,
            customerName: customer.name || "",
            amount: totalOutstanding,
            paygAccrualId: latestOpen.id,
            invoiceRef,
            supabase,
            customerId: r.customer_id,
            vehicleId: r.vehicle_id,
          });
          if (session) {
            paymentUrl = session.url;
            stripeSessionId = session.id;
          }
        }

        // Resolve the tenant's `payg_reminder` template (custom or default fallback)
        // and substitute variables. This lets each tenant edit the reminder copy
        // from Settings → Email Templates without redeploying the function.
        const templateData = {
          customer_name: customer.name || "Customer",
          customer_email: customer.email || "",
          rental_number: r.rental_number || r.id,
          invoice_ref: invoiceRef,
          outstanding_amount: fmtCurrency(totalOutstanding, tenant.currency_code),
          days_active: String(daysActive),
          vehicle_make: r.vehicles?.make || "",
          vehicle_model: r.vehicles?.model || "",
          vehicle_reg: r.vehicles?.reg || "",
          company_name: tenant.company_name || "Drive247",
          company_email: tenant.contact_email || "",
          company_phone: tenant.contact_phone || "",
          payment_url: paymentUrl,
        };

        const tpl = await getEmailTemplate(supabase, r.tenant_id, "payg_reminder");
        const subject = replaceTemplateVariables(tpl.subject, templateData);
        const html = replaceTemplateVariables(tpl.content, templateData);

        // Send via Resend (using the shared resend-service drop-in).
        // Pass tenant_id so Resend uses the tenant's branded {slug}@drive-247.com sender.
        const sendResult = await sendEmail(customer.email, subject, html, supabase, r.tenant_id);
        const success = sendResult.success;
        const sendErr = success ? null : { message: sendResult.error || "Resend send failed" };
        const reminderNumber = (r.payg_reminder_count || 0) + 1;

        await supabase.from("payg_reminder_log").insert({
          rental_id: r.id,
          tenant_id: r.tenant_id,
          accrual_id: latestOpen.id,
          sent_at: now.toISOString(),
          reminder_number: reminderNumber,
          outstanding_amount: totalOutstanding,
          days_active: daysActive,
          days_overdue: daysActive,
          channel: "email",
          recipient: customer.email,
          success,
          error_message: success ? null : (sendErr?.message ?? "Unknown error"),
          // Tracks the Stripe Checkout session attached to THIS reminder so a
          // future reminder can call expirePriorReminderSession on it.
          stripe_checkout_session_id: stripeSessionId,
        });

        if (!success) {
          console.error(`[SandboxPaygReminderCron] SES send failed for rental ${r.id}:`, sendErr?.message);
          failed++;
          continue;
        }

        await supabase.rpc("increment_payg_reminder_count", {
          p_rental_id: r.id,
          p_last_sent_at: now.toISOString(),
        }).then(async ({ error: rpcErr }) => {
          if (rpcErr) {
            await supabase
              .from("rentals")
              .update({
                payg_last_reminder_sent_at: now.toISOString(),
                payg_reminder_count: reminderNumber,
              })
              .eq("id", r.id);
          }
        });

        sent++;
        console.log(`[SandboxPaygReminderCron] Sent reminder #${reminderNumber} for rental ${r.id} (invoice ${invoiceRef}, outstanding=${totalOutstanding})`);
      } catch (rentalErr: any) {
        console.error(`[SandboxPaygReminderCron] Error processing rental ${r.id}:`, rentalErr?.message ?? rentalErr);
        failed++;
      }
    }

    console.log(`[SandboxPaygReminderCron] Done. sent=${sent} skipped=${skipped} failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, skipped, failed, matchedRentalIds }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[SandboxPaygReminderCron] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
