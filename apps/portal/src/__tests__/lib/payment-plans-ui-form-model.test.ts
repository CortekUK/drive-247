/**
 * The one form as data: sentence ⇄ ScheduleRule + AmountSpec + method +
 * reminders, and the live preview through the ENGINE's own generator.
 *
 * Schedule expectations are the design's golden rows (docs/PAYMENT_PLANS_DESIGN.md
 * §3.1), which were derived by hand and cross-checked with Python's calendar —
 * not read back from any implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_CHOICES,
  METHOD_CHOICES,
  RHYTHM_CHOICES,
  RULE_ERROR_TEXT,
  defaultPlanForm,
  describeChanges,
  draftToPlanForm,
  formToPlan,
  planToForm,
  selectRhythm,
  toggleWeekday,
  updateForm,
  type PlanContext,
  type PlanFormState,
} from '@/lib/payment-plans-ui/plan-form-model';
import { computePreview } from '@/lib/payment-plans-ui/preview';
import { planFormToRowAndSchedule } from '@/lib/payment-plans/engine';

const ctx: PlanContext = { rentalStart: '2026-09-30', rentalEnd: '2026-10-28', balanceCents: 140000 };
const base = (over: Partial<PlanFormState> = {}): PlanFormState => ({ ...defaultPlanForm(ctx), ...over });
const TODAY = '2026-09-01';

const draft = (s: PlanFormState, c: PlanContext = ctx) => {
  const r = formToPlan(s, c);
  if (r.ok === false) throw new Error(`${r.field}: ${r.message}`);
  return r.plan;
};

describe('the sentence never names a plan type', () => {
  it('no label or hint mentions pay-as-you-go or installments', () => {
    const words = [...AMOUNT_CHOICES, ...RHYTHM_CHOICES, ...METHOD_CHOICES].flatMap((c) => [c.label, 'hint' in c ? c.hint : '']);
    for (const w of [...words, ...Object.values(RULE_ERROR_TEXT)]) expect(w).not.toMatch(/pay[\s-]*as[\s-]*you[\s-]*go|payg|instal/i);
  });

  it('offers exactly the rhythms the design lists', () => {
    expect(RHYTHM_CHOICES.map((r) => r.id)).toEqual(['weekly', 'every_2_weeks', 'twice_a_week', 'monthly', 'every_n', 'pick_dates']);
    expect(METHOD_CHOICES.map((m) => m.id)).toEqual(['auto_charge', 'checkout_link', 'manual']);
  });
});

describe('defaults', () => {
  it('weekly on the rental start\'s weekday, spread evenly, until the rental ends, reminders −2/0/+2', () => {
    const s = defaultPlanForm(ctx);
    expect(s).toMatchObject({ rhythm: 'weekly', weekdays: [3], amount: 'split_total', endBy: 'rental_end', reminders: [-2, 0, 2], startFrom: 'rental_start' });
  });

  it('an open-ended rental defaults to a number of payments', () => {
    expect(defaultPlanForm({ ...ctx, rentalEnd: null }).endBy).toBe('count');
  });
});

describe('formToPlan', () => {
  it('weekly on Friday from a Wednesday start, until the rental ends (G1c)', () => {
    const d = draft(base({ weekdays: [5] }));
    expect(d.rule).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [5],
      anchor: '2026-09-30',
      firstOccurrence: 'on_anchor',
      end: { kind: 'rental_end', rentalEnd: '2026-10-28' },
    });
    expect(d.amount).toEqual({ mode: 'split_total', totalCents: 140000 });
    expect(d.collectionMethod).toBe('checkout_link');
    expect(d.reminderOffsets).toEqual([-2, 0, 2]);
  });

  it('every 2 weeks, twice a week, monthly, every N days/weeks/months, picked dates', () => {
    expect(draft(base({ rhythm: 'every_2_weeks', weekdays: [1] })).rule).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [1] });
    expect(draft(base({ rhythm: 'twice_a_week', weekdays: [4, 1] })).rule).toMatchObject({ freq: 'weekly', interval: 1, byWeekday: [1, 4] });
    expect(draft(base({ rhythm: 'monthly', monthDay: 31 })).rule).toMatchObject({ freq: 'monthly', interval: 1, byMonthDay: 31 });
    expect(draft(base({ rhythm: 'every_n', every: 3, everyUnit: 'days' })).rule).toMatchObject({ freq: 'daily', interval: 3 });
    expect(draft(base({ rhythm: 'every_n', every: 3, everyUnit: 'weeks', weekdays: [4] })).rule).toMatchObject({ freq: 'weekly', interval: 3, byWeekday: [4] });
    expect(draft(base({ rhythm: 'every_n', every: 2, everyUnit: 'months', monthDay: -1 })).rule).toMatchObject({ freq: 'monthly', interval: 2, byMonthDay: -1 });
    const picked = draft(base({ rhythm: 'pick_dates', dates: ['2026-10-20', '2026-10-01', '2026-10-10', '2026-10-10'] }));
    expect(picked.rule).toMatchObject({ freq: 'dates', dates: ['2026-10-01', '2026-10-10', '2026-10-20'], end: { kind: 'rental_end' } });
  });

  it('twice a week asks for exactly two weekdays', () => {
    const r = formToPlan(base({ rhythm: 'twice_a_week', weekdays: [1] }), ctx);
    expect(r).toMatchObject({ ok: false, field: 'weekdays' });
  });

  it('refuses what the engine would refuse, on the line it belongs to', () => {
    expect(formToPlan(base({ amount: 'fixed', fixedAmount: '' }), ctx)).toMatchObject({ ok: false, field: 'fixedAmount' });
    expect(formToPlan(base(), { ...ctx, balanceCents: 0 })).toMatchObject({ ok: false, field: 'amount' });
    expect(formToPlan(base({ endBy: 'rental_end' }), { ...ctx, rentalEnd: null })).toMatchObject({ ok: false, field: 'endBy' });
    expect(formToPlan(base({ endBy: 'count', count: 0 }), ctx)).toMatchObject({ ok: false, field: 'count' });
    expect(formToPlan(base({ endBy: 'until', until: '2026-09-01' }), ctx)).toMatchObject({ ok: false, field: 'until' });
    expect(formToPlan(base({ rhythm: 'pick_dates', dates: ['2026-09-01'] }), ctx)).toMatchObject({ ok: false, field: 'dates' });
    expect(formToPlan(base({ rhythm: 'pick_dates', dates: ['2026-10-28'] }), ctx)).toMatchObject({ ok: false, field: 'dates' });
    expect(formToPlan(base({ rhythm: 'every_n', every: 53, everyUnit: 'days' }), ctx)).toMatchObject({ ok: false, field: 'every' });
    expect(formToPlan(base({ startFrom: 'date', startDate: null }), ctx)).toMatchObject({ ok: false, field: 'startDate' });
  });

  it('a fixed amount is parsed from what was typed', () => {
    expect(draft(base({ amount: 'fixed', fixedAmount: '300' })).amount).toEqual({ mode: 'fixed', amountCents: 30000 });
  });
});

describe('planToForm ⇄ formToPlan round-trips every rule the form can make', () => {
  const states: PlanFormState[] = [
    base({ weekdays: [5] }),
    base({ weekdays: [5], firstPaymentOnStart: false, method: 'auto_charge' }),
    base({ rhythm: 'every_2_weeks', weekdays: [1], endBy: 'count', count: 4 }),
    base({ rhythm: 'twice_a_week', weekdays: [1, 4], endBy: 'until', until: '2026-10-20', reminders: [0] }),
    base({ rhythm: 'monthly', monthDay: -1, amount: 'fixed', fixedAmount: '450.00', endBy: 'count', count: 3 }),
    base({ rhythm: 'every_n', every: 3, everyUnit: 'days', amount: 'split_by_days', method: 'manual', reminders: [] }),
    base({ rhythm: 'every_n', every: 3, everyUnit: 'weeks', weekdays: [2, 7], endBy: 'count', count: 5 }),
    base({ rhythm: 'every_n', every: 2, everyUnit: 'months', monthDay: 15, endBy: 'count', count: 2 }),
    base({ rhythm: 'pick_dates', dates: ['2026-10-01', '2026-10-15'] }),
    base({ startFrom: 'date', startDate: '2026-10-05', weekdays: [1] }),
  ];
  it.each(states.map((s, i) => [i, s] as const))('state %i', (_i, s) => {
    const first = draft(s);
    const back = planToForm(
      { rule: first.rule, amount: first.amount, collectionMethod: first.collectionMethod, reminderOffsets: first.reminderOffsets },
      ctx,
    );
    const again = draft(back);
    expect({ ...again, overrides: [] }).toEqual({ ...first, overrides: [] });
  });
});

describe('editing helpers', () => {
  it('twice a week keeps the picked weekday and adds a second', () => {
    const s = selectRhythm(base({ weekdays: [5] }), 'twice_a_week', ctx);
    expect(s.weekdays).toHaveLength(2);
    expect(s.weekdays).toContain(5);
  });

  it('a third weekday tap on twice-a-week replaces the older pick', () => {
    const s = toggleWeekday(base({ rhythm: 'twice_a_week', weekdays: [1, 4] }), 6);
    expect(s.weekdays).toEqual([4, 6]);
  });

  it('changing the rhythm drops dates moved in the preview; changing the method does not', () => {
    const moved = base({ overrides: [{ seq: 2, moveTo: '2026-10-05' }] });
    expect(updateForm(moved, { method: 'manual' }).overrides).toHaveLength(1);
    expect(updateForm(moved, { weekdays: [1] }).overrides).toEqual([]);
  });

  it('says exactly what an edit changes, and nothing when nothing does', () => {
    const before = draft(base({ weekdays: [5] }));
    const after = draft(base({ rhythm: 'every_2_weeks', weekdays: [5], method: 'auto_charge' }));
    const lines = describeChanges(before, after, 'usd');
    expect(lines.some((l) => l.startsWith('How often:'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Collected by:'))).toBe(true);
    expect(describeChanges(before, before, 'usd')).toEqual([]);
  });
});

describe('the live preview runs the engine (golden rows, design §3.1)', () => {
  const dates = (s: PlanFormState, c: PlanContext = ctx) => {
    const p = computePreview(s, c, TODAY);
    if (p.ok === false) throw new Error(p.message);
    return p.drafts.map((d) => [d.dueDate, d.amountCents]);
  };

  it('G1c — weekly Friday from Wed 30 Sep, until 28 Oct, $1,400 spread evenly: a stub then four Fridays, 5 × $280', () => {
    expect(dates(base({ weekdays: [5] }))).toEqual([
      ['2026-09-30', 28000],
      ['2026-10-02', 28000],
      ['2026-10-09', 28000],
      ['2026-10-16', 28000],
      ['2026-10-23', 28000],
    ]);
  });

  it('G1d — the same, by days covered: 2, 7, 7, 7, 5 days', () => {
    expect(dates(base({ weekdays: [5], amount: 'split_by_days' })).map(([, a]) => a)).toEqual([10000, 35000, 35000, 35000, 25000]);
  });

  it('G5 — twice a week Mon + Thu, on the rhythm, 6 payments of $1,000: 5 × $166.66 + $166.70', () => {
    expect(
      dates(base({ rhythm: 'twice_a_week', weekdays: [1, 4], firstPaymentOnStart: false, endBy: 'count', count: 6 }), { ...ctx, balanceCents: 100000 }),
    ).toEqual([
      ['2026-10-01', 16666],
      ['2026-10-05', 16666],
      ['2026-10-08', 16666],
      ['2026-10-12', 16666],
      ['2026-10-15', 16666],
      ['2026-10-19', 16670],
    ]);
  });

  it('G2 — every 3 days from 30 Sep, 5 payments of $1,000 → $200 each', () => {
    expect(dates(base({ rhythm: 'every_n', every: 3, everyUnit: 'days', endBy: 'count', count: 5 }), { ...ctx, balanceCents: 100000 })).toEqual([
      ['2026-09-30', 20000],
      ['2026-10-03', 20000],
      ['2026-10-06', 20000],
      ['2026-10-09', 20000],
      ['2026-10-12', 20000],
    ]);
  });

  it('G6 — monthly on the 31st clamps and returns', () => {
    const c: PlanContext = { rentalStart: '2027-01-31', rentalEnd: null, balanceCents: 0 };
    const s: PlanFormState = { ...defaultPlanForm(c), rhythm: 'monthly', monthDay: 31, amount: 'fixed', fixedAmount: '10', endBy: 'count', count: 5 };
    expect(dates(s, c).map(([d]) => d)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('flags a total that differs from the balance, and payments already due', () => {
    const p = computePreview(base({ weekdays: [5], amount: 'fixed', fixedAmount: '300' }), ctx, '2026-10-02');
    expect(p.ok).toBe(true);
    if (p.ok === false) return;
    expect(p.totalCents).toBe(150000); // 5 × $300, hand-counted
    expect(p.differenceCents).toBe(10000);
    expect(p.dueNowCount).toBe(2); // 30 Sep and 2 Oct
  });

  it('maps the engine\'s own rule errors to plain English on the right line', () => {
    const p = computePreview(base({ endBy: 'until', until: '2026-09-30', weekdays: [5], firstPaymentOnStart: false }), ctx, TODAY);
    expect(p).toMatchObject({ ok: false, field: 'endBy' });
  });
});

describe('the request body is the engine\'s PlanForm — and the server schedule equals the preview', () => {
  const serverCtx = {
    tenantId: 't',
    rentalId: 'r',
    customerId: 'c',
    rentalEnd: ctx.rentalEnd,
    timezone: 'America/New_York',
    currency: 'usd',
    paymentProvider: 'stripe' as const,
    owedCents: ctx.balanceCents,
  };

  it('a split plan sends NO total; a fixed plan sends its price', () => {
    const split = draftToPlanForm(draft(base({ weekdays: [5] })));
    expect(split).toMatchObject({ amountMode: 'split_total', fixedAmountCents: null, end: { kind: 'rental_end' } });
    expect(JSON.stringify(split)).not.toContain('140000');
    expect(draftToPlanForm(draft(base({ amount: 'fixed', fixedAmount: '300' })))).toMatchObject({ amountMode: 'fixed', fixedAmountCents: 30000 });
  });

  it.each([
    ['weekly', base({ weekdays: [5] })],
    ['by days', base({ weekdays: [5], amount: 'split_by_days' })],
    ['twice a week', base({ rhythm: 'twice_a_week', weekdays: [1, 4] })],
    ['every 3 days', base({ rhythm: 'every_n', every: 3, everyUnit: 'days' })],
    ['picked', base({ rhythm: 'pick_dates', dates: ['2026-10-01', '2026-10-10'] })],
    ['moved', base({ weekdays: [5], overrides: [{ seq: 3, moveTo: '2026-10-12' }] })],
  ])('%s', (_n, s) => {
    const preview = computePreview(s, ctx, TODAY);
    if (preview.ok === false) throw new Error(preview.message);
    const server = planFormToRowAndSchedule(draftToPlanForm(preview.plan), serverCtx);
    expect(server.occurrences).toEqual(preview.drafts);
  });
});
