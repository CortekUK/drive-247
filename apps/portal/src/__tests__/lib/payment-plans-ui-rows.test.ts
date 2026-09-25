/**
 * Postgres rows → the card's shapes. Money is numeric(12,2) dollars in the
 * database and integer cents everywhere in the UI; this is the one crossing.
 * Column names are the migration's (supabase/migrations/20260925120100_payment_plans.sql).
 */
import { describe, expect, it } from 'vitest';
import { attemptFromRow, eventFromRow, occurrenceFromRow, planFromRow } from '@/lib/payment-plans-ui/rows';

const planRow = {
  id: 'p1', tenant_id: 't', rental_id: 'r', customer_id: 'c', status: 'active',
  freq: 'weekly', interval_count: 1, by_weekday: [5], by_month_day: null, explicit_dates: null,
  anchor_date: '2026-09-30', anchor_source: 'rental_start', first_occurrence: 'on_anchor',
  end_kind: 'rental_end', occurrence_count: null, until_date: '2026-10-28',
  timezone: 'America/New_York', charge_local_time: '10:00:00', amount_mode: 'split_total',
  total_amount: '1400.00', fixed_amount: null, daily_rate: null, currency: 'usd',
  collection_method: 'checkout_link', fallback_to_link: true, max_attempts: 3, retry_after_days: 2,
  reminder_offsets: [-2, 0, 2], payment_provider: 'stripe', stripe_payment_method_id: null,
  extends_rental: false, version: 2, created_at: '2026-09-25T12:00:00Z', paused_at: null, cancelled_at: null, completed_at: null,
};

describe('rows → view shapes', () => {
  it('a plan: rule, amount in cents, "until the rental ends" follows the rental\'s own end date', () => {
    const p = planFromRow(planRow, '2026-11-04');
    expect(p.rule).toEqual({
      freq: 'weekly', interval: 1, byWeekday: [5], anchor: '2026-09-30', firstOccurrence: 'on_anchor',
      end: { kind: 'rental_end', rentalEnd: '2026-11-04' },
    });
    expect(p.amount).toEqual({ mode: 'split_total', totalCents: 140000 });
    expect(p.chargeLocalTime).toBe('10:00');
    expect(p.version).toBe(2);
    expect(planFromRow(planRow, null).rule.end).toEqual({ kind: 'rental_end', rentalEnd: '2026-10-28' });
  });

  it('count / until / fixed / monthly shapes', () => {
    const p = planFromRow({ ...planRow, freq: 'monthly', by_weekday: null, by_month_day: -1, end_kind: 'count', occurrence_count: 3, amount_mode: 'fixed', total_amount: null, fixed_amount: 450.5 }, null);
    expect(p.rule).toMatchObject({ freq: 'monthly', byMonthDay: -1, end: { kind: 'count', count: 3 } });
    expect(p.rule.byWeekday).toBeUndefined();
    expect(p.amount).toEqual({ mode: 'fixed', amountCents: 45050 });
    const d = planFromRow({ ...planRow, freq: 'dates', by_weekday: null, explicit_dates: ['2026-10-01', '2026-10-10'], end_kind: 'until', until_date: '2026-10-10' }, null);
    expect(d.rule).toMatchObject({ freq: 'dates', dates: ['2026-10-01', '2026-10-10'], end: { kind: 'until', until: '2026-10-10' } });
  });

  it('an occurrence and an attempt: numeric dollars → cents, dates trimmed to the day', () => {
    const o = occurrenceFromRow({
      id: 'o1', plan_id: 'p1', tenant_id: 't', rental_id: 'r', seq: 1, plan_version: 1, due_date: '2026-10-02',
      due_at: '2026-10-02T14:00:00+00:00', period_start: '2026-09-30', period_end: '2026-10-09', amount: '166.70',
      amount_paid: '50.00', collection_method: 'auto_charge', status: 'partially_paid', attempt_no: 1,
      next_attempt_at: null, moved_from: '2026-10-01', note: null, paid_at: null,
    });
    expect(o).toMatchObject({ amountCents: 16670, amountPaidCents: 5000, dueDate: '2026-10-02', movedFrom: '2026-10-01' });
    const a = attemptFromRow({
      id: 'a1', occurrence_id: 'o1', attempt_no: 1, method: 'auto_charge', idempotency_key: 'pp:acct_1:o1:1', status: 'failed',
      provider: 'stripe', provider_account: 'acct_1', provider_mode: 'live', provider_ref: 'pi_1', checkout_session_id: null,
      payment_id: null, amount: '200.00', decline_code: 'insufficient_funds', error_code: 'card_declined', error_message: 'x',
      created_at: '2026-10-02T14:00:05Z', finished_at: '2026-10-02T14:00:06Z',
    });
    expect(a).toMatchObject({ amountCents: 20000, providerMode: 'live', declineCode: 'insufficient_funds', createdAt: '2026-10-02T14:00:05Z' });
    expect(eventFromRow({ id: 'e1', plan_id: 'p1', occurrence_id: null, kind: 'plan_created', amount: null, detail: null, created_at: 'x' })).toMatchObject({
      amountCents: null,
      detail: {},
    });
  });
});
