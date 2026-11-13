import { describe, expect, it } from 'vitest';
import { checkBookingRules, describeHours } from '../../components/rentals-v2/rental-detail/booking-rules';

// Northwind's rules: min 1 day + 1 hour, max 90 days, 24 h notice (QA R2.7).
const NW = { min_rental_days: 1, min_rental_hours: 1, max_rental_days: 90, booking_lead_time_hours: 24, booking_lead_time_unit: 'hours' as const };
const now = new Date('2026-11-13T09:00:00');

describe('checkBookingRules (portal date picker)', () => {
  it('accepts a normal 3-day rental well ahead', () => {
    expect(checkBookingRules({ start: '2026-12-01', startTime: '10:00', end: '2026-12-04', endTime: '10:00' }, NW, now)).toEqual({ refuse: null, warn: null });
  });
  it('refuses a rental shorter than the minimum, saying both lengths', () => {
    const r = checkBookingRules({ start: '2026-12-01', startTime: '10:00', end: '2026-12-02', endTime: '10:00' }, NW, now);
    expect(r.refuse).toMatch(/Too short: the shortest rental is 1 day 1 hour, and these dates come to 1 day/);
  });
  it('refuses a rental longer than the maximum', () => {
    expect(checkBookingRules({ start: '2026-12-01', startTime: '10:00', end: '2027-03-15', endTime: '10:00' }, NW, now).refuse).toMatch(/Too long: the longest rental is 90 days/);
  });
  it('refuses a return before the pickup', () => {
    expect(checkBookingRules({ start: '2026-12-04', startTime: '10:00', end: '2026-12-01', endTime: '10:00' }, NW, now).refuse).toBe('The return has to be after the pickup.');
  });
  it('only warns when the pickup is inside the booking notice (staff may book walk-ins)', () => {
    const r = checkBookingRules({ start: '2026-11-13', startTime: '15:00', end: '2026-11-16', endTime: '15:00' }, NW, now);
    expect(r.refuse).toBeNull();
    expect(r.warn).toMatch(/sooner than your 24 hours booking notice/);
  });
  it('uses the v1 minimum formula and defaults', () => {
    expect(describeHours(25)).toBe('1 day 1 hour');
    expect(checkBookingRules({ start: '2026-12-01', startTime: '10:00', end: '2026-12-01', endTime: '10:30' }, {}, now).refuse).toMatch(/shortest rental is 1 hour/);
  });
});
