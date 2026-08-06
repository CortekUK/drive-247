import { describe, it, expect, vi } from 'vitest';

// The transforms under test are the ONLY copy of these rules — the edge
// functions call them before every ABI write, so a change here changes what gets
// insured. They are therefore imported from the real Deno module rather than
// reimplemented next to the test, where the two could drift apart silently.
//
// `inshur-client.ts` pulls supabase-js from a URL that Node cannot load. Only
// `createServiceClient()` and the config readers touch it, and nothing below
// calls those, so the module is stubbed to satisfy the import.
vi.mock('https://esm.sh/@supabase/supabase-js@2.57.4', () => ({
  createClient: () => ({}),
}));

import {
  InshurError,
  formatAbiDateTime,
  normalizeUsPhone,
  normalizeVin,
  normalizeZip,
  splitName,
} from '../../../../../supabase/functions/_shared/inshur-client.ts';

/** Every rejection must be an InshurError with a field-level code — the edge
 *  functions branch on `err.code` to decide whether a failure is the operator's
 *  data or ABI's fault, and a bare Error would be filed as the latter. */
function expectFieldError(fn: () => unknown) {
  let thrown: unknown;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(InshurError);
  expect((thrown as InshurError).code).toBe('INSHUR_INVALID_FIELD');
  return thrown as InshurError;
}

describe('splitName', () => {
  it('splits a two-part name', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
  });

  it('keeps everything but the final token as the first name', () => {
    expect(splitName('Mary Jane Watson')).toEqual({ firstName: 'Mary Jane', lastName: 'Watson' });
  });

  it('handles four parts the same way', () => {
    expect(splitName('Jean Claude Van Damme')).toEqual({
      firstName: 'Jean Claude Van',
      lastName: 'Damme',
    });
  });

  it('collapses runs of whitespace instead of inventing empty name parts', () => {
    expect(splitName('  Ada   Byron   Lovelace \n')).toEqual({
      firstName: 'Ada Byron',
      lastName: 'Lovelace',
    });
  });

  it('rejects a single name — ABI requires both, and guessing a surname insures the wrong person', () => {
    const err = expectFieldError(() => splitName('Cher'));
    expect(err.message).toContain('Cher');
  });

  it('rejects an empty name', () => {
    expectFieldError(() => splitName(''));
  });

  it('rejects a whitespace-only name', () => {
    expectFieldError(() => splitName('   '));
  });

  it('rejects a null-ish name without throwing a TypeError', () => {
    expectFieldError(() => splitName(null as unknown as string));
    expectFieldError(() => splitName(undefined as unknown as string));
  });
});

describe('normalizeUsPhone', () => {
  it('passes a bare 10-digit number through', () => {
    expect(normalizeUsPhone('8009801950')).toBe('8009801950');
  });

  it('strips the country code from an 11-digit number starting with 1', () => {
    expect(normalizeUsPhone('18009801950')).toBe('8009801950');
    expect(normalizeUsPhone('+1 (800) 980-1950')).toBe('8009801950');
  });

  it('strips punctuation and spacing from a 10-digit number', () => {
    expect(normalizeUsPhone('(800) 980-1950')).toBe('8009801950');
    expect(normalizeUsPhone('800.980.1950')).toBe('8009801950');
  });

  it('rejects a UK number rather than truncating it into a plausible US one', () => {
    // This platform defaults unknown numbers to +44, so this is a real record
    // shape, not a hypothetical. 11 digits, but not a leading 1.
    const err = expectFieldError(() => normalizeUsPhone('+447700900123'));
    expect(err.message).toContain('+447700900123');
  });

  it('rejects a UK number written in national format', () => {
    expectFieldError(() => normalizeUsPhone('07700 900123'));
  });

  it('rejects too few and too many digits', () => {
    expectFieldError(() => normalizeUsPhone('980195'));
    expectFieldError(() => normalizeUsPhone('280098019501'));
  });

  it('rejects an 11-digit number whose leading digit is not 1', () => {
    expectFieldError(() => normalizeUsPhone('28009801950'));
  });

  it('rejects an empty value', () => {
    expectFieldError(() => normalizeUsPhone(''));
  });
});

