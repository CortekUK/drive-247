/**
 * reconcile-subscriptions
 *
 * Pulls platform-subscription truth from Stripe and repairs DB drift.
 *
 * WHY THIS EXISTS
 * Webhooks silently froze the DB in production (handleSubscriptionUpdated threw
 * RangeError on every customer.subscription.updated because Stripe moved
 * current_period_* onto subscription items in API 2025-03-31; separately the
 * status CHECK constraint rejected 'incomplete_expired', which can make Stripe
 * auto-disable the endpoint). Both are fixed, but a webhook is a delivery
 * guarantee, not a consistency guarantee — anything missed while the endpoint
 * was down stays wrong forever. This is the reconciliation layer: Stripe is the
 * authority, the DB is the cache, and this repairs the cache.
 *
 * SAFETY INVARIANTS (deliberate, do not "simplify" these away):
 *  1. DRY RUN BY DEFAULT. You must pass {"dryRun": false} to write anything.
 *  2. NEVER AUTO GO-LIVE. The webhook flips tenants.stripe_mode and
 *     bonzah_mode to 'live' when a subscription becomes active and
 *     setup_completed_at is null. Replaying historic subscriptions through
 *     that path would switch tenants to live Stripe Connect + live insurance —
 *     charging their real customers and binding real policies. This function
 *     writes ONLY to tenant_subscriptions and NEVER touches those columns.
 *  3. NO INVENTED ROWS. If a Stripe subscription cannot be resolved to a
 *     tenant, it is reported as an orphan, never guessed at.
 *  4. Scope with {"tenantId": "..."} to rehearse on exactly one tenant first.
 *
 * POST body: { dryRun?: boolean (default true), tenantId?: string }
 */
import {
  getSubscriptionStripeClientForAccount,
  type SubscriptionAccount,
} from "../_shared/subscription-stripe.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

type Mode = "test" | "live";

interface Snapshot {
  account: SubscriptionAccount;
  mode: Mode;
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  status: string;
  amount: number;
  currency: string;
  interval: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  trial_end: string | null;
  card_brand: string | null;
  card_last4: string | null;
}

