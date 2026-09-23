/**
 * integration-billing — premium integrations on the platform bill
 * (docs/integration-billing/build-spec.md). PURE: the service-role client,
 * the Stripe client factory and the clock are all passed in, so
 * tests/integrations/integration-billing drives this file directly and nothing
 * there reaches Stripe or Supabase. index.ts is only the Deno.serve wrapper.
 *
 * Actions (POST { action, ... }):
 *   subscribe      operator   add a premium integration to the tenant's platform
 *                             subscription (D6, D7, D8)
 *   upcoming       operator   the next invoice, one row per line (D11)
 *   invoice_lines  operator   one past invoice, one row per line (D11)
 *   cancel         super admin remove it again (D12)
 *
 * WHAT A SUBSCRIBE DOES TO THE BILL, in the transcript's own terms:
 *   - nothing is charged today. The item goes on with proration_behavior
 *     'none', so the days between now and the next billing date are free —
 *     "ye gap bhi hum khud bardasht karenge";
 *   - from the next bill on, the integration is its own line beside the
 *     platform fee, every month — "platform subscription 200 … Inshur
 *     subscription 20", never one merged figure;
 *   - "first month free" is a one-off credit for the full monthly price on
 *     that next bill, and only the first time this integration is ever on
 *     one of this tenant's bills.
 *
 * FAILURE PATHS (each pinned by a test): a create whose response was lost is
 * looked up by this claim's own metadata before anything is decided; the item
 * id is recorded the moment it exists; a failed undo leaves the row pending,
 * holding the one-live-row index; a claim a super admin canceled mid-flight is
 * never revived; a row whose platform subscription ended is closed.
 *
 * No existing subscription function is changed. subscription-webhook's
 * `customer.subscription.updated` handler never reads item amounts, and the
 * invoice handlers already store every invoice whatever lines it carries.
 */
import {
  authenticateOperator,
  authenticateSuperAdmin,
  type DbClient,
  type OperatorContext,
  type Outcome,
} from './auth.ts';
import {
  PREVIEW_ONLY_KEYS,
  integrationByKey,
  lookupKeyFor,
  productIdFor,
  productNameFor,
  type IntegrationInfo,
} from './catalog.ts';
import { summarizeInvoice, type InvoiceSummaryV2 } from './lines.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

export type SubscriptionAccount = 'uk' | 'uae';
export type StripeMode = 'test' | 'live';

/** The slice of the Stripe SDK (stripe@14, API 2023-10-16) this function uses. */
export interface StripeLike {
  subscriptions: { retrieve: (id: string, params?: Any) => Promise<Any> };
  subscriptionItems: {
    create: (params: Any, options?: Any) => Promise<Any>;
    del: (id: string, params?: Any) => Promise<Any>;
  };
  products: {
    retrieve: (id: string) => Promise<Any>;
    create: (params: Any) => Promise<Any>;
    update: (id: string, params: Any) => Promise<Any>;
  };
  prices: {
    list: (params: Any) => Promise<{ data: Any[] }>;
    create: (params: Any) => Promise<Any>;
  };
  invoiceItems: {
    create: (params: Any, options?: Any) => Promise<Any>;
    retrieve: (id: string) => Promise<Any>;
    del: (id: string) => Promise<Any>;
    list: (params: Any) => Promise<{ data: Any[] }>;
  };
  invoices: {
    retrieveUpcoming: (params: Any) => Promise<Any>;
    listUpcomingLines: (params: Any) => Promise<{ data: Any[] }>;
    retrieve: (id: string, params?: Any) => Promise<Any>;
    listLineItems: (id: string, params?: Any) => Promise<{ data: Any[] }>;
  };
}

export interface IntegrationBillingDeps {
  db: DbClient;
  stripeFor: (account: SubscriptionAccount, mode: StripeMode) => StripeLike;
  /** tenants.subscription_stripe_mode, through _shared/subscription-stripe.ts. */
  subscriptionMode: (tenantId: string) => Promise<StripeMode>;
  now: () => Date;
}

const json = (status: number, body: Record<string, unknown>): Outcome => ({ status, body });
const fail = (status: number, error: string, code?: string): Outcome =>
  json(status, { ok: false, error, ...(code ? { code } : {}) });

