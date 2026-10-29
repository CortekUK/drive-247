import { describe, it, expect } from 'vitest';
import { checkRentalConflicts } from '@/hooks/use-rental-conflicts';

// Minimal chainable stub: every filter returns the builder, awaiting it yields rows.
const supabaseWith = (rows: any[]) => {
  const builder: any = {
    select: () => builder, eq: () => builder, in: () => builder,
    lte: () => builder, or: () => builder, neq: () => builder,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return { from: () => builder } as any;
};

// Moore Luxe case: previous rental returns 2026-10-29 at 13:45.
const previous = {
  id: 'prev', start_date: '2026-10-27', end_date: '2026-10-29',
  pickup_time: '13:45:00', return_time: '13:45:00', status: 'Active', customers: { name: 'A' },
};

describe('checkRentalConflicts — same-day turnaround', () => {
  it('allows a pickup two hours after the previous return', async () => {
    const r = await checkRentalConflicts(supabaseWith([previous]), 't', 'v', '2026-10-29', '2026-11-28', undefined, { pickupTime: '15:45', returnTime: '15:45' });
    expect(r.hasConflicts).toBe(false);
  });

  it('flags a pickup before the previous return', async () => {
    const r = await checkRentalConflicts(supabaseWith([previous]), 't', 'v', '2026-10-29', '2026-11-28', undefined, { pickupTime: '12:00', returnTime: '12:00' });
    expect(r.hasConflicts).toBe(true);
  });

  it('keeps whole-day behaviour when no times are given', async () => {
    const r = await checkRentalConflicts(supabaseWith([previous]), 't', 'v', '2026-10-29', '2026-11-28');
    expect(r.hasConflicts).toBe(true);
  });

  it('treats a previous rental without a return time as holding the whole day', async () => {
    const r = await checkRentalConflicts(supabaseWith([{ ...previous, return_time: null }]), 't', 'v', '2026-10-29', '2026-11-28', undefined, { pickupTime: '15:45' });
    expect(r.hasConflicts).toBe(true);
  });

  it('still flags open-ended PAYG rentals', async () => {
    const r = await checkRentalConflicts(supabaseWith([{ ...previous, end_date: null, return_time: null }]), 't', 'v', '2026-12-01', '2026-12-03', undefined, { pickupTime: '10:00', returnTime: '10:00' });
    expect(r.hasConflicts).toBe(true);
  });
});
