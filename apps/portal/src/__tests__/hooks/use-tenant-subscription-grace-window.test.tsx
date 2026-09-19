/**
 * THE 14-DAY GRACE LEG — the coverage gap the Sep 18 subscription simulation left open.
 *
 * The simulation only ever ran the DEFAULT window: `admin_settings.subscription_grace_days`
 * unset, so seven days, and the soft->hard flip observed at D7. Nothing covered what happens
 * when a super admin sets 14 (or 3, or 30) from the admin dashboard, which is the whole point
 * of having made the number configurable — and the number decides the day a paying business
 * loses access to its own bookings.
 *
 * This is the REAL `useTenantSubscription`, with the real `useSubscriptionGraceDays` inside it,
 * driven by mocked PostgREST rows and a frozen clock. Nothing is re-implemented here: the only
 * things stubbed are the edges (the Supabase client, the tenant, the session) and the
 * development-only `useBillingScenarioOverride`, which returns its argument untouched in a
 * production bundle anyway.
 *
 * What is pinned:
 *   - with the column at 14, D7 is still INSIDE the window (under the old hardcoded
 *     `GRACE_DAYS = 7` this tenant was hard-blocked on that day) and the flip lands on D14;
 *   - the boundary is `>=`, so the instant `graceEndsAt` is reached the tenant is expired;
 *   - 3 / 7 / 14 / 30 each move the boundary to their own day, so the suite cannot pass by
 *     the window simply being open;
 *   - a NULL, a string, or an out-of-range number falls back to 7 rather than to 0 — a config
 *     read that fails must never be the thing that locks somebody out;
 *   - `graceSeverity` escalates to `critical` inside the last three days of the CONFIGURED
 *     window, not of a fixed seven;
 *   - the anchor is the open invoice's `period_end`, NOT the subscription's
 *     `current_period_end`, which Stripe rolls forward even while the charge is failing;
 *   - and the end-to-end consequence: the hook's real output, fed through the real gate
 *     expressions lifted out of `(dashboard)/layout.tsx`, leaves the tenant un-gated on D7
 *     and hard-gated on D14.
 *
 * Soundness: every boundary is asserted on BOTH sides of the same instant, and the grace-days
 * setting is the only thing that moves between the 3/7/14/30 cases. Re-hardcoding the window
 * back to 7 in `use-tenant-subscription.ts` turns this suite red (verified by mutation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  codeOnly,
  compileExpression,
  liftDeclaration,
  readPortalSource,
} from '../helpers/edge-source';

/* ── fixtures + the fake PostgREST, hoisted ────────────────────────────────────
 *
 * All of this lives inside `vi.hoisted` because the `vi.mock` factories below
 * are evaluated when `@/hooks/use-tenant-subscription` is first imported, which
 * (ESM hoists imports) happens before any module-scope `const` in this file has
 * been initialised. `H.state` is the mutable half each test writes.
 */