/** The table is not there yet: ops/integration_billing_v2.sql has not been applied. */
export function isMissingTable(error: Any): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (code === '42P01' || code === 'PGRST205') return true;
  return /could not find the table|does not exist/i.test(String(error.message ?? ''));
}

const NOT_SET_UP = fail(503, 'Premium integrations are not set up yet. Nothing was charged.', 'not_set_up');

const LIVE_PLAN_STATUSES = ['active', 'trialing', 'past_due'];

const toIso = (unixSeconds: unknown): string | null => {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
};

const idOf = (value: Any): string | null =>
  typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null;

const isMissingOnStripe = (e: Any): boolean =>
  e?.statusCode === 404 || e?.code === 'resource_missing' || e?.raw?.code === 'resource_missing';

const errorText = (e: Any): string => String(e?.message ?? e ?? 'unknown error').slice(0, 500);

/* ── entry point ────────────────────────────────────────────────────────── */

export async function handleIntegrationBilling(req: Request, deps: IntegrationBillingDeps): Promise<Outcome> {
  if (req.method !== 'POST') return fail(405, 'Use POST.');

  let body: Any;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'The request could not be read.');
  }
  if (!body || typeof body !== 'object') return fail(400, 'The request could not be read.');

  const action = String(body.action ?? '');

  if (action === 'cancel') {
    const auth = await authenticateSuperAdmin(req.headers, deps.db);
    if (!auth.ok) return auth.outcome;
    return cancel(auth.context.appUserId, body, deps);
  }

  if (action === 'subscribe' || action === 'upcoming' || action === 'invoice_lines') {
    const auth = await authenticateOperator(req.headers, deps.db, { write: action === 'subscribe' });
    if (!auth.ok) return auth.outcome;
    if (action === 'subscribe') return subscribe(auth.context, body, deps);
    if (action === 'upcoming') return upcoming(auth.context, deps);
    return invoiceLines(auth.context, body, deps);
  }

  return fail(400, 'Unknown action.');
}

/* ── the tenant's platform subscription ─────────────────────────────────── */

interface PlatformSubscription {
  id: string;
  status: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_account: string | null;
  currency: string | null;
  interval: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
}

const PLATFORM_COLUMNS =
  'id, status, stripe_subscription_id, stripe_customer_id, stripe_account, currency, interval, current_period_end, trial_end, cancel_at, canceled_at';

/**
 * Every live platform subscription of the tenant, newest first. The first is
 * the one a new integration goes on; the set says which subscriptions can
 * still carry an integration at all (during a UK → UAE move the old one keeps
 * billing until it ends).
 */
async function livePlatformSubscriptions(
  db: DbClient,
  tenantId: string,
): Promise<{ ok: true; plan: PlatformSubscription | null; liveIds: Set<string> } | { ok: false }> {
  const { data, error } = await db
    .from('tenant_subscriptions')
    .select(PLATFORM_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('status', LIVE_PLAN_STATUSES)
    .order('created_at', { ascending: false });
  if (error) return { ok: false };
  const rows = (data ?? []) as PlatformSubscription[];
  return { ok: true, plan: rows[0] ?? null, liveIds: new Set(rows.map((r) => r.stripe_subscription_id)) };
}

const accountOf = (sub: { stripe_account?: string | null }): SubscriptionAccount =>
  sub.stripe_account === 'uae' ? 'uae' : 'uk';

/** When the next bill is raised: the trial's end while trialing, else the period's end. */
function nextBillAt(sub: Any): string | null {
  if (sub?.status === 'trialing') return toIso(sub?.trial_end) ?? toIso(sub?.current_period_end);
  return toIso(sub?.current_period_end) ?? toIso(sub?.items?.data?.[0]?.current_period_end);
}

/** The integration's item on a Stripe subscription: by our product, or by this claim's own metadata. */
function integrationItemOn(sub: Any, key: string, claimId?: string): Any | null {
  const productId = productIdFor(key);
  return (
    (sub?.items?.data ?? []).find(
      (i: Any) => idOf(i?.price?.product) === productId || (claimId && i?.metadata?.d247_claim_id === claimId),
    ) ?? null
  );
}

/**
 * Was this integration ever actually on a bill? That is what uses up the free
 * first month: a subscription canceled before its first bill was raised never
 * reached one, so the free month is still owed.
 */
function wasOnABill(row: { first_bill_at?: string | null; canceled_at?: string | null }, now: Date): boolean {
  if (!row.first_bill_at) return false;
  const firstBill = new Date(row.first_bill_at).getTime();
  const until = row.canceled_at ? new Date(row.canceled_at).getTime() : now.getTime();
  return Number.isFinite(firstBill) && firstBill <= until;
}

/* ── Stripe objects we own ──────────────────────────────────────────────── */

async function ensureProduct(stripe: StripeLike, info: IntegrationInfo): Promise<string> {
  const id = productIdFor(info.key);
  try {
    const existing = await stripe.products.retrieve(id);
    if (existing && !existing.deleted) {
      if (existing.active === false) await stripe.products.update(id, { active: true });
      return id;
    }
  } catch (e) {
    if (!isMissingOnStripe(e)) throw e;
  }
  try {
    await stripe.products.create({
      id,
      name: productNameFor(info),
      metadata: { d247_integration_key: info.key },
    });
  } catch (e) {
    // Two subscribes at once: the other one created it first. Anything else is real.
    const again = await stripe.products.retrieve(id).catch(() => null);
    if (!again || again.deleted) throw e;
  }
  return id;
}

async function ensurePrice(stripe: StripeLike, info: IntegrationInfo, cents: number, currency: string): Promise<Any> {
  const lookupKey = lookupKeyFor(info.key, currency, cents);
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found?.data?.[0]) return found.data[0];

  const product = await ensureProduct(stripe, info);
  try {
    return await stripe.prices.create({
      product,
      currency,
      unit_amount: cents,
      recurring: { interval: 'month' },
      lookup_key: lookupKey,
      // An ARCHIVED price can still hold the key; without this, creating the
      // replacement would fail every time.
      transfer_lookup_key: true,
      metadata: { d247_integration_key: info.key },
    });
  } catch (e) {
    const again = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (again?.data?.[0]) return again.data[0];
    throw e;
  }
}

