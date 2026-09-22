/**
 * Agreements v2: the browser client for individual agreements
 * (lib/agreements-v2/api-client.ts), over the `agreements-v2` edge function.
 *
 *  - every call is `supabase.functions.invoke('agreements-v2', { body: { action, … } })`;
 *  - a non-2xx answer's JSON (on FunctionsHttpError.context) is read for the
 *    function's own sentence, and a RECORDED failed send (402/502) resolves
 *    with the row's { id, status, error };
 *  - a function that is not deployed yet (fetch/relay failure, or the
 *    gateway's own 404) is said in plain words: ready → reason 'service',
 *    sync → { updated: 0 }, send/document → an Error;
 *  - send renders the FINAL html for this recipient and a real PDF (base64,
 *    %PDF) in the browser and passes both; resend reads the old row
 *    tenant-scoped, redraws its PDF from the stored html and passes resendOf.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: h.invoke } },
  supabaseUntyped: { from: h.from },
}));

import {
  AGREEMENTS_FUNCTION_V2,
  AGREEMENTS_SERVICE_MISSING_V2,
  checkAgreementsReadyV2,
  fetchAgreementDocumentV2,
  prepareAgreementDocumentV2,
  resendAgreementV2,
  sendAgreementV2,
  syncAgreementsV2,
} from '@/lib/agreements-v2/api-client';
import { buildIndividualData, ensureSignatureTag, renderAgreementHtml } from '@/lib/agreements-v2/render';

/* ── helpers ───────────────────────────────────────────────────────────── */

const ok = (data: unknown) => h.invoke.mockResolvedValueOnce({ data, error: null });
const httpError = (status: number, body: unknown) =>
  h.invoke.mockResolvedValueOnce({
    data: null,
    error: new FunctionsHttpError(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
      }),
    ),
  });
const fetchFailure = () => h.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
const relayFailure = () => h.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsRelayError(new Response('', { status: 502 })) });
const gateway404 = () => httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' });

const lastCall = () => {
  const [name, options] = h.invoke.mock.calls.at(-1)!;
  return { name, body: (options as { body: Record<string, any> }).body };
};

const decode = (b64: string) => Buffer.from(b64, 'base64');

/** The builder `supabaseUntyped.from(...)` returns, recording the query. */
function rowQuery(result: { data: unknown; error: unknown }) {
  const seen = { table: '', select: '', eq: [] as Array<[string, unknown]> };
  const builder: any = {
    select: (cols: string) => ((seen.select = cols), builder),
    eq: (col: string, value: unknown) => (seen.eq.push([col, value]), builder),
    maybeSingle: async () => result,
  };
  h.from.mockImplementation((table: string) => ((seen.table = table), builder));
  return seen;
}

const COMPANY = {
  companyName: 'Northwind Rentals',
  companyEmail: 'hello@northwind.test',
  companyPhone: '+1 555 0100',
  companyAddress: '1 Harbour Road',
};

const CONTENT =
  '<h1>Services</h1><p>Between {{company_name}} ({{company_email}}) and {{customer_name}} &lt;{{customer_email}}&gt;.</p>' +
  '<p>Dated {{agreement_date}}. Vehicle: {{vehicle_reg}}.</p><p>Initials {{@init1}} Sign: {{@sig1}} Date: {{@date1}}</p>';

const sendBody = (over: Record<string, unknown> = {}) => ({
  templateId: '11111111-1111-4111-8111-111111111111',
  contentHtml: CONTENT,
  title: 'Consulting agreement',
  message: 'Please sign by Friday.',
  recipientName: 'Ada Lovelace',
  recipientEmail: 'ada@example.com',
  cc: ['boss@example.com'],
  company: COMPANY,
  timeZone: 'America/New_York',
  ...over,
});

const NOW = new Date('2026-09-22T02:30:00Z'); // still Sep 21 in New York