const H = vi.hoisted(() => {
  const TENANT_ID = 'tenant-grace-window';
  const SUB_ROW_ID = 'sub-row-grace-window';
  /* A fake Stripe-shaped URL. It is a fixture string, not a credential. */
  const INVOICE_URL = 'https://invoice.stripe.com/i/acct_fixture/test_grace_window';

  const SUBSCRIPTION_ROW = {
    id: SUB_ROW_ID,
    tenant_id: TENANT_ID,
    stripe_subscription_id: 'sub_fixture_grace',
    stripe_customer_id: 'cus_fixture_grace',
    status: 'past_due',
    plan_name: 'Pro',
    amount: 9900,
    currency: 'usd',
    interval: 'month',
    current_period_start: '2026-09-01T00:00:00.000Z',
    /* DELIBERATELY far in the future. Stripe rolls `current_period_end` forward
       to the next cycle even while the charge keeps failing, which is exactly
       why the hook anchors on the unpaid invoice instead. If anything ever
       starts reading this field, every boundary below moves and this suite says
       so. */
    current_period_end: '2026-10-01T00:00:00.000Z',
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    card_brand: 'visa',
    card_last4: '0341',
    card_exp_month: 12,
    card_exp_year: 2030,
    trial_end: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  };

  const OPEN_INVOICE_ROW = {
    id: 'inv-row-grace-window',
    tenant_id: TENANT_ID,
    subscription_id: SUB_ROW_ID,
    stripe_invoice_id: 'in_fixture_grace',
    stripe_invoice_pdf: null,
    stripe_hosted_invoice_url: INVOICE_URL,
    stripe_receipt_url: null,
    stripe_charge_id: null,
    stripe_payment_intent_id: null,
    status: 'open',
    amount_due: 9900,
    amount_paid: 0,
    currency: 'usd',
    period_start: '2026-08-01T00:00:00.000Z',
    /* THE ANCHOR: the instant the grace clock starts. */
    period_end: '2026-09-01T00:00:00.000Z',
    due_date: '2026-09-01T00:00:00.000Z',
    paid_at: null,
    invoice_number: 'FIXTURE-0001',
    base_amount: 9900,
    usage_amount: null,
    usage_quantity: null,
    attempt_count: 2,
    invoice_date: '2026-09-01T00:00:00.000Z',
    amount_refunded: null,
    refunded_at: null,
    dispute_status: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z',
  };

  const state = {
    /** Whatever `admin_settings.subscription_grace_days` holds for this case. */
    graceDaysColumn: 7 as unknown,
    /** The invoice rows the tenant has. */
    invoiceRows: [OPEN_INVOICE_ROW] as Array<Record<string, unknown>>,
    /** The live subscription row, or null. */
    subscriptionRow: SUBSCRIPTION_ROW as Record<string, unknown> | null,
    /** Force the `admin_settings` read to blow up. */
    adminSettingsError: null as { message: string } | null,
  };

  type PgResult = { data: unknown; error: unknown };

  const resultFor = (table: string, columns: string): PgResult => {
    if (table === 'admin_settings') {
      return state.adminSettingsError
        ? { data: null, error: state.adminSettingsError }
        : { data: { subscription_grace_days: state.graceDaysColumn }, error: null };
    }
    if (table === 'tenant_subscription_invoices') {
      return { data: state.invoiceRows, error: null };
    }
    if (table === 'tenant_subscriptions') {
      /* Two queries hit this table. The live one selects `*`; the
         expired/canceled lookup selects a named column list. Only the live one
         has a row here — a `past_due` subscription is not a PAST one. */
      return columns.trim() === '*'
        ? { data: state.subscriptionRow, error: null }
        : { data: null, error: null };
    }
    throw new Error(`unstubbed table read: ${table}`);
  };

  /* Every builder method returns the same object. The object is BOTH thenable
     (the invoices query awaits the builder directly, with no terminator) and
     carries `maybeSingle()`, because the hooks chain it both ways. */
  const builder = (table: string) => {
    let columns = '*';
    const resolve = () => resultFor(table, columns);
    const api: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'order', 'limit', 'neq', 'is', 'not', 'gte', 'lte', 'or']) {
      api[m] = () => api;
    }
    api.select = (cols?: string) => {
      if (typeof cols === 'string') columns = cols;
      return api;
    };
    api.maybeSingle = () => Promise.resolve(resolve());
    api.single = () => Promise.resolve(resolve());
    api.then = (onOk: (v: PgResult) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onOk, onErr);
    return api;
  };

  const client = {
    from: (table: string) => builder(table),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };

  return {
    TENANT_ID,
    SUB_ROW_ID,
    INVOICE_URL,
    SUBSCRIPTION_ROW,
    OPEN_INVOICE_ROW,
    state,
    client,
  };
});

/* `useTenantSubscription` imports `supabase`; `useSubscriptionGraceDays` imports
   `supabaseUntyped`. Both are this one recorder. */
vi.mock('@/integrations/supabase/client', () => ({
  supabase: H.client,
  supabaseUntyped: H.client,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: H.TENANT_ID, slug: 'zz-grace-window', setup_completed_at: null },
    loading: false,
  }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({
    session: { access_token: 'fixture' },
    user: { id: 'user-grace-window' },
  }),
}));

/* Development-only, and it returns its argument unchanged in a production
   bundle (three gates — see the header of use-billing-scenario.ts). Stubbed so
   this suite never depends on V2Provider / dev-override wiring. */