/* ── subscribe ──────────────────────────────────────────────────────────── */

async function subscribe(ctx: OperatorContext, body: Any, deps: IntegrationBillingDeps): Promise<Outcome> {
  const { db } = deps;
  const info = integrationByKey(body.integrationKey);
  if (!info) return fail(400, 'Unknown integration.');
  // A "coming soon" preview can wear the crown, but there is nothing to sell.
  if (PREVIEW_ONLY_KEYS.includes(info.key)) {
    return fail(409, `${info.name} is coming soon. You can subscribe as soon as it launches.`, 'coming_soon');
  }

  // 1. The catalog says it is premium, priced, and on offer.
  const { data: entry, error: entryError } = await db
    .from('integration_catalog_v2')
    .select('integration_key, is_premium, monthly_price_cents, currency, first_month_free, is_hidden, is_unavailable')
    .eq('integration_key', info.key)
    .maybeSingle();
  if (entryError) return isMissingTable(entryError) ? NOT_SET_UP : fail(500, 'The price could not be loaded. Try again.');
  if (!entry?.is_premium) {
    return fail(409, `${info.name} is free. There is nothing to subscribe to.`, 'not_premium');
  }
  if (entry.is_hidden || entry.is_unavailable) {
    return fail(409, `${info.name} is not available right now.`, 'unavailable');
  }
  // Premium with no price yet ("Price to be announced"): not on sale.
  const cents = Number(entry.monthly_price_cents);
  if (entry.monthly_price_cents == null || !Number.isInteger(cents) || cents <= 0) {
    return fail(409, `${info.name} isn't on sale yet. Its price will be announced soon.`, 'no_price');
  }
  const priceCurrency = String(entry.currency ?? 'usd').toLowerCase();

  // 2. There is a platform bill to add it to.
  const platform = await livePlatformSubscriptions(db, ctx.tenant.id);
  if (!platform.ok) return fail(500, 'Your Drive247 plan could not be loaded. Try again.');
  const plan = platform.plan;
  if (!plan) {
    return fail(409, 'Start your Drive247 plan first. Premium integrations are added to that bill.', 'no_plan');
  }
  if (plan.status === 'past_due') {
    return fail(409, 'Your last Drive247 bill has not been paid. Settle it in Billing first.', 'past_due');
  }
  if (plan.cancel_at || plan.canceled_at) {
    return fail(409, 'Your Drive247 plan is set to end, so there is no next bill to add this to.', 'plan_ending');
  }
  const planCurrency = String(plan.currency ?? 'usd').toLowerCase();
  if (planCurrency !== priceCurrency) {
    return fail(
      409,
      `Your plan is billed in ${planCurrency.toUpperCase()} and ${info.name} is priced in ${priceCurrency.toUpperCase()}. Contact support@drive-247.com to add it.`,
      'currency',
    );
  }
  if ((plan.interval ?? 'month') !== 'month') {
    return fail(
      409,
      `Premium integrations are billed monthly and your plan is billed every ${plan.interval}. Contact support@drive-247.com to add it.`,
      'interval',
    );
  }

  // 3. Not already on, and whether the free month still applies.
  const { data: prior, error: priorError } = await db
    .from('tenant_integration_subscriptions_v2')
    .select('id, status, stripe_subscription_id, first_bill_at, canceled_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('integration_key', info.key);
  if (priorError) return isMissingTable(priorError) ? NOT_SET_UP : fail(500, 'Your subscriptions could not be loaded. Try again.');
  const rows: Array<{ id: string; status: string; stripe_subscription_id?: string | null; first_bill_at?: string | null; canceled_at?: string | null }> =
    prior ?? [];

  // A live row on a platform subscription that is no longer live (canceled, or
  // replaced by a new one) ended with it: its item went when that subscription
  // did. Close it, so it neither blocks this subscribe nor reads as current.
  const nowIso = deps.now().toISOString();
  for (const r of rows) {
    const live = r.status === 'active' || r.status === 'pending';
    if (live && r.stripe_subscription_id && !platform.liveIds.has(r.stripe_subscription_id)) {
      const { error } = await db
        .from('tenant_integration_subscriptions_v2')
        .update({ status: 'canceled', canceled_at: nowIso, error: 'its platform subscription ended', updated_at: nowIso })
        .eq('id', r.id)
        .eq('tenant_id', ctx.tenant.id);
      if (error) return fail(500, 'Your subscriptions could not be updated. Try again.');
      r.status = 'canceled';
      r.canceled_at = nowIso;
    }
  }
  if (rows.some((r) => r.status === 'active' || r.status === 'pending')) {
    return fail(409, `You are already subscribed to ${info.name}.`, 'already_subscribed');
  }
  // "First" means the first time it was ever on a bill.
  const firstMonthFree =
    entry.first_month_free === true && !rows.some((r) => r.status === 'canceled' && wasOnABill(r, deps.now()));

  let mode: StripeMode;
  try {
    mode = await deps.subscriptionMode(ctx.tenant.id);
  } catch {
    return fail(500, 'Your billing account could not be resolved. Try again.');
  }
  const account = accountOf(plan);
  // Built BEFORE the claim: a missing Stripe key for this account and mode must
  // answer "not set up" with nothing written, never leave a pending row holding
  // the one-live-subscription index.
  let stripe: StripeLike;
  try {
    stripe = deps.stripeFor(account, mode);
  } catch (e) {
    console.error(`[integration-billing] no Stripe client for ${account}/${mode}:`, errorText(e));
    return NOT_SET_UP;
  }

  // 4. Claim. The partial unique index turns a double click into one row, so
  //    only one request ever reaches Stripe.
  const { data: claim, error: claimError } = await db
    .from('tenant_integration_subscriptions_v2')
    .insert({
      tenant_id: ctx.tenant.id,
      integration_key: info.key,
      status: 'pending',
      monthly_price_cents: cents,
      currency: priceCurrency,
      first_month_free: firstMonthFree,
      stripe_account: account,
      stripe_mode: mode,
      stripe_subscription_id: plan.stripe_subscription_id,
      subscribed_by: ctx.caller.appUserId,
    })
    .select('id')
    .single();
  if (claimError) {
    if (String(claimError.code) === '23505') {
      return fail(409, `You are already subscribed to ${info.name}.`, 'already_subscribed');
    }
    return isMissingTable(claimError) ? NOT_SET_UP : fail(500, 'Your subscription could not be started. Nothing was charged.');
  }
  const rowId = String(claim.id);

  let itemId: string | null = null;
  let creditId: string | null = null;
  let adopted = false;
  let priceId: string | null = null;
  let recordedCents = cents;
  let firstBill: string | null = null;
  let customerId: string = plan.stripe_customer_id;
  let itemCreateAttempted = false;
  let creditCreateAttempted = false;

  /**
   * Take off whatever this claim put on. Answers false when an item may still
   * be on the subscription (so the row must stay pending and hold the index).
   * A create whose RESPONSE was lost still happened at Stripe, so an attempt
   * with no id is looked up — by this claim's own metadata — before deciding.
   */
  const undo = async (): Promise<boolean> => {
    let clean = true;
    if (!itemId && itemCreateAttempted) {
      try {
        const again = await stripe.subscriptions.retrieve(plan.stripe_subscription_id);
        itemId = idOf(integrationItemOn(again, info.key, rowId)) ?? null;
      } catch {
        return false; // cannot tell whether it went on: assume it may have
      }
    }
    if (itemId && !adopted) {
      try {
        await stripe.subscriptionItems.del(itemId, { proration_behavior: 'none' });
      } catch (delError) {
        if (!isMissingOnStripe(delError)) clean = false;
      }
    }
    if (!creditId && creditCreateAttempted) {
      try {
        const pending = await stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 100 });
        creditId = idOf((pending?.data ?? []).find((ii: Any) => ii?.metadata?.d247_claim_id === rowId)) ?? null;
      } catch {
        console.error(`[integration-billing] could not look for a stray free-month credit for claim ${rowId}`);
      }
    }
    if (creditId) {
      try {
        await stripe.invoiceItems.del(creditId);
      } catch {
        // A credit left behind can only lower a bill; it must be removed by hand.
        console.error(`[integration-billing] STRAY CREDIT ${creditId} left pending for claim ${rowId}`);
      }
    }
    return clean;
  };

  try {
    // Stripe is the source of truth for whether there is a next bill.
    const live = await stripe.subscriptions.retrieve(plan.stripe_subscription_id);
    if (!['active', 'trialing'].includes(String(live?.status)) || live?.cancel_at_period_end || live?.cancel_at) {
      await markRow(db, rowId, { status: 'failed', error: `platform subscription is ${live?.status}${live?.cancel_at_period_end || live?.cancel_at ? ', set to cancel' : ''}` }, deps);
      return fail(409, 'Your Drive247 plan has no next bill to add this to. Nothing was charged.', 'plan_ending');
    }
    if (String(live.currency ?? planCurrency).toLowerCase() !== priceCurrency) {
      await markRow(db, rowId, { status: 'failed', error: `currency ${live.currency} on Stripe` }, deps);
      return fail(409, `Your plan is billed in ${String(live.currency).toUpperCase()}. Contact support@drive-247.com to add ${info.name}.`, 'currency');
    }
    firstBill = nextBillAt(live) ?? plan.current_period_end;
    customerId = idOf(live.customer) ?? plan.stripe_customer_id;

    // Already on the subscription (a lost write, or added by hand in Stripe):
    // adopt it. Nothing new is added, so nothing new is charged.
    const existing = integrationItemOn(live, info.key);
    if (existing) {
      adopted = true;
      itemId = String(existing.id);
      priceId = idOf(existing.price);
      const unit = Number(existing.price?.unit_amount);
      if (Number.isInteger(unit) && unit > 0) recordedCents = unit;
    } else {
      const price = await ensurePrice(stripe, info, cents, priceCurrency);
      priceId = String(price.id);
      itemCreateAttempted = true;
      const item = await stripe.subscriptionItems.create(
        {
          subscription: live.id,
          price: priceId,
          quantity: 1,
          // The gap until the next billing date is ours to absorb.
          proration_behavior: 'none',
          metadata: { d247_integration_key: info.key, d247_claim_id: rowId, tenant_id: ctx.tenant.id },
        },
        { idempotencyKey: `d247-int-item-${rowId}` },
      );
      itemId = String(item.id);
      // On record at once: if this isolate dies now, the row still says which
      // item it put on, so it can be found and removed.
      await markRow(db, rowId, { stripe_subscription_item_id: itemId, stripe_price_id: priceId }, deps);

      if (firstMonthFree) {
        creditCreateAttempted = true;
        const credit = await stripe.invoiceItems.create(
          {
            customer: customerId,
            subscription: live.id,
            currency: priceCurrency,
            amount: -cents,
            description: `${productNameFor(info)}: first month free`,
            metadata: { d247_integration_key: info.key, d247_kind: 'first_month_free', d247_claim_id: rowId, tenant_id: ctx.tenant.id },
          },
          { idempotencyKey: `d247-int-free-${rowId}` },
        );
        creditId = String(credit.id);
      }
    }
  } catch (e) {
    console.error(`[integration-billing] subscribe ${info.key} for tenant ${ctx.tenant.id} failed:`, errorText(e));
    // Undo whatever went on, so a half-finished subscribe never bills: an item
    // without its promised free month is exactly that.
    const clean = await undo();
    if (!clean) {
      // Leave the row PENDING: it keeps the unique index held, so the operator
      // cannot add a second copy while a super admin removes this one.
      console.error(`[integration-billing] ROLLBACK FAILED: item ${itemId ?? '(unknown)'} may still be on ${plan.stripe_subscription_id}`);
      await markRow(db, rowId, {
        stripe_subscription_item_id: itemId,
        stripe_credit_invoice_item_id: creditId,
        error: `rollback failed; item ${itemId ?? '(unknown id)'} may still be on the subscription: ${errorText(e)}`,
      }, deps);
      return fail(502, `Stripe did not finish adding ${info.name}. Contact support@drive-247.com and we will sort it out.`, 'stripe_error');
    }
    await markRow(db, rowId, { status: 'failed', stripe_subscription_item_id: null, error: errorText(e) }, deps);
    return fail(502, `Stripe could not add ${info.name} to your plan. Nothing was charged. Try again.`, 'stripe_error');
  }

  // Active only if still pending: a super admin may have canceled the claim
  // while Stripe was working, and a canceled row must never be revived.
  const activated = await markRow(db, rowId, {
    status: 'active',
    stripe_subscription_item_id: itemId,
    stripe_price_id: priceId,
    stripe_credit_invoice_item_id: creditId,
    first_bill_at: firstBill,
    first_month_free: adopted ? false : firstMonthFree,
    monthly_price_cents: recordedCents,
    error: null,
  }, deps, { onlyIfPending: true });
  if (activated === 'gone') {
    const clean = await undo();
    console.error(`[integration-billing] claim ${rowId} was canceled mid-subscribe; undo ${clean ? 'done' : 'FAILED'}`);
    return fail(409, `This ${info.name} subscription was canceled while it was being set up. ${clean ? 'Nothing was charged.' : 'Contact support@drive-247.com.'}`, 'canceled');
  }
  if (activated === 'error') {
    console.error(`[integration-billing] ${info.key} is on ${plan.stripe_subscription_id} (item ${itemId}) but row ${rowId} could not be marked active`);
  }

  return json(200, {
    ok: true,
    subscription: {
      id: rowId,
      integrationKey: info.key,
      status: activated === 'ok' ? 'active' : 'pending',
      monthlyPriceCents: recordedCents,
      currency: priceCurrency,
      firstMonthFree: adopted ? false : firstMonthFree,
      firstBillAt: firstBill,
      adopted,
    },
  });
}

