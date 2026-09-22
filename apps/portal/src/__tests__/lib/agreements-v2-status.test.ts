/**
 * Agreements v2 — the status vocabulary (D16) and the shared constants.
 *
 * Every raw `document_status` value either kind of row can carry is asserted
 * by name, because the list, the overview counts and the filters all read this
 * one function: a value that lands in the wrong bucket shows a failed
 * agreement as "Pending signature", or a superseded one as a live row.
 */
import { describe, expect, it } from 'vitest';
import { isMissingTableError, toStatusV2 } from '@/lib/agreements-v2/status';
import { OPERATOR_SIGNATURE_ATTR, SIGNATURE_FIELDS } from '@/lib/agreements-v2/types';

describe('toStatusV2', () => {
  it.each(['signed', 'completed'])('%s is Signed', (raw) => {
    expect(toStatusV2(raw)).toBe('signed');
  });

  it.each(['send_failed', 'credit_failed', 'declined', 'expired', 'failed'])('%s is Failed', (raw) => {
    expect(toStatusV2(raw)).toBe('failed');
  });

  it.each(['voided', 'revoked'])('%s is hidden: a resend superseded it', (raw) => {
    expect(toStatusV2(raw)).toBe('hidden');
  });

  it.each(['pending', 'sent', 'delivered', 'viewed'])('%s is Pending signature', (raw) => {
    expect(toStatusV2(raw)).toBe('pending');
  });

  it('treats null and empty as Pending signature', () => {
    expect(toStatusV2(null)).toBe('pending');
    expect(toStatusV2('')).toBe('pending');
  });

  it('treats a value it has never heard of as Pending, never as Signed', () => {
    // An unknown status is an agreement nobody has confirmed as signed.
    expect(toStatusV2('reassigned')).toBe('pending');
    expect(toStatusV2('signed_by_one')).toBe('pending');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(toStatusV2('Completed')).toBe('signed');
    expect(toStatusV2(' SEND_FAILED ')).toBe('failed');
    expect(toStatusV2('Voided')).toBe('hidden');
  });
});

describe('isMissingTableError', () => {
  it.each([
    [{ code: '42P01', message: 'relation "public.individual_agreements_v2" does not exist' }],
    [{ code: 'PGRST205', message: "Could not find the table 'public.individual_agreements_v2' in the schema cache" }],
    [{ message: "Could not find the table 'public.agreement_operator_signatures_v2' in the schema cache" }],
    [{ message: 'relation "individual_agreements_v2" does not exist' }],
  ])('recognises %o as the table not being there yet', (error) => {
    expect(isMissingTableError(error)).toBe(true);
  });

  it('does NOT read a missing column as a missing table', () => {
    // Schema drift on a table that exists must surface, not become an empty list.
    expect(isMissingTableError({ code: '42703', message: 'column individual_agreements_v2.title does not exist' })).toBe(false);
    expect(isMissingTableError({ message: 'column "title" does not exist' })).toBe(false);
  });

  it('does not swallow real failures', () => {
    expect(isMissingTableError({ code: '42501', message: 'permission denied for table individual_agreements_v2' })).toBe(false);
    expect(isMissingTableError({ code: '08006', message: 'connection failure' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe('SIGNATURE_FIELDS', () => {
  it('is exactly the three signer-1 text tags the send path defines, in order', () => {
    expect(SIGNATURE_FIELDS.map((f) => [f.key, f.tag, f.label])).toEqual([
      ['signature', '{{@sig1}}', 'Signature'],
      ['initials', '{{@init1}}', 'Initials'],
      ['date', '{{@date1}}', 'Date signed'],
    ]);
  });

  it('gives each field a short hint', () => {
    for (const field of SIGNATURE_FIELDS) {
      expect(field.hint.trim().length).toBeGreaterThan(0);
      expect(field.hint.length).toBeLessThanOrEqual(80);
    }
  });

  it('names the operator signature attribute the PDF renderers look for', () => {
    expect(OPERATOR_SIGNATURE_ATTR).toBe('data-operator-signature');
  });
});
