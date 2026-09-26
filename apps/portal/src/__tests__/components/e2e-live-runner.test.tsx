/**
 * The /dev LIVE test runner section (docs/PAYMENTS_ROADMAP.md Wave 4, A6).
 *
 * Held here, each against a fake of the backend this page talks to — the
 * `e2e-runner` edge function's actions as supabase/functions/e2e-runner/
 * index.ts answers them (GET → 400 "unknown action", list, preview, start,
 * advance, continue, abort, close) and the `dev_sim_runs` / `dev_sim_run_steps`
 * tables in the shape of supabase/migrations/20260926120300_dev_sim_runs.sql —
 * never a real one (this suite has no network and must never be pointed at one):
 *
 *   1. the catalogue (the real `Scenario` shape) renders in the seven engine
 *      groups, in the asked order, with each scenario's why, its expected
 *      outcome read from its check / tie-out steps, and no Run button for a
 *      scenario that is not a live test or is blocked live;
 *   2. a run is ALWAYS preview first (zero writes), then a confirm beside
 *      "This writes test rows to northwind in Stripe TEST mode"; cancel sends
 *      nothing; a preview that does not say northwind + test cannot be
 *      confirmed; a group or "all" runs one scenario after another;
 *   3. with the function or the table absent, or the runner not claiming
 *      northwind + test, the section says so and offers NOTHING to click;
 *   4. live progress per step, then pass/fail per check with expected vs
 *      actual, and links to the real rental and to Finances for it;
 *   5. a step only a person can do: the link, Continue, the runner's refusal;
 *   6. evidence downloads as JSON carrying the rows and the verdicts;
 *   7. the history reopens a run; a "passed" over a failing check is failed;
 *   8. for every tenant but northwind it renders nothing and calls nothing.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

/* ── the fake backend ───────────────────────────────────────────────────── */

type Row = Record<string, unknown>;
type Answer = { status: number; body: unknown } | { throws: string };

interface Call {
  kind: 'invoke' | 'from';
  name?: string;
  method?: string;
  body?: Record<string, unknown>;
  table?: string;
  select?: string;
  selectOpts?: unknown;
  eqs?: [string, unknown][];
  single?: boolean;
}

/** What each action answers. A function is called with the request body, and may answer later. */
type Handler = Answer | ((body: Record<string, unknown>) => Answer | Promise<Answer>);

const backend = {
  /** A deployed, switched-on runner answers a GET (no action) with 400. */
  fnGet: { status: 400, body: { ok: false, code: 'action', error: 'unknown action: ' } } as Answer,
  list: { status: 200, body: null } as Answer,
  preview: null as unknown as Handler,
  start: null as unknown as Handler,
  advance: { status: 409, body: { ok: false, code: 'not_running', error: 'This run is not running.' } } as Handler,
  cont: { status: 200, body: { ok: true } } as Handler,
  abort: { status: 200, body: { ok: true } } as Handler,
  close: { status: 200, body: { ok: true, closed: true } } as Handler,
  tableError: null as null | { code: string; message: string },
  runs: new Map<string, Row>(),
  steps: new Map<string, Row[]>(),
  rentals: new Map<string, Row>(),
  calls: [] as Call[],
};

function httpError(status: number, body: unknown) {
  const err = new Error('Edge Function returned a non-2xx status code') as Error & { context: unknown };
  err.name = 'FunctionsHttpError';
  err.context = { status, clone: () => ({ json: async () => body }) };
  return err;
}

function query(table: string) {
  const q = { select: '', selectOpts: undefined as unknown, eqs: [] as [string, unknown][], gtes: [] as [string, string][], single: false };
  const matches = (r: Row) => q.eqs.every(([c, v]) => r[c] === v) && q.gtes.every(([c, v]) => String(r[c]) >= v);
  const run = async () => {
    backend.calls.push({ kind: 'from', table, select: q.select, selectOpts: q.selectOpts, eqs: [...q.eqs], single: q.single });
    if (backend.tableError && table.startsWith('dev_sim')) return { data: null, error: backend.tableError };
    let rows: Row[] = [];
    if (table === 'dev_sim_runs') {
      rows = [...backend.runs.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    } else if (table === 'dev_sim_run_steps') {
      rows = [...backend.steps.values()].flat().sort((a, b) => Number(a.step_index) - Number(b.step_index));
    } else if (table === 'rentals') {
      rows = [...backend.rentals.values()];
    }
    rows = rows.filter(matches);
    return q.single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null };
  };
  const b: Record<string, unknown> = {
    select: (cols: string, opts?: unknown) => {
      q.select = cols;
      q.selectOpts = opts;
      return b;
    },
    eq: (c: string, v: unknown) => {
      q.eqs.push([c, v]);
      return b;
    },
    gte: (c: string, v: string) => {
      q.gtes.push([c, v]);
      return b;
    },
    order: () => b,
    limit: () => b,
    maybeSingle: () => {
      q.single = true;
      return run();
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
  };
  return b;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: async (name: string, opts: { method?: string; body?: Record<string, unknown> } = {}) => {
        const method = opts.method ?? 'POST';
        backend.calls.push({ kind: 'invoke', name, method, body: opts.body });
        const action = String(opts.body?.action ?? '');
        const handlers: Record<string, Handler> = {
          list: backend.list,
          preview: backend.preview,
          start: backend.start,
          advance: backend.advance,
          continue: backend.cont,
          abort: backend.abort,
          close: backend.close,
        };
        const h: Handler =
          method === 'GET' ? backend.fnGet : (handlers[action] ?? { status: 400, body: { ok: false, error: `unknown action: ${action}` } });
        const answer = typeof h === 'function' ? await h(opts.body ?? {}) : h;
        if ('throws' in answer) throw new TypeError(answer.throws);
        if (answer.status >= 400) return { data: null, error: httpError(answer.status, answer.body) };
        return { data: answer.body, error: null };
      },
    },
    from: (table: string) => query(table),
  },
}));

let currentTenant: { id: string; slug: string } | null = null;
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: currentTenant, loading: false, tenantSlug: currentTenant?.slug ?? null }),
}));

import { E2eLiveRunner, INSTANT_TIER_LABEL, LIVE_TIER_LABEL } from '@/components/dev/e2e-live-runner';
import { CONFIRM_SENTENCE, ENGINE_GROUPS } from '@/components/dev/e2e-runner-contract';

/** catalogueSummary() — what `list` sends (tests/e2e/scenarios/index.ts): no steps. */
function summaryOf(sc: Record<string, unknown>) {
  const steps = (sc.steps as { kind: string }[]) ?? [];
  return {
    id: sc.id,
    family: sc.family,
    title: sc.title,
    why: sc.why,
    tiers: sc.tiers,
    liveRunnable: (sc.tiers as string[]).includes('live') && !sc.liveBlockedBy && sc.fixture !== null,
    liveBlockedBy: sc.liveBlockedBy ?? null,
    suspect: sc.suspect ?? null,
    references: sc.references ?? [],
    stepCount: steps.length,
    humanSteps: steps.filter((st) => st.kind === 'human').length,
  };
}

/* ── fixtures: the catalogue in its REAL shape (tests/e2e/scenarios/types.ts) ─ */

const NORTHWIND = { id: 'tenant-northwind', slug: 'northwind' };
const M = (cents: number, math: string) => ({ cents, math });

