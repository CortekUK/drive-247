/**
 * agreements-v2 edge function (supabase/functions/agreements-v2).
 *
 * Driven through the function's real entry point, `handleAgreementsV2` in
 * core.ts, with a recording fake of the service-role Supabase client and a
 * recording fake `fetch` standing in for the signing provider. index.ts is only
 * the Deno.serve wrapper around it. Nothing here reaches BoldSign, Supabase or
 * any other live API.
 *
 * Ported from the Next routes' suite it replaces
 * (apps/portal/src/__tests__/lib/agreements-v2-server.test.ts). Pinned (build
 * spec D12, D13, D17, D19, D20):
 *  - auth: no token 401, a viewer or manager may not send, the tenant comes
 *    from the caller's account and never the body, a non-v2 tenant is refused,
 *    a super admin acts for the portal in Origin, and the BoldSign mode goes
 *    through the lean gate (northwind = live);
 *  - validation of every field, the PDF, and the signature tag;
 *  - ORDER: the row is inserted before credits are deducted, and credits are
 *    deducted before the provider is called;
 *  - a provider refusal refunds exactly as /api/esign does and marks the row
 *    send_failed; no credits marks it credit_failed and answers 402;
 *  - the provider payload: Title, Message, CC, DisableEmails false, the signer,
 *    the text-tag definitions and the browser's own PDF bytes;
 *  - a resend is a NEW row pointing back, and never touches the old one;
 *  - the status sync's mapping and bounds, and both kinds of document.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgreementsV2, type AgreementsDepsV2 } from '@fn/agreements-v2/core.ts';
import { tenantSlugFromHost, tenantSlugFromOrigin } from '@fn/agreements-v2/auth.ts';
import { mapDocumentStatus, providerErrorMessage, sendDocument, toIsoTimestamp } from '@fn/agreements-v2/provider.ts';
import { PDF_MAX_BYTES, bytesToBase64, decodePdfBase64 } from '@fn/agreements-v2/pdf-input.ts';
import { contentSizeForLimit, validateIndividualSendV2 } from '@fn/agreements-v2/validation.ts';

/* ── the fake service-role client ─────────────────────────────────────── */

