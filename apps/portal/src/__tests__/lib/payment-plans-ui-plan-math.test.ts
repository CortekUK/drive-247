/**
 * The plan card's words and figures, from rows. Every expected sum below is
 * added up by hand from the fixture rows — the test never asks the code what
 * the answer is.
 */
import { describe, expect, it } from 'vitest';
import type { OccurrenceStatus } from '@/lib/payment-plans/types';
import {
  eventSentence,
  explainMath,
  isMissed,
  nextOpenAfter,
  occurrenceActions,
  planActions,
  planMath,
  recoveries,
  type OccurrenceAction,
} from '@/lib/payment-plans-ui/plan-math';
import type { AttemptView, OccurrenceView } from '@/lib/payment-plans-ui/view-types';

let n = 0;
const occ = (seq: number, dueDate: string, amount: number, paid: number, status: OccurrenceStatus, over: Partial<OccurrenceView> = {}): OccurrenceView => ({
  id: `o${seq}`,
  planId: 'p1',
  tenantId: 't',
  rentalId: 'r',
  seq,
  planVersion: 1,
  dueDate,
  dueAt: `${dueDate}T14:00:00.000Z`,
  periodStart: dueDate,
  periodEnd: dueDate,
  amountCents: amount,
  amountPaidCents: paid,
  collectionMethod: 'auto_charge',
  status,
  attemptNo: 0,
  nextAttemptAt: null,
  ...over,
});

const ROWS: OccurrenceView[] = [
  occ(1, '2026-10-02', 20000, 20000, 'paid'),
  occ(2, '2026-10-09', 20000, 0, 'failed'),
  occ(3, '2026-10-16', 20000, 5000, 'partially_paid'),
  occ(4, '2026-10-23', 20000, 0, 'scheduled'),
  occ(5, '2026-10-30', 20000, 0, 'superseded'),
  occ(6, '2026-10-05', 10000, 0, 'skipped'),
];
const active = { status: 'active' as const };
const TODAY = '2026-10-12';

describe('the math line', () => {
  it('every figure is a sum over the rows', () => {
    const m = planMath(ROWS);
    // Charged — asked for: #1 200 + #2 200 + #3 200.
    expect(m.chargedCents).toBe(60000);
    // Paid — #1 200 + #3 50.
    expect(m.paidCents).toBe(25000);
    // Failed — what #2 still owes.
    expect(m.failedCents).toBe(20000);
    // Remaining — #2 200 + #3 150 + #4 200. Skipped and replaced rows owe nothing.
    expect(m.remainingCents).toBe(55000);
    expect(m.totalCents).toBe(80000);
    expect(m.openCount).toBe(3);
    // Next — the earliest open payment, #2 on 9 Oct (no retry scheduled).
    expect(m.next?.occurrence.seq).toBe(2);
    expect(m.next?.isRetry).toBe(false);
  });

  it('a scheduled retry is the next thing that happens', () => {
    const rows = [occ(1, '2026-10-02', 20000, 0, 'failed', { nextAttemptAt: '2026-10-04T14:00:00.000Z' }), occ(2, '2026-10-09', 20000, 0, 'scheduled')];
    expect(planMath(rows).next).toMatchObject({ date: '2026-10-04T14:00:00.000Z', isRetry: true });
  });

  it('reads the figures out in one sentence', () => {
    const text = explainMath(planMath(ROWS), 'usd', 'America/New_York');
    for (const figure of ['$600.00', '$250.00', '$200.00', '$550.00', '3 payments']) expect(text).toContain(figure);
    expect(explainMath(planMath([occ(1, '2026-10-02', 20000, 0, 'scheduled')]), 'usd')).toContain('Nothing has been asked for yet.');
  });
});

describe('missed payments and the recovery sentence', () => {
  it('a declined card, or a due date that passed, is missed', () => {
    expect(isMissed(ROWS[1], TODAY)).toBe(true);
    expect(isMissed(ROWS[2], TODAY)).toBe(false); // part-paid, due 16 Oct — not yet
    expect(isMissed(occ(7, '2026-10-09', 20000, 0, 'due', { collectionMethod: 'manual' }), '2026-10-10')).toBe(true);
    expect(isMissed(occ(7, '2026-10-09', 20000, 0, 'due', { collectionMethod: 'manual' }), '2026-10-09')).toBe(false);
  });

  it('says the lead\'s sentence, and offers only the ways out that work for that payment', () => {
    const rows = [occ(7, '2026-10-09', 20000, 0, 'due', { collectionMethod: 'manual' }), occ(8, '2026-10-16', 20000, 0, 'scheduled')];
    const [r] = recoveries({ plan: active, occurrences: rows, attempts: [], today: '2026-10-10', currency: 'usd' });
    expect(r.sentence).toBe('Missed on Fri 9 Oct — $200.00 is outstanding.');
    expect(r.actions).toEqual(['send_link', 'record_payment']); // no card to retry on a manual payment
  });
});