/**
 * Update a claim row. One retry. `onlyIfPending` refuses to touch a row that
 * has moved on (a super admin canceled it) and answers 'gone' for that.
 */
async function markRow(
  db: DbClient,
  rowId: string,
  patch: Record<string, unknown>,
  deps: IntegrationBillingDeps,
  opts: { onlyIfPending?: boolean } = {},
): Promise<'ok' | 'gone' | 'error'> {
  const values = { ...patch, updated_at: deps.now().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let query = db.from('tenant_integration_subscriptions_v2').update(values).eq('id', rowId);
    if (opts.onlyIfPending) query = query.eq('status', 'pending').select('id');
    const { data, error } = await query;
    if (!error) {
      if (opts.onlyIfPending && Array.isArray(data) && data.length === 0) return 'gone';
      return 'ok';
    }
    console.error(`[integration-billing] could not update row ${rowId}:`, error.message ?? error);
  }
  return 'error';
}

/* ── upcoming ───────────────────────────────────────────────────────────── */

async function upcoming(ctx: OperatorContext, deps: IntegrationBillingDeps): Promise<Outcome> {
  const platform = await livePlatformSubscriptions(deps.db, ctx.tenant.id);
  if (!platform.ok) return fail(500, 'Your Drive247 plan could not be loaded. Try again.');
  const plan = platform.plan;
  if (!plan) return json(200, { ok: true, upcoming: null, reason: 'no_plan' });
  // Ending before the next bill is raised: there is no next bill. A cancel date
  // AFTER the period end still leaves this one to come.
  const endsFirst =
    !!plan.canceled_at ||
    (!!plan.cancel_at && (!plan.current_period_end || new Date(plan.cancel_at).getTime() <= new Date(plan.current_period_end).getTime()));
  if (endsFirst) return json(200, { ok: true, upcoming: null, reason: 'plan_ending' });

  let mode: StripeMode;
  try {
    mode = await deps.subscriptionMode(ctx.tenant.id);
  } catch {
    return fail(500, 'Your billing account could not be resolved. Try again.');
  }
  let stripe: StripeLike;
  try {
    stripe = deps.stripeFor(accountOf(plan), mode);
  } catch {
    return NOT_SET_UP;
  }

  try {
    const invoice = await stripe.invoices.retrieveUpcoming({ subscription: plan.stripe_subscription_id });
    let lines: Any[] = invoice?.lines?.data ?? [];
    if (invoice?.lines?.has_more) {
      lines = (await stripe.invoices.listUpcomingLines({ subscription: plan.stripe_subscription_id, limit: 100 }))?.data ?? lines;
    }
    const summary: InvoiceSummaryV2 = summarizeInvoice(invoice, lines);
    const date =
      (plan.status === 'trialing' ? plan.trial_end : null) ??
      plan.current_period_end ??
      toIso(invoice?.next_payment_attempt) ??
      toIso(invoice?.period_end);
    return json(200, { ok: true, upcoming: { ...summary, date } });
  } catch (e) {
    const err = e as Any;
    // Stripe answers invoice_upcoming_none when there is nothing to bill next.
    if (err?.code === 'invoice_upcoming_none' || err?.raw?.code === 'invoice_upcoming_none') {
      return json(200, { ok: true, upcoming: null, reason: 'none' });
    }
    console.error(`[integration-billing] upcoming for tenant ${ctx.tenant.id} failed:`, errorText(e));
    return fail(502, 'Your next invoice could not be loaded from Stripe. Try again.', 'stripe_error');
  }
}

