/**
 * Payment plans UI — formatting. Every expected value here was worked out by
 * hand (a calendar and a pencil), not read back from the implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  centsToInput,
  formatCovers,
  formatDay,
  formatMoney,
  isIsoDate,
  isoWeekday,
  numericToCents,
  parseDollarsToCents,
  reminderLabel,
  todayInZone,
} from '@/lib/payment-plans-ui/format';

describe('money', () => {
  it('prints cents with two decimals', () => {
    expect(formatMoney(20000, 'usd')).toBe('$200.00');
    expect(formatMoney(16670, 'USD')).toBe('$166.70');
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('parses typed dollars from the digits, never via float multiplication', () => {
    // parseFloat("0.29") * 100 === 28.999999999999996
    expect(parseDollarsToCents('0.29')).toBe(29);
    expect(parseDollarsToCents('1,200.5')).toBe(120050);
    expect(parseDollarsToCents('$ 75')).toBe(7500);
    expect(parseDollarsToCents('.5')).toBe(50);
    for (const bad of ['', '.', 'abc', '12.345', '-5', '1.2.3']) expect(parseDollarsToCents(bad)).toBeNull();
  });

  it('round-trips an amount box', () => {
    expect(centsToInput(20000)).toBe('200.00');
    expect(centsToInput(5)).toBe('0.05');
    expect(parseDollarsToCents(centsToInput(123457))).toBe(123457);
  });

  it('reads Postgres numeric money as cents', () => {
    expect(numericToCents('200.00')).toBe(20000);
    expect(numericToCents(166.7)).toBe(16670);
    expect(numericToCents(null)).toBe(0);
  });
});

describe('calendar dates — never through new Date("YYYY-MM-DD")', () => {
  it('knows the weekday of a date (2026-10-09 is a Friday, 2026-09-30 a Wednesday)', () => {
    expect(isoWeekday('2026-10-09')).toBe(5);
    expect(isoWeekday('2026-09-30')).toBe(3);
    expect(isoWeekday('2026-10-05')).toBe(1);
    expect(isoWeekday('2026-10-04')).toBe(7);
  });

  it('prints a due date the way the lead wrote it: "Fri 9 Oct"', () => {
    expect(formatDay('2026-10-09')).toBe('Fri 9 Oct');
    expect(formatDay('2027-02-28')).toBe('Sun 28 Feb');
  });

  it('prints what a payment covers from a half-open period', () => {
    expect(formatCovers('2026-10-02', '2026-10-09')).toBe('2 – 8 Oct');
    expect(formatCovers('2026-09-30', '2026-10-02')).toBe('30 Sep – 1 Oct');
    expect(formatCovers('2026-10-02', '2026-10-03')).toBe('2 Oct');
    expect(formatCovers('2026-12-30', '2027-01-06')).toBe('30 Dec 2026 – 5 Jan 2027');
  });

  it('adds days across month, year and DST boundaries by the calendar', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02'); // DST ends 11-01 in the US
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('validates real calendar dates only', () => {
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-9-1')).toBe(false);
  });

  it('asks "what day is it" in the PLAN zone (design L1, L2)', () => {
    expect(todayInZone('America/Los_Angeles', new Date('2026-09-25T03:30:00Z'))).toBe('2026-09-24');
    expect(todayInZone('Asia/Dubai', new Date('2026-09-24T21:00:00Z'))).toBe('2026-09-25');
  });

  it('says reminder offsets in words', () => {
    expect(reminderLabel(-2)).toBe('2 days before');
    expect(reminderLabel(0)).toBe('On the day');
    expect(reminderLabel(1)).toBe('1 day after');
  });
});