/** Unix seconds -> ISO, or null. Never throws (the original webhook bug). */
function toIso(unixSeconds: unknown): string | null {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Billing window, resilient to Stripe's basil relocation of the period fields
 * onto subscription items.
 */
function resolvePeriod(sub: any): { start: string | null; end: string | null } {
  const item = sub?.items?.data?.[0];
  return {
    start: toIso(sub?.current_period_start) ?? toIso(item?.current_period_start),
    end: toIso(sub?.current_period_end) ?? toIso(item?.current_period_end),
  };
}

/**
 * The subscription's headline recurring price, in minor units.
 *
 * DO NOT use items.data[0] — these subscriptions routinely carry MORE THAN ONE
 * item: the plan itself, a silently-attached metered e-sign usage price, and
 * (for the $1 card-verification flow) a 100-minor-unit line. Stripe does not
 * guarantee item ordering, so [0] is a coin flip. Reading it that way once
 * rewrote a $350/mo plan as $1/mo.
 *
 * Rule: ignore metered items (they have no fixed unit_amount and are billed on
 * usage), then take the LARGEST licensed recurring amount — the plan always
 * dominates the incidental $1 verification line.
 */
function resolveAmount(sub: any): number {
  const items: any[] = sub?.items?.data ?? [];
  const licensed = items.filter(
    (i) => i?.price?.recurring && i.price.recurring.usage_type !== "metered",
  );
  // Stripe bills unit_amount x quantity — a 2-seat $175 item is a $350 charge.
  // Ignoring quantity once made a $350 plan read as $175.
  const amounts = licensed
    .map((i) => Number(i?.price?.unit_amount) * (Number(i?.quantity) || 1))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return 0;
  return Math.max(...amounts);
}

/** Interval of the item that produced the headline amount. */
function resolveInterval(sub: any): string {
  const items: any[] = sub?.items?.data ?? [];
  const licensed = items.filter(
    (i) => i?.price?.recurring && i.price.recurring.usage_type !== "metered",
  );
  let best: any = null;
  for (const i of licensed) {
    const n = Number(i?.price?.unit_amount);
    if (!Number.isFinite(n)) continue;
    if (!best || n > Number(best.price.unit_amount)) best = i;
  }
  return best?.price?.recurring?.interval ?? "month";
}

function toSnapshot(
  sub: any,
  account: SubscriptionAccount,
  mode: Mode,
): Snapshot {
  const period = resolvePeriod(sub);
  const pm = typeof sub.default_payment_method === "object"
    ? sub.default_payment_method
    : null;
  return {
    account,
    mode,
    stripe_subscription_id: sub.id,
    stripe_customer_id: typeof sub.customer === "string"
      ? sub.customer
      : sub.customer?.id ?? null,
    status: sub.status,
    amount: resolveAmount(sub),
    currency: sub.currency ?? "usd",
    interval: resolveInterval(sub),
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at: toIso(sub.cancel_at),
    canceled_at: toIso(sub.canceled_at),
    ended_at: toIso(sub.ended_at),
    trial_end: toIso(sub.trial_end),
    card_brand: pm?.card?.brand ?? null,
    card_last4: pm?.card?.last4 ?? null,
  };
}

/**
 * Map a Stripe subscription to a tenant. Ordered most- to least-authoritative.
 * Returns null rather than guessing — an unresolvable subscription is reported
 * as an orphan for a human to look at.
 */
async function resolveTenantId(
  supabase: any,
  sub: any,
  snap: Snapshot,
): Promise<{ tenantId: string | null; via: string }> {
  // 1. Explicit metadata (how our own checkout flow tags subscriptions).
  const metaTenant = sub.metadata?.tenant_id;
  if (metaTenant) return { tenantId: metaTenant, via: "metadata" };

  // 2. Existing row keyed by the subscription id.
  const { data: bySub } = await supabase
    .from("tenant_subscriptions")
    .select("tenant_id")
    .eq("stripe_subscription_id", snap.stripe_subscription_id)
    .maybeSingle();
  if (bySub?.tenant_id) return { tenantId: bySub.tenant_id, via: "subscription_id" };

  // 3. Existing row keyed by the Stripe customer.
  if (snap.stripe_customer_id) {
    const { data: byCust } = await supabase
      .from("tenant_subscriptions")
      .select("tenant_id")
      .eq("stripe_customer_id", snap.stripe_customer_id)
      .limit(1)
      .maybeSingle();
    if (byCust?.tenant_id) return { tenantId: byCust.tenant_id, via: "customer_id" };

    // 4. The tenant record itself stores the platform billing customer id.
    const { data: byTenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("stripe_subscription_customer_id", snap.stripe_customer_id)
      .limit(1)
      .maybeSingle();
    if (byTenant?.id) return { tenantId: byTenant.id, via: "tenant.customer_id" };
  }

  return { tenantId: null, via: "unresolved" };
}

/** Fields compared and repaired. Order is stable so diffs read consistently. */
const COMPARED = [
  "status",
  "amount",
  "currency",
  "interval",
  "current_period_start",
  "current_period_end",
  "cancel_at",
  "canceled_at",
  "ended_at",
  "trial_end",
  "card_brand",
  "card_last4",
] as const;

/** Normalise for comparison so 2026-01-01T00:00:00.000Z == 2026-01-01T00:00:00+00. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? String(v) : new Date(t).toISOString();
  }
  return String(v);
}

/**
 * How many invoices to re-read per subscription. A year of monthly cycles is
 * enough to repair a stale row without walking the whole history every hour.
 */
const INVOICE_LOOKBACK = 12;

/**
 * Fields that constitute REAL invoice drift.
 *
 * Deliberately excludes stripe_invoice_pdf / stripe_hosted_invoice_url. Stripe
 * appends a rotating token to those links, so their value changes between reads
 * for an otherwise untouched invoice. A first dry run against production
 * confirmed it: 29 of 29 existing invoices reported "drift" and every single one
 * was URL-only, with identical status and amounts. Comparing them literally
 * would rewrite the whole table every hour, generate pointless churn, and bury
 * the one thing this pass exists to surface — a status that disagrees with
 * Stripe. Those URLs are still FILLED when we have none (see below).
 */
const INVOICE_COMPARED = [
  "status",
  "amount_due",
  "amount_paid",
  // attempt_count is NOT cosmetic — it is the ONLY thing separating a DECLINED
  // invoice from one that is simply not due yet. Stripe leaves both at
  // status='open', and the admin dashboard keys its red "Payment failed" vs
  // amber "Unpaid" badge purely on this number
  // (apps/admin/.../rentals/page.tsx). Only handleInvoicePaymentFailed used to
  // write it, so any invoice first materialised HERE — i.e. exactly the
  // self-heal path for a webhook that was missed — landed with NULL and a
  // genuinely declined charge was rendered as "not due yet". That is precisely
  // backwards for someone chasing broken subscriptions.
  "attempt_count",
] as const;

/** Links we will fill if missing, but never rewrite. */
const INVOICE_LINK_FIELDS = ["stripe_invoice_pdf", "stripe_hosted_invoice_url"] as const;

/**
 * Reconcile ONE subscription's invoices against Stripe.
 *
 * WHY THIS EXISTS — this is the gap that can permanently lock out a paying
 * customer. The portal's 7-day grace clock is anchored on the oldest LOCAL
 * invoice whose status is open/uncollectible. Webhooks are the only thing that
 * ever moved an invoice off 'open', and webhooks drop (this project has already
 * had an outage where every delivery failed for days). When an invoice.paid is
 * lost, the local row stays 'open' forever:
 *
 *   tenant pays -> Stripe says paid -> our row still says open
 *   -> grace clock keeps counting -> hard paywall
 *   -> the screen tells them to "pay your pending invoice", pointing at an
 *      invoice Stripe already considers settled, with no self-service way out.
 *
 * Reconciling subscriptions alone did not help: the subscription row self-heals
 * within the hour while the invoice that is actually doing the blocking is
 * never looked at.
 *
 * DISCIPLINE (mirrors the subscription pass):
 *  - never INVENT a row we cannot attribute to a tenant
 *  - never blank a stored value with null
 *  - never touch the webhook-owned analytics columns (base_amount,
 *    usage_amount, usage_quantity) — this pass only owns what it can derive
 *    reliably from the Stripe invoice object
 *  - report in dry-run without writing
 */
async function reconcileInvoicesForSubscription(
  stripe: any,
  supabase: any,
  subscriptionId: string,
  tenantId: string,
  localSubscriptionId: string | null,
  dryRun: boolean,
): Promise<{ seen: number; changes: any[]; errors: any[] }> {
  const changes: any[] = [];
  const errors: any[] = [];
  let seen = 0;

  let list: any;
  try {
    list = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: INVOICE_LOOKBACK,
    });
  } catch (e) {
    errors.push({
      stripe_subscription_id: subscriptionId,
      scope: "invoices.list",
      error: String((e as any)?.message ?? e),
    });
    return { seen, changes, errors };
  }

  for (const inv of list?.data ?? []) {
    seen++;

    const { data: existing, error: readErr } = await supabase
      .from("tenant_subscription_invoices")
      .select(
        "id, status, amount_due, amount_paid, attempt_count, stripe_invoice_pdf, stripe_hosted_invoice_url",
      )
      .eq("stripe_invoice_id", inv.id)
      .maybeSingle();

    if (readErr) {
      errors.push({ stripe_invoice_id: inv.id, scope: "read", error: readErr.message });
      continue;
    }

    const desired: Record<string, unknown> = {
      status: inv.status,
      amount_due: inv.amount_due ?? 0,
      amount_paid: inv.amount_paid ?? 0,
      attempt_count: inv.attempt_count ?? 0,
      stripe_invoice_pdf: inv.invoice_pdf ?? null,
      stripe_hosted_invoice_url: inv.hosted_invoice_url ?? null,
    };

    const diff: Record<string, { db: unknown; stripe: unknown }> = {};
    for (const f of INVOICE_COMPARED) {
      const dbVal = existing ? (existing as any)[f] : null;
      const stVal = desired[f];
      // Do not report "Stripe has null, we have a value" as drift — that is the
      // blank-out case we deliberately refuse to write.
      if (stVal === null && dbVal != null) continue;
      if (norm(dbVal) !== norm(stVal)) diff[f] = { db: dbVal, stripe: stVal };
    }
    // Links count as drift ONLY when we are missing one Stripe can supply.
    for (const f of INVOICE_LINK_FIELDS) {
      const dbVal = existing ? (existing as any)[f] : null;
      const stVal = desired[f];
      if (!dbVal && stVal) diff[f] = { db: dbVal, stripe: stVal };
    }

    const isNew = !existing;
    if (!isNew && Object.keys(diff).length === 0) continue;

    changes.push({
      tenant_id: tenantId,
      stripe_subscription_id: subscriptionId,
      stripe_invoice_id: inv.id,
      action: isNew ? "insert" : "update",
      diff,
    });

    if (dryRun) continue;

    const payload: Record<string, unknown> = {
      tenant_id: tenantId,
      subscription_id: localSubscriptionId,
      stripe_invoice_id: inv.id,
      status: inv.status,
      amount_due: inv.amount_due ?? 0,
      amount_paid: inv.amount_paid ?? 0,
      currency: inv.currency || "usd",
      // Links are FILLED, never rewritten. Stripe rotates the token on these
      // URLs, so rewriting them would churn every row on every run; and Stripe
      // drops them entirely once an invoice is voided, so blindly writing would
      // also destroy a receipt link the tenant may still need. Only supply one
      // when we genuinely have none.
      ...(!(existing as any)?.stripe_invoice_pdf && inv.invoice_pdf
        ? { stripe_invoice_pdf: inv.invoice_pdf }
        : {}),
      ...(!(existing as any)?.stripe_hosted_invoice_url && inv.hosted_invoice_url
        ? { stripe_hosted_invoice_url: inv.hosted_invoice_url }
        : {}),
      ...(inv.period_start
        ? { period_start: new Date(inv.period_start * 1000).toISOString() }
        : {}),
      ...(inv.period_end
        ? { period_end: new Date(inv.period_end * 1000).toISOString() }
        : {}),
      ...(inv.due_date ? { due_date: new Date(inv.due_date * 1000).toISOString() } : {}),
      ...(inv.status_transitions?.paid_at
        ? { paid_at: new Date(inv.status_transitions.paid_at * 1000).toISOString() }
        : {}),
      ...(inv.number ? { invoice_number: inv.number } : {}),
      // The dunning trio. attempt_count decides whether the admin dashboard
      // renders a red "Payment failed" or an amber "Unpaid — not due yet", so
      // omitting it made every reconciler-created invoice look benign. Written
      // unconditionally (defaulting to 0) rather than conditionally, because a
      // genuine 0 is meaningful — it is what says "Stripe has not tried yet".
      attempt_count: inv.attempt_count ?? 0,
      ...(inv.next_payment_attempt
        ? { next_payment_attempt: new Date(inv.next_payment_attempt * 1000).toISOString() }
        : {}),
      ...(inv.billing_reason ? { billing_reason: inv.billing_reason } : {}),
    };

    const { error } = await supabase
      .from("tenant_subscription_invoices")
      .upsert(payload, { onConflict: "stripe_invoice_id" });

    if (error) {
      errors.push({ stripe_invoice_id: inv.id, scope: "upsert", error: error.message });
    }
  }

  return { seen, changes, errors };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let dryRun = true;
  let onlyTenantId: string | null = null;
  try {
    const body = await req.json();
    if (body?.dryRun === false) dryRun = false;
    if (typeof body?.tenantId === "string") onlyTenantId = body.tenantId;
  } catch {
    /* no body — safest defaults (dry run, all tenants) */
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = new Date().toISOString();
  const changes: any[] = [];
  const orphans: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];
  /** Legacy UK subscriptions intentionally left alone for UAE-migrated tenants. */
  const retiredUk: any[] = [];
  let stripeCount = 0;
  /** Invoice-level drift, reported separately so it is not lost in the noise. */
  const invoiceChanges: any[] = [];
  let invoicesSeen = 0;

  const cells: Array<{ account: SubscriptionAccount; mode: Mode }> = [
    { account: "uk", mode: "live" },
    { account: "uk", mode: "test" },
    { account: "uae", mode: "live" },
    { account: "uae", mode: "test" },
  ];

  for (const { account, mode } of cells) {
    let stripe: any;
    try {
      stripe = getSubscriptionStripeClientForAccount(account, mode);
    } catch (e) {
      // A missing key is reported explicitly — a silently skipped account is
      // exactly how drift hides.
      skipped.push({ account, mode, reason: "missing_key", detail: String(e?.message ?? e) });
      continue;
    }

    try {
      // status:'all' so canceled/incomplete_expired are seen, not just active.
      for await (const sub of stripe.subscriptions.list({
        status: "all",
        limit: 100,
        expand: ["data.default_payment_method"],
      })) {
        stripeCount++;
        const snap = toSnapshot(sub, account, mode);
        const { tenantId, via } = await resolveTenantId(supabase, sub, snap);

        if (!tenantId) {
          orphans.push({
            account,
            mode,
            stripe_subscription_id: snap.stripe_subscription_id,
            stripe_customer_id: snap.stripe_customer_id,
            status: snap.status,
          });
          continue;
        }
        if (onlyTenantId && tenantId !== onlyTenantId) continue;

        // EXISTENCE CHECK (must precede any write attempt).
        //
        // Stripe subscriptions outlive tenants: a deleted/abandoned tenant
        // leaves a live subscription whose metadata.tenant_id now points at a
        // row that no longer exists. tenant_subscriptions.tenant_id is a FK, so
        // inserting one would simply error. Report it as an orphan for a human
        // to cancel in Stripe rather than failing the whole run.
        const { data: tenantRecord } = await supabase
          .from("tenants")
          .select("company_name, subscription_account")
          .eq("id", tenantId)
          .maybeSingle();

        if (!tenantRecord) {
          orphans.push({
            account,
            mode,
            stripe_subscription_id: snap.stripe_subscription_id,
            stripe_customer_id: snap.stripe_customer_id,
            status: snap.status,
            metadata_tenant_id: tenantId,
            reason: "tenant no longer exists — stale Stripe subscription",
          });
          continue;
        }

        // POST-MIGRATION GUARD — mirrors handleSubscriptionUpdated.
        //
        // A tenant that has moved to the UAE account usually still has a legacy
        // UK subscription winding down via cancel_at_period_end, which Stripe's
        // UK account keeps reporting as active/trialing until the period ends.
        // The DB deliberately records that row as retired.
        //
        // Writing Stripe's UK view over it would either (a) trip the partial
        // unique index idx_tenant_subscriptions_active (one active row per
        // tenant) or (b) make the RETIRED UK subscription masquerade as the
        // tenant's current one, showing the old UK amount on the dashboard.
        // The UAE subscription is the source of truth for these tenants.
        if (account === "uk") {
          if (tenantRecord.subscription_account === "uae") {
            retiredUk.push({
              tenant_id: tenantId,
              stripe_subscription_id: snap.stripe_subscription_id,
              stripe_status: snap.status,
              reason: "tenant migrated to UAE; legacy UK subscription is retired",
            });
            continue;
          }
        }

        const { data: row } = await supabase
          .from("tenant_subscriptions")
          .select("*")
          .eq("stripe_subscription_id", snap.stripe_subscription_id)
          .maybeSingle();

        // Invoices are reconciled HERE, before the "subscription already in
        // sync -> continue" short-circuit below. A subscription row can be
        // perfectly in sync while one of its invoices is stale, and that stale
        // invoice is what the paywall actually decides on — so hanging this off
        // the subscription diff would skip exactly the tenants who look fine
        // and are silently locked out.
        const invRes = await reconcileInvoicesForSubscription(
          stripe,
          supabase,
          snap.stripe_subscription_id,
          tenantId,
          (row as any)?.id ?? null,
          dryRun,
        );
        invoicesSeen += invRes.seen;
        invoiceChanges.push(...invRes.changes);
        errors.push(...invRes.errors);

        const diff: Record<string, { db: unknown; stripe: unknown }> = {};
        for (const f of COMPARED) {
          const dbVal = row ? (row as any)[f] : null;
          const stVal = (snap as any)[f];
          if (norm(dbVal) !== norm(stVal)) diff[f] = { db: dbVal, stripe: stVal };
        }

        const isNew = !row;
        if (!isNew && Object.keys(diff).length === 0) continue;

        changes.push({
          tenant_id: tenantId,
          company: tenantRecord.company_name ?? null,
          resolved_via: via,
          account,
          mode,
          stripe_subscription_id: snap.stripe_subscription_id,
          action: isNew ? "insert" : "update",
          diff,
        });

        if (!dryRun) {
          const payload: Record<string, unknown> = {
            tenant_id: tenantId,
            stripe_subscription_id: snap.stripe_subscription_id,
            stripe_customer_id: snap.stripe_customer_id,
            status: snap.status,
            // amount is NOT NULL, so an insert must supply something; but never
            // let an unresolvable price (0) overwrite a good stored figure.
            ...(snap.amount > 0 || !row ? { amount: snap.amount } : {}),
            currency: snap.currency,
            interval: snap.interval,
            cancel_at: snap.cancel_at,
            canceled_at: snap.canceled_at,
            ended_at: snap.ended_at,
            trial_end: snap.trial_end,
            // Card details: never blank a stored value, same discipline as
            // `amount` above. Stripe's subscription.default_payment_method is
            // frequently null even when a card IS on file — the Billing Portal
            // sets the CUSTOMER's default payment method, not necessarily the
            // subscription's. Writing it unconditionally meant an ordinary
            // hourly run could wipe correct card_brand/card_last4 that the
            // webhook had captured at checkout, leaving the tenant's billing
            // screen showing no card while Stripe charges one happily.
            ...(snap.card_brand || !row ? { card_brand: snap.card_brand } : {}),
            ...(snap.card_last4 || !row ? { card_last4: snap.card_last4 } : {}),
            stripe_account: account,
            last_synced_at: new Date().toISOString(),
            last_sync_source: "reconcile",
            // Never clobber a stored period with null (see webhook fix).
            ...(snap.current_period_start
              ? { current_period_start: snap.current_period_start }
              : {}),
            ...(snap.current_period_end
              ? { current_period_end: snap.current_period_end }
              : {}),
          };

          const { error } = await supabase
            .from("tenant_subscriptions")
            .upsert(payload, { onConflict: "stripe_subscription_id" });

          if (error) {
            errors.push({
              tenant_id: tenantId,
              stripe_subscription_id: snap.stripe_subscription_id,
              error: error.message,
            });
          }
          // NOTE: deliberately no writes to `tenants` here — see invariant 2.
          // Plan name and go-live remain the webhook's business.
        }
      }
    } catch (e) {
      errors.push({ account, mode, error: String((e as any)?.message ?? e) });
    }
  }

  return jsonResponse({
    ok: true,
    dryRun,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    scope: onlyTenantId ?? "all-tenants",
    stripeSubscriptionsSeen: stripeCount,
    wouldChange: changes.length,
    changes,
    // Invoice drift is reported separately: a stale invoice is what actually
    // paywalls a tenant, so it must not be buried inside the subscription list.
    stripeInvoicesSeen: invoicesSeen,
    invoicesWouldChange: invoiceChanges.length,
    invoiceChanges,
    orphans,
    retiredUkIgnored: retiredUk,
    skippedCells: skipped,
    errors,
  });
});
