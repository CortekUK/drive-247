/**
 * The Finances loader against a stand-in for PRODUCTION's PostgREST, driven
 * through the real supabase-js client (so the URLs are the ones production
 * receives).
 *
 * The stand-in knows production's schema — the live DDL captured 2026-09-25
 * (tests/payment-plans/fixtures/live-ddl-2026-09-25.json), plus `invoices`
 * (the generated types) and `payg_accruals` (columns confirmed by the lead) —
 * and answers like PostgREST does:
 *   - an unknown column in select / filter / order  → 400 {code:'42703'}
 *   - a table that is not there (the payment-plan tables, absent in production)
 *       GET  → 404 {code:'PGRST205'}
 *       HEAD → 404 with NO body (HTTP HEAD never carries one)
 *   - otherwise 200 with the rows, at most 1,000 per request.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFinanceData, type FinanceClient } from '@/hooks/use-finances-data';
import { probePaymentPlans, type ProbeClient } from '@/lib/payment-plans-ui/feature';
import { FinanceLoadError } from '@/lib/finances/paging';

const DDL = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../tests/payment-plans/fixtures/live-ddl-2026-09-25.json'), 'utf8'),
) as { columns: { table: string; column: string }[] };

const schema = new Map<string, Set<string>>();
for (const c of DDL.columns) {
  if (!schema.has(c.table)) schema.set(c.table, new Set());
  schema.get(c.table)!.add(c.column);
}
schema.set(
  'invoices',
  new Set(['created_at', 'customer_id', 'delivery_fee', 'due_date', 'extras_total', 'id', 'insurance_premium', 'invoice_date', 'invoice_number', 'notes', 'protection_fee', 'rental_fee', 'rental_id', 'security_deposit', 'service_fee', 'status', 'subtotal', 'tax_amount', 'tenant_id', 'total_amount', 'updated_at', 'vehicle_id']),
);
schema.set(
  'payg_accruals',
  new Set(['id', 'rental_id', 'tenant_id', 'accrual_day_index', 'accrual_window_start', 'accrual_window_end', 'daily_rate', 'tax_amount', 'service_fee_amount', 'is_partial', 'hours_covered', 'ledger_entry_ids', 'created_at', 'invoice_status', 'paid_at', 'settling_payment_id', 'superseded_by_accrual_id']),
);

type Row = Record<string, any>;
let data: Record<string, Row[]>;
let requests: { method: string; table: string; url: string; status: number }[];

/** Split "a,b,rentals!inner(c,d)" at top-level commas. */
function topLevel(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function unknownColumns(table: string, select: string, filterKeys: string[], order: string | null): string[] {
  const cols = schema.get(table)!;
  const bad: string[] = [];
  for (const item of topLevel(select)) {
    const embed = /^(\w+)(?:!\w+)?\((.*)\)$/.exec(item);
    if (embed) {
      const inner = schema.get(embed[1]);
      if (!inner) bad.push(embed[1]);
      else for (const c of topLevel(embed[2])) if (!inner.has(c)) bad.push(`${embed[1]}.${c}`);
    } else if (!cols.has(item)) bad.push(`${table}.${item}`);
  }
  for (const key of filterKeys) {
    const [first, second] = key.split('.');
    if (second) {
      if (!schema.get(first)?.has(second)) bad.push(key);
    } else if (!cols.has(first)) bad.push(`${table}.${first}`);
  }
  if (order) {
    const col = order.split('.')[0];
    if (!cols.has(col)) bad.push(`${table}.${col}`);
  }
  return bad;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function productionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const table = url.pathname.replace(/^\/rest\/v1\//, '');
  const record = (status: number) => requests.push({ method, table, url: url.toString(), status });

  if (!schema.has(table)) {
    record(404);
    if (method === 'HEAD') return new Response(null, { status: 404 });
    return json(404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` });
  }
  const params = url.searchParams;
  const select = params.get('select') ?? '*';
  const filterKeys = [...params.keys()].filter((k) => !['select', 'order', 'offset', 'limit'].includes(k));
  const bad = unknownColumns(table, select === '*' ? 'id' : select, filterKeys, params.get('order'));
  if (bad.length) {
    record(400);
    return json(400, { code: '42703', details: null, hint: null, message: `column ${bad[0]} does not exist` });
  }
  let rows = [...(data[table] ?? [])];
  for (const key of filterKeys) {
    for (const v of params.getAll(key)) {
      const read = (r: Row) => key.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), r);
      if (v.startsWith('eq.')) rows = rows.filter((r) => String(read(r)) === v.slice(3));
      else if (v === 'is.null') rows = rows.filter((r) => read(r) == null);
      else if (v.startsWith('in.(')) {
        const set = new Set(v.slice(4, -1).split(','));
        rows = rows.filter((r) => set.has(String(read(r))));
      }
    }
  }
  rows.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  const offset = Number(params.get('offset') ?? 0);
  const limit = Math.min(Number(params.get('limit') ?? 1000), 1000);
  record(200);
  return json(200, rows.slice(offset, offset + limit));
}

// One real supabase-js client for the file (several would share an auth storage key).
const sharedClient = createClient('https://prod.example.supabase.co', 'anon-key', {
  global: { fetch: productionFetch as typeof fetch },
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = () => sharedClient;

beforeEach(() => {
  requests = [];
  data = {
    rentals: [{ id: 'r1', tenant_id: 't1', customer_id: 'c1', rental_number: 'R1', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false }],
    ledger_entries: Array.from({ length: 170 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      tenant_id: 't1',
      type: 'Charge',
      rental_id: 'r1',
      customer_id: 'c1',
      category: 'Tax',
      amount: 1,
      remaining_amount: 1,
      due_date: '2026-09-01',
      entry_date: '2026-09-01',
    })),
    payments: [],
    payment_applications: [],
    payg_accruals: [],
    invoices: [],
    rental_extensions: [],
    customers: [{ id: 'c1', tenant_id: 't1', name: 'Ada' }],
    vehicles: [],
  };
});

describe('against production (the payment-plan tables absent)', () => {
  it('the feature probe says "missing" — it GETs, so the 404 carries its PGRST205 body', async () => {
    const verdict = await probePaymentPlans(client() as unknown as ProbeClient);
    // It used to send a HEAD: a 404 with no body, which postgrest-js reads as
    // success, so production said "available" and every plan read failed.
    expect(requests).toEqual([expect.objectContaining({ method: 'GET', table: 'payment_plans', status: 404 })]);
    expect(verdict).toBe('missing');
  });

  it('so the loader confirms with a GET, reads no plan table, never selects the occurrence column, and loads', async () => {
    const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, /* probe said */ true);
    expect(raw.plansAvailable).toBe(false);
    expect([raw.plans, raw.occurrences, raw.attempts]).toEqual([[], [], []]);
    expect(raw.charges).toHaveLength(170);
    const planReads = requests.filter((r) => r.table.startsWith('payment_plan'));
    expect(planReads.map((r) => `${r.method} ${r.table} ${r.status}`)).toEqual(['GET payment_plans 404']);
    expect(requests.filter((r) => r.table === 'payments').every((r) => !r.url.includes('payment_plan_occurrence_id'))).toBe(true);
    // Every other request was valid against the live schema.
    expect(requests.filter((r) => !r.table.startsWith('payment_plan') && r.status !== 200)).toEqual([]);
  });

  it('every select, filter and order names a column production has (the embedded rentals!inner read included)', async () => {
    await loadFinanceData(client() as unknown as FinanceClient, 't1', { customerId: 'c1' }, false);
    const tables = new Set(requests.map((r) => r.table));
    for (const t of ['rentals', 'ledger_entries', 'payments', 'payg_accruals', 'payment_applications', 'invoices', 'rental_extensions', 'customers']) {
      expect(tables.has(t), t).toBe(true);
    }
    expect(requests.filter((r) => r.status !== 200)).toEqual([]);
    const accrualUrl = decodeURIComponent(requests.find((r) => r.table === 'payg_accruals')!.url);
    expect(accrualUrl).toContain('rentals!inner(customer_id,payg_closed_at)');
    expect(accrualUrl).toContain('rentals.payg_closed_at=is.null');
    expect(accrualUrl).toContain('rentals.customer_id=eq.c1');
    expect(accrualUrl).toContain('order=id.asc');
    expect(accrualUrl).toMatch(/offset=0&limit=1000|limit=1000&offset=0|limit=1000/);
  });

  it('keeps every request URL well under the proxy limit (80 ids per chunk)', async () => {
    await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, false);
    const allocationReads = requests.filter((r) => r.table === 'payment_applications');
    expect(allocationReads).toHaveLength(3); // 170 charge ids → 80 + 80 + 10
    const longest = Math.max(...requests.map((r) => r.url.length));
    expect(longest).toBeLessThan(4000);
  });

  it('a column production lacks is a named error, with the PostgREST code', async () => {
    schema.get('ledger_entries')!.delete('reference');
    try {
      const err = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, false).catch((e) => e);
      expect(err).toBeInstanceOf(FinanceLoadError);
      expect([err.label, err.code, err.pgMessage]).toEqual(['charges', '42703', 'column ledger_entries.reference does not exist']);
      expect(err.devText).toBe('charges — 42703: column ledger_entries.reference does not exist');
    } finally {
      schema.get('ledger_entries')!.add('reference');
    }
  });
});

describe('once the plan migration is applied', () => {
  it('reads the plan tables and the occurrence column', async () => {
    schema.set('payment_plans', new Set(['id', 'tenant_id', 'rental_id', 'customer_id', 'status', 'timezone']));
    schema.set('payment_plan_occurrences', new Set(['id', 'tenant_id', 'plan_id', 'rental_id', 'seq', 'due_date', 'amount', 'amount_paid', 'collection_method', 'status', 'next_attempt_at']));
    schema.set('payment_plan_attempts', new Set(['id', 'tenant_id', 'occurrence_id', 'attempt_no', 'status', 'provider', 'provider_account', 'provider_mode', 'provider_ref', 'checkout_session_id', 'payment_id', 'decline_code', 'error_code', 'created_by', 'created_at']));
    schema.get('payments')!.add('payment_plan_occurrence_id');
    try {
      const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, true);
      expect(raw.plansAvailable).toBe(true);
      expect(requests.filter((r) => r.status !== 200)).toEqual([]);
      expect(requests.some((r) => r.table === 'payments' && r.url.includes('payment_plan_occurrence_id'))).toBe(true);
    } finally {
      schema.delete('payment_plans');
      schema.delete('payment_plan_occurrences');
      schema.delete('payment_plan_attempts');
      schema.get('payments')!.delete('payment_plan_occurrence_id');
    }
  });

  it('a database caught between the tables and the column still loads (occurrence column retried without)', async () => {
    schema.set('payment_plans', new Set(['id', 'tenant_id', 'rental_id', 'customer_id', 'status', 'timezone']));
    schema.set('payment_plan_occurrences', new Set(['id', 'tenant_id', 'plan_id', 'rental_id', 'seq', 'due_date', 'amount', 'amount_paid', 'collection_method', 'status', 'next_attempt_at']));
    schema.set('payment_plan_attempts', new Set(['id', 'tenant_id', 'occurrence_id', 'attempt_no', 'status', 'provider', 'provider_account', 'provider_mode', 'provider_ref', 'checkout_session_id', 'payment_id', 'decline_code', 'error_code', 'created_by', 'created_at']));
    try {
      const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, true);
      expect(raw.plansAvailable).toBe(true);
      const paymentReads = requests.filter((r) => r.table === 'payments').map((r) => r.status);
      expect(paymentReads).toEqual([400, 200]);
    } finally {
      schema.delete('payment_plans');
      schema.delete('payment_plan_occurrences');
      schema.delete('payment_plan_attempts');
    }
  });
});

/* ── added Sep 26 2026 (Finances polish): off-platform payments, and invoices under a scope ── */

const paymentRow = (id: string, extra: Row = {}): Row => ({
  id,
  tenant_id: 't1',
  customer_id: 'c1',
  rental_id: 'r1',
  amount: 10,
  remaining_amount: 0,
  status: 'Applied',
  payment_type: 'Payment',
  method: 'Cash',
  payment_date: '2026-09-20',
  created_at: '2026-09-20T10:00:00Z',
  verification_status: 'approved',
  ...extra,
});

describe('payments.is_off_platform — read only once it exists, never by a failing request', () => {
  it('before the balance migration: one select=* probe, every request valid, no flags', async () => {
    data.payments = [paymentRow('p1')];
    const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, false);
    expect(raw.offPlatformAvailable).toBe(false);
    expect(raw.payments.map((p) => p.is_off_platform)).toEqual([undefined]);
    expect(requests.filter((r) => r.status !== 200)).toEqual([]);
    const paymentUrls = requests.filter((r) => r.table === 'payments').map((r) => decodeURIComponent(r.url));
    expect(paymentUrls).toHaveLength(2);
    expect(paymentUrls[1]).toContain('select=*');
    expect(paymentUrls[1]).toContain('limit=1');
    expect(paymentUrls.every((u) => !u.includes('is_off_platform'))).toBe(true);
  });

  it('no payments, no probe: the payments table is read once', async () => {
    await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, false);
    expect(requests.filter((r) => r.table === 'payments')).toHaveLength(1);
  });

  it('after the migration: reads the flagged ids, narrowed like the payments, and marks exactly those', async () => {
    schema.get('payments')!.add('is_off_platform');
    try {
      data.payments = [paymentRow('p1', { is_off_platform: false }), paymentRow('p2', { is_off_platform: true }), paymentRow('p3', { is_off_platform: true, customer_id: 'c2', rental_id: 'r2' })];
      const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', { customerId: 'c1' }, false);
      expect(raw.offPlatformAvailable).toBe(true);
      expect(raw.payments.map((p) => [p.id, p.is_off_platform])).toEqual([
        ['p1', false],
        ['p2', true],
      ]);
      expect(requests.filter((r) => r.status !== 200)).toEqual([]);
      const flagged = decodeURIComponent(requests.filter((r) => r.table === 'payments').at(-1)!.url);
      expect(flagged).toContain('select=id');
      expect(flagged).toContain('is_off_platform=eq.true');
      expect(flagged).toContain('customer_id=eq.c1');
      expect(flagged).toContain('tenant_id=eq.t1');
    } finally {
      schema.get('payments')!.delete('is_off_platform');
    }
  });

  it('a database caught mid-migration (the probe sees the key, the column read fails 42703) loads without flags', async () => {
    data.payments = [paymentRow('p1', { is_off_platform: true })];
    const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', {}, false);
    expect(raw.offPlatformAvailable).toBe(false);
    expect(raw.payments.map((p) => p.is_off_platform)).toEqual([undefined]);
    expect(requests.filter((r) => r.table === 'payments').map((r) => r.status)).toEqual([200, 200, 400]);
  });
});

describe('invoices under a scope', () => {
  it('are read for the scope’s OWN rentals — never for a rental pulled in by a payment', async () => {
    data.rentals = [
      { id: 'r1', tenant_id: 't1', customer_id: 'c1', rental_number: 'R1', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false },
      { id: 'r2', tenant_id: 't1', customer_id: 'c2', rental_number: 'R2', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false },
    ];
    // c1 paid something recorded against c2's rental: r2 is read (to name it), its invoices are not.
    data.payments = [paymentRow('p1', { rental_id: 'r2' })];
    data.invoices = [
      { id: 'i1', tenant_id: 't1', rental_id: 'r1', invoice_number: 'INV-1', created_at: '2026-09-01T00:00:00Z', total_amount: 10, invoice_date: '2026-09-01', status: 'pending', customer_id: 'c1' },
      { id: 'i2', tenant_id: 't1', rental_id: 'r2', invoice_number: 'INV-2', created_at: '2026-09-02T00:00:00Z', total_amount: 20, invoice_date: '2026-09-02', status: 'pending', customer_id: 'c2' },
    ];
    const raw = await loadFinanceData(client() as unknown as FinanceClient, 't1', { customerId: 'c1' }, false);
    expect(raw.rentals.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    expect(raw.invoices.map((i) => i.id)).toEqual(['i1']);
    const invoiceUrl = decodeURIComponent(requests.find((r) => r.table === 'invoices')!.url);
    expect(invoiceUrl).toContain('rental_id=in.(r1)');
    // Every invoice column the model reads exists in production.
    expect(requests.filter((r) => r.table === 'invoices' && r.status !== 200)).toEqual([]);
  });
});
