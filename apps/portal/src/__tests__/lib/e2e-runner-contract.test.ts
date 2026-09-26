/**
 * The live runner contract's pure rules (`components/dev/e2e-runner-contract.ts`).
 *
 * The rules that decide what the lead is shown as evidence: a failed check
 * fails a scenario whatever the runner wrote; a "pass" with no checks proves
 * nothing; a run is never shown green over red; a runner or preview that does
 * not say northwind + Stripe test is refused; and the links open the real
 * screens. Every expected value below is written out by hand.
 */
import { describe, expect, it } from 'vitest';
import {
  allScenarioIds,
  buildEvidence,
  describeExpect,
  describeStep,
  engineKeyOf,
  financesHref,
  formatCents,
  groupCatalogue,
  normalizeRun,
  normalizeStep,
  parseOutcome,
  parseRunnerList,
  parseScenarioPreview,
  plannedWrites,
  previewProblems,
  readScenario,
  rentalHref,
  rowVerdict,
  runCounts,
  runTimeline,
  runVerdict,
  runnerSafetyProblem,
  showActual,
  withFullScenario,
  type ExecutedStep,
  type RunnerInfo,
} from '@/components/dev/e2e-runner-contract';

/** A dev_sim_runs row (supabase/migrations/20260926120300_dev_sim_runs.sql). */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  tenant_id: 't',
  scenario_id: 'SB1',
  scenario: {
    id: 'SB1',
    family: 'simple_booking',
    title: 'Pay a booking',
    why: 'w',
    tiers: ['live'],
    fixture: {},
    steps: [{ kind: 'charge_saved_card', amount: { cents: 30000, math: '3 × 100.00 = 300.00' }, note: 'n' }, { kind: 'check', label: 'paid', checks: [] }],
  },
  status: 'passed',
  next_step: 2,
  waiting_for: null,
  fixture: { rental_id: 'r-1', customer_id: 'c-1' },
  pass_count: 1,
  fail_count: 0,
  error: null,
  created_at: '2026-09-26T10:00:00Z',
  finished_at: '2026-09-26T10:00:09Z',
  ...over,
});

/** A dev_sim_run_steps row. */
const step = (index: number, status: string, assertions: unknown[] = [], over: Record<string, unknown> = {}) =>
  normalizeStep({ run_id: 'run-1', step_index: index, kind: 'k', status, assertions, ...over })!;

const ok = { label: 'a', expected: 1, actual: 1, pass: true };
const bad = { label: 'b', expected: 0, actual: 5000, pass: false };

describe('reading the rows', () => {
  it('normalizeRun reads the migration\'s columns, and "errored" as error', () => {
    const r = normalizeRun(row({ status: 'errored', waiting_for: null }))!;
    expect(r).toMatchObject({
      id: 'run-1',
      scenarioId: 'SB1',
      status: 'error',
      nextStep: 2,
      passCount: 1,
      failCount: 0,
      fixture: { rentalId: 'r-1', customerId: 'c-1', rentalNumber: null },
    });
    expect(r.scenario!.title).toBe('Pay a booking');
    expect(r.scenario!.steps.map((x) => x.label)).toEqual(['Charge $300.00 to the saved card (n)', 'Check — paid']);
    expect(normalizeRun(row({ status: 'something-new' }))!.status).toBe('unknown');
    expect(normalizeRun({ status: 'passed' })).toBeNull();
  });

  it('normalizeRun reads waiting_for', () => {
    const r = normalizeRun(row({ status: 'waiting', waiting_for: { stepIndex: 1, ask: 'pay_latest_link', say: 'Pay it.', url: 'https://x' } }))!;
    expect(r.status).toBe('waiting');
    expect(r.waitingFor).toEqual({ stepIndex: 1, ask: 'pay_latest_link', say: 'Pay it.', url: 'https://x' });
  });

  it('normalizeStep: ok is passed; only a literal true passes a check; a refusal keeps its words', () => {
    expect(step(0, 'ok').status).toBe('passed');
    expect(step(0, 'ok', [{ label: 'a', expected: 1, actual: 1, pass: 'yes' }]).assertions[0].pass).toBe(false);
    const refused = step(1, 'refused', [], { response: { error: 'e2e: refused — not northwind' } });
    expect(refused.status).toBe('refused');
    expect(refused.detail).toBe('e2e: refused — not northwind');
    // The catalogue's own names are accepted: expect / observed.
    expect(step(2, 'ok', [{ label: 'c', expect: 2, observed: 2, pass: true }]).assertions[0]).toEqual({ label: 'c', expected: 2, actual: 2, pass: true, math: null });
    // The runner's AssertionResult carries the hand derivation.
    expect(step(3, 'ok', [{ label: 'd', expected: [20000], actual: [20000], pass: true, math: '600.00 / 3 = 200.00' }]).assertions[0].math).toBe('600.00 / 3 = 200.00');
    expect(normalizeStep({ step_index: 'x' })).toBeNull();
  });
});

