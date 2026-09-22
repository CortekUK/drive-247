/**
 * Agreements v2: the rules an individual send must meet
 * (lib/agreements-v2/validation.ts). Pure; the Send dialog checks them before
 * it asks, and the `agreements-v2` edge function enforces the same on its side.
 * Carried over from the deleted Next-route tests, which exercised these
 * through POST /api/agreements-v2/send.
 */
import { describe, expect, it } from 'vitest';
import {
  contentSizeForLimit,
  isUuidV2,
  isValidEmailV2,
  splitEmailsV2,
  validateIndividualSendV2,
} from '@/lib/agreements-v2/validation';

const validBody = (over: Record<string, unknown> = {}) => ({
  templateId: '11111111-1111-4111-8111-111111111111',
  contentHtml: '<h1>Services</h1><p>Between {{company_name}} and {{customer_name}}.</p><p>Sign: {{@sig1}} Date: {{@date1}}</p>',
  title: 'Consulting agreement',
  message: '  Please sign by Friday.  ',
  recipientName: 'Ada Lovelace',
  recipientEmail: 'ada@example.com',
  cc: ['boss@example.com', 'legal@example.com'],
  ...over,
});

describe('validateIndividualSendV2', () => {
  it.each([
    ['no recipient name', { recipientName: '  ' }, 'recipientName'],
    ['a name over 200', { recipientName: 'x'.repeat(201) }, 'recipientName'],
    ['a bad recipient email', { recipientEmail: 'ada@' }, 'recipientEmail'],
    ['a recipient email with a display name', { recipientEmail: 'Ada <ada@example.com>' }, 'recipientEmail'],
    ['a bad CC', { cc: ['ok@example.com', 'nope'] }, 'cc'],
    ['a duplicate CC', { cc: ['a@example.com', 'A@example.com'] }, 'cc'],
    ['the recipient in CC', { cc: ['ADA@example.com'] }, 'cc'],
    ['eleven CCs', { cc: Array.from({ length: 11 }, (_, i) => `p${i}@example.com`) }, 'cc'],
    ['no title', { title: '' }, 'title'],
    ['a title over 200', { title: 't'.repeat(201) }, 'title'],
    ['a message over 1000', { message: 'm'.repeat(1001) }, 'message'],
    ['no content', { contentHtml: '   ' }, 'contentHtml'],
    ['content over 500 kB', { contentHtml: `<p>${'x'.repeat(500 * 1024)}</p>` }, 'contentHtml'],
    ['a template id that is not an id', { templateId: 'drop table' }, 'templateId'],
  ])('rejects %s, naming the field', (_label, over, field) => {
    const result = validateIndividualSendV2(validBody(over));
    expect(result.ok).toBe(false);
    expect(result.field).toBe(field);
    expect(typeof result.error).toBe('string');
  });

  it('accepts a one-off agreement with no template and ten CCs', () => {
    const cc = Array.from({ length: 10 }, (_, i) => `p${i}@example.com`);
    const result = validateIndividualSendV2(validBody({ templateId: null, cc }));
    expect(result.ok).toBe(true);
    expect(result.value?.templateId).toBeNull();
    expect(result.value?.cc).toHaveLength(10);
  });

  it('does not count the operator signature image against the 500 kB', () => {
    const img = `<img data-operator-signature="true" src="data:image/png;base64,${'A'.repeat(400_000)}">`;
    const html = `<p>${'x'.repeat(300_000)}</p>${img}`;
    expect(contentSizeForLimit(html)).toBeLessThan(310_000);
    expect(validateIndividualSendV2(validBody({ contentHtml: html })).ok).toBe(true);
    // A pasted image that is NOT the signature still counts.
    const pasted = `<p>${'x'.repeat(300_000)}</p><img src="data:image/png;base64,${'A'.repeat(400_000)}">`;
    expect(validateIndividualSendV2(validBody({ contentHtml: pasted })).ok).toBe(false);
  });

  it('trims the message and keeps an empty one as null', () => {
    expect(validateIndividualSendV2(validBody()).value?.message).toBe('Please sign by Friday.');
    expect(validateIndividualSendV2(validBody({ message: '   ' })).value?.message).toBeNull();
  });

  it('leaves the signer tags in the content alone', () => {
    expect(validateIndividualSendV2(validBody()).value?.contentHtml).toContain('{{@sig1}}');
  });

  it('checkContent: false skips the content rules (a resend of a stored snapshot)', () => {
    expect(validateIndividualSendV2(validBody({ contentHtml: '' }), { checkContent: false }).ok).toBe(true);
  });
});

describe('the small helpers', () => {
  it('splits a pasted run of addresses on commas, semicolons and spaces', () => {
    expect(splitEmailsV2('a@x.com, b@x.com;c@x.com  d@x.com\n')).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  });

  it('knows an email address and an id', () => {
    expect(isValidEmailV2('ada@example.com')).toBe(true);
    expect(isValidEmailV2('ada@example')).toBe(false);
    expect(isValidEmailV2('ada@.example.com')).toBe(false);
    expect(isUuidV2('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isUuidV2('nope')).toBe(false);
  });
});
