/**
 * "Keeps renewing until stopped" — the plan form's renewal answers, as data.
 *
 * Every date literal below was worked out by hand from a calendar, not read
 * back from the code under test:
 *
 *   2026-10-09 is a Friday. +7 → 16 Oct, +14 → 23 Oct, +21 → 30 Oct,
 *   +28 → 6 Nov, +42 → 20 Nov.
 *   Monthly from 31 Jan 2027: Feb has 28 days → 28 Feb, then back to the 31st
 *   → 31 Mar, April has 30 → 30 Apr (design D4, golden row G6).
 *   Every 10 days from 9 Oct: 19 Oct, 29 Oct.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultPlanForm,
  describeChanges,
  describePlan,
  draftToPlanForm,
  formToPlan,
  planToForm,
  type PlanContext,
  type PlanDraft,
  type PlanFormState,
} from '@/lib/payment-plans-ui/plan-form-model';
import { computePreview } from '@/lib/payment-plans-ui/preview';
import {
  endAfterPeriods,
  formatPeriodSpan,
  insurableWindow,
  periodsUntil,
  renewalBoundaries,
  unitFromPeriodType,
} from '@/lib/payment-plans-ui/renewal';
import { occurrenceFromRow, renewalFromRow } from '@/lib/payment-plans-ui/rows';
import { nextOpenAfter, occurrenceActions, planActions } from '@/lib/payment-plans-ui/plan-math';
import type { OccurrenceView } from '@/lib/payment-plans-ui/view-types';

const TYPE_WORDS = /pay[\s-]*as[\s-]*you[\s-]*go|payg|instal|auto[\s-]*extend/i;

const ctx: PlanContext = {
  rentalStart: '2026-10-02',
  rentalEnd: '2026-10-09',
  balanceCents: 0,
  renewal: { bonzahSellable: true, rentalCoverage: { cdw: true, rcli: true }, defaultUnit: 'week' },
};
const renewing = (over: Partial<PlanFormState> = {}, c: PlanContext = ctx): PlanFormState => ({
  ...defaultPlanForm(c),
  endBy: 'renewing',
  ...over,
});
const draft = (s: PlanFormState, c: PlanContext = ctx): PlanDraft => {
  const r = formToPlan(s, c);
  if (r.ok === false) throw new Error(`${r.field}: ${r.message}`);
  return r.plan;
};

describe('renewal boundaries come from the engine (hand-derived)', () => {
  it('weekly, monthly with a month-end, and every N days', () => {
    expect(renewalBoundaries('2026-10-09', 'week', 1, 3)).toEqual(['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
    expect(renewalBoundaries('2026-10-09', 'week', 2, 2)).toEqual(['2026-10-09', '2026-10-23', '2026-11-06']);
    expect(renewalBoundaries('2027-01-31', 'month', 1, 3)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    expect(renewalBoundaries('2026-10-09', 'day', 10, 2)).toEqual(['2026-10-09', '2026-10-19', '2026-10-29']);
    expect(endAfterPeriods('2026-10-09', 'week', 1, 3)).toBe('2026-10-30');
  });

  it('"until a date" becomes the fewest whole periods reaching it', () => {
    expect(periodsUntil('2026-10-09', '2026-10-16', 'week', 1)).toEqual({ periods: 1, newEnd: '2026-10-16' });
    expect(periodsUntil('2026-10-09', '2026-10-20', 'week', 1)).toEqual({ periods: 2, newEnd: '2026-10-23' });
    expect(periodsUntil('2026-10-09', '2026-10-09', 'week', 1)).toBeNull();
    expect(periodsUntil('2026-10-09', '2026-10-01', 'week', 1)).toBeNull();
    expect(periodsUntil('2026-10-09', '2027-12-31', 'week', 1, 4)).toBeNull();
  });

  it('what Bonzah can cover of the new days — never before its earliest start', () => {
    expect(insurableWindow('2026-10-09', '2026-10-16', '2026-10-11')).toEqual({ kind: 'part', start: '2026-10-11', uncoveredDays: 2 });
    expect(insurableWindow('2026-10-09', '2026-10-16', '2026-10-05')).toEqual({ kind: 'all', start: '2026-10-09', uncoveredDays: 0 });
    expect(insurableWindow('2026-10-09', '2026-10-16', '2026-10-16').kind).toBe('none');
  });

  it('reads a period the way the rental does: old return date → new one', () => {
    expect(formatPeriodSpan('2026-10-02', '2026-10-09')).toBe('2 Oct → 9 Oct');
    expect(formatPeriodSpan('2026-12-28', '2027-01-04')).toBe('28 Dec 2026 → 4 Jan 2027');
    expect(unitFromPeriodType('Monthly')).toBe('month');
    expect(unitFromPeriodType('Daily')).toBe('day');
    expect(unitFromPeriodType('Weekly')).toBe('week');
  });
});

describe('the renewal answers → the pinned contract', () => {
  it('renews from the return date, every N units, with the rental\'s cover and the agreement choice', () => {
    const d = draft(renewing({ renewEvery: 2, renewUnit: 'week', renewInsurance: 'rental', renewAgreement: true, method: 'auto_charge' }));
    expect(d.renewal).toEqual({
      extendsRental: true,
      periodUnit: 'week',
      periodCount: 2,
      insurance: { cdw: true, rcli: true },
      sendAgreementEachPeriod: true,
    });
    // Anchored where the rental ends (Fri 9 Oct), on its weekday, every 2 weeks.
    expect(d.rule).toMatchObject({ freq: 'weekly', interval: 2, byWeekday: [5], anchor: '2026-10-09', firstOccurrence: 'on_anchor' });
    // Open-ended; `through` is only how far the preview materialises (4 periods).
    expect(d.rule.end).toEqual({ kind: 'open', through: '2026-11-20' });
    expect(d.overrides).toEqual([]);
  });

  it('always renews from the return date — a start date left over from another answer is ignored, as the server ignores it', () => {
    const d = draft(renewing({ startFrom: 'date', startDate: '2026-10-12' }));
    expect(d.rule.anchor).toBe('2026-10-09');
    expect(d.rule.byWeekday).toEqual([5]);
  });

  it('the agreement is off and the cover follows the rental by default', () => {
    const d = draft(renewing());
    expect(d.renewal!.sendAgreementEachPeriod).toBe(false);
    expect(d.renewal!.insurance).toEqual({ cdw: true, rcli: true });
    expect(d.renewal!.periodUnit).toBe('week');
  });

  it('no insurance is sent when the tenant does not sell Bonzah, whatever the state says', () => {
    const noBonzah: PlanContext = { ...ctx, renewal: { bonzahSellable: false, rentalCoverage: { cdw: true } } };
    expect(draft(renewing({ renewInsurance: 'rental' }, noBonzah), noBonzah).renewal!.insurance).toBeNull();
    expect(draft(renewing({ renewInsurance: 'none' })).renewal!.insurance).toBeNull();
    const noCover: PlanContext = { ...ctx, renewal: { bonzahSellable: true, rentalCoverage: null } };
    expect(defaultPlanForm(noCover).renewInsurance).toBe('none');
  });

  it('is refused where it is not offered, or with nothing to renew from', () => {
    const { renewal: _r, ...plain } = ctx;
    expect(formToPlan(renewing({}, plain), plain)).toMatchObject({ ok: false, field: 'endBy' });
    const noEnd: PlanContext = { ...ctx, rentalEnd: null };
    expect(formToPlan(renewing({}, noEnd), noEnd)).toMatchObject({ ok: false, field: 'endBy' });
    expect(formToPlan(renewing({ renewEvery: 0 }), ctx)).toMatchObject({ ok: false, field: 'renewEvery' });
    expect(formToPlan(renewing({ renewEvery: 13, renewUnit: 'month' }), ctx)).toMatchObject({ ok: false, field: 'renewEvery' });
  });

  it('the request body carries NO amount — the server prices every period', () => {
    const body = draftToPlanForm(draft(renewing({ renewUnit: 'month' })));
    expect(body.amountMode).toBe('per_period');
    expect(body.dailyRateCents).toBeNull();
    expect(body.fixedAmountCents).toBeNull();
    expect(body.end).toMatchObject({ kind: 'open' });
    expect(body.renewal).toMatchObject({ extendsRental: true, periodUnit: 'month', periodCount: 1 });
    expect('overrides' in body).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/totalCents|amountCents"?:\s*[1-9]/);
  });

  it('a plan that does not renew sends no renewal at all', () => {
    const s = { ...defaultPlanForm({ ...ctx, balanceCents: 60000 }), endBy: 'rental_end' as const };
    const d = draft(s, { ...ctx, rentalEnd: '2026-10-30', balanceCents: 60000 });
    expect(d.renewal).toBeUndefined();
    expect('renewal' in draftToPlanForm(d)).toBe(false);
  });
});

describe('planToForm ⇄ formToPlan round-trips every renewal answer', () => {
  const states: PlanFormState[] = [
    renewing(),
    renewing({ renewEvery: 2, renewUnit: 'week', renewAgreement: true, method: 'auto_charge' }),
    renewing({ renewEvery: 1, renewUnit: 'month', renewInsurance: 'none', reminders: [0] }),
    renewing({ renewEvery: 10, renewUnit: 'day', method: 'manual', reminders: [] }),
  ];
  it.each(states.map((s, i) => [i, s] as const))('state %i', (_i, s) => {
    const first = draft(s);
    const back = planToForm(
      { rule: first.rule, amount: first.amount, collectionMethod: first.collectionMethod, reminderOffsets: first.reminderOffsets, renewal: first.renewal },
      ctx,
    );
    expect(back.endBy).toBe('renewing');
    expect(draft(back)).toEqual(first);
  });
});

describe('the preview and the words', () => {
  it('lists the first four periods with what each covers and no amount', () => {
    const p = computePreview(renewing(), ctx, '2026-10-01');
    expect(p.ok).toBe(true);
    if (p.ok === false) return;
    expect(p.renewal).not.toBeNull();
    expect(p.totalCents).toBe(0);
    expect(p.differenceCents).toBe(0);
    expect(p.drafts.map((d) => [d.dueDate, d.periodStart, d.periodEnd])).toEqual([
      ['2026-10-09', '2026-10-09', '2026-10-16'],
      ['2026-10-16', '2026-10-16', '2026-10-23'],
      ['2026-10-23', '2026-10-23', '2026-10-30'],
      ['2026-10-30', '2026-10-30', '2026-11-06'],
    ]);
  });

  it('says what the plan does in plain words and never names a plan type', () => {
    const d = draft(renewing({ renewEvery: 2, renewAgreement: true }));
    const text = describePlan({ ...d }, 'usd');
    expect(text).toMatch(/^Keeps renewing every 2 weeks from Fri 9 Oct, each period priced when it starts/);
    expect(text).toMatch(/extension agreement is sent each period/);
    expect(text).not.toMatch(TYPE_WORDS);
  });

  it('an edit says what changes about the renewal', () => {
    const a = draft(renewing());
    const b = draft(renewing({ renewEvery: 2, renewInsurance: 'none', renewAgreement: true }));
    const lines = describeChanges(a, b, 'usd');
    expect(lines).toContain('Ends: keeps renewing every week → keeps renewing every 2 weeks');
    expect(lines.some((l) => l.startsWith('Insurance on renewals:'))).toBe(true);
    expect(lines).toContain('Extension agreement each period: no → yes');
    expect(describeChanges(a, a, 'usd')).toEqual([]);
  });
});

describe('rows', () => {
  it('a renewing plan is read from extends_rental, falling back to the rule for its period', () => {
    expect(renewalFromRow({ extends_rental: false, freq: 'weekly', interval_count: 1 })).toBeNull();
    expect(renewalFromRow({ extends_rental: true, freq: 'weekly', interval_count: 2 })).toEqual({
      extendsRental: true, periodUnit: 'week', periodCount: 2, insurance: null, sendAgreementEachPeriod: false,
    });
    expect(
      renewalFromRow({
        extends_rental: true, freq: 'monthly', interval_count: 1,
        renewal: { periodUnit: 'month', periodCount: 1, insurance: { cdw: true, sli: false }, sendAgreementEachPeriod: true },
      }),
    ).toEqual({ extendsRental: true, periodUnit: 'month', periodCount: 1, insurance: { cdw: true }, sendAgreementEachPeriod: true });
  });

  it('an occurrence carries the extension its period created', () => {
    const o = occurrenceFromRow({ id: 'o1', plan_id: 'p', tenant_id: 't', rental_id: 'r', seq: 1, due_date: '2026-10-09', amount: 350, amount_paid: 0, status: 'scheduled', extension_id: 'ext-1' });
    expect(o.extensionId).toBe('ext-1');
    expect(occurrenceFromRow({ id: 'o2', due_date: '2026-10-09', amount: 1, status: 'scheduled' }).extensionId).toBeNull();
  });
});

describe('what the store refuses on a renewing plan, said before the click', () => {
  const o = (seq: number, renews: boolean): OccurrenceView => ({
    id: `o${seq}`, planId: 'p1', tenantId: 't', rentalId: 'r', seq, planVersion: 1, dueDate: `2026-10-${String(8 + seq).padStart(2, '0')}`,
    dueAt: '', periodStart: null, periodEnd: null, amountCents: 1000, amountPaidCents: 0, collectionMethod: 'manual',
    status: 'scheduled', attemptNo: 0, nextAttemptAt: null, renews,
  });

  it('a renewal period cannot be skipped, and a skipped amount never rolls into one', () => {
    const rows = [o(1, false), o(2, true)];
    const skip = occurrenceActions(rows[1], { plan: { status: 'active' }, occurrences: rows, today: '2026-10-01' }).skip;
    expect(skip.enabled).toBe(false);
    expect(skip.reason).toMatch(/renewal period/);
    expect(nextOpenAfter(rows[0], rows)).toBeNull();
  });

  it('a renewing plan cannot be edited — Extend adds days, Cancel stops it', () => {
    const renewal = { periodUnit: 'week' as const, periodCount: 1, insurance: null, sendAgreementEachPeriod: false };
    const a = planActions({ status: 'active', renewal }, []);
    expect(a.edit.enabled).toBe(false);
    expect(a.edit.reason).toMatch(/Extend/);
    expect(a.cancel.enabled).toBe(true);
    expect(planActions({ status: 'active' }, []).edit.enabled).toBe(true);
  });
});
