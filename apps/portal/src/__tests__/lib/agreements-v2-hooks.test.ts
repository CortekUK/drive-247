/**
 * Agreements v2 — the three data hooks, against an in-memory Supabase double.
 *
 * The double enforces the two unique indexes `agreement_templates` really has
 * (one active row per tenant+category; one name per tenant+name+category), so
 * a mutation that runs its steps in the wrong order fails here the way it
 * would fail in production, with 23505. It also answers a missing table the way
 * PostgREST does (PGRST205), which is the state of both v2 tables until
 * ops/agreements_v2.sql is applied.
 *
 * What is pinned:
 *  - templates: every category, tenant-scoped, default first then name;
 *    create() never becomes the default and never collides on name;
 *    setDefault() touches one category of one tenant and never leaves it with
 *    no default; update() is tenant-scoped; defaultTemplateFor()'s fallback.
 *  - operator signature: a missing table degrades to null / persisted:false
 *    without throwing; the data URL is validated; other errors throw.
 *  - list: both kinds mapped through toStatusV2, voided dropped, newest sent
 *    first, a missing individual table contributes nothing, other errors throw.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── The Supabase double ─────────────────────────────────────────────────────

type Row = Record<string, any>;
type Err = { code?: string; message: string };
type Call = { table: string; op: string; filters: [string, string, any][]; payload: any; range?: [number, number] };

let db: Record<string, Row[] | undefined> = {};
let calls: Call[] = [];
let failWhen: ((call: Call) => Err | null) | null = null;
let seq = 0;

const missing = (table: string): Err => ({
  code: 'PGRST205',
  message: `Could not find the table 'public.${table}' in the schema cache`,
});

function matches(row: Row, filters: Call['filters']) {
  return filters.every(([kind, col, val]) => {
    if (kind === 'eq') return row[col] === val;
    if (kind === 'neq') return row[col] !== val;
    if (kind === 'in') return (val as unknown[]).includes(row[col]);
    // PostgREST `or`: "col.is.null,col.eq.false" — any clause matching is enough.
    if (kind === 'or') {
      return String(val).split(',').some((clause) => {
        const [c, op, raw] = clause.split('.');
        if (op === 'is' && raw === 'null') return row[c] == null;
        const want = raw === 'true' ? true : raw === 'false' ? false : raw;
        if (op === 'eq') return row[c] === want;
        throw new Error(`fake supabase: unsupported or-clause ${clause}`);
      });
    }
    throw new Error(`fake supabase: unsupported filter ${kind}`);
  });
}

function violatesTemplateIndexes(rows: Row[]): boolean {
  const active = new Set<string>();
  const names = new Set<string>();
  for (const r of rows) {
    const nameKey = `${r.tenant_id}|${r.template_name}|${r.template_category}`;
    if (names.has(nameKey)) return true;
    names.add(nameKey);
    if (r.is_active === true) {
      const key = `${r.tenant_id}|${r.template_category}`;
      if (active.has(key)) return true;
      active.add(key);
    }
  }
  return false;
}

function from(table: string) {
  const state: Call & { returning: boolean; single: null | 'single' | 'maybe'; onConflict?: string } = {
    table,
    op: 'select',
    filters: [],
    payload: null,
    returning: false,
    single: null,
  };

  const run = async (): Promise<{ data: any; error: Err | null }> => {
    const call: Call = { table, op: state.op, filters: state.filters, payload: state.payload, range: state.range };
    calls.push(call);
    const injected = failWhen?.(call);
    if (injected) return { data: null, error: injected };
    const rows = db[table];
    if (!rows) return { data: null, error: missing(table) };

    let result: Row[] = [];
    if (state.op === 'select') {
      result = rows.filter((r) => matches(r, state.filters));
      if (state.range) result = result.slice(state.range[0], state.range[1] + 1);
    } else if (state.op === 'insert') {
      const row = { id: `new-${++seq}`, updated_at: '2026-09-21T00:00:00Z', ...state.payload };
      if (table === 'agreement_templates' && violatesTemplateIndexes([...rows, row])) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      rows.push(row);
      result = [row];
    } else if (state.op === 'update') {
      const hits = rows.filter((r) => matches(r, state.filters));
      const before = hits.map((r) => ({ ...r }));
      hits.forEach((r) => Object.assign(r, state.payload));
      if (table === 'agreement_templates' && violatesTemplateIndexes(rows)) {
        hits.forEach((r, i) => Object.assign(r, before[i]));
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }
      result = hits;
    } else if (state.op === 'delete') {
      const hits = rows.filter((r) => matches(r, state.filters));
      db[table] = rows.filter((r) => !hits.includes(r));
      result = hits;
    } else if (state.op === 'upsert') {
      const key = state.onConflict ?? 'id';
      const existing = rows.find((r) => r[key] === state.payload[key]);
      if (existing) Object.assign(existing, state.payload);
      else rows.push({ ...state.payload });
      result = [existing ?? state.payload];
    }

    if (state.op !== 'select' && !state.returning) return { data: null, error: null };
    if (state.single === 'single') {
      return result.length === 1
        ? { data: result[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    if (state.single === 'maybe') return { data: result[0] ?? null, error: null };
    return { data: result, error: null };
  };

  const b: any = {
    select: (_cols?: string) => {
      if (state.op !== 'select') state.returning = true;
      return b;
    },
    eq: (c: string, v: any) => (state.filters.push(['eq', c, v]), b),
    neq: (c: string, v: any) => (state.filters.push(['neq', c, v]), b),
    in: (c: string, v: any[]) => (state.filters.push(['in', c, v]), b),
    or: (expr: string) => (state.filters.push(['or', '', expr]), b),
    delete: () => ((state.op = 'delete'), b),
    order: () => b,
    range: (f: number, t: number) => ((state.range = [f, t]), b),
    insert: (p: Row) => ((state.op = 'insert'), (state.payload = p), b),
    update: (p: Row) => ((state.op = 'update'), (state.payload = p), b),
    upsert: (p: Row, o?: { onConflict?: string }) => (
      (state.op = 'upsert'), (state.payload = p), (state.onConflict = o?.onConflict), b
    ),
    single: () => ((state.single = 'single'), run()),
    maybeSingle: () => ((state.single = 'maybe'), run()),
    then: (res: any, rej: any) => run().then(res, rej),
  };
  return b;
}

const fake = { from: (table: string) => from(table) };

let tenant: { id: string; slug: string } | null = { id: 't1', slug: 'northwind' };
let appUser: { id: string } | null = { id: 'u1' };

vi.mock('@/integrations/supabase/client', () => ({ supabase: fake, supabaseUntyped: fake }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenant, tenantSlug: tenant?.slug ?? null }) }));
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (s: { appUser: typeof appUser }) => unknown) => select({ appUser }),
  useAuth: () => ({ appUser }),
}));

const {
  useAgreementTemplatesV2,
  useAgreementTemplateMutationsV2,
  defaultTemplateFor,
  uniqueTemplateName,
} = await import('@/hooks/use-agreement-templates-v2');
const { useOperatorSignatureV2, isValidOperatorSignature, OPERATOR_SIGNATURE_MAX_BYTES } = await import(
  '@/hooks/use-operator-signature-v2'
);
const { useAgreementsListV2, fetchAgreementRowsV2 } = await import('@/hooks/use-agreements-list-v2');

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children?: any }): React.JSX.Element =>
    React.createElement(QueryClientProvider, { client }, children);
}

const tpl = (over: Row): Row => ({
  tenant_id: 't1',
  template_content: '<p>x</p>',
  template_category: 'standard',
  is_active: false,
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  db = {};
  calls = [];
  failWhen = null;
  seq = 0;
  tenant = { id: 't1', slug: 'northwind' };
  appUser = { id: 'u1' };
});

// ── Templates ───────────────────────────────────────────────────────────────

describe('useAgreementTemplatesV2', () => {
  beforeEach(() => {
    db.agreement_templates = [
      tpl({ id: 'a', template_name: 'Zeta', is_active: false }),
      tpl({ id: 'b', template_name: 'Default Template', is_active: true }),
      tpl({ id: 'c', template_name: 'Alpha', is_active: null }),
      tpl({ id: 'd', template_name: 'Extension terms', template_category: 'extension', is_active: true }),
      tpl({ id: 'e', template_name: 'Installment', template_category: 'installment', is_active: false }),
      tpl({ id: 'x', tenant_id: 't2', template_name: 'Other tenant', is_active: true }),
    ];
  });

  it('reads every category of THIS tenant, default first then by name', async () => {
    const { result } = renderHook(() => useAgreementTemplatesV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.templates.map((t) => t.id)).toEqual(['b', 'd', 'c', 'e', 'a']);
    expect(result.current.templates.find((t) => t.id === 'x')).toBeUndefined();
    const read = calls.find((c) => c.table === 'agreement_templates' && c.op === 'select')!;
    expect(read.filters).toContainEqual(['eq', 'tenant_id', 't1']);
  });

  it('maps a row to the v2 shape; isDefault is is_active === true, never null', async () => {
    const { result } = renderHook(() => useAgreementTemplatesV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.templates.length).toBe(5));
    const byId = Object.fromEntries(result.current.templates.map((t) => [t.id, t]));
    expect(byId.b).toEqual({
      id: 'b',
      name: 'Default Template',
      content: '<p>x</p>',
      category: 'standard',
      isDefault: true,
      updatedAt: '2026-09-01T00:00:00Z',
    });
    expect(byId.c.isDefault).toBe(false);
    expect(byId.d.category).toBe('extension');
  });

  it('does not query without a tenant', async () => {
    tenant = null;
    const { result } = renderHook(() => useAgreementTemplatesV2(), { wrapper: wrapper() });
    expect(result.current.templates).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('defaultTemplateFor', () => {
  const t = (id: string, category: any, isDefault: boolean) => ({ id, name: id, content: '', category, isDefault, updatedAt: null });

  it("returns the category's own default", () => {
    expect(defaultTemplateFor([t('s', 'standard', true), t('p', 'payg', true)], 'payg')?.id).toBe('p');
  });

  it("falls back to standard's default, as the send engines do", () => {
    expect(defaultTemplateFor([t('s', 'standard', true), t('p', 'payg', false)], 'payg')?.id).toBe('s');
  });

  it('is null when neither exists', () => {
    expect(defaultTemplateFor([t('p', 'payg', false), t('e', 'extension', true)], 'payg')).toBeNull();
  });
});

describe('uniqueTemplateName', () => {
  it('suffixes (2), (3)… until the name is free', () => {
    expect(uniqueTemplateName('Lease', [])).toBe('Lease');
    expect(uniqueTemplateName('Lease', ['Lease'])).toBe('Lease (2)');
    expect(uniqueTemplateName('Lease', ['Lease', 'Lease (2)', 'Lease (3)'])).toBe('Lease (4)');
  });
});

describe('useAgreementTemplateMutationsV2', () => {
  beforeEach(() => {
    db.agreement_templates = [
      tpl({ id: 'def', template_name: 'Default Template', is_active: true }),
      tpl({ id: 'cus', template_name: 'Custom Template', is_active: false }),
      tpl({ id: 'lease', template_name: 'Lease', is_active: false }),
      tpl({ id: 'ext', template_name: 'Extension', template_category: 'extension', is_active: true }),
      tpl({ id: 'other', tenant_id: 't2', template_name: 'Lease', is_active: true }),
    ];
  });

  const mutations = () => renderHook(() => useAgreementTemplateMutationsV2(), { wrapper: wrapper() }).result;

  it('create() inserts a standard template that is NOT the default', async () => {
    const m = mutations();
    const created = await m.current.create({ name: '  Vehicle lease  ', content: '<p>Hi</p>' });
    expect(created).toMatchObject({ name: 'Vehicle lease', content: '<p>Hi</p>', category: 'standard', isDefault: false });
    const row = db.agreement_templates!.find((r) => r.id === created.id)!;
    expect(row).toMatchObject({ tenant_id: 't1', template_category: 'standard', is_active: false });
    // The default did not move.
    expect(db.agreement_templates!.find((r) => r.id === 'def')!.is_active).toBe(true);
  });

  it('create() suffixes a name this tenant already uses, and ignores other tenants', async () => {
    const m = mutations();
    expect((await m.current.create({ name: 'Lease', content: '' })).name).toBe('Lease (2)');
    expect((await m.current.create({ name: 'Lease', content: '' })).name).toBe('Lease (3)');
    expect((await m.current.create({ name: 'Brand new', content: '' })).name).toBe('Brand new');
    const nameRead = calls.find((c) => c.op === 'select' && c.table === 'agreement_templates')!;
    expect(nameRead.filters).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(nameRead.filters).toContainEqual(['eq', 'template_category', 'standard']);
  });

  it('create() names a blank template rather than inserting an empty name', async () => {
    const m = mutations();
    expect((await m.current.create({ name: '   ', content: '' })).name).toBe('Untitled template');
  });

  it('create() retries with the next name when another insert took it first', async () => {
    let raced = false;
    failWhen = (call) => {
      if (call.op === 'insert' && !raced) {
        raced = true;
        // Someone else created "Lease (2)" between our read and our insert.
        db.agreement_templates!.push(tpl({ id: 'race', template_name: 'Lease (2)' }));
        return { code: '23505', message: 'duplicate key value violates unique constraint' };
      }
      return null;
    };
    const m = mutations();
    expect((await m.current.create({ name: 'Lease', content: '' })).name).toBe('Lease (3)');
  });

  it('remove() deletes a non-default template of this tenant only', async () => {
    const m = mutations();
    await m.current.remove('lease');
    expect(db.agreement_templates!.map((r) => r.id)).not.toContain('lease');
    // The other tenant's same-named template is untouched.
    expect(db.agreement_templates!.map((r) => r.id)).toContain('other');
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.filters).toContainEqual(['eq', 'id', 'lease']);
    expect(del.filters).toContainEqual(['eq', 'tenant_id', 't1']);
  });

  it('remove() refuses the default — it is what a rental sends', async () => {
    const m = mutations();
    await expect(m.current.remove('def')).rejects.toThrow(/default/i);
    expect(db.agreement_templates!.map((r) => r.id)).toContain('def');
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('remove() refuses another tenant’s template', async () => {
    const m = mutations();
    await expect(m.current.remove('other')).rejects.toThrow(/not found/i);
    expect(db.agreement_templates!.map((r) => r.id)).toContain('other');
  });

  it('remove() deletes nothing if the template became the default after the check', async () => {
    failWhen = (call) => {
      // Another tab made "lease" the default between our read and our delete.
      if (call.op === 'delete') db.agreement_templates!.find((r) => r.id === 'lease')!.is_active = true;
      return null;
    };
    const m = mutations();
    await expect(m.current.remove('lease')).rejects.toThrow(/just become your default/i);
    expect(db.agreement_templates!.find((r) => r.id === 'lease')).toBeTruthy();
  });

  it('setDefault() swaps the default within the row’s own category only', async () => {
    const m = mutations();
    await m.current.setDefault('lease');
    const active = db.agreement_templates!.filter((r) => r.is_active === true).map((r) => r.id).sort();
    // lease is now standard's default; extension's default and the other
    // tenant's default are untouched.
    expect(active).toEqual(['ext', 'lease', 'other']);
    for (const c of calls.filter((c) => c.op === 'update')) {
      expect(c.filters).toContainEqual(['eq', 'tenant_id', 't1']);
    }
  });

  it('setDefault() deactivates BEFORE it activates (the partial unique index)', async () => {
    const m = mutations();
    await m.current.setDefault('cus');
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates[0].payload).toEqual({ is_active: false });
    expect(updates[0].filters).toContainEqual(['eq', 'template_category', 'standard']);
    expect(updates[1].payload).toMatchObject({ is_active: true });
    expect(updates[1].filters).toContainEqual(['eq', 'id', 'cus']);
  });

  it('setDefault() is a no-op on the current default', async () => {
    const m = mutations();
    await m.current.setDefault('def');
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('setDefault() refuses another tenant’s template', async () => {
    const m = mutations();
    await expect(m.current.setDefault('other')).rejects.toThrow(/not found/i);
    expect(db.agreement_templates!.find((r) => r.id === 'other')!.is_active).toBe(true);
    expect(db.agreement_templates!.find((r) => r.id === 'def')!.is_active).toBe(true);
  });

  it('setDefault() puts the old default back when activating fails', async () => {
    failWhen = (call) =>
      call.op === 'update' && call.payload?.is_active === true && call.filters.some(([, c, v]) => c === 'id' && v === 'lease')
        ? { code: '08006', message: 'connection reset' }
        : null;
    const m = mutations();
    await expect(m.current.setDefault('lease')).rejects.toMatchObject({ code: '08006' });
    // The category is never left without a default.
    expect(db.agreement_templates!.find((r) => r.id === 'def')!.is_active).toBe(true);
    expect(db.agreement_templates!.find((r) => r.id === 'lease')!.is_active).toBe(false);
  });

  it('setDefault() stops, changing nothing, when deactivating fails', async () => {
    failWhen = (call) => (call.op === 'update' && call.payload?.is_active === false ? { code: '42501', message: 'denied' } : null);
    const m = mutations();
    await expect(m.current.setDefault('lease')).rejects.toMatchObject({ code: '42501' });
    expect(db.agreement_templates!.find((r) => r.id === 'def')!.is_active).toBe(true);
    expect(db.agreement_templates!.find((r) => r.id === 'lease')!.is_active).toBe(false);
  });

  it('update() renames and rewrites, scoped to the tenant', async () => {
    const m = mutations();
    await m.current.update('lease', { name: ' Long lease ', content: '<p>New</p>' });
    const row = db.agreement_templates!.find((r) => r.id === 'lease')!;
    expect(row.template_name).toBe('Long lease');
    expect(row.template_content).toBe('<p>New</p>');
    const u = calls.find((c) => c.op === 'update')!;
    expect(u.filters).toContainEqual(['eq', 'tenant_id', 't1']);
    expect(u.filters).toContainEqual(['eq', 'id', 'lease']);
  });

  it('update() with content only leaves the name alone and never touches is_active', async () => {
    const m = mutations();
    await m.current.update('def', { content: '<p>Rewritten</p>' });
    const row = db.agreement_templates!.find((r) => r.id === 'def')!;
    expect(row.template_name).toBe('Default Template');
    expect(row.is_active).toBe(true);
    expect(calls.find((c) => c.op === 'update')!.payload).not.toHaveProperty('is_active');
  });

  it('update() fails on another tenant’s row instead of silently doing nothing', async () => {
    const m = mutations();
    await expect(m.current.update('other', { content: 'hijack' })).rejects.toThrow(/not found/i);
    expect(db.agreement_templates!.find((r) => r.id === 'other')!.template_content).toBe('<p>x</p>');
  });

  it('update() explains a name that is already taken', async () => {
    const m = mutations();
    await expect(m.current.update('lease', { name: 'Custom Template' })).rejects.toThrow(/already exists/);
  });

  it('update() refuses a blank name', async () => {
    const m = mutations();
    await expect(m.current.update('lease', { name: '  ' })).rejects.toThrow(/name/);
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });
});

// ── Operator signature ──────────────────────────────────────────────────────

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('isValidOperatorSignature', () => {
  it('accepts PNG and JPEG data URLs', () => {
    expect(isValidOperatorSignature(PNG)).toBe(true);
    expect(isValidOperatorSignature('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
  });

  it.each([
    ['an SVG, which can carry script', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['a GIF', 'data:image/gif;base64,R0lGODlh'],
    ['a remote URL', 'https://example.com/sig.png'],
    ['a non-base64 payload', 'data:image/png,<svg onload=alert(1)>'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isValidOperatorSignature(value)).toBe(false);
  });

  it('caps the size at 500 kB', () => {
    const prefix = 'data:image/png;base64,';
    const atCap = prefix + 'A'.repeat(OPERATOR_SIGNATURE_MAX_BYTES - prefix.length);
    expect(OPERATOR_SIGNATURE_MAX_BYTES).toBe(512000);
    expect(isValidOperatorSignature(atCap)).toBe(true);
    expect(isValidOperatorSignature(atCap + 'A')).toBe(false);
  });
});

describe('useOperatorSignatureV2', () => {
  it('reads the signed-in staff member’s own row, scoped to the tenant', async () => {
    db.agreement_operator_signatures_v2 = [
      { app_user_id: 'u2', tenant_id: 't1', image_data: 'data:image/png;base64,QQ==' },
      { app_user_id: 'u1', tenant_id: 't1', image_data: PNG },
    ];
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.signature).toBe(PNG));
    const read = calls.find((c) => c.table === 'agreement_operator_signatures_v2')!;
    expect(read.filters).toContainEqual(['eq', 'app_user_id', 'u1']);
    expect(read.filters).toContainEqual(['eq', 'tenant_id', 't1']);
  });

  it('answers null, without an error, while the table does not exist', async () => {
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.signature).toBeNull();
  });

  it('save() resolves { persisted: false } while the table does not exist, and does not throw', async () => {
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await expect(result.current.save(PNG)).resolves.toEqual({ persisted: false });
  });

  it('save() upserts the owner’s row and the hook then shows it', async () => {
    db.agreement_operator_signatures_v2 = [];
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let outcome: { persisted: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.save(PNG);
    });
    expect(outcome).toEqual({ persisted: true });
    expect(db.agreement_operator_signatures_v2).toEqual([
      expect.objectContaining({ app_user_id: 'u1', tenant_id: 't1', image_data: PNG }),
    ]);
    await waitFor(() => expect(result.current.signature).toBe(PNG));
  });

  it('save() replaces, rather than duplicates, an existing signature', async () => {
    db.agreement_operator_signatures_v2 = [{ app_user_id: 'u1', tenant_id: 't1', image_data: 'data:image/png;base64,QQ==' }];
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.save(PNG);
    });
    expect(db.agreement_operator_signatures_v2).toHaveLength(1);
    expect(db.agreement_operator_signatures_v2![0].image_data).toBe(PNG);
  });

  it('save() rejects an invalid image before writing anything', async () => {
    db.agreement_operator_signatures_v2 = [];
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await expect(result.current.save('data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow(/PNG or JPEG/);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
  });

  it('save() throws a real failure instead of hiding it', async () => {
    db.agreement_operator_signatures_v2 = [];
    failWhen = (call) => (call.op === 'upsert' ? { code: '42501', message: 'new row violates row-level security policy' } : null);
    const { result } = renderHook(() => useOperatorSignatureV2(), { wrapper: wrapper() });
    await expect(result.current.save(PNG)).rejects.toMatchObject({ code: '42501' });
  });
});

// ── The list ────────────────────────────────────────────────────────────────

const rental = (over: Row): Row => ({
  tenant_id: 't1',
  rental_id: 'r1111111-aaaa',
  agreement_type: 'original',
  document_id: 'doc-r',
  document_status: 'sent',
  envelope_created_at: '2026-09-10T10:00:00Z',
  envelope_sent_at: '2026-09-10T10:00:05Z',
  envelope_completed_at: null,
  signed_document_id: null,
  created_at: '2026-09-10T10:00:00Z',
  rentals: { id: 'r1111111-aaaa', rental_number: 'R-1001', customers: { name: 'Ada Renter', email: 'ada@example.com' } },
  ...over,
});

const individual = (over: Row): Row => ({
  tenant_id: 't1',
  customer_id: null,
  recipient_name: 'Bo Signer',
  recipient_email: 'bo@example.com',
  cc_emails: ['boss@example.com'],
  title: 'Parking agreement',
  message: 'Please sign',
  template_id: 'tpl-1',
  document_id: 'doc-i',
  document_status: 'sent',
  sent_at: '2026-09-12T08:30:00Z',
  completed_at: null,
  resent_from_id: null,
  created_at: '2026-09-12T08:29:00Z',
  ...over,
});

describe('fetchAgreementRowsV2 / useAgreementsListV2', () => {
  it('maps both kinds, drops voided rows, and sorts newest sent first', async () => {
    db.rental_agreements = [
      rental({ id: 'ra-signed', document_status: 'completed', envelope_completed_at: '2026-09-11T00:00:00Z', signed_document_id: 'cd-1' }),
      rental({ id: 'ra-voided', document_status: 'voided', envelope_sent_at: '2026-09-20T00:00:00Z' }),
      rental({
        id: 'ra-ext',
        agreement_type: 'extension',
        document_status: 'credit_failed',
        envelope_sent_at: null,
        envelope_created_at: null,
        created_at: '2026-09-15T00:00:00Z',
        rentals: { id: 'r2222222-bbbb', rental_number: null, customers: { name: 'Cy', email: 'cy@example.com' } },
        rental_id: 'r2222222-bbbb',
      }),
      rental({ id: 'ra-other-tenant', tenant_id: 't2', envelope_sent_at: '2026-09-30T00:00:00Z' }),
    ];
    db.individual_agreements_v2 = [
      individual({ id: 'ia-1' }),
      individual({ id: 'ia-revoked', document_status: 'revoked', sent_at: '2026-09-25T00:00:00Z' }),
      individual({ id: 'ia-resend', resent_from_id: 'ia-1', sent_at: '2026-09-13T00:00:00Z', document_status: null, cc_emails: null }),
    ];

    const rows = await fetchAgreementRowsV2(fake, 't1');
    expect(rows.map((r) => r.id)).toEqual(['ra-ext', 'ia-resend', 'ia-1', 'ra-signed']);

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId['ra-signed']).toEqual({
      id: 'ra-signed',
      kind: 'rental',
      customerName: 'Ada Renter',
      customerEmail: 'ada@example.com',
      sentAt: '2026-09-10T10:00:05Z',
      status: 'signed',
      rawStatus: 'completed',
      rentalId: 'r1111111-aaaa',
      rentalRef: 'R-1001',
      documentId: 'doc-r',
      templateId: null,
      title: 'Rental agreement',
      message: null,
      cc: [],
      signedAt: '2026-09-11T00:00:00Z',
      signedDocumentId: 'cd-1',
      resentFromId: null,
      hasContentSnapshot: false,
    });
    // No sent time, no rental number: falls back to created_at and the id.
    expect(byId['ra-ext']).toMatchObject({
      status: 'failed',
      sentAt: '2026-09-15T00:00:00Z',
      rentalRef: 'r2222222',
      title: 'Extension agreement',
    });
    expect(byId['ia-1']).toEqual({
      id: 'ia-1',
      kind: 'individual',
      customerName: 'Bo Signer',
      customerEmail: 'bo@example.com',
      sentAt: '2026-09-12T08:30:00Z',
      status: 'pending',
      rawStatus: 'sent',
      rentalId: null,
      rentalRef: null,
      documentId: 'doc-i',
      templateId: 'tpl-1',
      title: 'Parking agreement',
      message: 'Please sign',
      cc: ['boss@example.com'],
      signedAt: null,
      signedDocumentId: null,
      resentFromId: null,
      hasContentSnapshot: true,
    });
    expect(byId['ia-resend']).toMatchObject({ resentFromId: 'ia-1', status: 'pending', cc: [] });
  });

  it('filters both reads by tenant_id', async () => {
    db.rental_agreements = [];
    db.individual_agreements_v2 = [];
    await fetchAgreementRowsV2(fake, 't1');
    const reads = calls.filter((c) => c.op === 'select');
    expect(reads.map((c) => c.table).sort()).toEqual(['individual_agreements_v2', 'rental_agreements']);
    for (const c of reads) expect(c.filters).toContainEqual(['eq', 'tenant_id', 't1']);
  });

  it('lists the rental agreements alone while individual_agreements_v2 does not exist', async () => {
    db.rental_agreements = [rental({ id: 'ra-1' })];
    const rows = await fetchAgreementRowsV2(fake, 't1');
    expect(rows.map((r) => r.id)).toEqual(['ra-1']);
  });

  it('throws any other failure of the individual read', async () => {
    db.rental_agreements = [rental({ id: 'ra-1' })];
    db.individual_agreements_v2 = [];
    failWhen = (call) => (call.table === 'individual_agreements_v2' ? { code: '42501', message: 'permission denied' } : null);
    await expect(fetchAgreementRowsV2(fake, 't1')).rejects.toMatchObject({ code: '42501' });
  });

  it('throws a failure of the rental read', async () => {
    db.individual_agreements_v2 = [];
    failWhen = (call) => (call.table === 'rental_agreements' ? { code: '42703', message: 'column does not exist' } : null);
    await expect(fetchAgreementRowsV2(fake, 't1')).rejects.toMatchObject({ code: '42703' });
  });

  it('pages past the 1000-row response cap', async () => {
    db.rental_agreements = Array.from({ length: 1500 }, (_, i) =>
      rental({ id: `ra-${String(i).padStart(4, '0')}`, envelope_sent_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }),
    );
    db.individual_agreements_v2 = [];
    const rows = await fetchAgreementRowsV2(fake, 't1');
    expect(rows).toHaveLength(1500);
    expect(rows[0].id).toBe('ra-1499');
    const ranges = calls.filter((c) => c.table === 'rental_agreements').map((c) => c.range);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('the hook exposes the rows and does not query without a tenant', async () => {
    db.rental_agreements = [rental({ id: 'ra-1' })];
    const { result } = renderHook(() => useAgreementsListV2(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['ra-1']));
    expect(result.current.error).toBeNull();

    calls = [];
    tenant = null;
    const empty = renderHook(() => useAgreementsListV2(), { wrapper: wrapper() });
    expect(empty.result.current.rows).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
