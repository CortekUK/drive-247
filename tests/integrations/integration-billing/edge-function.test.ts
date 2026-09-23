/**
 * integration-billing edge function (supabase/functions/integration-billing).
 *
 * Driven through the real entry point, `handleIntegrationBilling` in core.ts,
 * with a recording fake of the service-role Supabase client and a recording
 * fake of the Stripe SDK. Nothing here reaches Stripe or Supabase.
 *
 * Pinned (docs/integration-billing/build-spec.md):
 *  - auth: no token 401; northwind only (a v2 tenant that is not on the list
 *    is refused before any Stripe call); a viewer may read the next invoice
 *    but not subscribe; a manager needs editor on settings AND
 *    settings.subscription; cancel is super admin only (D1, D8, D13);
 *  - every precondition is answered BEFORE Stripe and before the claim row
 *    (D8);
 *  - the bill: the item goes on with proration 'none' (nothing charged today,
 *    the gap is ours), priced by lookup key, on a product named
 *    "<Name> subscription"; the first month free is ONE credit for the full
 *    price, the first time only (D6, D7);
 *  - a half-finished subscribe is undone, and a failed undo keeps the row
 *    pending so a second copy cannot be added (D5, D7);
 *  - the next invoice and a past invoice come back one row per line (D11);
 *  - cancel removes the item with no proration and a still-pending credit.
 *
 * Every expected amount below is written by hand from the fixture, never
 * computed by the code under test.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { handleIntegrationBilling, type IntegrationBillingDeps, type StripeLike } from '@fn/integration-billing/core.ts';
import { summarizeInvoice, labelInvoiceLine } from '@fn/integration-billing/lines.ts';
import { lookupKeyFor, productIdFor } from '@fn/integration-billing/catalog.ts';

/* ── the fake service-role client ─────────────────────────────────────── */

type Filter = [column: string, op: string, value: unknown];
interface Op {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert';
  columns?: string;
  payload?: any;
  filters: Filter[];
  terminal: 'single' | 'maybeSingle' | null;
}

const NORTHWIND_ID = '11111111-1111-4111-8111-111111111111';
const GONIKO_ID = '22222222-2222-4222-8222-222222222222';
const ROW_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

const PERIOD_END_UNIX = 1792022400; // 2026-10-15T00:00:00Z
const PERIOD_END_ISO = '2026-10-15T00:00:00.000Z';
const TRIAL_END_UNIX = 1791417600; // 2026-10-08T00:00:00Z
const TRIAL_END_ISO = '2026-10-08T00:00:00.000Z';

const state = {
  ops: [] as Op[],
  users: {} as Record<string, string>,
  appUser: null as any,
  grants: [] as any[],
  tenants: [] as any[],
  catalog: [] as any[],
  catalogError: null as any,
  plans: [] as any[],
  intRows: [] as any[],
  intError: null as any,
  claimError: null as any,
  updateErrors: 0,
  invoices: [] as any[],
  /** Runs after every update of the claims table: a hook for "canceled mid-flight". */
  onUpdate: null as null | ((op: Op) => void),
};

const matches = (row: any, filters: Filter[]) =>
  filters.every(([col, op, value]) => {
    if (op === 'eq') return row[col] === value;
    if (op === 'in') return (value as unknown[]).includes(row[col]);
    return true;
  });