describe('row actions: valid, or disabled WITH a reason — never a silent no-op', () => {
  const all: OccurrenceAction[] = ['retry', 'send_link', 'record_payment', 'move_date', 'skip'];
  const ctx = { plan: active, occurrences: ROWS, attempts: [] as AttemptView[], today: TODAY };

  it('a paid payment offers nothing, and says why', () => {
    const a = occurrenceActions(ROWS[0], ctx);
    for (const k of all) expect(a[k]).toEqual({ enabled: false, reason: 'Already paid in full.' });
  });

  it('a scheduled card payment can be recorded early or moved, not charged or linked yet', () => {
    const a = occurrenceActions(ROWS[3], ctx);
    expect(a.retry.enabled).toBe(false);
    expect(a.retry.reason).toContain('Not due until Fri 23 Oct');
    expect(a.send_link.enabled).toBe(false);
    expect(a.record_payment.enabled).toBe(true);
    expect(a.move_date.enabled).toBe(true);
    // #4 is the last payment that can take an amount (#5 replaced, #6 skipped).
    expect(a.skip).toMatchObject({ enabled: false });
    expect(a.skip.reason).toContain('last payment');
  });

  it('a declined card payment can be retried, linked, recorded, moved or skipped into #3', () => {
    const a = occurrenceActions(ROWS[1], ctx);
    for (const k of all) expect(a[k].enabled).toBe(true);
    expect(nextOpenAfter(ROWS[1], ROWS)?.seq).toBe(3);
  });

  it('a payment going through right now can\'t be touched', () => {
    const a = occurrenceActions(occ(9, '2026-10-12', 20000, 0, 'processing'), ctx);
    for (const k of all) {
      expect(a[k].enabled).toBe(false);
      expect(a[k].reason).toMatch(/going through/);
    }
  });

  it('retry is for card payments only; a paused plan still takes a recorded payment but sends nothing', () => {
    const manual = occ(2, '2026-10-09', 20000, 0, 'failed', { collectionMethod: 'manual' });
    expect(occurrenceActions(manual, ctx).retry.reason).toMatch(/collected by/);
    const paused = occurrenceActions(ROWS[1], { ...ctx, plan: { status: 'paused' } });
    expect(paused.retry).toMatchObject({ enabled: false });
    expect(paused.retry.reason).toMatch(/paused/);
    expect(paused.send_link).toMatchObject({ enabled: false });
    expect(paused.send_link.reason).toMatch(/paused/);
    expect(paused.record_payment.enabled).toBe(true);
  });

  it('a link that is out does not block skip or cancel (the server releases it); a card charge in flight does', () => {
    const attempt = (method: AttemptView['method']): AttemptView => ({
      id: 'a1', occurrenceId: 'o2', attemptNo: 1, method, idempotencyKey: 'pp:platform:o2:1', status: 'in_flight',
      provider: 'stripe', providerAccount: null, providerMode: 'test', providerRef: null, paymentId: null, amountCents: 20000,
      declineCode: null, errorCode: null, errorMessage: null,
    });
    const link = occurrenceActions(ROWS[1], { ...ctx, attempts: [attempt('checkout_link')] });
    expect(link.skip.enabled).toBe(true);
    expect(link.send_link.enabled).toBe(true); // a resend
    expect(planActions(active, ROWS, [attempt('checkout_link')]).cancel.enabled).toBe(true);

    const card = occurrenceActions(ROWS[1], { ...ctx, attempts: [attempt('auto_charge')] });
    expect(card.skip).toMatchObject({ enabled: false });
    expect(card.send_link.reason).toMatch(/going through/);
    const blocked = planActions(active, ROWS, [attempt('auto_charge')]);
    expect(blocked.cancel.enabled).toBe(false);
    expect(blocked.cancel.reason).toMatch(/#2 is going through/);
    expect(blocked.edit.enabled).toBe(false);
  });

  it('for EVERY status, method and plan state: enabled ⇔ no reason, disabled ⇔ a sentence', () => {
    const statuses: OccurrenceStatus[] = ['scheduled', 'due', 'processing', 'requires_action', 'paid', 'partially_paid', 'failed', 'skipped', 'waived', 'superseded', 'cancelled'];
    for (const status of statuses)
      for (const method of ['auto_charge', 'checkout_link', 'manual'] as const)
        for (const planStatus of ['active', 'paused', 'completed', 'cancelled'] as const) {
          const o = occ(2, '2026-10-09', 20000, status === 'partially_paid' ? 5000 : 0, status, { collectionMethod: method });
          const a = occurrenceActions(o, { ...ctx, plan: { status: planStatus } });
          for (const k of all) {
            if (a[k].enabled) expect(a[k].reason).toBeNull();
            else expect(a[k].reason && a[k].reason!.length).toBeGreaterThan(10);
          }
        }
  });
});

describe('the timeline in words', () => {
  it('names the payment by number and never shows a fraud code', () => {
    const e = (kind: any, over: any = {}) => ({ id: 'e', planId: 'p1', kind, createdAt: '2026-10-09T14:00:00Z', ...over });
    expect(eventSentence(e('charge_failed', { occurrenceId: 'o2', detail: { declineCode: 'stolen_card' } }), ROWS, 'usd')).toBe(
      'Card declined for payment #2 — the card was declined.',
    );
    expect(eventSentence(e('occurrence_moved', { occurrenceId: 'o4', detail: { from: '2026-10-23', to: '2026-10-26' } }), ROWS, 'usd')).toBe(
      'Payment #4 moved from Fri 23 Oct to Mon 26 Oct.',
    );
    expect(eventSentence(e('reminder', { occurrenceId: 'o4', channel: 'email', detail: { offset: -2 } }), ROWS, 'usd')).toBe(
      'Reminder about payment #4 sent 2 days before by email.',
    );
  });
});