beforeEach(() => {
  h.invoke.mockReset();
  h.from.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/* ── readiness ─────────────────────────────────────────────────────────── */

describe('checkAgreementsReadyV2', () => {
  it('asks the function with { action: "ready" }', async () => {
    ok({ ok: true, ready: true, mode: 'live' });
    await expect(checkAgreementsReadyV2()).resolves.toEqual({ ready: true });
    expect(lastCall()).toEqual({ name: AGREEMENTS_FUNCTION_V2, body: { action: 'ready' } });
  });

  it("passes the function's reason and message through", async () => {
    ok({ ok: true, ready: false, reason: 'database', message: 'Needs the one-time database update.' });
    await expect(checkAgreementsReadyV2()).resolves.toEqual({
      ready: false,
      reason: 'database',
      message: 'Needs the one-time database update.',
    });
    ok({ ok: true, ready: false, reason: 'signing', message: "E-signing isn't set up." });
    await expect(checkAgreementsReadyV2()).resolves.toMatchObject({ ready: false, reason: 'signing' });
  });

  it.each([
    ['the request cannot be made', fetchFailure],
    ['the relay fails', relayFailure],
    ["the gateway's own 404", gateway404],
  ])('not deployed (%s) → reason "service", never a throw', async (_label, arrange) => {
    arrange();
    await expect(checkAgreementsReadyV2()).resolves.toEqual({
      ready: false,
      reason: 'service',
      message: AGREEMENTS_SERVICE_MISSING_V2,
    });
  });

  it("a refusal of the caller (401/403) is not ready, with the function's sentence", async () => {
    httpError(403, { ok: false, error: 'Your role can view agreements but not send them.' });
    await expect(checkAgreementsReadyV2()).resolves.toEqual({
      ready: false,
      reason: 'access',
      message: 'Your role can view agreements but not send them.',
    });
  });

  it('any other failure throws (the dialog then blocks nothing)', async () => {
    httpError(500, { ok: false, error: 'Could not check whether sending is available.' });
    await expect(checkAgreementsReadyV2()).rejects.toThrow('Could not check whether sending is available.');
  });
});

/* ── send ──────────────────────────────────────────────────────────────── */

describe('sendAgreementV2', () => {
  it('renders the FINAL html and a real PDF in the browser, and passes both', async () => {
    ok({ ok: true, id: 'row-1', status: 'sent' });
    await expect(sendAgreementV2(sendBody())).resolves.toEqual({ id: 'row-1', status: 'sent' });

    const { name, body } = lastCall();
    expect(name).toBe('agreements-v2');
    const expectedHtml = ensureSignatureTag(
      renderAgreementHtml(
        CONTENT,
        buildIndividualData({ ...COMPANY, recipientName: 'Ada Lovelace', recipientEmail: 'ada@example.com', timeZone: 'America/New_York' }),
        { mode: 'send' },
      ),
    );
    expect(body.contentHtml).toBe(expectedHtml);
    expect(body.contentHtml).toContain('Northwind Rentals');
    expect(body.contentHtml).toContain('Ada Lovelace');
    expect(body.contentHtml).toContain('September 21, 2026'); // the tenant's day, not UTC's
    expect(body.contentHtml).not.toMatch(/\{\{\s*[a-z_]/i); // nothing unresolved is left raw
    // The signer tags are never stripped or rewritten.
    for (const tag of ['{{@sig1}}', '{{@init1}}', '{{@date1}}']) expect(body.contentHtml).toContain(tag);

    expect(decode(body.pdfBase64).subarray(0, 5).toString()).toBe('%PDF-');
    expect(body).toMatchObject({
      action: 'send',
      templateId: '11111111-1111-4111-8111-111111111111',
      title: 'Consulting agreement',
      message: 'Please sign by Friday.',
      recipientName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
      cc: ['boss@example.com'],
      resendOf: null,
    });
    // The raw template and the company object are not what is sent.
    expect(body).not.toHaveProperty('company');
  });

  it('adds the customer signature when the document has none, and leaves Message off when empty', async () => {
    ok({ ok: true, id: 'row-2', status: 'sent' });
    await sendAgreementV2(sendBody({ contentHtml: '<p>No signature here.</p>', message: undefined, templateId: null }));
    const { body } = lastCall();
    expect(body.contentHtml).toContain('{{@sig1}}');
    expect(body).not.toHaveProperty('message');
    expect(body.templateId).toBeNull();
  });

  it('the PDF is drawn from the same html that is sent', async () => {
    const prepared = await prepareAgreementDocumentV2(
      { content: CONTENT, company: COMPANY, recipientName: 'Ada Lovelace', recipientEmail: 'ada@example.com', timeZone: 'America/New_York' },
      'Consulting agreement',
    );
    ok({ ok: true, id: 'row-1', status: 'sent' });
    await sendAgreementV2(sendBody());
    const { body } = lastCall();
    expect(body.contentHtml).toBe(prepared.contentHtml);
    // pdf-lib stamps a creation date, so compare everything but the metadata.
    const strip = (b64: string) => decode(b64).toString('latin1').replace(/\/(CreationDate|ModDate) \([^)]*\)/g, '');
    expect(strip(body.pdfBase64)).toBe(strip(prepared.pdfBase64));
  });

  it.each([
    [402, 'credit_failed', 'There are not enough e-sign credits to send this agreement.'],
    [502, 'send_failed', 'The signing service refused the document.'],
  ])('a RECORDED failure (%i) resolves with the row, read from the error body', async (status, rowStatus, error) => {
    httpError(status, { ok: false, id: 'row-3', status: rowStatus, error });
    await expect(sendAgreementV2(sendBody())).resolves.toEqual({ id: 'row-3', status: rowStatus, error });
  });

  it("any other refusal throws the function's own sentence", async () => {
    httpError(400, { ok: false, error: 'Enter a valid email address for the recipient.', field: 'recipientEmail' });
    await expect(sendAgreementV2(sendBody())).rejects.toThrow('Enter a valid email address for the recipient.');
    httpError(503, { ok: false, error: 'Individual agreements are not switched on yet, so nothing was sent.' });
    await expect(sendAgreementV2(sendBody())).rejects.toThrow('not switched on yet');
    httpError(401, 'Unauthorized');
    await expect(sendAgreementV2(sendBody())).rejects.toThrow('Your session has expired. Sign in again.');
    httpError(500, '<html>oops</html>');
    await expect(sendAgreementV2(sendBody())).rejects.toThrow('The request failed (500).');
  });

  it.each([
    ['the request cannot be made', fetchFailure],
    ['the relay fails', relayFailure],
    ["the gateway's own 404", gateway404],
  ])('not deployed (%s) → a clear Error', async (_label, arrange) => {
    arrange();
    await expect(sendAgreementV2(sendBody())).rejects.toThrow(AGREEMENTS_SERVICE_MISSING_V2);
  });
});

/* ── resend ────────────────────────────────────────────────────────────── */

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORED_HTML = '<p>Between Northwind Rentals and Ada Lovelace.</p><p>Sign: {{@sig1}} Date: {{@date1}}</p>';
const OLD_ROW = {
  id: 'old-1',
  recipient_name: 'Ada Lovelace',
  recipient_email: 'ada@example.com',
  cc_emails: ['boss@example.com', 'legal@example.com'],
  title: 'Consulting agreement',
  message: null,
  template_id: '11111111-1111-4111-8111-111111111111',
  content_html: STORED_HTML,
};

describe('resendAgreementV2', () => {
  it('reads the old row scoped to the tenant, redraws its PDF from the stored html, and passes resendOf', async () => {
    const seen = rowQuery({ data: OLD_ROW, error: null });
    ok({ ok: true, id: 'new-1', status: 'sent' });
    await expect(resendAgreementV2('old-1', TENANT)).resolves.toEqual({ id: 'new-1', status: 'sent' });

    expect(seen.table).toBe('individual_agreements_v2');
    expect(seen.select).toBe('id, recipient_name, recipient_email, cc_emails, title, message, template_id, content_html');
    expect(seen.eq).toEqual([
      ['id', 'old-1'],
      ['tenant_id', TENANT],
    ]);

    const { body } = lastCall();
    expect(body).toMatchObject({
      action: 'send',
      resendOf: 'old-1',
      templateId: OLD_ROW.template_id,
      title: 'Consulting agreement',
      recipientName: 'Ada Lovelace',
      recipientEmail: 'ada@example.com',
      cc: ['boss@example.com', 'legal@example.com'],
      contentHtml: STORED_HTML, // already final: not substituted again
    });
    expect(body).not.toHaveProperty('message');
    expect(decode(body.pdfBase64).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a recorded failure resolves with the new row', async () => {
    rowQuery({ data: OLD_ROW, error: null });
    httpError(402, { ok: false, id: 'new-2', status: 'credit_failed', error: 'Not enough credits.' });
    await expect(resendAgreementV2('old-1', TENANT)).resolves.toEqual({ id: 'new-2', status: 'credit_failed', error: 'Not enough credits.' });
  });

  it('the table not being there yet is "not switched on yet", and nothing is sent', async () => {
    rowQuery({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.individual_agreements_v2'" } });
    await expect(resendAgreementV2('old-1', TENANT)).rejects.toThrow(AGREEMENTS_SERVICE_MISSING_V2);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("another tenant's row (or none) is not found, and one with no content is refused", async () => {
    rowQuery({ data: null, error: null });
    await expect(resendAgreementV2('old-1', TENANT)).rejects.toThrow('That agreement was not found.');
    rowQuery({ data: { ...OLD_ROW, content_html: '  ' }, error: null });
    await expect(resendAgreementV2('old-1', TENANT)).rejects.toThrow('no content to resend');
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('not deployed → a clear Error', async () => {
    rowQuery({ data: OLD_ROW, error: null });
    fetchFailure();
    await expect(resendAgreementV2('old-1', TENANT)).rejects.toThrow(AGREEMENTS_SERVICE_MISSING_V2);
  });
});

/* ── sync / document ───────────────────────────────────────────────────── */

describe('syncAgreementsV2', () => {
  it('answers the count', async () => {
    ok({ ok: true, updated: 3 });
    await expect(syncAgreementsV2()).resolves.toEqual({ updated: 3 });
    expect(lastCall()).toEqual({ name: 'agreements-v2', body: { action: 'sync' } });
  });

  it.each([
    ['the request cannot be made', fetchFailure],
    ['the relay fails', relayFailure],
    ["the gateway's own 404", gateway404],
  ])('not deployed (%s) → silently { updated: 0 }', async (_label, arrange) => {
    arrange();
    await expect(syncAgreementsV2()).resolves.toEqual({ updated: 0 });
  });

  it('a real failure throws (the page ignores it)', async () => {
    httpError(500, { ok: false, error: 'The agreements could not be refreshed.' });
    await expect(syncAgreementsV2()).rejects.toThrow('The agreements could not be refreshed.');
  });
});

describe('fetchAgreementDocumentV2', () => {
  it('returns the PDF or the recorded html', async () => {
    ok({ ok: true, kind: 'pdf', base64: 'JVBERi0=', signed: true });
    await expect(fetchAgreementDocumentV2('row-1')).resolves.toEqual({ kind: 'pdf', base64: 'JVBERi0=', signed: true });
    expect(lastCall().body).toEqual({ action: 'document', id: 'row-1' });
    ok({ ok: true, kind: 'html', html: '<p>x</p>' });
    await expect(fetchAgreementDocumentV2('row-2')).resolves.toEqual({ kind: 'html', html: '<p>x</p>' });
  });

  it("the function's own 404 is its sentence, not 'not deployed'", async () => {
    httpError(404, { ok: false, error: 'That agreement was not found.' });
    await expect(fetchAgreementDocumentV2('x')).rejects.toThrow('That agreement was not found.');
  });

  it('not deployed → a clear Error', async () => {
    gateway404();
    await expect(fetchAgreementDocumentV2('x')).rejects.toThrow(AGREEMENTS_SERVICE_MISSING_V2);
  });
});

/* ── the old Next routes are gone ──────────────────────────────────────── */

describe('no code calls the old /api/agreements-v2 routes', () => {
  const SRC = resolve(__dirname, '../..');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it('has no route folder and no caller', () => {
    expect(() => statSync(join(SRC, 'app/api/agreements-v2'))).toThrow();
    expect(() => statSync(join(SRC, 'lib/agreements-v2/server'))).toThrow();
    const callers = files(SRC).filter((f) => /\/api\/agreements-v2|agreements-v2\/server\//.test(readFileSync(f, 'utf8')));
    expect(callers).toEqual([]);
  });
});
