/**
 * describeHoldExpiry — the deposit-hold expiry line on the rental page.
 *
 * GMT (Aug 2026): "I cannot refresh the hold. This is affecting our day to day
 * business." Their 60-120 day rentals outlive a Stripe authorisation by an
 * order of magnitude. Nothing in the webhook chain watches
 * rentals.deposit_hold_payment_intent_id, so the row sits on 'held' over a dead
 * authorisation and this line is the only warning an operator gets before a
 * capture fails. The tone thresholds are therefore load-bearing, not cosmetic.
 *
 * The helper lives at module scope inside a ~6000-line page component that
 * cannot be imported here (it pulls in Next's router, 40+ hooks and the whole
 * Supabase client). Rather than duplicate the implementation into the test —
 * which would test a copy and prove nothing — we lift the real source text out
 * of the page and compile it. If someone edits the helper, this suite sees the
 * edit.
 */

import { describe, it, expect } from 'vitest';
import { readAppSource, sliceModuleConst, evalModuleConsts } from '../helpers/source';

const pageSource = readAppSource('app/(dashboard)/rentals/[id]/page.tsx');

type HoldExpiry = { tone: 'ok' | 'soon' | 'past'; label: string } | null;

const describeHoldExpiry = evalModuleConsts<(expiresAt: string | null | undefined) => HoldExpiry>(
  [sliceModuleConst(pageSource, 'describeHoldExpiry')],
  'describeHoldExpiry',
);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** ISO timestamp `ms` milliseconds from now. */
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

/**
 * The label embeds a locale date, so asserting a literal string would make the
 * suite fail in any timezone but the author's. Assert the shape instead — the
 * parts that carry meaning are the tone and the countdown.
 */
const EXPIRES_LINE = (remaining: string) =>
  new RegExp(`^Authorisation expires [A-Z][a-z]{2} \\d{1,2}, \\d{4} · ${remaining}$`);

describe('describeHoldExpiry — nothing to say', () => {
  it('renders no line when the rental has no recorded expiry', () => {
    // Most rentals across the other 27 tenants have never had a hold. They must
    // not sprout a mystery date line.
    expect(describeHoldExpiry(null)).toBeNull();
    expect(describeHoldExpiry(undefined)).toBeNull();
    expect(describeHoldExpiry('')).toBeNull();
  });

  it('renders no line for a value Date cannot parse', () => {
    // deposit_hold_expires_at is written by several code paths; a junk value
    // must degrade to silence, never to "Authorisation expires Invalid Date".
    expect(describeHoldExpiry('not-a-timestamp')).toBeNull();
  });
});

describe('describeHoldExpiry — tone thresholds', () => {
  it('is calm ("ok") while there is more than 3 days of authorisation left', () => {
    const r = describeHoldExpiry(inMs(10 * DAY + HOUR));
    expect(r?.tone).toBe('ok');
    expect(r?.label).toMatch(EXPIRES_LINE('10 days left'));
  });

  it('turns urgent ("soon") strictly under 3 days', () => {
    // 3 days is the practical warning window: the last point at which an
    // operator can still refresh the hold before a weekend swallows it.
    const r = describeHoldExpiry(inMs(2 * DAY + 23 * HOUR));
    expect(r?.tone).toBe('soon');
    expect(r?.label).toMatch(EXPIRES_LINE('2 days left'));
  });

  it('is still calm at exactly 3 days (the boundary is < 3, not <= 3)', () => {
    const r = describeHoldExpiry(inMs(3 * DAY + HOUR));
    expect(r?.tone).toBe('ok');
    expect(r?.label).toMatch(EXPIRES_LINE('3 days left'));
  });

  it('reports a lapsed authorisation as "past", not as a countdown', () => {
    // This is GMT's state: the money is already back with the customer while
    // the row still says 'held'. It has to read as damage, not as a schedule.
    const r = describeHoldExpiry(inMs(-2 * DAY));
    expect(r?.tone).toBe('past');
    expect(r?.label).toMatch(/^Authorisation lapsed [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(r?.label).not.toMatch(/left/);
  });

  it('treats "expires right now" as already lapsed', () => {
    const r = describeHoldExpiry(new Date(Date.now() - 1).toISOString());
    expect(r?.tone).toBe('past');
  });
});

describe('describeHoldExpiry — countdown wording', () => {
  it('drops to hours inside the last day', () => {
    const r = describeHoldExpiry(inMs(5 * HOUR + 60_000));
    expect(r?.tone).toBe('soon');
    expect(r?.label).toMatch(EXPIRES_LINE('5 hours left'));
  });

  it('says "under an hour left" rather than "0 hours left"', () => {
    const r = describeHoldExpiry(inMs(20 * 60_000));
    expect(r?.tone).toBe('soon');
    expect(r?.label).toMatch(EXPIRES_LINE('under an hour left'));
  });

  it('singularises one day and one hour', () => {
    expect(describeHoldExpiry(inMs(DAY + HOUR))?.label).toMatch(EXPIRES_LINE('1 day left'));
    expect(describeHoldExpiry(inMs(HOUR + 60_000))?.label).toMatch(EXPIRES_LINE('1 hour left'));
  });
});