const SB1 = {
  id: 'SB1',
  family: 'simple_booking',
  title: 'Pay a booking in full with the card on file',
  why: 'Spec §6: verify simple booking first.',
  tiers: ['live'],
  assumes: ['usd'],
  fixture: { shape: 'booking' },
  steps: [
    { kind: 'charge_saved_card', amount: M(30000, '3 × 100.00 = 300.00'), note: 'E2E: pay the booking in full' },
    {
      kind: 'check',
      label: 'the card payment',
      checks: [
        { label: 'one payment received', observe: 'payments.received_count', expect: 1 },
        { label: 'it is for $300.00', observe: 'payments.received_cents', expect: M(30000, '3 × 100.00 = 300.00') },
        { label: 'the payment reads Applied', observe: 'payments.non_pending_statuses', expect: ['Applied'] },
      ],
    },
    {
      kind: 'tie_out',
      label: 'after payment',
      expect: {
        outstanding: M(0, '300.00 - 300.00 = 0.00'),
        collected: M(30000, '300.00 - 0.00 = 300.00'),
        bills: [
          {
            label: 'Booking',
            total: M(30000, '3 × 100.00 = 300.00'),
            paid: M(30000, '300.00 = 300.00'),
            credited: M(0, '0.00 = 0.00'),
            balance: M(0, '300.00 - 300.00 - 0.00 = 0.00'),
          },
        ],
      },
    },
  ],
};

const EX1 = {
  id: 'EX1',
  family: 'manual_extension',
  title: 'Extend by 2 days, paid by link',
  why: 'Extension payments.',
  tiers: ['live'],
  assumes: ['usd'],
  fixture: { shape: 'booking' },
  steps: [
    { kind: 'extend_manually', days: 2, amount: M(20000, '2 × 100.00 = 200.00') },
    { kind: 'human', ask: 'pay_latest_link', say: 'Open the extension payment link below and pay it with 4242 4242 4242 4242. Then press Continue.' },
    {
      kind: 'check',
      label: 'after the link is paid',
      checks: [{ label: 'received $500.00 in all', observe: 'payments.received_cents', expect: M(50000, '300.00 + 200.00 = 500.00') }],
    },
  ],
};

const CATALOGUE = [
  SB1,
  EX1,
  { id: 'AE1', family: 'auto_extend', title: 'Renewal charges then moves the end date', why: 'A3 order.', tiers: ['live'], fixture: {}, steps: [{ kind: 'fire', job: 'sandbox-auto-extend-rentals', copies: 2 }] },
  {
    id: 'AE7',
    family: 'auto_extend',
    title: 'Prepaid credit covers the renewal',
    why: 'Credit before card.',
    tiers: ['live'],
    fixture: {},
    liveBlockedBy: 'sandbox-auto-extend-rentals has no prepaid-credit path.',
    steps: [],
  },
  { id: 'PG1', family: 'payg', title: 'Daily accrual', why: 'Charges build up.', tiers: ['live'], fixture: {}, steps: [{ kind: 'advance', domain: 'payg', days: 3 }] },
  { id: 'IN1', family: 'installment', title: 'Second installment declines', why: 'A card that stops working.', tiers: ['live'], fixture: {}, suspect: 'Overdue is marked before the retry.', steps: [] },
  {
    id: 'PP-REF',
    family: 'payment_plan',
    title: 'Payment-plan engine scenarios S1–S19b (memory and PGlite)',
    why: 'Every branch of the plan engine.',
    tiers: ['memory', 'pglite'],
    fixture: null,
    steps: [],
    references: ['S1', 'S2', 'S3'],
  },
  { id: 'PP-L1', family: 'payment_plan', title: 'Live: three weekly card payments', why: 'The real engine.', tiers: ['live'], fixture: {}, references: ['S1'], steps: [{ kind: 'tick_plan' }] },
  { id: 'X1', family: 'teleport', title: 'Something new', why: 'Unknown family.', tiers: ['live'], fixture: {}, steps: [] },
];

const RUNNABLE = ['SB1', 'EX1', 'AE1', 'PG1', 'IN1', 'PP-L1', 'X1'];
const scenarioOf = (id: string) => CATALOGUE.find((s) => s.id === id)!;

const ENV_OK = { stripeTestKey: { ok: true }, sandboxTenant: { ok: true } };
const LIST = { ok: true, scenarios: CATALOGUE.map(summaryOf), environment: ENV_OK, quiet: {} };

/** `preview { scenarioId }`, as index.ts answers it; `over` replaces fields. */
const previewAnswer = (over: Record<string, unknown> = {}): Handler => (body) => ({
  status: 200,
  body: {
    ok: true,
    preview: true,
    writes: [],
    scenario: scenarioOf(String(body.scenarioId)),
    runnable: { ok: true },
    assumptions: { ok: true, failed: [] },
    environment: ENV_OK,
    quiet: {},
    wouldStart: true,
    ...over,
  },
});

const RENTAL_ID = '0f1e2d3c-aaaa-4bbb-8ccc-000000000001';

/** A dev_sim_runs row, as the migration defines it. */
const runRow = (id: string, scenarioId: string, status: string, extra: Row = {}): Row => ({
  id,
  tenant_id: NORTHWIND.id,
  scenario_id: scenarioId,
  scenario: scenarioOf(scenarioId),
  status,
  next_step: 0,
  waiting_for: null,
  fixture: { rental_id: RENTAL_ID, customer_id: 'c-1' },
  pass_count: 0,
  fail_count: 0,
  error: null,
  created_at: '2026-09-26T10:00:00Z',
  finished_at: ['passed', 'failed', 'errored', 'aborted'].includes(status) ? '2026-09-26T10:00:09Z' : null,
  ...extra,
});

/** A dev_sim_run_steps row. */
const stepRow = (runId: string, index: number, status: string, assertions: Row[] = [], extra: Row = {}): Row => ({
  run_id: runId,
  tenant_id: NORTHWIND.id,
  step_index: index,
  kind: index === -1 ? 'fixture' : 'step',
  label: index === -1 ? 'Create the fixture rental' : null,
  status,
  assertions,
  pass_count: assertions.filter((a) => a.pass === true).length,
  fail_count: assertions.filter((a) => a.pass !== true).length,
  finished_at: '2026-09-26T10:00:02Z',
  ...extra,
});

const SB1_CHECKS: Row[] = [
  { label: 'one payment received', expected: 1, actual: 1, pass: true },
  { label: 'it is for $300.00', expected: M(30000, '3 × 100.00 = 300.00'), actual: 30000, pass: true },
];

/** SB1 finished and passed: the fixture, the charge, the check. */
function finishSB1(runId: string, extra: Row = {}) {
  backend.runs.set(runId, runRow(runId, 'SB1', 'passed', { next_step: 3, pass_count: 2, fail_count: 0, ...extra }));
  backend.steps.set(runId, [stepRow(runId, -1, 'ok'), stepRow(runId, 0, 'ok'), stepRow(runId, 1, 'ok', SB1_CHECKS), stepRow(runId, 2, 'ok')]);
}

/** A `start` that makes the run row (and whatever `then` adds), answering a RunOutcome. */
let runSeq = 0;
function startsAs(status: string, then: (runId: string, scenarioId: string) => void = () => {}): Handler {
  return (body) => {
    runSeq += 1;
    const runId = `aaaaaaaa-0000-4000-8000-${String(runSeq).padStart(12, '0')}`;
    const sid = String(body.scenarioId);
    backend.runs.set(runId, runRow(runId, sid, status, { created_at: new Date(Date.now() + runSeq).toISOString() }));
    backend.steps.set(runId, [stepRow(runId, -1, 'ok')]);
    then(runId, sid);
    const row = backend.runs.get(runId)!;
    return { status: 200, body: { ok: true, runId, status: row.status, nextStep: row.next_step, waitingFor: row.waiting_for, passCount: 0, failCount: 0 } };
  };
}