/* ── invoice_lines ──────────────────────────────────────────────────────── */

async function invoiceLines(ctx: OperatorContext, body: Any, deps: IntegrationBillingDeps): Promise<Outcome> {
  const invoiceId = String(body.stripeInvoiceId ?? '');
  if (!/^in_[A-Za-z0-9]{6,}$/.test(invoiceId)) return fail(400, 'Unknown invoice.');

  // It must be one of THIS tenant's invoices, by our own records first…
  const { data: row, error } = await deps.db
    .from('tenant_subscription_invoices')
    .select('stripe_invoice_id, subscription_id')
    .eq('tenant_id', ctx.tenant.id)
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle();
  if (error) return fail(500, 'The invoice could not be loaded. Try again.');
  if (!row) return fail(404, 'Unknown invoice.');

  const { data: subs, error: subsError } = await deps.db
    .from('tenant_subscriptions')
    .select('id, stripe_account, stripe_customer_id')
    .eq('tenant_id', ctx.tenant.id);
  if (subsError) return fail(500, 'The invoice could not be loaded. Try again.');
  const all: Array<{ id: string; stripe_account: string | null; stripe_customer_id: string | null }> = subs ?? [];
  const owner = all.find((s) => s.id === row.subscription_id) ?? all[0];
  const customers = new Set(all.map((s) => s.stripe_customer_id).filter(Boolean));

  let mode: StripeMode;
  try {
    mode = await deps.subscriptionMode(ctx.tenant.id);
  } catch {
    return fail(500, 'Your billing account could not be resolved. Try again.');
  }
  const account = owner ? accountOf(owner) : 'uk';

  // The invoice may predate a test → live switch, so the other mode is tried once.
  for (const tryMode of [mode, mode === 'live' ? 'test' : 'live'] as StripeMode[]) {
    let stripe: StripeLike;
    try {
      stripe = deps.stripeFor(account, tryMode);
    } catch {
      continue;
    }
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      // …and by Stripe's: the invoice's customer is one of this tenant's.
      if (!customers.has(idOf(invoice?.customer) ?? '')) return fail(404, 'Unknown invoice.');
      let lines: Any[] = invoice?.lines?.data ?? [];
      if (invoice?.lines?.has_more) {
        lines = (await stripe.invoices.listLineItems(invoiceId, { limit: 100 }))?.data ?? lines;
      }
      return json(200, { ok: true, invoice: summarizeInvoice(invoice, lines) });
    } catch (e) {
      if (isMissingOnStripe(e)) continue;
      console.error(`[integration-billing] invoice ${invoiceId} for tenant ${ctx.tenant.id} failed:`, errorText(e));
      return fail(502, 'This invoice could not be loaded from Stripe. Try again.', 'stripe_error');
    }
  }
  return fail(404, 'This invoice could not be found on Stripe.');
}

