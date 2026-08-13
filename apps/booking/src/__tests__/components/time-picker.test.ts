import { describe, expect, it } from 'vitest';
import { isTimeWithinBusinessHours } from '@/components/ui/time-picker';

describe('isTimeWithinBusinessHours', () => {
  it('accepts both business-hour boundaries', () => {
    expect(isTimeWithinBusinessHours('08:15', '08:15:00', '19:00:00')).toBe(true);
    expect(isTimeWithinBusinessHours('19:00', '08:15:00', '19:00:00')).toBe(true);
  });

  it('rejects a minute after closing', () => {
    expect(isTimeWithinBusinessHours('19:01', '08:15:00', '19:00:00')).toBe(false);
  });
});