/* ── harness ────────────────────────────────────────────────────────────── */

beforeEach(() => {
  currentTenant = NORTHWIND;
  backend.fnGet = { status: 400, body: { ok: false, code: 'action', error: 'unknown action: ' } };
  backend.list = { status: 200, body: LIST };
  backend.preview = previewAnswer();
  backend.start = startsAs('running');
  backend.advance = { status: 409, body: { ok: false, code: 'not_running', error: 'This run is not running.' } };
  backend.cont = { status: 200, body: { ok: true } };
  backend.abort = { status: 200, body: { ok: true } };
  backend.close = { status: 200, body: { ok: true, closed: true } };
  backend.tableError = null;
  backend.runs = new Map();
  backend.steps = new Map();
  backend.rentals = new Map([[RENTAL_ID, { id: RENTAL_ID, tenant_id: NORTHWIND.id, rental_number: 'R-1042' }]]);
  backend.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const section = (c: HTMLElement) => c.querySelector('[data-e2e-live-runner]') as HTMLElement;
const invokes = (action?: string) =>
  backend.calls.filter((c) => c.kind === 'invoke' && (action ? c.body?.action === action : true));

async function renderReady(pollMs = 15) {
  const utils = render(<E2eLiveRunner pollMs={pollMs} />);
  await waitFor(() => expect(utils.container.querySelector('[data-e2e-catalogue]')).not.toBeNull());
  return utils;
}

/**
 * Click, then let pending promises settle. Deliberately NOT `await act(async …)`:
 * while a run is going, the section's own polling keeps React's act queue busy
 * every few milliseconds, and an async act waits for that queue to empty — so a
 * click wrapped that way can stall for as long as the run keeps polling.
 * `fireEvent` is already wrapped in a synchronous act by Testing Library;
 * outcomes are then awaited with `waitFor`.
 */
async function click(el: Element) {
  fireEvent.click(el);
  await pause(0);
}

/** Real time passing, without holding React's act queue open. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runAndConfirm(container: HTMLElement, selector: string) {
  await click(container.querySelector(selector)!);
  await waitFor(() => expect(container.querySelector('[data-e2e-confirm]')).not.toBeNull());
  await click(container.querySelector('[data-e2e-confirm]')!);
}

const result = (c: HTMLElement, id: string) => c.querySelector(`[data-e2e-result="${id}"]`) as HTMLElement;

/* ── 1. the catalogue ───────────────────────────────────────────────────── */

describe('Live test runs — the catalogue', () => {
  it('shows every engine group in the asked order, each scenario under its family, a gap as a gap, the unknown under Other', async () => {
    const { container } = await renderReady();

    const groups = [...container.querySelectorAll('[data-e2e-group]')].map((g) => g.getAttribute('data-e2e-group'));
    expect(groups).toEqual([...ENGINE_GROUPS.map((g) => g.key), 'other']);
    expect(ENGINE_GROUPS.map((g) => g.title)).toEqual([
      'Simple booking',
      'Extension',
      'Auto-extend',
      'Pay as you go',
      'Installments',
      'Payment plans',
      'Cron safety',
    ]);

    const inGroup = (key: string) =>
      [...container.querySelectorAll(`[data-e2e-group="${key}"] [data-e2e-scenario]`)].map((s) => s.getAttribute('data-e2e-scenario'));
    expect(inGroup('simple_booking')).toEqual(['SB1']);
    expect(inGroup('extension')).toEqual(['EX1']); // manual_extension
    expect(inGroup('auto_extend')).toEqual(['AE1', 'AE7']);
    expect(inGroup('payg')).toEqual(['PG1']);
    expect(inGroup('installments')).toEqual(['IN1']); // installment
    expect(inGroup('payment_plans')).toEqual(['PP-REF', 'PP-L1']); // payment_plan
    expect(inGroup('other')).toEqual(['X1']);
    // No cron-safety scenario from the runner: the group still shows, as a visible gap.
    expect(inGroup('cron_safety')).toEqual([]);
    expect(container.querySelector('[data-e2e-group="cron_safety"] [data-e2e-group-empty]')).not.toBeNull();
    expect(container.querySelector('[data-e2e-group="cron_safety"] [data-e2e-run-group]')).toBeNull();

    // The two tiers, named as asked.
    expect(screen.getByText(INSTANT_TIER_LABEL)).toBeTruthy();
    expect(screen.getByText(LIVE_TIER_LABEL)).toBeTruthy();

    // A step only a person can do is flagged before anything runs (from the summary's humanSteps).
    expect(container.querySelector('[data-e2e-scenario="EX1"] [data-e2e-needs-you]')).not.toBeNull();
    expect(container.querySelector('[data-e2e-scenario="SB1"] [data-e2e-needs-you]')).toBeNull();
  });

  it("opening a scenario reads its steps and expected outcome with the runner's preview, which writes nothing", async () => {
    const { container } = await renderReady();
    const sb1 = container.querySelector('[data-e2e-scenario="SB1"]') as HTMLElement;
    expect(sb1.textContent).toContain('Spec §6: verify simple booking first.');
    expect(invokes('preview')).toHaveLength(0);
    await click(within(sb1).getByRole('button', { expanded: false }));
    await waitFor(() => expect(sb1.querySelector('[data-e2e-expected]')).not.toBeNull());
    expect(invokes('preview').map((c) => c.body)).toEqual([{ action: 'preview', scenarioId: 'SB1' }]);
    const detail = sb1.querySelector('[data-e2e-scenario-detail]') as HTMLElement;
    // The expected outcome is read from the check and tie-out steps, money with its hand derivation.
    expect([...detail.querySelectorAll('[data-e2e-expected] > li')].map((li) => li.textContent)).toEqual([
      'the card payment — one payment received: 1',
      'the card payment — it is for $300.00: $300.00 (3 × 100.00 = 300.00)',
      'the card payment — the payment reads Applied: Applied',
      'Finances after payment — Outstanding $0.00, Collected $300.00',
      'Finances after payment — Booking: total $300.00, paid $300.00, credited $0.00, balance $0.00',
    ]);
    expect([...detail.querySelectorAll('[data-e2e-step-specs] > li')].map((li) => li.textContent)).toEqual([
      'Charge $300.00 to the saved card (E2E: pay the booking in full)',
      'Check — the card payment',
      'Finances tie-out — after payment',
    ]);
    expect(detail.textContent).toContain('Assumes: usd.');
    // Opened again: read once, not again.
    await click(within(sb1).getByRole('button', { expanded: true }));
    await click(within(sb1).getByRole('button', { expanded: false }));
    expect(invokes('preview')).toHaveLength(1);
    expect(invokes().filter((c) => c.method !== 'GET' && !['list', 'preview'].includes(String(c.body?.action)))).toHaveLength(0);
  });

  it('offers no Run button to a scenario that is not a live test or is blocked live, and says why', async () => {
    const { container } = await renderReady();
    const ae7 = container.querySelector('[data-e2e-scenario="AE7"]') as HTMLElement;
    expect(ae7.querySelector('[data-e2e-run]')).toBeNull();
    expect(ae7.querySelector('[data-e2e-not-live]')!.textContent).toBe('blocked live');
    await click(within(ae7).getByRole('button', { expanded: false }));
    expect(ae7.querySelector('[data-e2e-blocked]')!.textContent).toContain('sandbox-auto-extend-rentals has no prepaid-credit path.');

    const ref = container.querySelector('[data-e2e-scenario="PP-REF"]') as HTMLElement;
    expect(ref.querySelector('[data-e2e-run]')).toBeNull();
    expect(ref.querySelector('[data-e2e-not-live]')!.textContent).toBe('not a live test');
    await click(within(ref).getByRole('button', { expanded: false }));
    expect(ref.querySelector('[data-e2e-other-tiers]')!.textContent).toContain('memory and pglite: S1, S2, S3');

    const in1 = container.querySelector('[data-e2e-scenario="IN1"]') as HTMLElement;
    await click(within(in1).getByRole('button', { expanded: false }));
    expect(in1.querySelector('[data-e2e-suspect]')!.textContent).toContain('Overdue is marked before the retry.');
    // A scenario with no steps at all says it would prove nothing.
    expect(in1.querySelector('[data-e2e-no-expected]')!.textContent).toContain('would prove nothing');

    expect(container.querySelector('[data-e2e-run-all]')!.textContent).toContain(`Run all (${RUNNABLE.length})`);
    expect(container.querySelectorAll('[data-e2e-run]')).toHaveLength(RUNNABLE.length);
  });

  it('probes with GETs — never a HEAD — then lists, and writes nothing on the way in', async () => {
    await renderReady();
    const fnCalls = invokes();
    expect(fnCalls.map((c) => [c.method, c.body?.action ?? null])).toEqual([
      ['GET', null],
      ['POST', 'list'],
    ]);
    expect(fnCalls[0].name).toBe('e2e-runner');
    expect(fnCalls[0].body).toBeUndefined();
    const tableProbe = backend.calls.find((c) => c.kind === 'from' && c.select === 'id');
    expect(tableProbe?.table).toBe('dev_sim_runs');
    expect(tableProbe?.selectOpts).toBeUndefined(); // not { head: true }
    expect(tableProbe?.eqs).toEqual([['tenant_id', NORTHWIND.id]]);
  });

  it("names the runner's own checks, and how it knows the tenant and the mode", async () => {
    const { container } = await renderReady();
    const r = container.querySelector('[data-e2e-runner]') as HTMLElement;
    expect(r.textContent).toContain('tenant northwind · Stripe test mode');
    expect(r.textContent).toContain('✓ Stripe key is a TEST key (G3)');
    expect(r.textContent).toContain('✓ sandbox clones are locked to northwind (G3)');
    expect(r.textContent).toContain('refuses every request otherwise (G2)');
  });
});

/* ── 2. preview, then confirm ───────────────────────────────────────────── */

describe('Live test runs — preview first, then confirm', () => {
  it('Run asks for the zero-write preview, shows its answers and exactly what a run writes, and only the confirm starts it', async () => {
    const { container } = await renderReady();
    await click(container.querySelector('[data-e2e-run="SB1"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-preview]')).not.toBeNull());

    expect(invokes('preview').map((c) => c.body)).toEqual([{ action: 'preview', scenarioId: 'SB1' }]);
    expect(invokes('start')).toHaveLength(0);

    const panel = container.querySelector('[data-e2e-preview]') as HTMLElement;
    const checks = panel.querySelector('[data-e2e-preview-checks]')!.textContent!;
    expect(checks).toContain('✓ the scenario may run live (G4)');
    expect(checks).toContain("✓ northwind’s settings match what the expected values assume");
    expect(checks).toContain('✓ the preview wrote nothing');
    // What a run writes, read from the scenario's fixture and steps (the runner's preview lists no writes).
    expect([...panel.querySelectorAll('[data-e2e-preview-write]')].map((w) => w.textContent)).toEqual([
      'dev_sim_runs — 1 row for this run (the evidence)',
      'dev_sim_run_steps — 4 rows — the fixture and each step, with every check',
      'customers — 1 fixture customer named E2E-FIXTURE…, at an @e2e.drive247.test address, no phone',
      'rentals — 1 fixture rental, no vehicle, marked as this run’s fixture and registered in dev_sim_fixtures'.replace('’', "'"),
      'charge-saved-card — a Stripe TEST charge of $300.00 on the saved card, its payment row and allocation',
    ]);
    expect(panel.querySelector('[data-e2e-confirm-sentence]')!.textContent).toBe(`${CONFIRM_SENTENCE}.`);
    expect(CONFIRM_SENTENCE).toBe('This writes test rows to northwind in Stripe TEST mode');

    // While a preview is open nothing else can be started.
    expect((container.querySelector('[data-e2e-run="EX1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-e2e-run-all]') as HTMLButtonElement).disabled).toBe(true);

    await click(panel.querySelector('[data-e2e-confirm]')!);
    await waitFor(() => expect(invokes('start')).toHaveLength(1));
    expect(invokes('start')[0].body).toEqual({ action: 'start', scenarioId: 'SB1', confirm: CONFIRM_SENTENCE });
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-run-id')).toMatch(/^aaaaaaaa-/));
  });

  it('Cancel sends nothing', async () => {
    const { container } = await renderReady();
    await click(container.querySelector('[data-e2e-run="SB1"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-preview]')).not.toBeNull());
    await click(container.querySelector('[data-e2e-cancel]')!);
    expect(container.querySelector('[data-e2e-preview]')).toBeNull();
    expect(invokes('start')).toHaveLength(0);
    expect((container.querySelector('[data-e2e-run="SB1"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Run group and Run all preview exactly their live scenarios, one request each, in group order', async () => {
    const { container } = await renderReady();
    await click(container.querySelector('[data-e2e-run-group="payment_plans"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-preview]')).not.toBeNull());
    expect(invokes('preview').map((c) => c.body!.scenarioId)).toEqual(['PP-L1']); // PP-REF is memory/PGlite
    await click(container.querySelector('[data-e2e-cancel]')!);

    backend.calls = [];
    await click(container.querySelector('[data-e2e-run-all]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-preview]')).not.toBeNull());
    expect(invokes('preview').map((c) => c.body!.scenarioId)).toEqual(RUNNABLE); // AE7 blocked, PP-REF not live
    expect((container.querySelector('[data-e2e-confirm]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a confirmed "Run all" starts one scenario at a time, each only after the one before it has finished', async () => {
    const startedWhile: string[][] = [];
    backend.start = startsAs('passed', (runId) => {
      startedWhile.push([...backend.runs.values()].filter((r) => r.id !== runId).map((r) => String(r.status)));
      backend.runs.set(runId, { ...backend.runs.get(runId)!, pass_count: 1 });
      backend.steps.set(runId, [stepRow(runId, -1, 'ok'), stepRow(runId, 0, 'ok', [{ label: 'x', expected: 1, actual: 1, pass: true }])]);
    });
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run-all]');
    await waitFor(() => expect(invokes('start')).toHaveLength(RUNNABLE.length), { timeout: 10000 });
    expect(invokes('start').map((c) => c.body!.scenarioId)).toEqual(RUNNABLE);
    for (const earlier of startedWhile) expect(earlier.every((st) => st === 'passed')).toBe(true);
    await waitFor(() => expect(container.querySelector('[data-e2e-report]')!.getAttribute('data-e2e-verdict')).toBe('passed'));
    expect(container.querySelector('[data-e2e-counts]')!.textContent).toContain(`${RUNNABLE.length} passed · 0 failed`);
  });

  it('"Stop after this scenario" lets the running one finish and starts no more', async () => {
    let first = '';
    backend.start = startsAs('running', (runId) => {
      first = first || runId;
    });
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run-all]');
    await waitFor(() => expect(container.querySelector('[data-e2e-stop]')).not.toBeNull());
    await click(container.querySelector('[data-e2e-stop]')!);
    finishSB1(first);
    await waitFor(() => expect(container.querySelector('[data-e2e-queue-note]')?.textContent).toContain('Stopped before EX1'));
    expect(invokes('start')).toHaveLength(1);
    expect(container.querySelector('[data-e2e-queue-note]')!.textContent).toContain(`${RUNNABLE.length - 1} not run`);
    expect(result(container, 'EX1').getAttribute('data-e2e-verdict')).toBe('queued');
  });

  it.each([
    ['the scenario is refused (G4)', { runnable: { ok: false, status: 412, code: 'scenario', message: 'amount above $1,000' } }, /will not run it — amount above \$1,000/],
    ['the settings differ', { assumptions: { ok: false, failed: ['tax_off: tax is on'] } }, /settings differ .*tax_off: tax is on/],
    ['a live Stripe key', { environment: { stripeTestKey: { ok: false, message: 'key is sk_live_' }, sandboxTenant: { ok: true } } }, /TEST key \(G3\) — key is sk_live_/],
    ['the preview tried to write', { writes: ['insert rentals'] }, /tried to write \(insert rentals\)/],
    ['no scenario came back', { scenario: null }, /did not include the scenario/],
  ])('a preview where %s cannot be confirmed', async (_name, over, why) => {
    backend.preview = previewAnswer(over);
    const { container } = await renderReady();
    await click(container.querySelector('[data-e2e-run="SB1"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-preview]')).not.toBeNull());
    expect(container.querySelector('[data-e2e-preview-problems]')!.textContent).toMatch(why);
    const confirm = container.querySelector('[data-e2e-confirm]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(invokes('start')).toHaveLength(0);
  });

  it("a refused preview shows the runner's own words and runs nothing", async () => {
    backend.preview = { status: 403, body: { ok: false, code: 'not_head_admin', error: "Only northwind's head admin (or a super admin) can run end-to-end scenarios." } };
    const { container } = await renderReady();
    await click(container.querySelector('[data-e2e-run="SB1"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-flow="failed"]')).not.toBeNull());
    expect(container.querySelector('[data-e2e-flow="failed"]')!.textContent).toContain("Only northwind's head admin");
    expect(container.querySelector('[data-e2e-preview]')).toBeNull();
    expect(invokes('start')).toHaveLength(0);
  });

  it("a refused start stops the queue there, in the runner's words", async () => {
    backend.start = { status: 412, body: { ok: false, code: 'assumptions', error: "northwind's settings differ from the ones the expected values were derived under; nothing was written." } };
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run-all]');
    await waitFor(() => expect(container.querySelector('[data-e2e-queue-note]')).not.toBeNull());
    expect(container.querySelector('[data-e2e-queue-note]')!.textContent).toContain('SB1 did not start: northwind');
    expect(container.querySelector('[data-e2e-queue-note]')!.textContent).toContain(`${RUNNABLE.length - 1} not run`);
    expect(invokes('start')).toHaveLength(1);
  });
});

/* ── 3. backend absent ──────────────────────────────────────────────────── */

describe('Live test runs — when the backend is not there', () => {
  async function renderUnavailable() {
    const utils = render(<E2eLiveRunner pollMs={15} />);
    await waitFor(() => expect(utils.container.querySelector('[data-e2e-status="unavailable"]')).not.toBeNull());
    return utils;
  }

  function expectNothingToClick(container: HTMLElement) {
    expect(section(container).querySelectorAll('button')).toHaveLength(0);
    expect(section(container).querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('[data-e2e-catalogue]')).toBeNull();
    expect(invokes().filter((c) => c.method !== 'GET' && c.body?.action !== 'list')).toHaveLength(0);
  }

  it('the function is not deployed (GET answers 404): says so, and offers nothing', async () => {
    backend.fnGet = { status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } };
    const { container } = await renderUnavailable();
    const fn = container.querySelector('[data-e2e-piece="e2e-runner"]')!;
    expect(fn.getAttribute('data-e2e-piece-state')).toBe('absent');
    expect(fn.textContent).toContain('not deployed');
    expect(fn.textContent).toContain('Requested function was not found');
    expect(invokes('list')).toHaveLength(0);
    expect(container.querySelector('[data-e2e-piece="dev_sim_runs"]')!.getAttribute('data-e2e-piece-state')).toBe('ok');
    expect(section(container).textContent).toContain('Live test runs are not available here.');
    expectNothingToClick(container);
  });

  it('deployed but switched off (G0 answers 503): says so, and offers nothing', async () => {
    backend.fnGet = { status: 503, body: { ok: false, code: 'runner_disabled', error: 'The E2E runner is switched off (E2E_RUNNER_ENABLED is not set to northwind).' } };
    const { container } = await renderUnavailable();
    const fn = container.querySelector('[data-e2e-piece="e2e-runner"]')!;
    expect(fn.getAttribute('data-e2e-piece-state')).toBe('refused');
    expect(fn.textContent).toContain('switched off');
    expectNothingToClick(container);
  });

  it('the table is not applied (PGRST205 on a GET): says so, and offers nothing', async () => {
    backend.tableError = { code: 'PGRST205', message: "Could not find the table 'public.dev_sim_runs' in the schema cache" };
    const { container } = await renderUnavailable();
    const t = container.querySelector('[data-e2e-piece="dev_sim_runs"]')!;
    expect(t.getAttribute('data-e2e-piece-state')).toBe('absent');
    expect(t.textContent).toContain('not applied');
    expectNothingToClick(container);
  });

  it('both absent: both named', async () => {
    backend.fnGet = { status: 404, body: { message: 'Requested function was not found' } };
    backend.tableError = { code: '42P01', message: 'relation "public.dev_sim_runs" does not exist' };
    const { container } = await renderUnavailable();
    expect(container.querySelector('[data-e2e-piece="e2e-runner"]')!.getAttribute('data-e2e-piece-state')).toBe('absent');
    expect(container.querySelector('[data-e2e-piece="dev_sim_runs"]')!.getAttribute('data-e2e-piece-state')).toBe('absent');
    expectNothingToClick(container);
  });

  it.each([
    ['its Stripe key check failed', { ...LIST, environment: { stripeTestKey: { ok: false, message: 'the key is not a test key' }, sandboxTenant: { ok: true } } }, /Stripe key is a TEST key \(G3\): the key is not a test key/],
    ['its sandbox check failed', { ...LIST, environment: { stripeTestKey: { ok: true }, sandboxTenant: { ok: false, message: 'SANDBOX_TEST_TENANT_ID is another tenant' } } }, /sandbox clones are locked to northwind/],
    ['no environment at all', { ok: true, scenarios: LIST.scenarios }, /did not say which Stripe mode/],
    ['Stripe live mode, in so many words', { ...LIST, runner: { stripe_mode: 'live' } }, /Stripe mode "live"/],
    ['another tenant, in so many words', { ...LIST, runner: { tenant_slug: 'revtek' } }, /tenant "revtek"/],
  ])('a runner whose list reports %s is refused here', async (_n, body, why) => {
    backend.list = { status: 200, body };
    const { container } = await renderUnavailable();
    const fn = container.querySelector('[data-e2e-piece="e2e-runner"]')!;
    expect(fn.getAttribute('data-e2e-piece-state')).toBe('unsafe');
    expect(fn.textContent).toMatch(why);
    expectNothingToClick(container);
  });

  it('a runner with an empty catalogue, a refusal, or no network offers nothing either', async () => {
    for (const [get, list] of [
      [backend.fnGet, { status: 200, body: { ...LIST, scenarios: [] } }],
      [{ status: 403, body: { ok: false, code: 'not_head_admin', error: 'head admin only' } }, backend.list],
      [{ throws: 'Failed to fetch' }, backend.list],
    ] as [Answer, Answer][]) {
      backend.fnGet = get;
      backend.list = list;
      backend.calls = [];
      const utils = await renderUnavailable();
      expect(utils.container.querySelector('[data-e2e-piece="e2e-runner"]')!.getAttribute('data-e2e-piece-state')).not.toBe('ok');
      expectNothingToClick(utils.container);
      utils.unmount();
    }
  });
});

/* ── 4. progress and results ────────────────────────────────────────────── */

describe('Live test runs — progress, then results', () => {
  it('shows the run while start is still working, each step as it goes, then every check, and links to the real screens', async () => {
    const runId = 'aaaaaaaa-0000-4000-8000-000000000777';
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // `start` does real work before it answers: the row appears at once, the answer only later.
    backend.start = async (body) => {
      backend.runs.set(runId, runRow(runId, String(body.scenarioId), 'running', { next_step: 0, created_at: new Date().toISOString() }));
      backend.steps.set(runId, [stepRow(runId, -1, 'ok')]);
      await gate;
      return { status: 200, body: { ok: true, runId, status: 'running', nextStep: 0, waitingFor: null, passCount: 0, failCount: 0 } };
    };
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run="SB1"]');

    // Before start has answered, the card says it is starting…
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-verdict')).toBe('running'));
    // …and then the row it is making is found and its steps show.
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-run-id')).toBe(runId));
    const discovery = backend.calls.find((c) => c.table === 'dev_sim_runs' && c.select === 'id, status, created_at');
    expect(discovery?.eqs).toEqual([
      ['tenant_id', NORTHWIND.id],
      ['scenario_id', 'SB1'],
    ]);
    await waitFor(() => expect(result(container, 'SB1')?.querySelector('[data-e2e-step="0"]')?.getAttribute('data-e2e-step-status')).toBe('running'));
    expect(invokes('advance')).toHaveLength(0); // start still has the run
    release();
    const status = (i: number) => result(container, 'SB1').querySelector(`[data-e2e-step="${i}"]`)!.getAttribute('data-e2e-step-status');
    expect(status(-1)).toBe('passed');
    expect(status(1)).toBe('pending');
    expect(status(2)).toBe('pending');
    expect(result(container, 'SB1').querySelector('[data-e2e-step="0"]')!.textContent).toContain('Charge $300.00 to the saved card');
    expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('running');
    // Everything else is locked while it goes.
    expect((container.querySelector('[data-e2e-run="EX1"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('[data-e2e-run-all]') as HTMLButtonElement).disabled).toBe(true);

    // The runner finishes.
    finishSB1(runId);
    await waitFor(() => expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('passed'));
    expect(container.querySelector('[data-e2e-report]')!.getAttribute('data-e2e-verdict')).toBe('passed');

    const rows = [...result(container, 'SB1').querySelectorAll('[data-e2e-check]')];
    expect(rows.map((r) => r.getAttribute('data-e2e-check'))).toEqual(['pass', 'pass']);
    // Money reads as money on both sides; the hand derivation stays beside the expected value.
    expect([...rows[1].querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      '✓',
      'it is for $300.00',
      '$300.00 (3 × 100.00 = 300.00)',
      '$300.00',
    ]);

    // The REAL screens for the fixture — Finances searched by the rental's own number.
    await waitFor(() => expect(result(container, 'SB1').querySelector('[data-e2e-link="finances-billed"]')).not.toBeNull());
    const href = (k: string) => result(container, 'SB1').querySelector(`[data-e2e-link="${k}"]`)!.getAttribute('href');
    expect(href('rental')).toBe(`/rentals/${RENTAL_ID}`);
    expect(href('finances-billed')).toBe('/finances?view=billed&q=R-1042&period=all');
    expect(href('finances-received')).toBe('/finances?view=received&q=R-1042&period=all');
    expect(result(container, 'SB1').querySelector('[data-e2e-link="rental"]')!.getAttribute('target')).toBe('_blank');
    const rentalRead = backend.calls.find((c) => c.table === 'rentals');
    expect(rentalRead?.eqs).toEqual([
      ['id', RENTAL_ID],
      ['tenant_id', NORTHWIND.id],
    ]);

    // The catalogue row carries the verdict too, and the section unlocks.
    expect(container.querySelector('[data-e2e-scenario="SB1"]')!.getAttribute('data-e2e-scenario-verdict')).toBe('passed');
    await waitFor(() => expect((container.querySelector('[data-e2e-run="EX1"]') as HTMLButtonElement).disabled).toBe(false));

    // Polling stops at a terminal status, and so does advancing.
    const polls = () => backend.calls.filter((c) => c.kind === 'from' && c.table === 'dev_sim_runs' && c.single).length;
    const settled = polls();
    const advances = invokes('advance').length;
    await pause(80);
    expect(polls()).toBe(settled);
    expect(invokes('advance')).toHaveLength(advances);
  });

  it('calls advance while the run is running — waiting first when the runner asks (G8) — and never once it is finished', async () => {
    let next = 0;
    let runId = '';
    backend.start = startsAs('running', (id) => {
      runId = id;
    });
    // The first advance is told to wait a moment for a real cron's window.
    let asked = 0;
    backend.advance = (body) => {
      asked += 1;
      expect(body).toEqual({ action: 'advance', runId });
      if (asked === 1) return { status: 200, body: { ok: true, runId, status: 'running', nextStep: 0, deferredSeconds: 0.4 } };
      const steps = backend.steps.get(runId)!;
      steps.push(stepRow(runId, next, 'ok', next === 1 ? SB1_CHECKS : []));
      next += 1;
      const status = next >= 3 ? 'passed' : 'running';
      backend.runs.set(runId, runRow(runId, 'SB1', status, { next_step: next, pass_count: next >= 2 ? 2 : 0 }));
      return { status: 200, body: { ok: true, runId, status, nextStep: next } };
    };
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run="SB1"]');
    await waitFor(() =>
      expect(container.querySelector('[data-e2e-defer-note]')?.textContent).toContain("a real cron's run window passes first (G8)"),
    );
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-verdict')).toBe('passed'), { timeout: 5000 });
    expect(asked).toBe(4);
    expect(container.querySelector('[data-e2e-defer-note]')).toBeNull();
    await pause(80);
    expect(asked).toBe(4);
  });

  it('a run the runner ended in error fails, with what the step answered, and the steps it never reached say so', async () => {
    backend.start = startsAs('errored', (runId) => {
      backend.runs.set(runId, { ...backend.runs.get(runId)!, next_step: 0, error: 'step 0 (charge_saved_card): card declined' });
      backend.steps.set(runId, [
        stepRow(runId, -1, 'ok'),
        stepRow(runId, 0, 'error', [], { response: { error: 'card declined' } }),
      ]);
    });
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run="SB1"]');
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-verdict')).toBe('failed'));
    const step0 = result(container, 'SB1').querySelector('[data-e2e-step="0"]')!;
    expect(step0.getAttribute('data-e2e-step-status')).toBe('error');
    expect(step0.textContent).toContain('card declined');
    expect(result(container, 'SB1').querySelector('[data-e2e-step="1"]')!.getAttribute('data-e2e-step-status')).toBe('skipped');
    expect(result(container, 'SB1').textContent).toContain('The runner reported: step 0 (charge_saved_card): card declined');
  });
});

/* ── 5. a step only a person can do ─────────────────────────────────────── */

describe('Live test runs — a human step', () => {
  it('shows the instruction and the link, sends Continue, shows a refusal in its own words, and goes on', async () => {
    let runId = '';
    const say = 'Open the extension payment link below and pay it with 4242 4242 4242 4242. Then press Continue.';
    const url = 'https://checkout.stripe.com/c/pay/cs_test_abc';
    backend.start = startsAs('waiting', (id) => {
      runId = id;
      backend.runs.set(id, { ...backend.runs.get(id)!, next_step: 1, waiting_for: { stepIndex: 1, ask: 'pay_latest_link', say, url, baselineReceived: 1 } });
      backend.steps.set(id, [stepRow(id, -1, 'ok'), stepRow(id, 0, 'ok')]);
    });
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run="EX1"]');

    await waitFor(() => expect(container.querySelector('[data-e2e-waiting="1"]')).not.toBeNull());
    expect(result(container, 'EX1').getAttribute('data-e2e-verdict')).toBe('waiting');
    expect(container.querySelector('[data-e2e-report]')!.getAttribute('data-e2e-verdict')).toBe('waiting');
    const waiting = container.querySelector('[data-e2e-waiting="1"]') as HTMLElement;
    expect(waiting.textContent).toContain(say);
    const link = waiting.querySelector('[data-e2e-link="human"]')!;
    expect(link.getAttribute('href')).toBe(url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(result(container, 'EX1').querySelector('[data-e2e-step="1"]')!.getAttribute('data-e2e-step-status')).toBe('waiting');
    // Nothing advances a run that is waiting for a person.
    expect(invokes('advance')).toHaveLength(0);

    // Pressed while another request holds the run: the runner refuses, in its own words, and the step stays.
    backend.cont = { status: 409, body: { ok: false, code: 'busy', error: 'This run is busy in another request, or already finished.' } };
    await click(waiting.querySelector('[data-e2e-continue="1"]')!);
    await waitFor(() => expect(container.querySelector('[data-e2e-continue-error]')).not.toBeNull());
    expect(container.querySelector('[data-e2e-continue-error]')!.textContent).toContain('This run is busy in another request');

    // Pressed again: the runner records the step and finishes the run inside the same request.
    backend.cont = (body) => {
      backend.runs.set(runId, runRow(runId, 'EX1', 'passed', { next_step: 3, pass_count: 1 }));
      backend.steps.set(runId, [
        stepRow(runId, -1, 'ok'),
        stepRow(runId, 0, 'ok'),
        stepRow(runId, 1, 'ok', [], { kind: 'human', label: say }),
        stepRow(runId, 2, 'ok', [{ label: 'received $500.00 in all', expected: M(50000, '300.00 + 200.00 = 500.00'), actual: 50000, pass: true }]),
      ]);
      return { status: 200, body: { ok: true, runId: body.runId, status: 'passed' } };
    };
    await click(container.querySelector('[data-e2e-continue="1"]')!);
    expect(invokes('continue')).toHaveLength(2);
    expect(invokes('continue')[1].body).toEqual({ action: 'continue', runId });

    await waitFor(() => expect(result(container, 'EX1').getAttribute('data-e2e-verdict')).toBe('passed'));
    expect(container.querySelector('[data-e2e-continue]')).toBeNull();
    const money = result(container, 'EX1').querySelector('[data-e2e-check="pass"]') as HTMLElement;
    expect([...money.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      '✓',
      'received $500.00 in all',
      '$500.00 (300.00 + 200.00 = 500.00)',
      '$500.00',
    ]);
  });
});

/* ── 5b. stop and close ─────────────────────────────────────────────────── */

describe('Live test runs — stop a run, close a fixture', () => {
  it('"Stop this run" aborts it and starts nothing after it', async () => {
    let runId = '';
    backend.start = startsAs('running', (id) => {
      runId = id;
    });
    backend.abort = (body) => {
      backend.runs.set(runId, runRow(runId, 'SB1', 'aborted', { next_step: 0 }));
      return { status: 200, body: { ok: true, runId: body.runId, status: 'aborted' } };
    };
    const { container } = await renderReady();
    await runAndConfirm(container, '[data-e2e-run-all]');
    await waitFor(() => expect(container.querySelector(`[data-e2e-abort="${runId}"]`)).not.toBeNull());
    await click(container.querySelector(`[data-e2e-abort="${runId}"]`)!);
    expect(invokes('abort').map((c) => c.body)).toEqual([{ action: 'abort', runId }]);
    await waitFor(() => expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('aborted'));
    await waitFor(() => expect(container.querySelector('[data-e2e-queue-note]')?.textContent).toContain('Stopped before EX1'));
    expect(invokes('start')).toHaveLength(1);
  });

  it('"Close the fixture rental" is offered on a finished run, sends close, and shows it closed', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    finishSB1(id);
    backend.close = (body) => {
      backend.runs.set(id, { ...backend.runs.get(id)!, fixture_closed_at: '2026-09-26T12:00:00Z' });
      return { status: 200, body: { ok: true, runId: body.runId, closed: true } };
    };
    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelector(`[data-e2e-open="${id}"]`)).not.toBeNull());
    await click(container.querySelector(`[data-e2e-open="${id}"]`)!);
    await waitFor(() => expect(container.querySelector(`[data-e2e-close-fixture="${id}"]`)).not.toBeNull());
    // Opening wrote nothing.
    expect(invokes().filter((c) => c.method !== 'GET' && c.body?.action !== 'list')).toHaveLength(0);
    await click(container.querySelector(`[data-e2e-close-fixture="${id}"]`)!);
    expect(invokes('close').map((c) => c.body)).toEqual([{ action: 'close', runId: id }]);
    await waitFor(() => expect(container.querySelector(`[data-e2e-close-fixture="${id}"]`)).toBeNull());
    expect(result(container, 'SB1').textContent).toContain('fixture closed');
  });
});