/* ── cancel (super admin) ───────────────────────────────────────────────── */

async function cancel(adminAppUserId: string, body: Any, deps: IntegrationBillingDeps): Promise<Outcome> {
  const { db } = deps;
  const tenantId = String(body.tenantId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return fail(400, 'Unknown company.');
  const info = integrationByKey(body.integrationKey);
  if (!info) return fail(400, 'Unknown integration.');

  const { data: rows, error } = await db
    .from('tenant_integration_subscriptions_v2')
    .select('id, status, stripe_account, stripe_mode, stripe_subscription_id, stripe_subscription_item_id, stripe_credit_invoice_item_id')
    .eq('tenant_id', tenantId)
    .eq('integration_key', info.key)
    .in('status', ['pending', 'active']);
  if (error) return isMissingTable(error) ? NOT_SET_UP : fail(500, 'The subscription could not be loaded. Try again.');
  const row = rows?.[0];
  if (!row) return fail(404, `This company is not subscribed to ${info.name}.`);

  let stripe: StripeLike;
  try {
    stripe = deps.stripeFor(row.stripe_account === 'uae' ? 'uae' : 'uk', row.stripe_mode === 'live' ? 'live' : 'test');
  } catch {
    return NOT_SET_UP;
  }

  // 1. The item. A platform subscription that has ended took its items with it.
  try {
    let live: Any = null;
    try {
      live = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    } catch (e) {
      if (!isMissingOnStripe(e)) throw e;
    }
    const ended = !live || ['canceled', 'incomplete_expired'].includes(String(live.status));
    if (!ended) {
      const itemId: string | null = row.stripe_subscription_item_id ?? idOf(integrationItemOn(live, info.key, row.id));
      if (itemId) {
        try {
          // No proration: nothing is refunded or charged for the rest of this period.
          await stripe.subscriptionItems.del(itemId, { proration_behavior: 'none' });
        } catch (e) {
          if (!isMissingOnStripe(e)) throw e;
        }
      }
    }
  } catch (e) {
    console.error(`[integration-billing] cancel ${info.key} for tenant ${tenantId} failed:`, errorText(e));
    return fail(502, `Stripe could not remove ${info.name}. Nothing was changed. Try again.`, 'stripe_error');
  }

  // 2. A still-pending free-month credit. Without the item it would only be a
  //    stray discount on the platform fee. Its failure does not undo step 1.
  let creditLeft = false;
  if (row.stripe_credit_invoice_item_id) {
    try {
      const credit = await stripe.invoiceItems.retrieve(row.stripe_credit_invoice_item_id);
      if (credit && !credit.deleted && !credit.invoice) await stripe.invoiceItems.del(row.stripe_credit_invoice_item_id);
    } catch (e) {
      if (!isMissingOnStripe(e)) {
        creditLeft = true;
        console.error(`[integration-billing] STRAY CREDIT ${row.stripe_credit_invoice_item_id} left pending after canceling ${row.id}:`, errorText(e));
      }
    }
  }

  const now = deps.now().toISOString();
  const { error: updateError } = await db
    .from('tenant_integration_subscriptions_v2')
    .update({
      status: 'canceled',
      canceled_at: now,
      canceled_by: adminAppUserId,
      updated_at: now,
      ...(creditLeft ? { error: `free-month credit ${row.stripe_credit_invoice_item_id} could not be removed; delete it in Stripe` } : {}),
    })
    .eq('id', row.id)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'active']);
  if (updateError) {
    console.error(`[integration-billing] ${info.key} removed on Stripe but row ${row.id} not marked canceled:`, updateError.message);
    return fail(500, `${info.name} was removed from the bill, but the record could not be updated. Reload and check.`);
  }
  return json(200, {
    ok: true,
    canceled: { id: row.id, integrationKey: info.key, creditLeft },
    ...(creditLeft
      ? { warning: `${info.name} is off the bill, but its first-month-free credit could not be removed. Delete it in Stripe.` }
      : {}),
  });
}