describe('runVerdict — from the evidence, not the say-so', () => {
  const run = (over: Record<string, unknown> = {}) => normalizeRun(row(over))!;
  const steps = (...xs: ExecutedStep[]) => xs;

  it('passed with every check passing is passed', () => {
    expect(runVerdict(run(), steps(step(-1, 'ok'), step(1, 'ok', [ok])))).toBe('passed');
  });
  it('a failed check fails it, even when the row says passed', () => {
    expect(runVerdict(run(), steps(step(1, 'ok', [ok, bad])))).toBe('failed');
  });
  it('a failed, errored or refused step fails it', () => {
    for (const s of ['failed', 'error', 'refused']) expect(runVerdict(run(), steps(step(1, 'ok', [ok]), step(2, s)))).toBe('failed');
  });
  it('the row\'s own fail_count is a second witness', () => {
    expect(runVerdict(run({ fail_count: 1 }), steps(step(1, 'ok', [ok])))).toBe('failed');
    expect(rowVerdict(run({ fail_count: 1 }))).toBe('failed');
  });
  it('passed with NO checks is unproven — from the steps, and from the row alone', () => {
    expect(runVerdict(run(), steps(step(-1, 'ok'), step(0, 'ok')))).toBe('unproven');
    expect(rowVerdict(run({ pass_count: 0 }))).toBe('unproven');
    expect(rowVerdict(run({ pass_count: 3 }))).toBe('passed');
  });
  it('a run still going reads its own status — unless a check has already failed', () => {
    expect(runVerdict(run({ status: 'running', finished_at: null }), steps(step(-1, 'ok')))).toBe('running');
    expect(runVerdict(run({ status: 'waiting', finished_at: null }), steps())).toBe('waiting');
    expect(runVerdict(run({ status: 'running', finished_at: null }), steps(step(0, 'ok', [bad])))).toBe('failed');
  });
  it('counts come from the step rows', () => {
    expect(runCounts(steps(step(0, 'ok', [ok, ok]), step(1, 'ok', [bad]), step(2, 'refused')))).toEqual({ passed: 2, failed: 1, badSteps: 1 });
  });
});

describe('runTimeline — every step, ran or not', () => {
  const run = (over: Record<string, unknown> = {}) => normalizeRun(row(over))!;
  const view = (t: ReturnType<typeof runTimeline>) => t.map((x) => [x.index, x.status]);

  it('running: done steps, the one going, the ones to come', () => {
    expect(view(runTimeline(run({ status: 'running', next_step: 1, finished_at: null }), [step(-1, 'ok'), step(0, 'ok')], null))).toEqual([
      [-1, 'passed'],
      [0, 'passed'],
      [1, 'running'],
    ]);
  });
  it('waiting: the step waiting_for names, with its link', () => {
    const t = runTimeline(
      run({ status: 'waiting', next_step: 1, finished_at: null, waiting_for: { stepIndex: 1, say: 'Pay it.', url: 'https://x' } }),
      [step(-1, 'ok'), step(0, 'ok')],
      null,
    );
    expect(view(t)).toEqual([
      [-1, 'passed'],
      [0, 'passed'],
      [1, 'waiting'],
    ]);
    expect(t[2].waiting).toMatchObject({ say: 'Pay it.', url: 'https://x' });
  });
  it('finished early: the steps never reached read "skipped", not "pending"', () => {
    expect(view(runTimeline(run({ status: 'failed', next_step: 0 }), [step(-1, 'ok'), step(0, 'refused')], null))).toEqual([
      [-1, 'passed'],
      [0, 'refused'],
      [1, 'skipped'],
    ]);
  });
  it('a step row the scenario does not list is still shown', () => {
    const t = runTimeline(run(), [step(-1, 'ok'), step(0, 'ok'), step(1, 'ok'), step(7, 'ok', [], { label: 'extra' })], null);
    expect(t.map((x) => x.index)).toEqual([-1, 0, 1, 7]);
    expect(t[3].label).toBe('extra');
  });
});