/* ── 6. evidence ────────────────────────────────────────────────────────── */

describe('Live test runs — evidence', () => {
  it('Download evidence saves the rows, every check and the verdicts as JSON', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    finishSB1(id);
    let saved: Blob | null = null;
    let savedName = '';
    const create = vi.fn((b: Blob) => {
      saved = b;
      return 'blob:evidence';
    });
    const real = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    onTestFinished(() => {
      Object.assign(URL, real);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedName = this.download;
    });

    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelector(`[data-e2e-open="${id}"]`)).not.toBeNull());
    await click(container.querySelector(`[data-e2e-open="${id}"]`)!);
    await waitFor(() => expect(container.querySelector('[data-e2e-download]')).not.toBeNull());
    await click(container.querySelector('[data-e2e-download]')!);

    expect(create).toHaveBeenCalledTimes(1);
    expect(savedName).toMatch(/^e2e-live-run-11111111-\d{4}-\d{2}-\d{2}T\d{6}\.json$/);
    const text = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsText(saved!);
    });
    const ev = JSON.parse(text);
    expect(ev.kind).toBe('e2e-live-run');
    expect(ev.writesToDatabase).toBe(true);
    expect(ev.tenant).toBe('northwind');
    expect(ev.stripeMode).toBe('test');
    expect(ev.runner.checks).toEqual([
      { name: 'Stripe key is a TEST key (G3)', ok: true, message: null },
      { name: 'sandbox clones are locked to northwind (G3)', ok: true, message: null },
    ]);
    expect(ev.runs).toHaveLength(1);
    const r = ev.runs[0];
    expect(r).toMatchObject({
      id,
      scenarioId: 'SB1',
      status: 'passed',
      verdict: 'passed',
      why: 'Spec §6: verify simple booking first.',
      counts: { passed: 2, failed: 0, badSteps: 0 },
      runnerCounts: { pass: 2, fail: 0 },
      fixture: { rentalId: RENTAL_ID },
    });
    // The expected outcome comes from the run's own `scenario` column — as it was at run time.
    expect(r.expectedOutcome[1]).toBe('the card payment — it is for $300.00: $300.00 (3 × 100.00 = 300.00)');
    expect(r.timeline.map((t: { index: number; status: string }) => [t.index, t.status])).toEqual([
      [-1, 'passed'],
      [0, 'passed'],
      [1, 'passed'],
      [2, 'passed'],
    ]);
    expect(r.timeline[2].checks).toEqual([
      { label: 'one payment received', expected: 1, actual: 1, pass: true, math: null },
      { label: 'it is for $300.00', expected: { cents: 30000, math: '3 × 100.00 = 300.00' }, actual: 30000, pass: true, math: null },
    ]);
    // The rows themselves, untouched.
    expect(r.row.id).toBe(id);
    expect(r.stepRows).toHaveLength(4);
    expect(r.stepRows[2].assertions).toHaveLength(2);
  });
});

