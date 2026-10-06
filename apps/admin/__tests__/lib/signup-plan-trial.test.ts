import { describe, expect, it } from 'vitest';
import { parseTrialDays, TRIAL_DAYS_MAX } from '@/components/admin/signup-plan-card';

describe('parseTrialDays', () => {
  it('accepts a whole number of days from 1 to the max', () => {
    expect(parseTrialDays('5')).toEqual({ ok: true, days: 5 });
    expect(parseTrialDays(' 1 ')).toEqual({ ok: true, days: 1 });
    expect(parseTrialDays(String(TRIAL_DAYS_MAX))).toEqual({ ok: true, days: TRIAL_DAYS_MAX });
  });

  it('refuses 0 (that is the switch), decimals, words and anything over the max', () => {
    for (const bad of ['0', '2.5', 'five', '', '-3', String(TRIAL_DAYS_MAX + 1)]) {
      expect(parseTrialDays(bad).ok).toBe(false);
    }
  });
});