type Filter = [column: string, op: string, value: unknown];
interface Op {
  table: string;
  action: 'select' | 'insert' | 'update';
  columns?: string;
  payload?: any;
  filters: Filter[];
  modifiers: Record<string, unknown>;
  terminal: 'single' | 'maybeSingle' | null;
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const NEW_ROW = '33333333-3333-4333-8333-333333333333';
const OLD_ROW = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = '55555555-5555-4555-8555-555555555555';
const OTHER_TEMPLATE = '66666666-6666-4666-8666-666666666666';

const state = {
  log: [] as string[],
  ops: [] as Op[],
  rpcCalls: [] as Array<{ name: string; params: any }>,
  users: {} as Record<string, string>,
  appUser: null as any,
  grant: null as any,
  tenants: [] as any[],
  portalExperience: {} as Record<string, string | null>,
  templates: [] as any[],
  rows: [] as any[],
  insertError: null as any,
  /** When set, every read of individual_agreements_v2 answers this error. */
  tableError: null as any,
  deduct: null as any,
  env: {} as Record<string, string | undefined>,
  fetchImpl: null as null | ((url: string, init: any) => Promise<Response>),
};

const matches = (row: any, filters: Filter[]) =>
  filters.every(([col, op, value]) => {
    if (op === 'eq') return row[col] === value;
    return true;
  });

function respond(op: Op): { data: any; error: any } {
  const one = (rows: any[]) => (op.terminal ? rows[0] ?? null : rows);
  switch (op.table) {
    case 'app_users':
      return { data: state.appUser, error: null };
    case 'manager_permissions':
      return { data: state.grant, error: null };
    case 'tenants': {
      if (op.columns === 'portal_experience') {
        const id = op.filters.find((f) => f[0] === 'id')?.[2] as string;
        return { data: { portal_experience: state.portalExperience[id] ?? null }, error: null };
      }
      return { data: one(state.tenants.filter((t) => matches(t, op.filters))), error: null };
    }
    case 'agreement_templates':
      return { data: one(state.templates.filter((t) => matches(t, op.filters))), error: null };
    case 'individual_agreements_v2': {
      if (op.action === 'insert') {
        if (state.insertError) return { data: null, error: state.insertError };
        state.rows.push({ id: NEW_ROW, ...op.payload });
        return { data: { id: NEW_ROW }, error: null };
      }
      if (state.tableError) return { data: null, error: state.tableError };
      if (op.action === 'update') return { data: null, error: null };
      return { data: one(state.rows.filter((r) => matches(r, op.filters))), error: null };
    }
    default:
      return { data: null, error: null };
  }
}

function builder(table: string) {
  const op: Op = { table, action: 'select', filters: [], modifiers: {}, terminal: null };
  const run = () => {
    state.ops.push(op);
    state.log.push(`${op.action}:${table}`);
    return Promise.resolve(respond(op));
  };
  const api: any = {
    select(columns?: string) {
      if (op.action === 'select') op.columns = columns;
      return api;
    },
    insert(payload: any) {
      op.action = 'insert';
      op.payload = payload;
      return api;
    },
    update(payload: any) {
      op.action = 'update';
      op.payload = payload;
      return api;
    },
    eq: (c: string, v: unknown) => (op.filters.push([c, 'eq', v]), api),
    not: (c: string, o: string, v: unknown) => (op.filters.push([c, `not.${o}`, v]), api),
    lt: (c: string, v: unknown) => (op.filters.push([c, 'lt', v]), api),
    in: (c: string, v: unknown) => (op.filters.push([c, 'in', v]), api),
    order: (c: string, o: unknown) => ((op.modifiers.order = [c, o]), api),
    limit: (n: number) => ((op.modifiers.limit = n), api),
    maybeSingle: () => ((op.terminal = 'maybeSingle'), run()),
    single: () => ((op.terminal = 'single'), run()),
    then: (resolve: any, reject: any) => run().then(resolve, reject),
  };
  return api;
}

const fakeClient = {
  from: (table: string) => builder(table),
  rpc: async (name: string, params: any) => {
    state.log.push(`rpc:${name}`);
    state.rpcCalls.push({ name, params });
    if (name === 'deduct_credits') return { data: state.deduct, error: null };
    return { data: { success: true }, error: null };
  },
  auth: {
    getUser: async (token: string) =>
      state.users[token]
        ? { data: { user: { id: state.users[token] } }, error: null }
        : { data: { user: null }, error: { message: 'invalid JWT' } },
  },
};

/* ── fixtures ──────────────────────────────────────────────────────────── */

const ORIGIN = 'https://northwind.portal.drive-247.com';
const FUNCTION_URL = 'https://project.supabase.test/functions/v1/agreements-v2';

const northwind = {
  id: TENANT_A,
  slug: 'northwind',
  // Literally 'test' in production: the lean gate must still resolve live.
  boldsign_mode: 'test',
  boldsign_test_brand_id: 'brand-test',
  boldsign_live_brand_id: 'brand-live',
};
const goniko = { ...northwind, id: TENANT_B, slug: 'goniko', boldsign_mode: 'live' };

/** A tiny but real-looking PDF, as the browser would send it. */
const PDF_TEXT = '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n';
const PDF_BYTES = new TextEncoder().encode(PDF_TEXT);
const PDF_BASE64 = bytesToBase64(PDF_BYTES);

/** The FINAL html the browser rendered (substituted, sig1 ensured): stored and tagged exactly as sent. */
const FINAL_HTML = '<h1>Services</h1><p>Between Northwind Rentals and Ada Lovelace.</p><p>Sign: {{@sig1}} Date: {{@date1}}</p>';

const validBody = (over: Record<string, unknown> = {}) => ({
  action: 'send',
  templateId: TEMPLATE,
  contentHtml: FINAL_HTML,
  pdfBase64: PDF_BASE64,
  title: 'Consulting agreement',
  message: '  Please sign by Friday.  ',
  recipientName: 'Ada Lovelace',
  recipientEmail: 'ada@example.com',
  cc: ['boss@example.com', 'legal@example.com'],
  ...over,
});

const sentForms: FormData[] = [];
const fetchCalls: Array<{ url: string; init: any }> = [];
const waited: Promise<unknown>[] = [];
const sleep = vi.fn(async (_ms: number) => undefined);

const recordingFetch = vi.fn(async (url: string, init?: any) => {
  const path = new URL(String(url)).pathname;
  state.log.push(`fetch:${path}`);
  fetchCalls.push({ url: String(url), init });
  if (path === '/v1/document/send') sentForms.push(init.body);
  return state.fetchImpl!(String(url), init);
});

const deps = (): AgreementsDepsV2 => ({
  client: fakeClient,
  fetch: recordingFetch,
  env: (key) => state.env[key],
  now: () => new Date('2026-09-22T12:00:00.000Z'),
  sleep,
  waitUntil: (p) => void waited.push(p),
});

const call = async (
  body: unknown,
  opts: { token?: string | null; origin?: string | null; method?: string; raw?: string } = {},
) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? 'good-token'}`;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const method = opts.method ?? 'POST';
  const req = new Request(FUNCTION_URL, {
    method,
    headers,
    body: method === 'GET' ? undefined : opts.raw ?? JSON.stringify(body),
  });
  const outcome = await handleAgreementsV2(req, deps());
  return { status: outcome.status, json: outcome.body as Record<string, any> };
};

const send = (body: unknown, opts: { token?: string | null; origin?: string | null } = {}) => call(body, opts);

const okSend = async () => new Response(JSON.stringify({ documentId: 'doc-1' }), { status: 200 });

beforeEach(() => {
  state.env = {
    SUPABASE_URL: 'https://project.supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    BOLDSIGN_LIVE_API_KEY: 'live-key',
    BOLDSIGN_TEST_API_KEY: 'test-key',
  };
  state.log = [];
  state.ops = [];
  state.rpcCalls = [];
  state.users = { 'good-token': 'auth-1' };
  state.appUser = { id: 'app-1', tenant_id: TENANT_A, role: 'admin', is_super_admin: false, is_active: true };
  state.grant = null;
  state.tenants = [northwind, goniko];
  state.portalExperience = {};
  state.templates = [
    { id: TEMPLATE, tenant_id: TENANT_A },
    { id: OTHER_TEMPLATE, tenant_id: TENANT_B },
  ];
  state.rows = [];
  state.insertError = null;
  state.tableError = null;
  state.deduct = { success: true, amount_deducted: 7, balance_after: 93 };
  state.fetchImpl = okSend;
  sentForms.length = 0;
  fetchCalls.length = 0;
  waited.length = 0;
  sleep.mockClear();
  recordingFetch.mockClear();
});

const opsOn = (table: string, action?: Op['action']) =>
  state.ops.filter((o) => o.table === table && (!action || o.action === action));
const filterValue = (op: Op, column: string) => op.filters.find((f) => f[0] === column && f[1] === 'eq')?.[2];
const providerCalls = () => fetchCalls.filter((c) => c.url.startsWith('https://api.boldsign.com/'));

/* ── the request itself ────────────────────────────────────────────────── */

describe('the request', () => {
  it('only answers POST', async () => {
    expect((await call(undefined, { method: 'GET' })).status).toBe(405);
    expect(state.log).toEqual([]);
  });

  it('refuses a body that is not JSON, or an unknown action (400), before any auth work', async () => {
    expect((await call(undefined, { raw: 'not json' })).status).toBe(400);
    expect((await call({ action: 'drop' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(state.log).toEqual([]);
  });
});

/* ── auth ──────────────────────────────────────────────────────────────── */

describe('authentication and the tenant', () => {
  it('refuses a request with no token (401) before touching anything', async () => {
    const res = await send(validBody(), { token: null });
    expect(res.status).toBe(401);
    expect(res.json.ok).toBe(false);
    expect(state.log).toEqual([]);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('refuses an invalid token, such as the bare anon key the gateway also admits (401)', async () => {
    const res = await send(validBody(), { token: 'anon-key-jwt' });
    expect(res.status).toBe(401);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
  });

  it.each(['viewer', 'manager'])('a %s may not send (403)', async (role) => {
    state.appUser.role = role;
    state.grant = { tab_key: 'agreements' };
    const res = await send(validBody());
    expect(res.status).toBe(403);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('an inactive account is refused', async () => {
    state.appUser.is_active = false;
    expect((await send(validBody())).status).toBe(403);
  });

  it('an account with no app_users row is refused', async () => {
    state.appUser = null;
    expect((await send(validBody())).status).toBe(403);
  });

  it('takes the tenant from the account, never from the body', async () => {
    const res = await send(validBody({ tenantId: TENANT_B, tenant_id: TENANT_B }));
    expect(res.status).toBe(200);
    const tenantRead = opsOn('tenants').find((o) => o.columns !== 'portal_experience')!;
    expect(filterValue(tenantRead, 'id')).toBe(TENANT_A);
    const insert = opsOn('individual_agreements_v2', 'insert')[0];
    expect(insert.payload.tenant_id).toBe(TENANT_A);
    expect(insert.payload.created_by).toBe('app-1');
  });

  it('refuses a tenant that is not on v2 for agreements (403)', async () => {
    state.appUser.tenant_id = TENANT_B; // goniko: not in the canary list, no portal_experience
    const res = await send(validBody());
    expect(res.status).toBe(403);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('lets in a tenant flagged portal_experience = v2, and signs it live', async () => {
    state.appUser.tenant_id = TENANT_B;
    state.portalExperience[TENANT_B] = 'v2';
    state.templates.push({ id: TEMPLATE, tenant_id: TENANT_B });
    const res = await send(validBody());
    expect(res.status).toBe(200);
    expect(providerCalls()[0].init.headers['X-API-KEY']).toBe('live-key');
  });

  it('northwind is lean, so it signs LIVE although its column says test', async () => {
    const res = await send(validBody());
    expect(res.status).toBe(200);
    expect(providerCalls()[0].init.headers['X-API-KEY']).toBe('live-key');
    // …and it is on integration billing, so no credits at all (D2 of docs/integration-billing).
    expect(state.rpcCalls.find((c) => c.name === 'deduct_credits')).toBeUndefined();
    expect(opsOn('individual_agreements_v2', 'insert')[0].payload.boldsign_mode).toBe('live');
    expect(sentForms[0].get('BrandId')).toBe('brand-live');
  });

  it('a super admin (no tenant of their own) works on the portal in Origin', async () => {
    state.appUser = { id: 'sa-1', tenant_id: null, role: 'head_admin', is_super_admin: true, is_active: true };
    const res = await send(validBody());
    expect(res.status).toBe(200);
    const tenantRead = opsOn('tenants').find((o) => o.columns !== 'portal_experience')!;
    expect(filterValue(tenantRead, 'slug')).toBe('northwind');
    expect(filterValue(tenantRead, 'id')).toBeUndefined();
  });

  it('a super admin with no portal Origin has no tenant (403)', async () => {
    state.appUser = { id: 'sa-1', tenant_id: null, role: 'head_admin', is_super_admin: true, is_active: true };
    expect((await send(validBody(), { origin: 'https://portal.drive-247.com' })).status).toBe(403);
    expect((await send(validBody(), { origin: null })).status).toBe(403);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
  });

  it('Origin never picks the tenant for anyone but a super admin', async () => {
    const res = await send(validBody(), { origin: 'https://goniko.portal.drive-247.com' });
    expect(res.status).toBe(200);
    expect(opsOn('individual_agreements_v2', 'insert')[0].payload.tenant_id).toBe(TENANT_A);
  });

  it('a non-super-admin with no tenant is refused', async () => {
    state.appUser.tenant_id = null;
    expect((await send(validBody())).status).toBe(403);
  });

  it('reads the portal subdomain the way the proxy does', () => {
    expect(tenantSlugFromHost('northwind.portal.drive-247.com')).toBe('northwind');
    expect(tenantSlugFromHost('northwind.portal.localhost:3001')).toBe('northwind');
    expect(tenantSlugFromHost('northwind.localhost:3001')).toBe('northwind');
    expect(tenantSlugFromHost('portal.drive-247.com')).toBeNull();
    expect(tenantSlugFromHost('admin.portal.drive-247.com')).toBeNull();
    expect(tenantSlugFromHost('rentals.example.com')).toBeNull();
    expect(tenantSlugFromOrigin('https://northwind.portal.drive-247.com')).toBe('northwind');
    expect(tenantSlugFromOrigin('http://northwind.portal.localhost:3001')).toBe('northwind');
    expect(tenantSlugFromOrigin('null')).toBeNull();
    expect(tenantSlugFromOrigin('not a url')).toBeNull();
    expect(tenantSlugFromOrigin(undefined)).toBeNull();
  });
});

/* ── validation ────────────────────────────────────────────────────────── */

describe('validation', () => {
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
    ['content over 500 kB', { contentHtml: `<p>{{@sig1}}${'x'.repeat(500 * 1024)}</p>` }, 'contentHtml'],
    ['content with no customer signature tag', { contentHtml: '<p>No fields here.</p>' }, 'contentHtml'],
    ['a template id that is not an id', { templateId: 'drop table' }, 'templateId'],
    ['no PDF', { pdfBase64: undefined }, 'pdfBase64'],
    ['an empty PDF', { pdfBase64: '' }, 'pdfBase64'],
    ['a PDF that is not base64', { pdfBase64: '%%%not-base64%%%' }, 'pdfBase64'],
    ['base64 that is not a PDF', { pdfBase64: bytesToBase64(new TextEncoder().encode('<html>hi</html>')) }, 'pdfBase64'],
    ['a PDF that is a number', { pdfBase64: 12345 }, 'pdfBase64'],
  ])('rejects %s (400) and records nothing', async (_label, over, field) => {
    const res = await send(validBody(over));
    expect(res.status).toBe(400);
    expect(res.json.ok).toBe(false);
    expect(res.json.field).toBe(field);
    expect(typeof res.json.error).toBe('string');
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('refuses a PDF over 10 MB without decoding it', () => {
    const justOver = 'A'.repeat(Math.ceil((PDF_MAX_BYTES + 1) / 3) * 4);
    const r = decodePdfBase64(justOver);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 MB/);
  });

  it('accepts a PDF of exactly 10 MB, and a data: URL prefix', () => {
    const bytes = new Uint8Array(PDF_MAX_BYTES);
    bytes.set(PDF_BYTES);
    const b64 = Buffer.from(bytes).toString('base64');
    expect(decodePdfBase64(b64).ok).toBe(true);
    const r = decodePdfBase64(`data:application/pdf;base64,${PDF_BASE64}`);
    expect(r.ok).toBe(true);
    expect(Array.from(r.bytes!)).toEqual(Array.from(PDF_BYTES));
  });

  it("never stores another tenant's (or a deleted) template id — it is only provenance", async () => {
    const res = await send(validBody({ templateId: OTHER_TEMPLATE }));
    expect(res.status).toBe(200);
    const lookup = opsOn('agreement_templates')[0];
    expect(filterValue(lookup, 'tenant_id')).toBe(TENANT_A);
    expect(filterValue(lookup, 'id')).toBe(OTHER_TEMPLATE);
    const insert = opsOn('individual_agreements_v2', 'insert')[0];
    expect(insert.payload.template_id).toBeNull();
    expect(JSON.stringify(opsOn('individual_agreements_v2'))).not.toContain(OTHER_TEMPLATE);
  });

  it("keeps the tenant's own template id", async () => {
    await send(validBody());
    expect(opsOn('individual_agreements_v2', 'insert')[0].payload.template_id).toBe(TEMPLATE);
  });

  it('accepts a one-off agreement with no template and ten CCs', async () => {
    const cc = Array.from({ length: 10 }, (_, i) => `p${i}@example.com`);
    const res = await send(validBody({ templateId: null, cc }));
    expect(res.status).toBe(200);
    expect(opsOn('agreement_templates')).toHaveLength(0);
    expect(opsOn('individual_agreements_v2', 'insert')[0].payload.template_id).toBeNull();
    expect(sentForms[0].get('CC[9][EmailAddress]')).toBe('p9@example.com');
  });

  it('does not count the operator signature image against the 500 kB', () => {
    const img = `<img data-operator-signature="true" src="data:image/png;base64,${'A'.repeat(400_000)}">`;
    const html = `<p>${'x'.repeat(300_000)}</p>${img}`;
    expect(contentSizeForLimit(html)).toBeLessThan(310_000);
    expect(validateIndividualSendV2(validBody({ contentHtml: html })).ok).toBe(true);
    const pasted = `<p>${'x'.repeat(300_000)}</p><img src="data:image/png;base64,${'A'.repeat(400_000)}">`;
    expect(validateIndividualSendV2(validBody({ contentHtml: pasted })).ok).toBe(false);
  });

  it('trims the message and stores an empty one as null', () => {
    const r = validateIndividualSendV2(validBody({ message: '   ' }));
    expect(r.ok && r.value!.message).toBeNull();
  });
});

/* ── the send ──────────────────────────────────────────────────────────── */

describe('sending', () => {
  // A v2 tenant that still pays for e-signing in credits: the same id and
  // fixture as northwind, flagged portal_experience = v2 under another slug.
  // northwind itself has no credits (integration billing, D2), pinned in its
  // own tests at the end of this block.
  beforeEach(() => {
    state.tenants = [{ ...northwind, slug: 'acme' }, goniko];
    state.portalExperience[TENANT_A] = 'v2';
  });
  it('inserts the row BEFORE deducting credits, and deducts BEFORE calling the provider', async () => {
    const res = await send(validBody());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, id: NEW_ROW, status: 'sent' });

    const order = state.log.filter((e) =>
      ['insert:individual_agreements_v2', 'rpc:deduct_credits', 'fetch:/v1/document/send', 'update:individual_agreements_v2'].includes(e),
    );
    expect(order).toEqual([
      'insert:individual_agreements_v2',
      'rpc:deduct_credits',
      'fetch:/v1/document/send',
      'update:individual_agreements_v2',
    ]);
  });

  it("records the client's FINAL html byte for byte, pending, and deducts against the new row", async () => {
    const tagged = '<p>A {{@init1}}</p><p>{{@sig1}}</p><p>{{@date1}}</p><img data-operator-signature="true" src="data:image/png;base64,iVBORw0KGgo=">';
    await send(validBody({ contentHtml: tagged }));
    const insert = opsOn('individual_agreements_v2', 'insert')[0].payload;
    expect(insert.document_status).toBe('pending');
    expect(insert.content_html).toBe(tagged);
    expect(insert.cc_emails).toEqual(['boss@example.com', 'legal@example.com']);
    expect(insert.message).toBe('Please sign by Friday.');
    expect(insert.title).toBe('Consulting agreement');
    expect(insert.recipient_name).toBe('Ada Lovelace');
    expect(insert.recipient_email).toBe('ada@example.com');
    expect(insert.resent_from_id).toBeNull();

    const deduct = state.rpcCalls.find((c) => c.name === 'deduct_credits')!.params;
    expect(deduct).toEqual({
      p_tenant_id: TENANT_A,
      p_category: 'esign',
      p_description: `E-sign agreement: Ada Lovelace (Ref: ${NEW_ROW.substring(0, 8).toUpperCase()})`,
      p_reference_id: NEW_ROW,
      p_reference_type: 'individual_agreement',
      p_is_test_mode: false,
    });

    const done = opsOn('individual_agreements_v2', 'update').at(-1)!;
    expect(done.payload).toEqual({
      document_id: 'doc-1',
      boldsign_mode: 'live',
      document_status: 'sent',
      sent_at: '2026-09-22T12:00:00.000Z',
      error: null,
    });
    expect(filterValue(done, 'id')).toBe(NEW_ROW);
    expect(filterValue(done, 'tenant_id')).toBe(TENANT_A);
  });

  it('sends Title, Message, CC, the signer, DisableEmails false and the browser PDF to the provider', async () => {
    await send(validBody());
    const form = sentForms[0];
    expect(form.get('Title')).toBe('Consulting agreement');
    expect(form.get('Message')).toBe('Please sign by Friday.');
    expect(form.get('DisableEmails')).toBe('false');
    expect(form.get('UseTextTags')).toBe('true');
    expect(form.get('EnableSigningOrder')).toBe('false');
    expect(form.get('Signers[0][Name]')).toBe('Ada Lovelace');
    expect(form.get('Signers[0][EmailAddress]')).toBe('ada@example.com');
    expect(form.get('Signers[0][SignerType]')).toBe('Signer');
    expect(form.get('CC[0][EmailAddress]')).toBe('boss@example.com');
    expect(form.get('CC[1][EmailAddress]')).toBe('legal@example.com');
    expect(form.get('CC[2][EmailAddress]')).toBeNull();
    // sig1 always, date1 because the document carries it, init1 not.
    expect(form.get('TextTagDefinitions[0][DefinitionId]')).toBe('sig1');
    expect(form.get('TextTagDefinitions[0][Type]')).toBe('Signature');
    expect(form.get('TextTagDefinitions[0][SignerIndex]')).toBe('1');
    expect(form.get('TextTagDefinitions[0][IsRequired]')).toBe('true');
    expect(form.get('TextTagDefinitions[0][Size][Width]')).toBe('250');
    expect(form.get('TextTagDefinitions[0][Size][Height]')).toBe('50');
    expect(form.get('TextTagDefinitions[1][DefinitionId]')).toBe('date1');
    expect(form.get('TextTagDefinitions[1][Type]')).toBe('DateSigned');
    expect(form.get('TextTagDefinitions[1][Size][Width]')).toBe('150');
    expect(form.get('TextTagDefinitions[2][DefinitionId]')).toBeNull();

    const file = form.get('Files') as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('application/pdf');
    expect(file.name).toBe('Agreement.pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PDF_BYTES);

    const provider = providerCalls()[0];
    expect(provider.url).toBe('https://api.boldsign.com/v1/document/send');
    expect(provider.init.method).toBe('POST');
  });

  it('uses BOLDSIGN_BASE_URL when it is set', async () => {
    state.env.BOLDSIGN_BASE_URL = 'https://api-eu.boldsign.test';
    await send(validBody());
    expect(fetchCalls[0].url).toBe('https://api-eu.boldsign.test/v1/document/send');
  });

  it('leaves Message off when there is none, and defines init1 when the document has initials', async () => {
    await send(validBody({ message: '', contentHtml: '<p>{{@sig1}} {{@init1}}</p>' }));
    const form = sentForms[0];
    expect(form.get('Message')).toBeNull();
    expect(form.get('TextTagDefinitions[1][DefinitionId]')).toBe('init1');
    expect(form.get('TextTagDefinitions[1][Type]')).toBe('Initial');
    expect(form.get('TextTagDefinitions[1][Size][Width]')).toBe('100');
    expect(form.get('TextTagDefinitions[1][Size][Height]')).toBe('40');
  });

  it('defines all three tags, in order, when the document has all three', async () => {
    await send(validBody({ contentHtml: '<p>{{@init1}}</p><p>{{@sig1}}</p><p>{{@date1}}</p>' }));
    const ids = [0, 1, 2, 3].map((i) => sentForms[0].get(`TextTagDefinitions[${i}][DefinitionId]`));
    expect(ids).toEqual(['sig1', 'date1', 'init1', null]);
  });

  it('a provider refusal refunds the credits as /api/esign does and marks the row send_failed', async () => {
    state.fetchImpl = async () => new Response(JSON.stringify({ error: 'Invalid signer email' }), { status: 422 });
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ ok: false, id: NEW_ROW, status: 'send_failed' });
    expect(res.json.error).toMatch(/HTTP 422/);
    expect(res.json.error).not.toMatch(/live-key|BoldSign/);

    const refund = state.rpcCalls.find((c) => c.name === 'add_credits')!;
    expect(refund.params).toEqual({
      p_tenant_id: TENANT_A,
      p_amount: 7,
      p_type: 'refund',
      p_description: `Refund: BoldSign send failed (Ref: ${NEW_ROW.substring(0, 8).toUpperCase()})`,
      p_category: 'esign',
      p_is_test_mode: false,
    });
    const failed = opsOn('individual_agreements_v2', 'update').at(-1)!;
    expect(failed.payload).toMatchObject({ document_status: 'send_failed' });
    expect(failed.payload.error).toMatch(/Invalid signer email/);
    expect(filterValue(failed, 'id')).toBe(NEW_ROW);
    expect(filterValue(failed, 'tenant_id')).toBe(TENANT_A);
    expect(state.log.indexOf('rpc:add_credits')).toBeGreaterThan(state.log.indexOf('fetch:/v1/document/send'));
  });

  it('a network failure also refunds and marks send_failed', async () => {
    state.fetchImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ ok: false, id: NEW_ROW, status: 'send_failed' });
    expect(state.rpcCalls.some((c) => c.name === 'add_credits')).toBe(true);
    expect(opsOn('individual_agreements_v2', 'update').at(-1)!.payload.document_status).toBe('send_failed');
  });

  it('an accepted send with no documentId is send_failed but NOT refunded (the document may exist)', async () => {
    state.fetchImpl = async () => new Response(JSON.stringify({}), { status: 200 });
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(res.json.status).toBe('send_failed');
    expect(state.rpcCalls.some((c) => c.name === 'add_credits')).toBe(false);
  });

  it('no credits: the row is marked credit_failed, 402, nothing is sent or refunded, and the tenant is alerted', async () => {
    state.deduct = { success: false, balance: 3, required: 7 };
    const res = await send(validBody());
    expect(res.status).toBe(402);
    expect(res.json).toMatchObject({ ok: false, id: NEW_ROW, status: 'credit_failed' });
    expect(opsOn('individual_agreements_v2', 'update').at(-1)!.payload.document_status).toBe('credit_failed');
    expect(recordingFetch).not.toHaveBeenCalled();
    expect(state.rpcCalls.some((c) => c.name === 'add_credits')).toBe(false);
    // The same critical reminder /api/esign raises.
    const reminder = opsOn('reminders', 'insert')[0];
    expect(reminder.payload).toMatchObject({ rule_code: 'ESIGN_LOW_CREDIT', severity: 'critical', tenant_id: TENANT_A });
  });

  it('a credit check that errors marks the row send_failed and never calls the provider', async () => {
    const original = fakeClient.rpc;
    fakeClient.rpc = async (name: string, params: any) => {
      state.log.push(`rpc:${name}`);
      state.rpcCalls.push({ name, params });
      return { data: null, error: { message: 'function deduct_credits does not exist' } };
    };
    try {
      const res = await send(validBody());
      expect(res.json).toMatchObject({ ok: false, id: NEW_ROW, status: 'send_failed' });
      expect(recordingFetch).not.toHaveBeenCalled();
    } finally {
      fakeClient.rpc = original;
    }
  });

  it('when the table is missing (SQL not applied) nothing is charged or sent (503)', async () => {
    state.insertError = { code: '42P01', message: 'relation "individual_agreements_v2" does not exist' };
    const res = await send(validBody());
    expect(res.status).toBe(503);
    expect(res.json.ok).toBe(false);
    expect(res.json.error).toMatch(/not switched on yet/);
    expect(state.rpcCalls).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('with no signing key the row is marked send_failed before any credit is taken', async () => {
    delete state.env.BOLDSIGN_LIVE_API_KEY;
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(res.json).toMatchObject({ id: NEW_ROW, status: 'send_failed' });
    expect(state.rpcCalls).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('asks the wallet to auto-refill when deduct_credits says so, with the service key, kept alive past the response', async () => {
    state.deduct = { success: true, amount_deducted: 7, balance_after: 20, auto_refill_needed: true };
    await send(validBody());
    const refill = fetchCalls.find((c) => c.url === 'https://project.supabase.test/functions/v1/manage-credit-wallet')!;
    expect(refill.init.headers.Authorization).toBe('Bearer service-key');
    expect(JSON.parse(refill.init.body)).toEqual({ action: 'auto_refill', tenantId: TENANT_A });
    expect(waited).toHaveLength(1);
  });

  it('retries a 429 twice, 15 s then 30 s, like /api/esign', async () => {
    const statuses = [429, 429, 200];
    state.fetchImpl = async () => new Response('{}', { status: statuses.shift()! });
    const res = await sendDocument(new FormData(), 'k', { fetch: recordingFetch, env: (k) => state.env[k], sleep });
    expect(res.status).toBe(200);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([15_000, 30_000]);
    expect(fetchCalls).toHaveLength(3);
  });

  it('gives up after the third 429 and refunds', async () => {
    state.fetchImpl = async () => new Response('{}', { status: 429 });
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(providerCalls()).toHaveLength(3);
    expect(state.rpcCalls.some((c) => c.name === 'add_credits')).toBe(true);
  });

  it('the provider error message never carries more than a short reason', () => {
    expect(providerErrorMessage(500, 'not json')).toBe('The signing service turned the document down (HTTP 500).');
    expect(providerErrorMessage(400, JSON.stringify({ message: 'x'.repeat(1000) })).length).toBeLessThanOrEqual(300);
  });
});

/* ── resend ────────────────────────────────────────────────────────────── */

describe('northwind: e-signing is on the plan, no credits (integration billing)', () => {
  it('sends without checking, taking or alerting on credits', async () => {
    const res = await send(validBody());
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, status: 'sent' });
    expect(state.rpcCalls).toEqual([]);
    expect(opsOn('reminders', 'insert')).toHaveLength(0);
  });

  it('a provider refusal refunds nothing, because nothing was taken', async () => {
    state.fetchImpl = async () => new Response('{"error":"Invalid document"}', { status: 400 });
    const res = await send(validBody());
    expect(res.status).toBe(502);
    expect(state.rpcCalls).toEqual([]);
  });

  it('is never credit_failed, even with an empty wallet', async () => {
    state.deduct = { success: false, balance: 0, required: 7 };
    const res = await send(validBody());
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([]);
  });
});

describe('resend', () => {
  // A v2 tenant that still pays for e-signing in credits: the same id and
  // fixture as northwind, flagged portal_experience = v2 under another slug.
  // northwind itself has no credits (integration billing, D2), pinned in its
  // own tests at the end of this block.
  beforeEach(() => {
    state.tenants = [{ ...northwind, slug: 'acme' }, goniko];
    state.portalExperience[TENANT_A] = 'v2';
  });
  const oldRow = {
    id: OLD_ROW,
    tenant_id: TENANT_A,
    recipient_name: 'Ada Lovelace',
    recipient_email: 'ada@example.com',
    cc_emails: ['boss@example.com'],
    title: 'Consulting agreement',
    message: 'Please sign.',
    template_id: TEMPLATE,
    content_html: '<p>Between Northwind Rentals and Ada Lovelace.</p><p>{{@sig1}}</p>',
    document_status: 'declined',
  };
  const resendBody = () =>
    validBody({
      resendOf: OLD_ROW,
      contentHtml: oldRow.content_html,
      cc: oldRow.cc_emails,
      message: oldRow.message,
    });

  it('makes a NEW row pointing back at the old one, and never touches the old row', async () => {
    state.rows.push({ ...oldRow });
    const res = await send(resendBody());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, id: NEW_ROW, status: 'sent' });

    const lookup = opsOn('individual_agreements_v2', 'select')[0];
    expect(filterValue(lookup, 'id')).toBe(OLD_ROW);
    expect(filterValue(lookup, 'tenant_id')).toBe(TENANT_A);

    const insert = opsOn('individual_agreements_v2', 'insert')[0].payload;
    expect(insert).toMatchObject({
      recipient_name: oldRow.recipient_name,
      recipient_email: oldRow.recipient_email,
      cc_emails: oldRow.cc_emails,
      title: oldRow.title,
      message: oldRow.message,
      template_id: oldRow.template_id,
      content_html: oldRow.content_html,
      resent_from_id: OLD_ROW,
      document_status: 'pending',
    });
    const updates = opsOn('individual_agreements_v2', 'update');
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) expect(filterValue(update, 'id')).toBe(NEW_ROW);
    expect(state.rows.find((r) => r.id === OLD_ROW)).toEqual(oldRow);
    expect(state.rpcCalls.find((c) => c.name === 'deduct_credits')!.params.p_reference_id).toBe(NEW_ROW);
    expect(sentForms[0].get('CC[0][EmailAddress]')).toBe('boss@example.com');
  });

  it("cannot resend another tenant's agreement (404), and nothing is recorded or charged", async () => {
    state.rows.push({ ...oldRow, tenant_id: TENANT_B });
    const res = await send(resendBody());
    expect(res.status).toBe(404);
    expect(opsOn('individual_agreements_v2', 'insert')).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('a resendOf that is not an id is not found (404), without a query', async () => {
    const res = await send(validBody({ resendOf: "1' or '1'='1" }));
    expect(res.status).toBe(404);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
  });

  it('resendOf null is an ordinary send', async () => {
    const res = await send(validBody({ resendOf: null }));
    expect(res.status).toBe(200);
    expect(opsOn('individual_agreements_v2', 'insert')[0].payload.resent_from_id).toBeNull();
  });

  it('a resend while the table is missing is 503, not a crash', async () => {
    state.tableError = { code: 'PGRST205', message: 'Could not find the table' };
    const res = await send(resendBody());
    expect(res.status).toBe(503);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

/* ── sync ──────────────────────────────────────────────────────────────── */

describe('status sync', () => {
  const sync = (token?: string | null) => call({ action: 'sync' }, { token });

  it('maps statuses exactly as /api/esign/status does', () => {
    expect(mapDocumentStatus('WaitingForOthers')).toBe('sent');
    expect(mapDocumentStatus('NeedsSigning')).toBe('sent');
    expect(mapDocumentStatus('InProgress')).toBe('sent');
    expect(mapDocumentStatus('Completed')).toBe('completed');
    expect(mapDocumentStatus('Declined')).toBe('declined');
    expect(mapDocumentStatus('Revoked')).toBe('voided');
    expect(mapDocumentStatus('Expired')).toBe('expired');
    expect(mapDocumentStatus('Draft')).toBe('pending');
    expect(mapDocumentStatus('SomethingNew')).toBe('somethingnew');
  });

  it("updates the tenant's non-terminal rows from the provider and counts the changes", async () => {
    state.rows.push(
      { id: 'r1', tenant_id: TENANT_A, document_id: 'd1', boldsign_mode: 'live', document_status: 'sent' },
      { id: 'r2', tenant_id: TENANT_A, document_id: 'd2', boldsign_mode: 'test', document_status: 'sent' },
      { id: 'r3', tenant_id: TENANT_A, document_id: 'd3', boldsign_mode: 'live', document_status: 'sent' },
    );
    const byDoc: Record<string, any> = {
      d1: { status: 'Completed', completedDate: '2026-09-20T10:00:00Z' },
      d2: { status: 'WaitingForOthers' },
      d3: { status: 'Declined' },
    };
    state.fetchImpl = async (url) => {
      const id = new URL(url).searchParams.get('documentId')!;
      return new Response(JSON.stringify(byDoc[id]), { status: 200 });
    };

    const res = await sync();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, updated: 2 });

    const query = opsOn('individual_agreements_v2', 'select')[0];
    expect(filterValue(query, 'tenant_id')).toBe(TENANT_A);
    expect(query.filters).toContainEqual(['document_id', 'not.is', null]);
    expect(query.filters.find((f) => f[1] === 'not.in')?.[2]).toBe(
      '(completed,signed,declined,voided,expired,revoked,send_failed,credit_failed)',
    );
    // Only rows untouched for 60 s: now is 12:00:00, so the cutoff is 11:59:00.
    expect(query.filters).toContainEqual(['updated_at', 'lt', '2026-09-22T11:59:00.000Z']);
    expect(query.modifiers.limit).toBe(50);
    expect(query.modifiers.order).toEqual(['updated_at', { ascending: true }]);

    const updates = opsOn('individual_agreements_v2', 'update');
    const r1 = updates.find((u) => filterValue(u, 'id') === 'r1')!;
    expect(r1.payload).toMatchObject({ document_status: 'completed', completed_at: '2026-09-20T10:00:00.000Z' });
    expect(filterValue(r1, 'tenant_id')).toBe(TENANT_A);
    expect(updates.find((u) => filterValue(u, 'id') === 'r3')!.payload.document_status).toBe('declined');
    // An unchanged row is still touched, so the next call moves on.
    const r2 = updates.find((u) => filterValue(u, 'id') === 'r2')!;
    expect(r2.payload).toEqual({ document_status: 'sent', updated_at: '2026-09-22T12:00:00.000Z' });

    // Each row is read with the key of the mode it was CREATED in.
    const keyFor = (doc: string) => fetchCalls.find((c) => c.url.includes(`documentId=${doc}`))!.init.headers['X-API-KEY'];
    expect(keyFor('d1')).toBe('live-key');
    expect(keyFor('d2')).toBe('test-key');
    expect(fetchCalls[0].url).toBe('https://api.boldsign.com/v1/document/properties?documentId=d1');
  });

  it('records Signed even when the provider sends its date as epoch seconds', async () => {
    state.rows.push({ id: 'r9', tenant_id: TENANT_A, document_id: 'd9', boldsign_mode: 'live', document_status: 'sent' });
    state.fetchImpl = async () => new Response(JSON.stringify({ status: 'Completed', activityDate: 1758499200 }), { status: 200 });
    const res = await sync();
    expect(res.json).toEqual({ ok: true, updated: 1 });
    const r9 = opsOn('individual_agreements_v2', 'update').find((u) => filterValue(u, 'id') === 'r9')!;
    expect(r9.payload).toMatchObject({ document_status: 'completed', completed_at: new Date(1758499200 * 1000).toISOString() });
  });

  it('falls back to now for completed_at when the provider gives no readable date', async () => {
    state.rows.push({ id: 'r8', tenant_id: TENANT_A, document_id: 'd8', boldsign_mode: 'live', document_status: 'sent' });
    state.fetchImpl = async () => new Response(JSON.stringify({ status: 'Completed', completedDate: 'soon' }), { status: 200 });
    await sync();
    const r8 = opsOn('individual_agreements_v2', 'update').find((u) => filterValue(u, 'id') === 'r8')!;
    expect(r8.payload.completed_at).toBe('2026-09-22T12:00:00.000Z');
  });

  it('a provider that errors for one row leaves that row alone', async () => {
    state.rows.push({ id: 'r7', tenant_id: TENANT_A, document_id: 'd7', boldsign_mode: 'live', document_status: 'sent' });
    state.fetchImpl = async () => new Response('nope', { status: 404 });
    expect((await sync()).json).toEqual({ ok: true, updated: 0 });
    expect(opsOn('individual_agreements_v2', 'update')).toHaveLength(0);
  });

  it('toIsoTimestamp reads seconds, milliseconds, numeric strings and ISO, and rejects junk', () => {
    expect(toIsoTimestamp(1758499200)).toBe(new Date(1758499200 * 1000).toISOString());
    expect(toIsoTimestamp(1758499200000)).toBe(new Date(1758499200000).toISOString());
    expect(toIsoTimestamp('1758499200')).toBe(new Date(1758499200 * 1000).toISOString());
    expect(toIsoTimestamp('2026-09-20T10:00:00Z')).toBe('2026-09-20T10:00:00.000Z');
    for (const junk of [null, undefined, '', 'soon', 0, -5, {}]) expect(toIsoTimestamp(junk)).toBeNull();
  });

  it('answers 0 when the table does not exist yet', async () => {
    state.tableError = { code: 'PGRST205', message: 'Could not find the table' };
    expect((await sync()).json).toEqual({ ok: true, updated: 0 });
  });

  it('is a read: a viewer may sync, a manager only with a grant on the tab', async () => {
    state.appUser.role = 'viewer';
    expect((await sync()).status).toBe(200);
    state.appUser.role = 'manager';
    state.grant = null;
    expect((await sync()).status).toBe(403);
    state.grant = { tab_key: 'agreements' };
    expect((await sync()).status).toBe(200);
    const grantRead = opsOn('manager_permissions')[0];
    expect(filterValue(grantRead, 'app_user_id')).toBe('app-1');
    expect(filterValue(grantRead, 'tab_key')).toBe('agreements');
  });

  it('needs a token', async () => {
    expect((await sync(null)).status).toBe(401);
  });
});

/* ── document ──────────────────────────────────────────────────────────── */

describe('document', () => {
  const doc = (id: unknown) => call({ action: 'document', id });
  const row = (over: Record<string, unknown> = {}) => ({
    id: OLD_ROW,
    tenant_id: TENANT_A,
    document_id: 'doc-9',
    boldsign_mode: 'live',
    document_status: 'completed',
    content_html: '<p>What was sent {{@sig1}}</p>',
    ...over,
  });

  it("returns the provider's PDF as base64, signed once completed", async () => {
    state.rows.push(row());
    state.fetchImpl = async () => new Response(PDF_BYTES, { status: 200 });
    const res = await doc(OLD_ROW);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, kind: 'pdf', signed: true });
    expect(Buffer.from(res.json.base64, 'base64').toString()).toBe(PDF_TEXT);
    expect(fetchCalls[0].url).toBe('https://api.boldsign.com/v1/document/download?documentId=doc-9');
    expect(fetchCalls[0].init.headers['X-API-KEY']).toBe('live-key');
  });

  it('encodes a multi-megabyte PDF correctly (no call-stack overflow)', async () => {
    const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    state.rows.push(row());
    state.fetchImpl = async () => new Response(big, { status: 200 });
    const res = await doc(OLD_ROW);
    expect(res.json.base64).toBe(Buffer.from(big).toString('base64'));
  });

  it('reads a sandbox document with the test key', async () => {
    state.rows.push(row({ boldsign_mode: 'test' }));
    state.fetchImpl = async () => new Response(PDF_BYTES, { status: 200 });
    await doc(OLD_ROW);
    expect(fetchCalls[0].init.headers['X-API-KEY']).toBe('test-key');
  });

  it('is not signed while the row is still out for signature', async () => {
    state.rows.push(row({ document_status: 'sent' }));
    state.fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    expect((await doc(OLD_ROW)).json).toMatchObject({ kind: 'pdf', signed: false });
  });

  it('returns the recorded html when no provider document exists', async () => {
    state.rows.push(row({ document_id: null, document_status: 'send_failed' }));
    expect((await doc(OLD_ROW)).json).toEqual({ ok: true, kind: 'html', html: '<p>What was sent {{@sig1}}</p>' });
    expect(recordingFetch).not.toHaveBeenCalled();
  });

  it('falls back to the html for an unsigned row the provider cannot produce, but never for a signed one', async () => {
    state.fetchImpl = async () => new Response('gone', { status: 404 });
    state.rows.push(row({ document_status: 'sent' }));
    expect((await doc(OLD_ROW)).json).toMatchObject({ kind: 'html' });
    state.rows = [row({ document_status: 'completed' })];
    expect((await doc(OLD_ROW)).status).toBe(502);
  });

  it("is tenant-scoped: another tenant's row is not found", async () => {
    state.rows.push(row({ tenant_id: TENANT_B }));
    expect((await doc(OLD_ROW)).status).toBe(404);
    const lookup = opsOn('individual_agreements_v2', 'select')[0];
    expect(filterValue(lookup, 'tenant_id')).toBe(TENANT_A);
  });

  it('an id that is not an id is not found, without a query', async () => {
    expect((await doc('../etc/passwd')).status).toBe(404);
    expect((await doc(undefined)).status).toBe(404);
    expect(opsOn('individual_agreements_v2')).toHaveLength(0);
  });

  it('a viewer may view', async () => {
    state.appUser.role = 'viewer';
    state.rows.push(row({ document_id: null }));
    expect((await doc(OLD_ROW)).status).toBe(200);
  });
});

/* ── ready ─────────────────────────────────────────────────────────────── */

describe('ready (asked when the send dialog opens)', () => {
  const ready = (token?: string | null) => call({ action: 'ready' }, { token });

  it('says the one-time database update is missing when the table is not there yet', async () => {
    state.tableError = { code: 'PGRST205', message: 'Could not find the table' };
    const res = await ready();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, ready: false, reason: 'database' });
    expect(typeof res.json.message).toBe('string');
  });

  it('says e-signing is not set up when the mode has no key', async () => {
    delete state.env.BOLDSIGN_LIVE_API_KEY;
    delete state.env.BOLDSIGN_TEST_API_KEY;
    delete state.env.BOLDSIGN_API_KEY;
    expect((await ready()).json).toMatchObject({ ok: true, ready: false, reason: 'signing' });
  });

  it('BOLDSIGN_API_KEY alone is enough, as in every v1 route', async () => {
    state.env = { BOLDSIGN_API_KEY: 'shared-key' };
    expect((await ready()).json).toEqual({ ok: true, ready: true, mode: 'live' });
  });

  it('is ready when everything is in place, names the mode, and applies the send gate to the caller', async () => {
    expect((await ready()).json).toEqual({ ok: true, ready: true, mode: 'live' });
    const probe = opsOn('individual_agreements_v2', 'select')[0];
    expect(filterValue(probe, 'tenant_id')).toBe(TENANT_A);
    expect((await ready(null)).status).toBe(401);
    state.appUser.role = 'viewer';
    expect((await ready()).status).toBe(403);
  });

  it('never contacts the signing provider', async () => {
    await ready();
    expect(recordingFetch).not.toHaveBeenCalled();
  });
});