function respond(op: Op): { data: any; error: any } {
  const one = (rows: any[]) => (op.terminal ? rows[0] ?? null : rows);
  switch (op.table) {
    case 'app_users':
      return { data: state.appUser, error: null };
    case 'manager_permissions':
      return { data: state.grants, error: null };
    case 'tenants':
      return { data: one(state.tenants.filter((t) => matches(t, op.filters))), error: null };
    case 'integration_catalog_v2':
      if (state.catalogError) return { data: null, error: state.catalogError };
      return { data: one(state.catalog.filter((r) => matches(r, op.filters))), error: null };
    case 'tenant_subscriptions':
      return { data: one(state.plans.filter((r) => matches(r, op.filters))), error: null };
    case 'tenant_subscription_invoices':
      return { data: one(state.invoices.filter((r) => matches(r, op.filters))), error: null };
    case 'tenant_integration_subscriptions_v2': {
      if (op.action === 'insert') {
        if (state.claimError) return { data: null, error: state.claimError };
        state.intRows.push({ id: ROW_ID, ...op.payload });
        return { data: { id: ROW_ID }, error: null };
      }
      if (op.action === 'update') {
        if (state.updateErrors > 0) {
          state.updateErrors -= 1;
          return { data: null, error: { message: 'write refused' } };
        }
        // Match first, then write — the filters describe the row as it was.
        const hit = state.intRows.filter((r) => matches(r, op.filters));
        for (const r of hit) Object.assign(r, op.payload);
        state.onUpdate?.(op);
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (state.intError) return { data: null, error: state.intError };
      return { data: one(state.intRows.filter((r) => matches(r, op.filters))), error: null };
    }
    default:
      return { data: null, error: null };
  }
}

function builder(table: string) {
  const op: Op = { table, action: 'select', filters: [], terminal: null };
  const run = () => {
    state.ops.push(op);
    return Promise.resolve(respond(op));
  };
  const api: any = {
    select(columns?: string) {
      if (op.action === 'select') op.columns = columns;
      return api;
    },
    insert: (payload: any) => ((op.action = 'insert'), (op.payload = payload), api),
    update: (payload: any) => ((op.action = 'update'), (op.payload = payload), api),
    eq: (c: string, v: unknown) => (op.filters.push([c, 'eq', v]), api),
    in: (c: string, v: unknown) => (op.filters.push([c, 'in', v]), api),
    order: () => api,
    limit: () => api,
    maybeSingle: () => ((op.terminal = 'maybeSingle'), run()),
    single: () => ((op.terminal = 'single'), run()),
    then: (resolve: any, reject: any) => run().then(resolve, reject),
  };
  return api;
}

const db = {
  from: (table: string) => builder(table),
  auth: {
    getUser: async (token: string) =>
      state.users[token]
        ? { data: { user: { id: state.users[token] } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } },
  },
};

/* ── the fake Stripe ──────────────────────────────────────────────────── */

const calls: Array<{ method: string; args: any[] }> = [];
const stripeState = {
  subscription: null as any,
  priceFound: null as any,
  productExists: true,
  itemCreateError: null as any,
  creditCreateError: null as any,
  itemDeleteError: null as any,
  upcoming: null as any,
  upcomingError: null as any,
  invoice: null as any,
  creditItem: null as any,
  /** Answers for successive subscriptions.retrieve calls, before `subscription`. */
  retrieveQueue: [] as any[],
  pendingInvoiceItems: [] as any[],
  creditRetrieveError: null as any,
};
const stripeAccounts: Array<[string, string]> = [];

const fakeStripe: StripeLike = {
  subscriptions: {
    retrieve: async (...args) => {
      calls.push({ method: 'subscriptions.retrieve', args });
      if (stripeState.retrieveQueue.length > 0) {
        const next = stripeState.retrieveQueue.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      return stripeState.subscription;
    },
  },
  subscriptionItems: {
    create: async (...args) => {
      calls.push({ method: 'subscriptionItems.create', args });
      if (stripeState.itemCreateError) throw stripeState.itemCreateError;
      return { id: 'si_new' };
    },
    del: async (...args) => {
      calls.push({ method: 'subscriptionItems.del', args });
      if (stripeState.itemDeleteError) throw stripeState.itemDeleteError;
      return { id: args[0], deleted: true };
    },
  },
  products: {
    retrieve: async (...args) => {
      calls.push({ method: 'products.retrieve', args });
      if (!stripeState.productExists) throw Object.assign(new Error('No such product'), { statusCode: 404, code: 'resource_missing' });
      return { id: args[0], active: true };
    },
    create: async (...args) => (calls.push({ method: 'products.create', args }), { id: args[0].id }),
    update: async (...args) => (calls.push({ method: 'products.update', args }), { id: args[0] }),
  },
  prices: {
    list: async (...args) => (calls.push({ method: 'prices.list', args }), { data: stripeState.priceFound ? [stripeState.priceFound] : [] }),
    create: async (...args) => (calls.push({ method: 'prices.create', args }), { id: 'price_new', ...args[0] }),
  },
  invoiceItems: {
    create: async (...args) => {
      calls.push({ method: 'invoiceItems.create', args });
      if (stripeState.creditCreateError) throw stripeState.creditCreateError;
      return { id: 'ii_credit' };
    },
    retrieve: async (...args) => {
      calls.push({ method: 'invoiceItems.retrieve', args });
      if (stripeState.creditRetrieveError) throw stripeState.creditRetrieveError;
      return stripeState.creditItem;
    },
    del: async (...args) => (calls.push({ method: 'invoiceItems.del', args }), { id: args[0], deleted: true }),
    list: async (...args) => (calls.push({ method: 'invoiceItems.list', args }), { data: stripeState.pendingInvoiceItems }),
  },
  invoices: {
    retrieveUpcoming: async (...args) => {
      calls.push({ method: 'invoices.retrieveUpcoming', args });
      if (stripeState.upcomingError) throw stripeState.upcomingError;
      return stripeState.upcoming;
    },
    listUpcomingLines: async (...args) => (calls.push({ method: 'invoices.listUpcomingLines', args }), { data: [] }),
    retrieve: async (...args) => (calls.push({ method: 'invoices.retrieve', args }), stripeState.invoice),
    listLineItems: async (...args) => (calls.push({ method: 'invoices.listLineItems', args }), { data: [] }),
  },
};

const deps: IntegrationBillingDeps = {
  db,
  stripeFor: (account, mode) => {
    stripeAccounts.push([account, mode]);
    return fakeStripe;
  },
  subscriptionMode: async () => 'live',
  now: () => new Date('2026-09-22T10:00:00.000Z'),
};

/* ── fixtures ──────────────────────────────────────────────────────────── */

const ORIGIN = 'https://northwind.portal.drive-247.com';
const URL_ = 'https://project.supabase.test/functions/v1/integration-billing';

const call = (body: unknown, token: string | null = 'tok-staff', origin = ORIGIN) =>
  handleIntegrationBilling(
    new Request(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    deps,
  );

const squarePremium = (over: Record<string, unknown> = {}) => ({
  integration_key: 'square',
  is_premium: true,
  monthly_price_cents: 2000,
  currency: 'usd',
  first_month_free: false,
  is_hidden: false,
  is_unavailable: false,
  ...over,
});

const northwindPlan = (over: Record<string, unknown> = {}) => ({
  id: 'plan-row',
  tenant_id: NORTHWIND_ID,
  status: 'active',
  stripe_subscription_id: 'sub_platform',
  stripe_customer_id: 'cus_northwind',
  stripe_account: 'uae',
  currency: 'usd',
  interval: 'month',
  current_period_end: PERIOD_END_ISO,
  trial_end: null,
  cancel_at: null,
  canceled_at: null,
  ...over,
});

const liveStripeSub = (over: Record<string, unknown> = {}) => ({
  id: 'sub_platform',
  status: 'active',
  customer: 'cus_northwind',
  currency: 'usd',
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: PERIOD_END_UNIX,
  trial_end: null,
  items: { data: [{ id: 'si_plan', price: { id: 'price_plan', product: 'prod_platform', unit_amount: 20000 } }] },
  ...over,
});

const methods = () => calls.map((c) => c.method);
const findCall = (method: string) => calls.find((c) => c.method === method);
const intInserts = () => state.ops.filter((o) => o.table === 'tenant_integration_subscriptions_v2' && o.action === 'insert');

beforeEach(() => {
  state.ops = [];
  state.users = { 'tok-staff': 'auth-staff' };
  state.appUser = { id: 'app-staff', tenant_id: NORTHWIND_ID, role: 'admin', is_super_admin: false, is_active: true };
  state.grants = [];
  state.tenants = [
    { id: NORTHWIND_ID, slug: 'northwind' },
    { id: GONIKO_ID, slug: 'goniko' },
  ];
  state.catalog = [squarePremium()];
  state.catalogError = null;
  state.plans = [northwindPlan()];
  state.intRows = [];
  state.intError = null;
  state.claimError = null;
  state.updateErrors = 0;
  state.invoices = [];
  state.onUpdate = null;
  calls.length = 0;
  stripeAccounts.length = 0;
  Object.assign(stripeState, {
    subscription: liveStripeSub(),
    priceFound: null,
    productExists: true,
    itemCreateError: null,
    creditCreateError: null,
    itemDeleteError: null,
    upcoming: null,
    upcomingError: null,
    invoice: null,
    creditItem: null,
    retrieveQueue: [],
    pendingInvoiceItems: [],
    creditRetrieveError: null,
  });
});

/* ── auth ─────────────────────────────────────────────────────────────── */

describe('auth', () => {
  it('refuses a call with no token', async () => {
    const res = await call({ action: 'subscribe', integrationKey: 'square' }, null);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('is northwind only: another tenant is refused before Stripe or the claim', async () => {
    state.appUser = { ...state.appUser, tenant_id: GONIKO_ID };
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_available');
    expect(calls).toHaveLength(0);
    expect(intInserts()).toHaveLength(0);
  });

  it('takes the tenant from the caller’s account, never the body', async () => {
    state.appUser = { ...state.appUser, tenant_id: GONIKO_ID };
    const res = await call({ action: 'subscribe', integrationKey: 'square', tenantId: NORTHWIND_ID });
    expect(res.status).toBe(403);
  });

  it('lets a viewer read the next invoice but not subscribe', async () => {
    state.appUser = { ...state.appUser, role: 'viewer' };
    const sub = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(sub.status).toBe(403);
    stripeState.upcoming = { total: 20000, amount_due: 20000, currency: 'usd', lines: { data: [] } };
    const up = await call({ action: 'upcoming' });
    expect(up.status).toBe(200);
  });

  it('needs editor on settings AND settings.subscription for a manager', async () => {
    state.appUser = { ...state.appUser, role: 'manager' };
    state.grants = [{ tab_key: 'settings', access_level: 'editor' }, { tab_key: 'settings.subscription', access_level: 'viewer' }];
    expect((await call({ action: 'subscribe', integrationKey: 'square' })).status).toBe(403);
    state.grants = [{ tab_key: 'settings', access_level: 'editor' }, { tab_key: 'settings.subscription', access_level: 'editor' }];
    expect((await call({ action: 'subscribe', integrationKey: 'square' })).status).toBe(200);
  });

  it('acts for the portal in Origin when a super admin calls', async () => {
    state.appUser = { id: ADMIN_ID, tenant_id: null, role: 'head_admin', is_super_admin: true, is_active: true };
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(state.intRows[0].tenant_id).toBe(NORTHWIND_ID);
  });

  it('keeps cancel to super admins', async () => {
    const res = await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

/* ── subscribe: preconditions, all before Stripe and before the claim ─── */

describe('subscribe — refused up front', () => {
  const refused = async (body: Record<string, unknown>, status: number, code?: string) => {
    const res = await call({ action: 'subscribe', integrationKey: 'square', ...body });
    expect(res.status).toBe(status);
    if (code) expect(res.body.code).toBe(code);
    expect(calls).toHaveLength(0);
    expect(intInserts()).toHaveLength(0);
    return res;
  };

  it('an unknown integration', async () => {
    await refused({ integrationKey: 'nope' }, 400);
  });

  it('a "coming soon" preview (Inshur, Turo Sync, CheckMyDriver): priced, but never sold', async () => {
    state.catalog = [{ ...squarePremium(), integration_key: 'inshur' }];
    await refused({ integrationKey: 'inshur' }, 409, 'coming_soon');
    state.catalog = [{ ...squarePremium(), integration_key: 'turo_sync' }];
    await refused({ integrationKey: 'turo_sync' }, 409, 'coming_soon');
  });

  it('before the SQL is applied: not set up, nothing charged', async () => {
    state.catalogError = { code: 'PGRST205', message: "Could not find the table 'public.integration_catalog_v2'" };
    const res = await refused({}, 503, 'not_set_up');
    expect(String(res.body.error)).toMatch(/Nothing was charged/);
  });

  it('premium with no price yet: not on sale', async () => {
    state.catalog = [squarePremium({ monthly_price_cents: null })];
    await refused({}, 409, 'no_price');
  });

  it('a free integration', async () => {
    state.catalog = [squarePremium({ is_premium: false, monthly_price_cents: null })];
    await refused({}, 409, 'not_premium');
  });

  it('a hidden or not-available integration', async () => {
    state.catalog = [squarePremium({ is_unavailable: true })];
    await refused({}, 409, 'unavailable');
    state.catalog = [squarePremium({ is_hidden: true })];
    await refused({}, 409, 'unavailable');
  });

  it('no platform plan to add it to', async () => {
    state.plans = [];
    await refused({}, 409, 'no_plan');
  });

  it('a past-due plan', async () => {
    state.plans = [northwindPlan({ status: 'past_due' })];
    await refused({}, 409, 'past_due');
  });

  it('a plan set to end', async () => {
    state.plans = [northwindPlan({ cancel_at: '2026-10-15T00:00:00.000Z' })];
    await refused({}, 409, 'plan_ending');
  });

  it('a plan in another currency, or not monthly', async () => {
    state.plans = [northwindPlan({ currency: 'gbp' })];
    await refused({}, 409, 'currency');
    state.plans = [northwindPlan({ interval: 'year' })];
    await refused({}, 409, 'interval');
  });

  it('already subscribed', async () => {
    state.intRows = [{ id: 'old', tenant_id: NORTHWIND_ID, integration_key: 'square', status: 'active' }];
    await refused({}, 409, 'already_subscribed');
  });

  it('no Stripe key for this account and mode: "not set up", and no claim row left behind', async () => {
    const realStripeFor = deps.stripeFor;
    deps.stripeFor = () => {
      throw new Error('No UAE Stripe secret key for mode: live');
    };
    try {
      const res = await call({ action: 'subscribe', integrationKey: 'square' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('not_set_up');
      expect(intInserts()).toHaveLength(0);
    } finally {
      deps.stripeFor = realStripeFor;
    }
  });

  it('a double click: the claim hits the unique index and Stripe is never called', async () => {
    state.claimError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_subscribed');
    expect(calls).toHaveLength(0);
  });
});

/* ── subscribe: what goes on the bill ─────────────────────────────────── */

describe('subscribe — the bill', () => {
  it('adds the item with no proration, on the tenant’s own account, priced by lookup key', async () => {
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);

    // The claim row, before Stripe: the price and account as subscribed.
    expect(intInserts()[0].payload).toMatchObject({
      tenant_id: NORTHWIND_ID,
      integration_key: 'square',
      status: 'pending',
      monthly_price_cents: 2000,
      currency: 'usd',
      first_month_free: false,
      stripe_account: 'uae',
      stripe_mode: 'live',
      stripe_subscription_id: 'sub_platform',
    });
    expect(stripeAccounts).toEqual([['uae', 'live']]);

    expect(findCall('prices.list')!.args[0]).toMatchObject({ lookup_keys: ['d247_integration_square_usd_2000_month'], active: true });
    expect(findCall('prices.create')!.args[0]).toMatchObject({
      product: 'd247_integration_square',
      currency: 'usd',
      unit_amount: 2000,
      recurring: { interval: 'month' },
      lookup_key: 'd247_integration_square_usd_2000_month',
    });

    const create = findCall('subscriptionItems.create')!;
    expect(create.args[0]).toMatchObject({
      subscription: 'sub_platform',
      price: 'price_new',
      quantity: 1,
      proration_behavior: 'none',
    });
    expect(create.args[1]).toEqual({ idempotencyKey: `d247-int-item-${ROW_ID}` });
    // No free month configured: no credit.
    expect(findCall('invoiceItems.create')).toBeUndefined();

    expect(state.intRows[0]).toMatchObject({
      status: 'active',
      stripe_subscription_item_id: 'si_new',
      stripe_price_id: 'price_new',
      first_bill_at: PERIOD_END_ISO,
    });
    expect(res.body.subscription).toMatchObject({ status: 'active', monthlyPriceCents: 2000, firstMonthFree: false, firstBillAt: PERIOD_END_ISO });
  });

  it('names the product "<Name> subscription" when it has to create it', async () => {
    stripeState.productExists = false;
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(findCall('products.create')!.args[0]).toMatchObject({ id: 'd247_integration_square', name: 'Square subscription' });
  });

  it('reuses an existing price rather than minting another', async () => {
    stripeState.priceFound = { id: 'price_existing' };
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(findCall('prices.create')).toBeUndefined();
    expect(findCall('products.retrieve')).toBeUndefined();
    expect(findCall('subscriptionItems.create')!.args[0].price).toBe('price_existing');
  });

  it('first month free: one credit for the full price on the next bill', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);
    const credit = findCall('invoiceItems.create')!;
    expect(credit.args[0]).toMatchObject({
      customer: 'cus_northwind',
      subscription: 'sub_platform',
      currency: 'usd',
      amount: -2000,
      description: 'Square subscription: first month free',
      metadata: { d247_integration_key: 'square', d247_kind: 'first_month_free' },
    });
    expect(credit.args[1]).toEqual({ idempotencyKey: `d247-int-free-${ROW_ID}` });
    expect(state.intRows[0]).toMatchObject({ first_month_free: true, stripe_credit_invoice_item_id: 'ii_credit' });
    expect(res.body.subscription).toMatchObject({ firstMonthFree: true });
  });

  it('first month free is for the first time only', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    // On a bill on Aug 15, canceled Sep 1: the free month was used.
    state.intRows = [
      { id: 'old', tenant_id: NORTHWIND_ID, integration_key: 'square', status: 'canceled', first_bill_at: '2026-08-15T00:00:00.000Z', canceled_at: '2026-09-01T00:00:00.000Z' },
    ];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(findCall('invoiceItems.create')).toBeUndefined();
    expect(intInserts()[0].payload.first_month_free).toBe(false);
  });

  it('a failed earlier attempt billed nothing, so the free month still applies', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    state.intRows = [{ id: 'old', tenant_id: NORTHWIND_ID, integration_key: 'square', status: 'failed' }];
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(findCall('invoiceItems.create')!.args[0].amount).toBe(-2000);
  });

  it('while the plan is trialing, the first bill is the trial’s end', async () => {
    state.plans = [northwindPlan({ status: 'trialing', trial_end: TRIAL_END_ISO })];
    stripeState.subscription = liveStripeSub({ status: 'trialing', trial_end: TRIAL_END_UNIX });
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.body.subscription).toMatchObject({ firstBillAt: TRIAL_END_ISO });
  });

  it('adopts an item already on the subscription instead of adding a second', async () => {
    stripeState.subscription = liveStripeSub({
      items: {
        data: [
          { id: 'si_plan', price: { id: 'price_plan', product: 'prod_platform' } },
          { id: 'si_square', price: { id: 'price_square', product: 'd247_integration_square' } },
        ],
      },
    });
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(findCall('subscriptionItems.create')).toBeUndefined();
    expect(state.intRows[0]).toMatchObject({ status: 'active', stripe_subscription_item_id: 'si_square' });
    expect(res.body.subscription).toMatchObject({ adopted: true });
  });

  it('Stripe says the plan is ending: refused, the row failed, nothing added', async () => {
    stripeState.subscription = liveStripeSub({ cancel_at_period_end: true });
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(409);
    expect(findCall('subscriptionItems.create')).toBeUndefined();
    expect(state.intRows[0].status).toBe('failed');
  });

  it('the item is refused: the row failed, nothing to undo', async () => {
    stripeState.itemCreateError = new Error('Your card was declined');
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    expect(String(res.body.error)).toMatch(/Nothing was charged/);
    expect(findCall('subscriptionItems.del')).toBeUndefined();
    expect(state.intRows[0].status).toBe('failed');
  });

  it('the free-month credit is refused: the item is taken off again, with no proration', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    stripeState.creditCreateError = new Error('Stripe is down');
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    const del = findCall('subscriptionItems.del')!;
    expect(del.args).toEqual(['si_new', { proration_behavior: 'none' }]);
    expect(state.intRows[0].status).toBe('failed');
  });

  it('the undo itself fails: the row stays pending, so no second copy can be added', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    stripeState.creditCreateError = new Error('Stripe is down');
    stripeState.itemDeleteError = new Error('Stripe is still down');
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    expect(state.intRows[0].status).toBe('pending');
    expect(String(state.intRows[0].error)).toMatch(/rollback failed/);
    expect(state.intRows[0].stripe_subscription_item_id).toBe('si_new');
  });
});

describe('subscribe — failure paths', () => {
  it('records the item id the moment it exists, while the row is still pending', async () => {
    const snapshots: any[] = [];
    state.onUpdate = () => snapshots.push({ ...state.intRows[0] });
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(snapshots[0]).toMatchObject({ status: 'pending', stripe_subscription_item_id: 'si_new', stripe_price_id: 'price_new' });
    expect(state.intRows[0].status).toBe('active');
  });

  it('a create whose response was lost is found by the claim id and taken off again', async () => {
    stripeState.itemCreateError = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    // First retrieve: the live check. Second: the undo's look-up, which shows
    // the item Stripe did create before the response was lost.
    stripeState.retrieveQueue = [
      liveStripeSub(),
      liveStripeSub({
        items: {
          data: [
            { id: 'si_plan', price: { id: 'price_plan', product: 'prod_platform' } },
            { id: 'si_ghost', price: { id: 'price_new', product: 'd247_integration_square' }, metadata: { d247_claim_id: ROW_ID } },
          ],
        },
      }),
    ];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    expect(findCall('subscriptionItems.del')!.args).toEqual(['si_ghost', { proration_behavior: 'none' }]);
    expect(state.intRows[0].status).toBe('failed');
  });

  it('when the look-up itself fails, the row stays pending instead of claiming nothing was charged', async () => {
    stripeState.itemCreateError = new Error('socket hang up');
    stripeState.retrieveQueue = [liveStripeSub(), new Error('Stripe unreachable')];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    expect(String(res.body.error)).not.toMatch(/Nothing was charged/);
    expect(state.intRows[0].status).toBe('pending');
  });

  it('a free-month credit whose response was lost is found and deleted', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    stripeState.creditCreateError = new Error('socket hang up');
    stripeState.pendingInvoiceItems = [{ id: 'ii_ghost', metadata: { d247_claim_id: ROW_ID } }];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(502);
    expect(findCall('invoiceItems.list')!.args[0]).toMatchObject({ customer: 'cus_northwind', pending: true });
    expect(findCall('invoiceItems.del')!.args).toEqual(['ii_ghost']);
    expect(findCall('subscriptionItems.del')!.args[0]).toBe('si_new');
  });

  it('a claim a super admin canceled mid-subscribe is never revived, and its item comes off', async () => {
    state.onUpdate = () => {
      // Right after the item id is recorded, a super admin cancels the claim.
      if (state.intRows[0].status === 'pending' && state.intRows[0].stripe_subscription_item_id) {
        state.intRows[0].status = 'canceled';
        state.onUpdate = null;
      }
    };
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('canceled');
    expect(state.intRows[0].status).toBe('canceled');
    expect(findCall('subscriptionItems.del')!.args).toEqual(['si_new', { proration_behavior: 'none' }]);
  });

  it('closes a row whose platform subscription ended, and subscribes on the current one', async () => {
    state.intRows = [
      { id: 'old', tenant_id: NORTHWIND_ID, integration_key: 'square', status: 'active', stripe_subscription_id: 'sub_old_uk', first_bill_at: '2026-08-15T00:00:00.000Z' },
    ];
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(state.intRows.find((r) => r.id === 'old')).toMatchObject({ status: 'canceled', error: 'its platform subscription ended' });
    expect(findCall('subscriptionItems.create')!.args[0].subscription).toBe('sub_platform');
  });

  it('keeps the free month for a subscription canceled before its first bill', async () => {
    state.catalog = [squarePremium({ first_month_free: true })];
    state.intRows = [
      { id: 'old', tenant_id: NORTHWIND_ID, integration_key: 'square', status: 'canceled', first_bill_at: '2026-10-15T00:00:00.000Z', canceled_at: '2026-09-20T00:00:00.000Z' },
    ];
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(findCall('invoiceItems.create')!.args[0].amount).toBe(-2000);
  });

  it('records the adopted item’s own price, not the catalog’s', async () => {
    stripeState.subscription = liveStripeSub({
      items: { data: [{ id: 'si_square', price: { id: 'price_old', product: 'd247_integration_square', unit_amount: 1500 } }] },
    });
    const res = await call({ action: 'subscribe', integrationKey: 'square' });
    expect(res.body.subscription).toMatchObject({ adopted: true, monthlyPriceCents: 1500 });
    expect(state.intRows[0].monthly_price_cents).toBe(1500);
  });

  it('lets a replacement price take over a lookup key an archived price still holds', async () => {
    await call({ action: 'subscribe', integrationKey: 'square' });
    expect(findCall('prices.create')!.args[0].transfer_lookup_key).toBe(true);
  });
});

/* ── upcoming ─────────────────────────────────────────────────────────── */

const PLATFORM_LINE = { type: 'subscription', amount: 20000, price: { product: 'prod_platform', recurring: { usage_type: 'licensed' } } };
const SQUARE_LINE = { type: 'subscription', amount: 2000, price: { product: 'd247_integration_square', recurring: { usage_type: 'licensed' } } };
const SQUARE_CREDIT = { type: 'invoiceitem', amount: -2000, price: { product: 'prod_adhoc' }, metadata: { d247_integration_key: 'square', d247_kind: 'first_month_free' } };
const METERED_ZERO = { type: 'subscription', amount: 0, price: { product: 'prod_platform', recurring: { usage_type: 'metered' } } };

describe('upcoming', () => {
  it('no plan: no invoice, and no Stripe call', async () => {
    state.plans = [];
    const res = await call({ action: 'upcoming' });
    expect(res.body).toMatchObject({ ok: true, upcoming: null, reason: 'no_plan' });
    expect(calls).toHaveLength(0);
  });

  it('one row per line — platform, integration, its free-month credit — and the $0 meter dropped', async () => {
    stripeState.upcoming = {
      currency: 'usd',
      total: 20000,
      amount_due: 20000,
      lines: { data: [PLATFORM_LINE, METERED_ZERO, SQUARE_LINE, SQUARE_CREDIT], has_more: false },
    };
    const res = await call({ action: 'upcoming' });
    expect(findCall('invoices.retrieveUpcoming')!.args[0]).toEqual({ subscription: 'sub_platform' });
    expect(res.body.upcoming).toEqual({
      currency: 'usd',
      lines: [
        { kind: 'platform', label: 'Platform subscription', amount: 20000 },
        { kind: 'integration', label: 'Square subscription', amount: 2000, integrationKey: 'square' },
        { kind: 'integration_credit', label: 'Square subscription: first month free', amount: -2000, integrationKey: 'square' },
      ],
      total: 20000,
      amountDue: 20000,
      balanced: true,
      date: PERIOD_END_ISO,
    });
  });

  it('the month after: $200 + $20 = $220, as two lines', async () => {
    stripeState.upcoming = { currency: 'usd', total: 22000, amount_due: 22000, lines: { data: [PLATFORM_LINE, SQUARE_LINE] } };
    const res = await call({ action: 'upcoming' });
    const up = res.body.upcoming as any;
    expect(up.lines.map((l: any) => [l.label, l.amount])).toEqual([
      ['Platform subscription', 20000],
      ['Square subscription', 2000],
    ]);
    expect(up.total).toBe(22000);
    expect(up.balanced).toBe(true);
  });

  it('a cancel date after the period end still leaves this bill to come', async () => {
    state.plans = [northwindPlan({ cancel_at: '2026-11-15T00:00:00.000Z' })];
    stripeState.upcoming = { currency: 'usd', total: 20000, amount_due: 20000, lines: { data: [PLATFORM_LINE] } };
    const res = await call({ action: 'upcoming' });
    expect(res.body.upcoming).not.toBeNull();
    state.plans = [northwindPlan({ cancel_at: PERIOD_END_ISO })];
    expect((await call({ action: 'upcoming' })).body).toMatchObject({ upcoming: null, reason: 'plan_ending' });
  });

  it('nothing to bill next (either shape of the error)', async () => {
    stripeState.upcomingError = Object.assign(new Error('No upcoming invoices'), { raw: { code: 'invoice_upcoming_none' } });
    expect((await call({ action: 'upcoming' })).body).toMatchObject({ upcoming: null, reason: 'none' });
  });

  it('nothing to bill next', async () => {
    stripeState.upcomingError = Object.assign(new Error('No upcoming invoices'), { code: 'invoice_upcoming_none' });
    const res = await call({ action: 'upcoming' });
    expect(res.body).toMatchObject({ ok: true, upcoming: null, reason: 'none' });
  });
});

/* ── invoice_lines ────────────────────────────────────────────────────── */

describe('invoice_lines', () => {
  it('an invoice that is not in this tenant’s records never reaches Stripe', async () => {
    const res = await call({ action: 'invoice_lines', stripeInvoiceId: 'in_ABCDEF123' });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('refuses an invoice whose Stripe customer is not this tenant’s', async () => {
    state.invoices = [{ tenant_id: NORTHWIND_ID, stripe_invoice_id: 'in_ABCDEF123', subscription_id: 'plan-row' }];
    stripeState.invoice = { customer: 'cus_someone_else', total: 100, lines: { data: [] } };
    const res = await call({ action: 'invoice_lines', stripeInvoiceId: 'in_ABCDEF123' });
    expect(res.status).toBe(404);
  });

  it('answers the invoice line by line', async () => {
    state.invoices = [{ tenant_id: NORTHWIND_ID, stripe_invoice_id: 'in_ABCDEF123', subscription_id: 'plan-row' }];
    stripeState.invoice = { customer: 'cus_northwind', currency: 'usd', total: 22000, amount_due: 22000, lines: { data: [PLATFORM_LINE, SQUARE_LINE] } };
    const res = await call({ action: 'invoice_lines', stripeInvoiceId: 'in_ABCDEF123' });
    expect(res.status).toBe(200);
    expect((res.body.invoice as any).lines.map((l: any) => l.label)).toEqual(['Platform subscription', 'Square subscription']);
    expect(stripeAccounts[0]).toEqual(['uae', 'live']);
  });
});

/* ── cancel ───────────────────────────────────────────────────────────── */

describe('cancel (super admin)', () => {
  beforeEach(() => {
    state.appUser = { id: ADMIN_ID, tenant_id: null, role: 'head_admin', is_super_admin: true, is_active: true };
    state.intRows = [
      {
        id: ROW_ID,
        tenant_id: NORTHWIND_ID,
        integration_key: 'square',
        status: 'active',
        stripe_account: 'uae',
        stripe_mode: 'live',
        stripe_subscription_id: 'sub_platform',
        stripe_subscription_item_id: 'si_square',
        stripe_credit_invoice_item_id: 'ii_credit',
      },
    ];
  });

  it('removes the item with no proration and the still-pending credit', async () => {
    stripeState.creditItem = { id: 'ii_credit', invoice: null };
    const res = await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' }, 'tok-staff', 'https://admin.drive-247.com');
    expect(res.status).toBe(200);
    expect(findCall('subscriptionItems.del')!.args).toEqual(['si_square', { proration_behavior: 'none' }]);
    expect(findCall('invoiceItems.del')!.args).toEqual(['ii_credit']);
    expect(state.intRows[0]).toMatchObject({ status: 'canceled', canceled_by: ADMIN_ID });
  });

  it('leaves a credit that is already on an invoice alone', async () => {
    stripeState.creditItem = { id: 'ii_credit', invoice: 'in_paid' };
    await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(findCall('invoiceItems.del')).toBeUndefined();
  });

  it('an ended platform subscription took the item with it: nothing to delete, the row is closed', async () => {
    stripeState.subscription = liveStripeSub({ status: 'canceled' });
    const res = await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(findCall('subscriptionItems.del')).toBeUndefined();
    expect(state.intRows[0].status).toBe('canceled');
  });

  it('finds the item on the subscription when the row never recorded it', async () => {
    state.intRows[0].stripe_subscription_item_id = null;
    stripeState.subscription = liveStripeSub({
      items: { data: [{ id: 'si_plan', price: { product: 'prod_platform' } }, { id: 'si_found', price: { product: 'd247_integration_square' } }] },
    });
    await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(findCall('subscriptionItems.del')!.args).toEqual(['si_found', { proration_behavior: 'none' }]);
  });

  it('the item is off but the credit could not be removed: the row is closed and says so', async () => {
    stripeState.creditRetrieveError = new Error('Stripe is down');
    const res = await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/could not be removed/);
    expect(state.intRows[0]).toMatchObject({ status: 'canceled' });
    expect(String(state.intRows[0].error)).toMatch(/ii_credit/);
  });

  it('nothing to cancel', async () => {
    state.intRows = [];
    const res = await call({ action: 'cancel', tenantId: NORTHWIND_ID, integrationKey: 'square' });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

/* ── lines, on their own ──────────────────────────────────────────────── */

describe('summarizeInvoice', () => {
  it('shows a discount and tax as their own rows so the column adds up', () => {
    const summary = summarizeInvoice({
      currency: 'usd',
      total: 21100, // 20000 + 2000 − 1000 + 100
      amount_due: 21100,
      total_discount_amounts: [{ amount: 1000 }],
      tax: 100,
      lines: { data: [PLATFORM_LINE, SQUARE_LINE] },
    });
    expect(summary.lines.map((l) => [l.kind, l.amount])).toEqual([
      ['platform', 20000],
      ['integration', 2000],
      ['discount', -1000],
      ['tax', 100],
    ]);
    expect(summary.balanced).toBe(true);
  });

  it('flags a bill whose rows do not add up to Stripe’s total', () => {
    const summary = summarizeInvoice({ currency: 'usd', total: 25000, amount_due: 25000, lines: { data: [PLATFORM_LINE] } });
    expect(summary.balanced).toBe(false);
    expect(summary.total).toBe(25000);
  });

  it('keeps metered usage that actually costs something', () => {
    expect(labelInvoiceLine({ type: 'subscription', amount: 700, price: { recurring: { usage_type: 'metered' } } })).toEqual({
      kind: 'usage',
      label: 'E-sign usage',
      amount: 700,
    });
  });

  it('labels anything else by Stripe’s own description', () => {
    expect(labelInvoiceLine({ type: 'invoiceitem', amount: 500, description: 'Setup fee' })).toEqual({ kind: 'other', label: 'Setup fee', amount: 500 });
  });
});

describe('catalog ids', () => {
  it('one product per integration; the price key carries the amount', () => {
    expect(productIdFor('square')).toBe('d247_integration_square');
    expect(lookupKeyFor('square', 'USD', 2020)).toBe('d247_integration_square_usd_2020_month');
  });
});
