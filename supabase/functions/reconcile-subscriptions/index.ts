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
    amount: sub.items?.data?.[0]?.price?.unit_amount ?? 0,
    currency: sub.currency ?? "usd",
    interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? "month",
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
            amount: snap.amount,
            currency: snap.currency,
            interval: snap.interval,
            cancel_at: snap.cancel_at,
            canceled_at: snap.canceled_at,
            ended_at: snap.ended_at,
            trial_end: snap.trial_end,
            card_brand: snap.card_brand,
            card_last4: snap.card_last4,
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
    orphans,
    retiredUkIgnored: retiredUk,
    skippedCells: skipped,
    errors,
  });
});
