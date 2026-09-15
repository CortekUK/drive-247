/**
 * lib/csv-export.ts. Every expected string below is written out by hand.
 */
import { describe, expect, it } from 'vitest';
import { csvCell, csvDate, csvFilename, toCsv } from '@/lib/csv-export';

describe('csvCell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('Priya Raman')).toBe('Priya Raman');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(true)).toBe('true');
  });

  it('writes nothing for no value, or a number that is not finite', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('quotes a comma, a quote, a line break or edge spaces, doubling quotes', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(' padded')).toBe('" padded"');
  });

  it('keeps a spreadsheet from running typed text as a formula', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+44 7700 900123')).toBe("'+44 7700 900123");
    expect(csvCell('@handle')).toBe("'@handle");
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF, header first', () => {
    expect(toCsv(['Rental #', 'Customer'], [['R-NW29', 'Smith, John'], ['R-NW32', null]])).toBe(
      'Rental #,Customer\r\nR-NW29,"Smith, John"\r\nR-NW32,',
    );
  });
});

describe('csvDate and csvFilename', () => {
  it('passes a bare date through and reads an instant on the local calendar', () => {
    expect(csvDate('2026-09-22')).toBe('2026-09-22');
    expect(csvDate(new Date(2026, 8, 15, 23, 30))).toBe('2026-09-15');
    expect(csvDate(new Date(2026, 0, 5, 0, 5).toISOString())).toBe('2026-01-05');
  });

  it('writes nothing for no date or an unreadable one', () => {
    expect(csvDate(null)).toBe('');
    expect(csvDate('')).toBe('');
    expect(csvDate('not a date')).toBe('');
  });

  it('names the file after the list and the day', () => {
    expect(csvFilename('rentals', new Date(2026, 8, 5, 9))).toBe('rentals-2026-09-05.csv');
  });
});