vi.mock('@/hooks/use-billing-scenario', () => ({
  useBillingScenarioOverride: (real: unknown) => real,
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useTenantSubscription } from '@/hooks/use-tenant-subscription';
import { DEFAULT_GRACE_DAYS, GRACE_DAYS_OPTIONS } from '@/hooks/use-subscription-grace-days';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ANCHOR = Date.parse('2026-09-01T00:00:00.000Z');
/** Whole days after the anchor, nudged by `offsetMs`. */
const day = (n: number, offsetMs = 0) => ANCHOR + n * DAY + offsetMs;

type Billing = ReturnType<typeof useTenantSubscription>;

/**
 * Renders the real hook with `Date` frozen at `nowMs` and
 * `subscription_grace_days` set to `graceDays`, and returns its settled result.
 *
 * Only `Date` is faked. `setTimeout` / `setInterval` stay real, because React
 * Query's resolution and the hook's own 30s dunning tick both need them — and
 * the grace decision is a pure `Date.now()` comparison, so `Date` is the whole
 * experiment.
 */
async function readBilling(graceDays: unknown, nowMs: number): Promise<Billing> {
  H.state.graceDaysColumn = graceDays;
  vi.setSystemTime(nowMs);

  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);

  const { result } = renderHook(() => useTenantSubscription(), { wrapper });
  await waitFor(() => expect(result.current.isResolved).toBe(true));
  /* The grace-days setting is a separate, independently-settling query. Wait for
     the configured number to have actually landed, or a case would be measured
     against DEFAULT_GRACE_DAYS by accident and pass for the wrong reason. */
  const expected =
    !H.state.adminSettingsError &&
    typeof graceDays === 'number' &&
    Number.isFinite(graceDays) &&
    graceDays >= 0 &&
    graceDays <= 90
      ? Math.floor(graceDays)
      : DEFAULT_GRACE_DAYS;
  if (H.state.invoiceRows.some((i) => i.status === 'open' || i.status === 'uncollectible')) {
    await waitFor(() => expect(result.current.graceEndsAt).toBe(ANCHOR + expected * DAY));
  }
  return result.current;
}

beforeEach(() => {
  H.state.graceDaysColumn = 7;
  H.state.invoiceRows = [H.OPEN_INVOICE_ROW];
  H.state.subscriptionRow = H.SUBSCRIPTION_ROW;
  H.state.adminSettingsError = null;
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/* ── the 14-day leg ────────────────────────────────────────────────────────── */

describe('subscription_grace_days = 14 moves the soft->hard flip to D14', () => {
  it('D7 is still INSIDE the window — the day the old hardcoded 7 blocked them', async () => {
    const b = await readBilling(14, day(7, HOUR));

    expect(b.isPastDue).toBe(true);
    expect(b.isInGracePeriod).toBe(true);
    expect(b.isGraceExpired).toBe(false);
    // Inside the window a tenant keeps FULL access: still a customer with a
    // payment problem, not a stranger who must finish setup.
    expect(b.isSubscribed).toBe(true);
    expect(b.hasExpiredSubscription).toBe(false);
    expect(b.graceDaysRemaining).toBe(7);
    expect(b.graceEndsAt).toBe(day(14));
  });

  it('D13 is the last full day, and still a warning', async () => {
    const b = await readBilling(14, day(13, HOUR));
    expect(b.isInGracePeriod).toBe(true);
    expect(b.isGraceExpired).toBe(false);
    expect(b.graceDaysRemaining).toBe(1);
  });

  it('one hour before D14 the tenant is still in grace', async () => {
    const b = await readBilling(14, day(14, -HOUR));
    expect(b.isInGracePeriod).toBe(true);
    expect(b.isGraceExpired).toBe(false);
    expect(b.isSubscribed).toBe(true);
    expect(b.hasExpiredSubscription).toBe(false);
  });

  it('AT D14 exactly the window is closed — the boundary is >=, not >', async () => {
    const b = await readBilling(14, day(14));
    expect(b.isInGracePeriod).toBe(false);
    expect(b.isGraceExpired).toBe(true);
    expect(b.isSubscribed).toBe(false);
    expect(b.hasExpiredSubscription).toBe(true);
    expect(b.graceDaysRemaining).toBe(0);
  });

  it('one minute after D14 the tenant is hard-blocked, and still owes the invoice', async () => {
    const b = await readBilling(14, day(14, 60_000));
    expect(b.isGraceExpired).toBe(true);
    expect(b.hasExpiredSubscription).toBe(true);
    // The pay link survives the flip: the hard gate's only recoverable path.
    expect(b.owesOutstandingInvoice).toBe(true);
    expect(b.outstandingInvoiceUrl).toBe(H.INVOICE_URL);
  });
});

describe('every option the admin dashboard offers moves the boundary to its own day', () => {
  /* If the window were "always open" or "always 7", one of these fails. */
  it.each([...GRACE_DAYS_OPTIONS])(
    '%i days: in grace the hour before, expired at it',
    async (n) => {
      const inside = await readBilling(n, day(n, -HOUR));
      expect(inside.isInGracePeriod).toBe(true);
      expect(inside.isGraceExpired).toBe(false);
      expect(inside.graceEndsAt).toBe(day(n));

      const after = await readBilling(n, day(n, HOUR));
      expect(after.isInGracePeriod).toBe(false);
      expect(after.isGraceExpired).toBe(true);
    },
  );

  it('the default really is 7: D7 blocks when the column says 7', async () => {
    const b = await readBilling(7, day(7, HOUR));
    expect(b.isGraceExpired).toBe(true);
    expect(b.hasExpiredSubscription).toBe(true);
  });

  it('3 days blocks on D3, where 14 would still be warning', async () => {
    const short = await readBilling(3, day(3, HOUR));
    expect(short.isGraceExpired).toBe(true);

    const long = await readBilling(14, day(3, HOUR));
    expect(long.isGraceExpired).toBe(false);
    expect(long.isInGracePeriod).toBe(true);
  });
});

describe('a bad read of the setting falls back to 7, never to 0', () => {
  const badValues: Array<[string, unknown]> = [
    ['NULL', null],
    ['missing', undefined],
    ['a string', '14'],
    ['negative', -1],
    ['out of range', 9_999],
    ['not finite', Number.NaN],
  ];

  it.each(badValues)('%s -> DEFAULT_GRACE_DAYS', async (_label, value) => {
    const inside = await readBilling(value, day(DEFAULT_GRACE_DAYS, -HOUR));
    expect(inside.graceEndsAt).toBe(day(DEFAULT_GRACE_DAYS));
    expect(inside.isInGracePeriod).toBe(true);

    const after = await readBilling(value, day(DEFAULT_GRACE_DAYS, HOUR));
    expect(after.isGraceExpired).toBe(true);
  });

  it('an ERRORING admin_settings read leaves the tenant working, on the historical window', async () => {
    H.state.adminSettingsError = { message: 'permission denied for table admin_settings' };
    const b = await readBilling(14, day(DEFAULT_GRACE_DAYS, -HOUR));
    expect(b.graceEndsAt).toBe(day(DEFAULT_GRACE_DAYS));
    expect(b.isInGracePeriod).toBe(true);
    expect(b.isSubscribed).toBe(true);
  });
});

describe('graceSeverity escalates inside the CONFIGURED window, not a fixed seven', () => {
  it('14-day window: D7 is a warning, not critical', async () => {
    const b = await readBilling(14, day(7, HOUR));
    expect(b.graceDaysRemaining).toBe(7);
    expect(b.graceSeverity).toBe('warning');
  });

  it('14-day window: critical only once three days or fewer remain', async () => {
    const four = await readBilling(14, day(10, HOUR));
    expect(four.graceDaysRemaining).toBe(4);
    expect(four.graceSeverity).toBe('warning');

    const three = await readBilling(14, day(11, HOUR));
    expect(three.graceDaysRemaining).toBe(3);
    expect(three.graceSeverity).toBe('critical');
  });

  it('once the window has closed severity is "none" — expiry carries its own escalation', async () => {
    const b = await readBilling(14, day(14, HOUR));
    // So the red state on the sidebar chip and on the phone bar cannot be read
    // off graceSeverity alone; both OR in isGraceExpired.
    expect(b.graceSeverity).toBe('none');
    expect(b.isGraceExpired).toBe(true);
  });
});

describe('the anchor is the unpaid invoice, not the subscription period', () => {
  it('current_period_end a month in the future does not extend the window', async () => {
    // The row's current_period_end is 2026-10-01 — 30 days past the anchor.
    // Anchoring there would put a 14-day deadline in mid-October and the block
    // would never fire.
    const b = await readBilling(14, day(14, HOUR));
    expect(b.subscription?.current_period_end).toBe('2026-10-01T00:00:00.000Z');
    expect(b.graceEndsAt).toBe(day(14));
    expect(b.isGraceExpired).toBe(true);
  });

  it('with the invoice SETTLED there is no anchor, and 14 days changes nothing', async () => {
    H.state.invoiceRows = [
      { ...H.OPEN_INVOICE_ROW, status: 'paid', paid_at: '2026-09-02T00:00:00.000Z' },
    ];
    const b = await readBilling(14, day(60));
    // Nothing overdue, no block — fail-open, whatever the window is set to.
    expect(b.graceEndsAt).toBeNull();
    expect(b.isGraceExpired).toBe(false);
    expect(b.isSubscribed).toBe(true);
    expect(b.hasExpiredSubscription).toBe(false);
  });
});

/* ── end to end: the real hook, through the real gate expressions ──────────── */

const RAW = readPortalSource('app/(dashboard)/layout.tsx');
const SRC = codeOnly(RAW);

const LIFTED = [
  'isSubscriptionPage',
  'hasActivePlans',
  'gateSuppressed',
  'plansResolved',
  'plansNeededForGate',
  'gateStateKnown',
  'expiredGateApplies',
  'setupGateApplies',
  'showExpiredGate',
  'showSetupGate',
  'gateOpen',
  'gateWouldOpen',
  'nothingToBuy',
  'showGate',
  'gateWouldBlock',
] as const;

const PARAMS = [
  'pathname',
  'plans',
  'subscriptionGateDisabled',
  'tenant',
  'plansSuccess',
  'plansErrored',
  'isSubscribed',
  'hasExpiredSubscription',
  'tenantLoading',
  'subscriptionResolved',
  'gateLatched',
] as const;

const evaluateGate = compileExpression<
  (
    ...args: unknown[]
  ) => { showGate: boolean; gateWouldBlock: boolean; showExpiredGate: boolean }
>(
  [...PARAMS],
  LIFTED.map((name) => liftDeclaration(RAW, name, { tsx: true })),
  '({ showGate, gateWouldBlock, showExpiredGate })',
);

/** The layout's gate decision, driven by a REAL hook result. */
const gateFor = (b: Billing, pathname = '/') =>
  evaluateGate(
    pathname,
    [{ id: 'plan-1' }],
    false,
    { id: H.TENANT_ID },
    true,
    false,
    b.isSubscribed,
    b.hasExpiredSubscription,
    false,
    b.isResolved,
    false,
  );

describe('the hard gate itself flips on D14, not D7', () => {
  it('sanity: the lifted expressions are the shipped ones', () => {
    expect(SRC).toContain('const gateWouldBlock =');
    expect(SRC).toContain('const expiredGateApplies =');
  });

  it('D7 with a 14-day window: no gate, nothing suppressed', async () => {
    const b = await readBilling(14, day(7, HOUR));
    const g = gateFor(b);
    expect(g.showExpiredGate).toBe(false);
    expect(g.showGate).toBe(false);
    // Onboarding is allowed to run: this tenant is not blocked.
    expect(g.gateWouldBlock).toBe(false);
  });

  it('D14 with a 14-day window: hard gate on a normal route', async () => {
    const b = await readBilling(14, day(14, HOUR));
    const g = gateFor(b, '/');
    expect(g.showExpiredGate).toBe(true);
    expect(g.showGate).toBe(true);
    expect(g.gateWouldBlock).toBe(true);
  });

  it('D14, on /subscription: no dialog, but the prompts are still suppressed', async () => {
    const b = await readBilling(14, day(14, HOUR));
    const g = gateFor(b, '/subscription');
    // The exempt route keeps the dialog off so the tenant can pay...
    expect(g.showGate).toBe(false);
    // ...and MAJOR 5: the first-run wizard must not take that screen instead.
    expect(g.gateWouldBlock).toBe(true);
  });
});