describe('normalizeVin', () => {
  const VIN = '1HGCM82633A004352';

  it('accepts a 17-character VIN', () => {
    expect(VIN).toHaveLength(17);
    expect(normalizeVin(VIN)).toBe(VIN);
  });

  it('upper-cases and trims', () => {
    expect(normalizeVin(`  ${VIN.toLowerCase()}  `)).toBe(VIN);
  });

  it('rejects a VIN that is too short, naming the length it got', () => {
    const err = expectFieldError(() => normalizeVin('1HGCM82633A00'));
    expect(err.message).toContain('13');
  });

  it('rejects a VIN that is too long', () => {
    expectFieldError(() => normalizeVin(`${VIN}9`));
  });

  it('rejects I, O and Q — never valid VIN characters, so their presence is a typo or an OCR artefact', () => {
    for (const bad of ['I', 'O', 'Q']) {
      const candidate = `${bad}HGCM82633A004352`;
      expect(candidate).toHaveLength(17);
      expectFieldError(() => normalizeVin(candidate));
    }
  });

  it('rejects lowercase i/o/q too, since the value is upper-cased before the check', () => {
    expectFieldError(() => normalizeVin('1hgcm82633a0043o2'));
  });

  it('rejects an empty VIN', () => {
    expectFieldError(() => normalizeVin(''));
  });
});

describe('normalizeZip', () => {
  it('accepts a 5-digit ZIP', () => {
    expect(normalizeZip('90210')).toBe('90210');
  });

  it('keeps a leading zero', () => {
    expect(normalizeZip('02108')).toBe('02108');
  });

  it('truncates ZIP+4 to the 5-digit form ABI wants', () => {
    expect(normalizeZip('90210-1234')).toBe('90210');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeZip('  90210 ')).toBe('90210');
  });

  it('rejects a non-numeric postcode', () => {
    const err = expectFieldError(() => normalizeZip('SW1A 1AA'));
    expect(err.message).toContain('SW1A 1AA');
  });

  it('rejects the wrong number of digits', () => {
    expectFieldError(() => normalizeZip('9021'));
    expectFieldError(() => normalizeZip('902101'));
  });

  it('rejects a malformed +4 suffix', () => {
    expectFieldError(() => normalizeZip('90210-12'));
  });

  it('rejects an empty ZIP', () => {
    expectFieldError(() => normalizeZip(''));
  });
});

describe('formatAbiDateTime', () => {
  it('renders the wall clock of the named zone, not UTC', () => {
    expect(formatAbiDateTime(new Date('2026-07-04T16:05:09Z'), 'America/Chicago')).toBe(
      '2026-07-04 11:05:09'
    );
  });

  it('crosses the date boundary backwards for a zone behind UTC', () => {
    // 03:30 UTC is still the previous evening in Los Angeles. Formatting this as
    // a UTC date would move the start of cover a full day.
    expect(formatAbiDateTime(new Date('2026-01-15T03:30:00Z'), 'America/Los_Angeles')).toBe(
      '2026-01-14 19:30:00'
    );
    expect(formatAbiDateTime(new Date('2026-01-15T03:30:00Z'), 'UTC')).toBe('2026-01-15 03:30:00');
  });

  it('crosses the date boundary forwards for a zone ahead of UTC', () => {
    expect(formatAbiDateTime(new Date('2026-01-15T23:30:00Z'), 'Asia/Tokyo')).toBe(
      '2026-01-16 08:30:00'
    );
  });

  it('renders local midnight as 00, never 24', () => {
    // en-CA reports hour 24 for midnight on some runtimes; "2026-03-01 24:00:00"
    // would be rejected by ABI and is a different day besides.
    expect(formatAbiDateTime(new Date('2026-03-01T08:00:00Z'), 'America/Los_Angeles')).toBe(
      '2026-03-01 00:00:00'
    );
  });

  it('follows the offset across the spring DST jump', () => {
    // 2026-03-08 is the US spring-forward date: 01:59 EST is followed by 03:00 EDT.
    expect(formatAbiDateTime(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toBe(
      '2026-03-08 01:59:00'
    );
    expect(formatAbiDateTime(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toBe(
      '2026-03-08 03:00:00'
    );
  });

  it('renders both halves of the repeated autumn hour identically, as a wall clock must', () => {
    // 01:30 happens twice on 2026-11-01 in New York. The string is genuinely
    // ambiguous — the point of the assertion is that it stays a wall clock and
    // does not silently become 02:30 for the second pass.
    expect(formatAbiDateTime(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01 01:30:00'
    );
    expect(formatAbiDateTime(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(
      '2026-11-01 01:30:00'
    );
  });

  it('always produces ABI’s exact "YYYY-MM-DD HH:mm:ss" shape', () => {
    for (const tz of ['UTC', 'America/New_York', 'America/Phoenix', 'Pacific/Honolulu']) {
      expect(formatAbiDateTime(new Date('2026-02-09T04:07:03Z'), tz)).toMatch(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      );
    }
  });
});