describe('the evidence file', () => {
  it('carries the rows untouched, the verdict, every check and what was expected', () => {
    const r = normalizeRun(row())!;
    const s = [step(-1, 'ok'), step(1, 'ok', [ok])];
    const ev = buildEvidence({ runs: [{ run: r, steps: s }], runner: null, catalogue: [], confirmedPreview: null, now: new Date('2026-09-26T12:00:00Z') });
    expect(ev).toMatchObject({ kind: 'e2e-live-run', writesToDatabase: true, tenant: 'northwind', generatedAt: '2026-09-26T12:00:00.000Z' });
    expect(ev.runs[0]).toMatchObject({ id: 'run-1', verdict: 'passed', counts: { passed: 1, failed: 0, badSteps: 0 }, runnerCounts: { pass: 1, fail: 0 } });
    expect(ev.runs[0].timeline.find((t) => t.index === 1)!.checks).toEqual([{ ...ok, math: null }]);
    expect(ev.runs[0].row).toEqual(row());
    expect(ev.runs[0].stepRows).toHaveLength(2);
  });
});

describe('engine grouping', () => {
  it.each([
    ['simple_booking', 'simple_booking'],
    ['Simple booking', 'simple_booking'],
    ['auto-extend', 'auto_extend'],
    ['Auto extension', 'auto_extend'],
    ['pay as you go', 'payg'],
    ['PAYG', 'payg'],
    ['installment', 'installments'],
    ['payment-plans', 'payment_plans'],
    ['cron', 'cron_safety'],
    ['teleport', null],
    [undefined, null],
  ])('%j → %j', (raw, key) => {
    expect(engineKeyOf(raw)).toBe(key);
  });

  it('keeps all seven groups, an empty one included, and only adds Other when needed', () => {
    const parsed = parseRunnerList({
      ok: true,
      runner: {},
      catalogue: [
        { id: 'C1', family: 'cron_safety', title: 'c', tiers: ['live'] },
        { id: 'S1', family: 'simple_booking', title: 's', tiers: ['live'] },
        { id: 'S1', family: 'simple_booking', title: 'duplicate id is dropped', tiers: ['live'] },
        { id: '', family: 'simple_booking' },
        // Not offered: no tiers at all (fail closed), memory only, and blocked live.
        { id: 'N1', family: 'simple_booking', title: 'says nothing about tiers' },
        { id: 'N2', family: 'payment_plan', title: 'memory only', tiers: ['memory', 'pglite'], references: ['S1'] },
        { id: 'N3', family: 'auto_extend', title: 'blocked', tiers: ['live'], liveBlockedBy: 'no credit path in the clone' },
        { id: 'N4', family: 'payg', title: 'no fixture', tiers: ['live'], fixture: null, steps: [] },
        // The catalogue's catalogueSummary() shape: its own verdict, counts, no steps.
        { id: 'N5', family: 'payg', title: 'summary says no', tiers: ['live'], liveRunnable: false, stepCount: 4, humanSteps: 1 },
        { id: 'N6', family: 'payg', title: 'summary says yes', tiers: ['live'], liveRunnable: true, stepCount: 3, humanSteps: 0 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok === false) return;
    const groups = groupCatalogue(parsed.catalogue);
    expect(groups.map((g) => g.key)).toEqual([
      'simple_booking',
      'extension',
      'auto_extend',
      'payg',
      'installments',
      'payment_plans',
      'cron_safety',
    ]);
    expect(groups.find((g) => g.key === 'simple_booking')!.scenarios.map((x) => x.id)).toEqual(['S1', 'N1']);
    // Run all: live-runnable only, in group order.
    expect(allScenarioIds(parsed.catalogue)).toEqual(['S1', 'N6', 'C1']);
    const n = (id: string) => parsed.catalogue.find((x) => x.id === id)!;
    expect(n('N1').runnableLive).toBe(false);
    expect(n('N2')).toMatchObject({ runnableLive: false, tiers: ['memory', 'pglite'], references: ['S1'] });
    expect(n('N3')).toMatchObject({ runnableLive: false, liveBlockedBy: 'no credit path in the clone' });
    expect(n('N4').runnableLive).toBe(false);
    expect(n('N5')).toMatchObject({ runnableLive: false, stepCount: 4, humanSteps: 1, steps: [], expected: [] });
    expect(n('N6')).toMatchObject({ runnableLive: true, stepCount: 3 });
  });

  it('a catalogue with no scenarios is not a runner this page can use', () => {
    expect(parseRunnerList({ ok: true, scenarios: [] })).toMatchObject({ ok: false });
    expect(parseRunnerList('<html>')).toMatchObject({ ok: false });
    expect(parseRunnerList({ ok: false, error: 'nope' })).toEqual({ ok: false, message: 'nope' });
  });
});

describe('list: what the runner claims, and what the page refuses', () => {
  const LIST = (over: Record<string, unknown> = {}) => ({
    ok: true,
    scenarios: [{ id: 'SB1', family: 'simple_booking', title: 't', why: 'w', tiers: ['live'], liveRunnable: true, stepCount: 4, humanSteps: 0 }],
    environment: { stripeTestKey: { ok: true }, sandboxTenant: { ok: true } },
    quiet: {},
    ...over,
  });

  it("reads index.ts's list: tenant by slug (G2), test mode only from the key check (G3), the checks by name", () => {
    const r = parseRunnerList(LIST());
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.runner.tenantSlug).toBe('northwind');
    expect(r.runner.stripeMode).toBe('test');
    expect(r.runner.checks).toEqual([
      { name: 'Stripe key is a TEST key (G3)', ok: true, message: null },
      { name: 'sandbox clones are locked to northwind (G3)', ok: true, message: null },
    ]);
    expect(r.runner.basis).toHaveLength(2);
    expect(runnerSafetyProblem(r.runner)).toBeNull();
    // The summary shape: no steps, the catalogue's own verdict, counts.
    expect(r.catalogue[0]).toMatchObject({ id: 'SB1', full: false, steps: [], stepCount: 4, runnableLive: true, expected: [] });
  });

  it('a failed check, a missing key check, or an explicit other mode / tenant is refused', () => {
    const refused = (body: unknown) => {
      const r = parseRunnerList(body);
      if (r.ok === false) throw new Error(r.message);
      return runnerSafetyProblem(r.runner);
    };
    expect(refused(LIST({ environment: { stripeTestKey: { ok: false, message: 'sk_live_ key' }, sandboxTenant: { ok: true } } }))).toMatch(
      /Stripe key is a TEST key \(G3\): sk_live_ key/,
    );
    expect(refused(LIST({ environment: { stripeTestKey: { ok: true }, sandboxTenant: { ok: false, message: 'other tenant' } } }))).toMatch(
      /sandbox clones are locked to northwind \(G3\): other tenant/,
    );
    expect(refused(LIST({ environment: undefined }))).toMatch(/did not say which Stripe mode/);
    expect(refused(LIST({ runner: { stripe_mode: 'live' } }))).toMatch(/Stripe mode "live"/);
    expect(refused(LIST({ runner: { tenant_slug: 'revtek' } }))).toMatch(/tenant "revtek"/);
    const info = (stripeMode: string | null, tenantSlug: string | null): RunnerInfo => ({ version: null, stripeMode, tenantSlug, checks: [], basis: [] });
    expect(runnerSafetyProblem(info('TEST', 'northwind'))).not.toBeNull();
    expect(runnerSafetyProblem(info('test', 'northwind'))).toBeNull();
  });
});

describe('preview: the runner checks the guards; the page reads what a run writes from the scenario', () => {
  const FULL = {
    id: 'SB1',
    family: 'simple_booking',
    title: 'Pay a booking',
    why: 'w',
    tiers: ['live'],
    assumes: ['usd'],
    fixture: {
      shape: 'booking',
      card: 'visa',
      charges: [{ category: 'Rental', amount: { cents: 30000, math: '3 × 100.00 = 300.00' }, dueOffsetDays: 0 }],
    },
    steps: [
      { kind: 'charge_saved_card', amount: { cents: 30000, math: 'm' }, note: 'n' },
      { kind: 'advance', domain: 'payg', days: 2 },
      { kind: 'fire', job: 'sandbox-accrue-payg-charges', copies: 2 },
      { kind: 'human', ask: 'pay_latest_link', say: 'Pay it.' },
      { kind: 'check', label: 'c', checks: [] },
    ],
  };
  const answer = (over: Record<string, unknown> = {}) => ({
    ok: true,
    preview: true,
    writes: [],
    scenario: FULL,
    runnable: { ok: true },
    assumptions: { ok: true, failed: [] },
    environment: { stripeTestKey: { ok: true }, sandboxTenant: { ok: true } },
    quiet: {},
    wouldStart: true,
    ...over,
  });

  it('parses index.ts\'s preview answer', () => {
    const p = parseScenarioPreview(answer(), 'SB1')!;
    expect(p).toMatchObject({ scenarioId: 'SB1', assumptionsOk: true, refusedWrites: [], wouldStart: true });
    expect(p.runnable).toEqual({ name: 'the scenario may run live (G4)', ok: true, message: null });
    expect(p.scenario!.full).toBe(true);
    expect(p.scenario!.humanSteps).toBe(1);
    expect(parseScenarioPreview({ ok: false, error: 'x' }, 'SB1')).toBeNull();
  });

  it('previewProblems: every refusal blocks the confirm, in the runner\'s words', () => {
    const problems = (over: Record<string, unknown>) => previewProblems({ items: [parseScenarioPreview(answer(over), 'SB1')!] }, ['SB1']);
    expect(problems({})).toEqual([]);
    expect(problems({ runnable: { ok: false, message: 'amount above $1,000' } })).toEqual(['SB1: the runner will not run it — amount above $1,000.']);
    expect(problems({ assumptions: { ok: false, failed: ['tax_off'] } })).toEqual([
      "SB1: northwind's settings differ from the ones its expected values assume (tax_off).",
    ]);
    expect(problems({ assumptions: null })).toEqual(["SB1: the preview did not check the tenant's settings."]);
    expect(problems({ environment: { stripeTestKey: { ok: false, message: 'live key' }, sandboxTenant: { ok: true } } })).toEqual([
      'SB1: Stripe key is a TEST key (G3) — live key.',
    ]);
    expect(problems({ writes: ['insert rentals'] })).toEqual(['SB1: the preview tried to write (insert rentals) and was stopped — that is a runner fault.']);
    expect(problems({ scenario: null })).toEqual(['SB1: the preview did not include the scenario, so what it would write cannot be shown.']);
    expect(problems({ wouldStart: false })).toEqual(['SB1: the runner says it would not start.']);
    // Missing and extra scenarios.
    expect(previewProblems({ items: [] }, ['SB1'])).toEqual(['The runner gave no preview for SB1.']);
    expect(previewProblems({ items: [parseScenarioPreview(answer(), 'SB1')!] }, [])).toEqual([
      'The preview includes scenarios that were not asked for: SB1.',
    ]);
  });

  it('plannedWrites: the fixture, each writing step, and nothing for checks or a person\'s step', () => {
    const w = plannedWrites(readScenario(FULL)!).map((x) => `${x.where}: ${x.what}`);
    expect(w).toEqual([
      'dev_sim_runs: 1 row for this run (the evidence)',
      'dev_sim_run_steps: 6 rows — the fixture and each step, with every check',
      'customers: 1 fixture customer named E2E-FIXTURE…, at an @e2e.drive247.test address, no phone',
      'Stripe TEST: a customer with the Visa test card (always succeeds) (sandbox-fixture-setup), and a $1.00 hold it places, cancelled at once',
      'rentals: 1 fixture rental, no vehicle, marked as this run\'s fixture and registered in dev_sim_fixtures',
      'ledger_entries: 1 booking charge: Rental $300.00',
      'charge-saved-card: a Stripe TEST charge of $300.00 on the saved card, its payment row and allocation',
      "e2e_shift_fixture: the fixture's payg dates moved 2 day(s) into the past — nothing else's",
      'sandbox-accrue-payg-charges: run for the fixture only (only_rental_id), twice at once — whatever it writes for that rental',
    ]);
  });

  it('withFullScenario keeps the summary\'s refusal', () => {
    const summary = readScenario({ id: 'SB1', family: 'simple_booking', tiers: ['live'], liveRunnable: false, stepCount: 5 })!;
    const full = readScenario(FULL)!;
    expect(full.runnableLive).toBe(true);
    const merged = withFullScenario(summary, full);
    expect(merged.runnableLive).toBe(false);
    expect(merged.steps).toHaveLength(5);
    expect(withFullScenario(summary, null)).toBe(summary);
  });

  it('parseOutcome reads a RunOutcome', () => {
    expect(parseOutcome({ ok: true, runId: 'r', status: 'running', nextStep: 2, deferredSeconds: 40 })).toEqual({
      runId: 'r',
      status: 'running',
      deferredSeconds: 40,
      error: null,
    });
    expect(parseOutcome({ ok: true, runId: 'r', status: 'errored', error: 'x' })).toMatchObject({ status: 'error', error: 'x' });
    expect(parseOutcome(null)).toEqual({ runId: null, status: null, deferredSeconds: null, error: null });
  });
});

describe('links to the real screens', () => {
  it('the rental, and Finances searched by its number over all time — and no Finances link without the number', () => {
    const f = { rentalId: 'abcdef12-3456-4789-8abc-def012345678', rentalNumber: 'R-1042', customerId: null };
    expect(rentalHref(f)).toBe('/rentals/abcdef12-3456-4789-8abc-def012345678');
    expect(financesHref(f, 'billed')).toBe('/finances?view=billed&q=R-1042&period=all');
    expect(financesHref(f, 'received')).toBe('/finances?view=received&q=R-1042&period=all');
    // Every rental gets a number from a trigger; an id-prefix search would never match it, so no link.
    expect(financesHref({ ...f, rentalNumber: null }, 'billed')).toBeNull();
    expect(rentalHref({ rentalId: null, rentalNumber: null, customerId: 'c' })).toBeNull();
  });
});

describe('the catalogue in words', () => {
  it('formatCents: sign, thousands, two places', () => {
    expect(formatCents(30000)).toBe('$300.00');
    expect(formatCents(-30000)).toBe('-$300.00');
    expect(formatCents(123456789)).toBe('$1,234,567.89');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(0)).toBe('$0.00');
  });

  it('describeExpect keeps the hand derivation beside the number', () => {
    expect(describeExpect({ cents: 30000, math: '3 × 100.00 = 300.00' })).toBe('$300.00 (3 × 100.00 = 300.00)');
    expect(describeExpect(['Applied', 'Refunded'])).toBe('Applied, Refunded');
    expect(describeExpect(true)).toBe('true');
    expect(describeExpect(2)).toBe('2');
  });

  it('showActual reads a bare number beside a money expectation as cents', () => {
    expect(showActual({ cents: 50000, math: 'x' }, 50000)).toBe('$500.00');
    expect(showActual(2, 2)).toBe('2');
    expect(showActual('paid', 'paid')).toBe('paid');
    expect(showActual({ cents: 1, math: 'x' }, undefined)).toBe('—');
  });

  it.each([
    [{ kind: 'charge_saved_card', amount: { cents: 30000, math: 'm' }, note: 'n' }, 'Charge $300.00 to the saved card (n)'],
    [{ kind: 'record_payment', amount: { cents: 35000, math: 'm' }, method: 'Cash', note: 'n' }, 'Record a Cash payment of $350.00 (n)'],
    [{ kind: 'refund', category: 'Rental', amount: { cents: 10000, math: 'm' }, refundType: 'partial' }, 'Refund $100.00 of Rental (partial)'],
    [{ kind: 'extend_manually', days: 2, amount: { cents: 20000, math: 'm' } }, 'Extend the rental by 2 days for $200.00'],
    [{ kind: 'pause_auto_extend' }, 'Pause automatic renewal'],
    [{ kind: 'swap_card', card: 'declined' }, 'Swap the customer\'s card for the "declined" test card'],
    [{ kind: 'advance', domain: 'payg', days: 1 }, 'Move the payg clock forward 1 day'],
    [{ kind: 'fire', job: 'sandbox-auto-extend-rentals', copies: 2 }, 'Fire sandbox-auto-extend-rentals for this rental only — twice at the same moment'],
    [{ kind: 'tick_plan', ageAttemptsMinutes: 10 }, 'Run the payment-plan tick for this rental, with in-flight attempts aged 10 min'],
    [{ kind: 'crash_after_charge' }, 'Crash straight after the card is charged, before anything is recorded'],
    [{ kind: 'human', ask: 'pay_latest_link', say: 'Pay it.' }, 'You: Pay it.'],
    [{ kind: 'replay_webhook', event: 'checkout.session.completed' }, 'Deliver the checkout.session.completed event a second time'],
    [{ kind: 'check', label: 'after', checks: [] }, 'Check — after'],
    [{ kind: 'tie_out', label: 'after', expect: {} }, 'Finances tie-out — after'],
    [{ kind: 'new_kind_nobody_wrote_yet' }, 'new_kind_nobody_wrote_yet'],
  ])('describeStep(%j)', (step, words) => {
    expect(describeStep(step)).toBe(words);
  });
});
