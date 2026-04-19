import { describe, it, expect } from 'vitest';
import {
  ageInYearsAt,
  formatBonzahDate,
  formatBonzahDateTime,
} from './date.util';

describe('date.util', () => {
  describe('formatBonzahDate', () => {
    it('formats MM/DD/YYYY', () => {
      expect(formatBonzahDate(new Date('2026-05-01T00:00:00Z'))).toBe(
        '05/01/2026',
      );
    });
    it('pads single-digit month and day', () => {
      expect(formatBonzahDate(new Date('2026-01-09T00:00:00Z'))).toBe(
        '01/09/2026',
      );
    });
  });

  describe('formatBonzahDateTime', () => {
    it('formats MM/DD/YYYY HH:mm:ss', () => {
      expect(
        formatBonzahDateTime(new Date('2026-05-01T14:30:07Z')),
      ).toBe('05/01/2026 14:30:07');
    });
  });

  describe('ageInYearsAt', () => {
    it('returns completed years when after birthday', () => {
      const dob = new Date('2000-01-01T00:00:00Z');
      const at = new Date('2026-06-01T00:00:00Z');
      expect(ageInYearsAt(dob, at)).toBe(26);
    });
    it('returns years - 1 when before birthday in same year', () => {
      const dob = new Date('2000-06-15T00:00:00Z');
      const at = new Date('2026-06-14T00:00:00Z');
      expect(ageInYearsAt(dob, at)).toBe(25);
    });
    it('returns years on exact birthday', () => {
      const dob = new Date('2000-06-15T00:00:00Z');
      const at = new Date('2026-06-15T00:00:00Z');
      expect(ageInYearsAt(dob, at)).toBe(26);
    });
    it('returns 0 when `at` is before dob within same year', () => {
      const dob = new Date('2026-02-01T00:00:00Z');
      const at = new Date('2026-01-01T00:00:00Z');
      expect(ageInYearsAt(dob, at)).toBe(-1);
    });
  });
});