/* ── 7. history ─────────────────────────────────────────────────────────── */

describe('Live test runs — history', () => {
  it('lists runs from dev_sim_runs and reopens one; a "passed" over a failing check is shown as failed', async () => {
    const good = '11111111-2222-4333-8444-555555555555';
    const lying = '99999999-2222-4333-8444-555555555555';
    finishSB1(good, { created_at: '2026-09-26T09:00:00Z' });
    backend.runs.set(lying, runRow(lying, 'SB1', 'passed', { pass_count: 1, fail_count: 0, created_at: '2026-09-26T11:00:00Z' }));
    backend.steps.set(lying, [
      stepRow(lying, -1, 'ok'),
      stepRow(lying, 1, 'ok', [{ label: 'rental balance (cents)', expected: M(0, '300.00 - 300.00 = 0.00'), actual: 5000, pass: false }]),
    ]);
    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelectorAll('[data-e2e-history-row]')).toHaveLength(2));
    // Newest first, as read.
    expect([...container.querySelectorAll('[data-e2e-history-row]')].map((r) => r.getAttribute('data-e2e-history-row'))).toEqual([lying, good]);
    const historyRead = backend.calls.find((c) => c.kind === 'from' && c.table === 'dev_sim_runs' && c.select === '*' && !c.single);
    expect(historyRead?.eqs).toEqual([['tenant_id', NORTHWIND.id]]);

    await click(container.querySelector(`[data-e2e-open="${lying}"]`)!);
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-run-id')).toBe(lying));
    await waitFor(() => expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('failed'));
    const card = result(container, 'SB1');
    expect(card.textContent).toContain('does not support it');
    expect(card.querySelector('[data-e2e-count-mismatch]')!.textContent).toContain('1 passed / 0 failed');
    const bad = card.querySelector('[data-e2e-check="fail"]') as HTMLElement;
    expect([...bad.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      '✗',
      'rental balance (cents)',
      '$0.00 (300.00 - 300.00 = 0.00)',
      '$50.00',
    ]);
    const stepRead = backend.calls.find((c) => c.table === 'dev_sim_run_steps');
    expect(stepRead?.eqs).toEqual([
      ['run_id', lying],
      ['tenant_id', NORTHWIND.id],
    ]);

    await click(container.querySelector(`[data-e2e-open="${good}"]`)!);
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-run-id')).toBe(good));
    await waitFor(() => expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('passed'));
  });

  it('a "passed" run with no checks is unproven, in the history and when opened', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    backend.runs.set(id, runRow(id, 'SB1', 'passed', { pass_count: 0 }));
    backend.steps.set(id, [stepRow(id, -1, 'ok'), stepRow(id, 0, 'ok')]);
    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelector(`[data-e2e-open="${id}"]`)).not.toBeNull());
    expect(container.querySelector('[data-e2e-history-verdict]')!.getAttribute('data-e2e-history-verdict')).toBe('unproven');
    await click(container.querySelector(`[data-e2e-open="${id}"]`)!);
    await waitFor(() => expect(result(container, 'SB1')?.getAttribute('data-e2e-verdict')).toBe('unproven'));
    expect(container.querySelector('[data-e2e-report]')!.getAttribute('data-e2e-verdict')).toBe('unproven');
  });

  it('an unfinished run reopened from the history is only watched until Resume is pressed', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    backend.runs.set(id, runRow(id, 'SB1', 'running', { next_step: 0 }));
    backend.steps.set(id, [stepRow(id, -1, 'ok')]);
    backend.advance = (body) => {
      finishSB1(id);
      return { status: 200, body: { ok: true, runId: body.runId, status: 'passed' } };
    };
    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelector(`[data-e2e-open="${id}"]`)).not.toBeNull());
    await click(container.querySelector(`[data-e2e-open="${id}"]`)!);
    await waitFor(() => expect(container.querySelector('[data-e2e-resume]')).not.toBeNull());
    await pause(60);
    // Opening wrote nothing.
    expect(invokes().filter((c) => c.method !== 'GET' && c.body?.action !== 'list')).toHaveLength(0);
    await click(container.querySelector('[data-e2e-resume]')!);
    await waitFor(() => expect(result(container, 'SB1').getAttribute('data-e2e-verdict')).toBe('passed'));
    expect(invokes('advance')).toHaveLength(1);
    expect(invokes('start')).toHaveLength(0);
  });

  it('says so when there are no runs yet', async () => {
    const { container } = await renderReady();
    await waitFor(() => expect(container.querySelector('[data-e2e-history-empty]')).not.toBeNull());
  });
});

/* ── 8. northwind only ──────────────────────────────────────────────────── */

describe('Live test runs — northwind only', () => {
  it.each(['goniko', 'revtek', 'nasir', 'squad', 'Northwind', 'northwind-2', ''])('renders nothing and calls nothing for %j', async (slug) => {
    currentTenant = { id: `tenant-${slug}`, slug };
    const { container } = render(<E2eLiveRunner pollMs={15} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.innerHTML).toBe('');
    expect(backend.calls).toHaveLength(0);
  });

  it('renders nothing and calls nothing while there is no tenant', async () => {
    currentTenant = null;
    const { container } = render(<E2eLiveRunner pollMs={15} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(container.innerHTML).toBe('');
    expect(backend.calls).toHaveLength(0);
  });
});
