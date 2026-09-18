import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { calendarClock } from '../../../../../supabase/functions/trax-support/support/calendar-clock';
import { createBusinessReads, type BusinessDatabase, type BusinessContext } from '../../../../../supabase/functions/trax-support/support/business-query';
import { generateReport, parseReportRequest, DOWNLOAD_TTL_SECONDS, type ReportStore, type ReportJob, type JobState } from '../../../../../supabase/functions/trax-support/support/report-tools';
import type { SupportContext, Permission } from '../../../../../supabase/functions/trax-support/support/types';
import { configuredReports, type ReportDatabase } from '../../../../../supabase/functions/trax-support/support/report-store';
import { MODEL_TOOLS } from '../../../../../supabase/functions/trax-support/support/model-tools';
import { postgrestShim, type Row, type Statement } from '../helpers/postgrest-shim';

/*
 * Report generation.
 *
 * The property that matters: a report is not a second calculation. It runs the
 * same query the answer runs and formats that one result, so the file and the
 * summary cannot disagree. These tests read the produced file back and compare it
 * with the figures the same call returned.
 *
 * The store is in-memory here. The real one writes to a private bucket and a job
 * table created by docs/trax/pending-migrations/01-trax-report-jobs.sql, applied
 * 2026-09-18 — but nothing here touches storage or a live database.
 */
const tenant = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const customerA = '00000000-0000-4000-8000-0000000000a1';
const now = Date.parse('2026-09-18T09:00:00Z');
const clock = calendarClock(fromZonedTime, formatInTimeZone);

let tables: Record<string, Row[]>;
let statements: Statement[];
let role: SupportContext['role'];
let permissions: Permission[];
let scopes: string[];
let store: ReportStore & { jobs: Map<string, ReportJob>; objects: Map<string, { bytes: Uint8Array; contentType: string }>; signed: string[]; failPut?: boolean };

function memoryStore() {
  const jobs = new Map<string, ReportJob>();
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const signed: string[] = [];
  let counter = 0;
  const made = {
    jobs, objects, signed, failPut: false as boolean | undefined,
    async createJob(job: Omit<ReportJob, 'id' | 'state'> & { state: JobState }) {
      const id = `job-${++counter}`;
      jobs.set(id, { ...job, id });
      return { id };
    },
    async updateJob(id: string, patch: Partial<ReportJob>) {
      jobs.set(id, { ...jobs.get(id)!, ...patch });
    },
    async put(path: string, bytes: Uint8Array, contentType: string) {
      if (made.failPut) throw new Error('storage unavailable');
      objects.set(path, { bytes, contentType });
    },
    async signedUrl(path: string, expiresIn: number) {
      signed.push(`${path}|${expiresIn}`);
      return `https://storage.test/signed/${path}?exp=${expiresIn}`;
    },
  };
  return made;
}

const auth = (): SupportContext => ({
  userId: 'user', staffId: 'staff-a', tenant: { id: tenant, slug: 'acme-hire', status: 'active' } as never,
  role, superAdmin: false, permissions, scope: 'scope',
} as SupportContext);
const context = (): BusinessContext & { reports: ReportStore } => {
  const shim = postgrestShim(() => tables, statements);
  return {
    auth: auth(),
    business: createBusinessReads(shim.database as unknown as BusinessDatabase),
    clock, now,
    timezone: async () => 'Europe/London',
    currency: async () => 'GBP',
    financeScopes: scopes,
    reports: store,
  } as unknown as BusinessContext & { reports: ReportStore };
};

beforeEach(() => {
  statements = []; role = 'admin'; permissions = []; scopes = ['rental_payments', 'account_balance'];
  store = memoryStore() as typeof store;
  tables = {
    vehicles: [
      { id: 'v1', tenant_id: tenant, reg: 'ACME-1', make: 'Toyota', model: 'Yaris', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true },
      { id: 'v2', tenant_id: tenant, reg: 'ACME-2', make: 'Ford', model: 'Focus', status: 'Available', is_paused: false, is_disposed: false, show_on_website: false },
      { id: 'v9', tenant_id: other, reg: 'BOR-9', make: 'Kia', model: 'Ceed', status: 'Available', is_paused: false, is_disposed: false, show_on_website: true },
    ],
    payments: [
      { id: 'p1', tenant_id: tenant, customer_id: customerA, amount: 1234.5, refund_amount: 0, status: 'Applied', capture_status: null, payment_date: '2026-08-04', payment_type: 'Card', remaining_amount: 0 },
      { id: 'p2', tenant_id: tenant, customer_id: customerA, amount: 99.99, refund_amount: 0, status: 'Applied', capture_status: null, payment_date: '2026-08-20', payment_type: 'Transfer', remaining_amount: 0 },
      { id: 'p9', tenant_id: other, customer_id: 'foreign', amount: 7777, refund_amount: 0, status: 'Applied', capture_status: null, payment_date: '2026-08-20', payment_type: 'Card', remaining_amount: 0 },
    ],
    customers: [
      { id: customerA, tenant_id: tenant, name: 'Ada Okafor', status: 'active' },
      { id: 'foreign', tenant_id: other, name: 'Borealis Customer', status: 'active' },
    ],
    rentals: [{ id: 'r1', tenant_id: tenant, customer_id: customerA, status: 'Active', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null }],
    ledger_entries: [{ id: 'l1', tenant_id: tenant, customer_id: customerA, rental_id: 'r1', type: 'Charge', category: 'Rental', due_date: '2026-09-01', remaining_amount: 250 }],
    payg_accruals: [],
  };
});

const reportOf = (result: Awaited<ReturnType<typeof generateReport>>) => (result.data as {
  report: { jobId: string; state: JobState; format: string; filename: string; rows: number; bytes: number; downloadUrl: string; expiresInSeconds: number; contains: string };
}).report;
const answerOf = (result: Awaited<ReturnType<typeof generateReport>>) => (result.data as {
  answer: { groups: { label: string; value: string; currency?: string | null }[]; total?: string; definition: string };
}).answer;
const decode = (path: string) => new TextDecoder().decode(store.objects.get(path)!.bytes);

describe('a report is the same measurement as the answer', () => {
  it('writes the figure the query returned, not a recalculation', async () => {
    const result = await generateReport({ dataset: 'payments', metric: 'collected', format: 'csv', period: { basis: 'payment_date', preset: 'last_month' } }, context());
    const report = reportOf(result);
    const answer = answerOf(result);
    // 1234.50 + 99.99 for this account only.
    expect(answer.groups[0].value).toBe('1334.49');
    const csv = decode(report.filename ? [...store.objects.keys()].find((k) => k.endsWith(report.filename))! : '');
    expect(csv).toContain('1334.49');
    // The other account's 7,777 is in neither.
    expect(csv).not.toContain('7777');
    expect(JSON.stringify(answer)).not.toContain('7777');
  });

  it('carries the definition, period and timezone into the file', async () => {
    const result = await generateReport({ dataset: 'payments', metric: 'collected', format: 'csv', period: { basis: 'payment_date', preset: 'last_month' } }, context());
    const csv = decode([...store.objects.keys()][0]);
    expect(csv).toContain('Definition:');
    expect(csv).toContain('Money the application records as received');
    expect(csv).toContain('2026-08-01 to 2026-08-31');
    expect(csv).toContain('Europe/London');
    // Whose data it is, stated in the file itself.
    expect(csv).toContain('acme-hire');
    expect(csv).toContain("this account's records only");
  });

  it('produces a readable xlsx with the figure as a number', async () => {
    const result = await generateReport({ dataset: 'payments', metric: 'collected', format: 'xlsx', groupBy: 'payment_type' }, context());
    const [path] = [...store.objects.keys()];
    expect(store.objects.get(path)!.contentType).toContain('spreadsheetml');
    const archive = await JSZip.loadAsync(store.objects.get(path)!.bytes);
    const sheet = await archive.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<v>1234.50</v>');
    expect(sheet).toContain('<v>99.99</v>');
    expect(reportOf(result).rows).toBe(2);
  });

  it('produces a pdf', async () => {
    const result = await generateReport({ dataset: 'vehicles', metric: 'vehicle_count', format: 'pdf' }, context());
    const [path] = [...store.objects.keys()];
    expect(store.objects.get(path)!.contentType).toBe('application/pdf');
    const head = new TextDecoder().decode(store.objects.get(path)!.bytes.subarray(0, 5));
    expect(head).toBe('%PDF-');
    expect(reportOf(result).format).toBe('pdf');
  });

  it('reports balances, with outstanding, credit and net columns', async () => {
    const result = await generateReport({ report: 'customer_balances', format: 'csv' }, context());
    const csv = decode([...store.objects.keys()][0]);
    expect(csv).toContain('Outstanding');
    expect(csv).toContain('Ada Okafor');
    expect(csv).toContain('250.00');
    expect(answerOf(result).groups[0].value).toBe('250.00');
  });
});

describe('the job record', () => {
  it('moves queued -> running -> ready and records the file', async () => {
    const result = await generateReport({ dataset: 'vehicles', metric: 'vehicle_count', format: 'csv' }, context());
    const report = reportOf(result);
    const job = store.jobs.get(report.jobId)!;
    expect(job.state).toBe('ready');
    expect(job.tenantId).toBe(tenant);
    expect(job.requestedBy).toBe('staff-a');
    expect(job.kind).toBe('vehicles.vehicle_count');
    expect(job.rows).toBe(1);
    expect(job.bytes).toBeGreaterThan(0);
    expect(job.path).toBe(report.filename ? `${tenant}/${report.filename}` : job.path);
  });

  it('records a failure instead of failing silently, and creates no file', async () => {
    store.failPut = true;
    await expect(generateReport({ dataset: 'vehicles', metric: 'vehicle_count', format: 'csv' }, context()))
      .rejects.toMatchObject({ code: 'report_failed' });
    const [job] = [...store.jobs.values()];
    expect(job.state).toBe('failed');
    expect(job.error).toContain('storage unavailable');
    expect(store.objects.size).toBe(0);
    expect(store.signed).toEqual([]);
  });

  it('issues a time-limited link, and nothing longer', async () => {
    const result = await generateReport({ dataset: 'vehicles', metric: 'vehicle_count', format: 'csv' }, context());
    expect(reportOf(result).expiresInSeconds).toBe(DOWNLOAD_TTL_SECONDS);
    expect(DOWNLOAD_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(store.signed[0]).toContain(`|${DOWNLOAD_TTL_SECONDS}`);
  });
});

describe('the account boundary', () => {
  it('writes under the asking account’s prefix and nowhere else', async () => {
    await generateReport({ dataset: 'payments', metric: 'collected', format: 'csv' }, context());
    for (const path of store.objects.keys()) {
      expect(path.startsWith(`${tenant}/`)).toBe(true);
      expect(path).not.toContain(other);
    }
    // And the query beneath it was scoped before it ran.
    for (const statement of statements) expect(statement.filters[0]).toBe(`tenant_id=eq.${tenant}`);
  });

  it('refuses a money report without the finance permission, before any job or file', async () => {
    scopes = [];
    await expect(generateReport({ dataset: 'payments', metric: 'collected', format: 'csv' }, context()))
      .rejects.toMatchObject({ code: 'finance_restricted' });
    expect(store.jobs.size).toBe(0);
    expect(store.objects.size).toBe(0);
    expect(statements).toEqual([]);
  });

  it('refuses a balances report for a role that cannot read customers', async () => {
    role = 'manager'; permissions = []; scopes = ['rental_payments'];
    await expect(generateReport({ report: 'customer_balances', format: 'pdf' }, context()))
      .rejects.toMatchObject({ code: 'restricted' });
    expect(store.jobs.size).toBe(0);
  });

  it('cannot be pointed at another account by the request', async () => {
    await expect(generateReport({ dataset: 'payments', metric: 'collected', format: 'csv', filters: [{ field: 'tenant_id', op: 'eq', value: other }] }, context()))
      .rejects.toThrow(/not a field/);
    expect(store.jobs.size).toBe(0);
  });
});

describe('what may be asked for', () => {
  it('accepts only the three formats', () => {
    for (const format of ['csv', 'xlsx', 'pdf']) {
      expect(parseReportRequest({ dataset: 'vehicles', metric: 'vehicle_count', format }).format).toBe(format);
    }
    for (const bad of ['docx', 'html', 'exe', '']) {
      expect(() => parseReportRequest({ dataset: 'vehicles', metric: 'vehicle_count', format: bad })).toThrow(/csv, xlsx or pdf/);
    }
  });

  it('defaults to csv, and refuses a request that names nothing', () => {
    expect(parseReportRequest({ dataset: 'vehicles', metric: 'vehicle_count' }).format).toBe('csv');
    expect(() => parseReportRequest({ format: 'pdf' })).toThrow(/Say which report/);
    expect(() => parseReportRequest({ report: 'everything', format: 'pdf' })).toThrow(/Say which report/);
  });

  it('rejects an unsupported argument rather than ignoring it', () => {
    expect(() => parseReportRequest({ dataset: 'vehicles', metric: 'vehicle_count', tenantId: other })).toThrow();
    expect(() => parseReportRequest({ dataset: 'vehicles', metric: 'vehicle_count', sql: 'select 1' })).toThrow();
  });

  it('says so when storage is not configured, rather than claiming a file', async () => {
    const env = { ...context(), reports: undefined } as unknown as BusinessContext & { reports: ReportStore };
    await expect(generateReport({ dataset: 'vehicles', metric: 'vehicle_count', format: 'csv' }, env))
      .rejects.toMatchObject({ code: 'reports_unavailable' });
  });
});

/*
 * Whether reports are offered at all.
 *
 * This used to need TRAX_REPORTS=enabled. The flag was the honest default while the
 * bucket and job table did not exist, but it is not what makes reports safe: the
 * store refuses honestly when they are missing. These tests pin both halves of that
 * claim, because the default being wrong is the difference between TRAX producing a
 * file and TRAX insisting it cannot.
 */
describe('report availability', () => {
  const db = () => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'relation "trax_report_jobs" does not exist' } }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: null, error: null }) }) },
  }) as unknown as ReportDatabase;

  it('is offered with no environment variable set at all', () => {
    expect(configuredReports(db(), () => undefined)).toBeDefined();
  });

  it('is withheld only by TRAX_REPORTS=disabled, and not by any other value', () => {
    expect(configuredReports(db(), k => (k === 'TRAX_REPORTS' ? 'disabled' : undefined))).toBeUndefined();
    for (const value of ['enabled', 'DISABLED', 'false', '0', '']) {
      expect(configuredReports(db(), k => (k === 'TRAX_REPORTS' ? value : undefined))).toBeDefined();
    }
  });

  // The reason the default can be turned around: an environment without the
  // migration refuses instead of inventing a file, flag or no flag.
  it('refuses with report_failed when the job table is missing, rather than claiming a file', async () => {
    const store = configuredReports(db(), () => undefined)!;
    await expect(store.createJob({ tenantId: tenant, requestedBy: customerA, kind: 'vehicles.vehicle_count', format: 'csv', state: 'queued' }))
      .rejects.toMatchObject({ code: 'report_failed' });
  });
});

/*
 * The report tool is withdrawn from the model.
 *
 * The writers and the store below still work and are still tested — this asserts
 * only that the model is never OFFERED the tool, because offering it produced
 * confident promises of files that never arrived. If it is re-registered, these
 * tests fail and whoever does it has to prove a file actually reaches a user.
 */
describe('reports are not offered to the model', () => {
  it('registers no report tool', () => {
    expect(MODEL_TOOLS.map((t) => t.function.name)).not.toContain('generate_report');
  });

  it('offers no tool that claims to produce a file', () => {
    const filey = MODEL_TOOLS.filter((t) => /(csv|xlsx|pdf|download|export)/i.test(t.function.description));
    expect(filey.map((t) => t.function.name)).toEqual([]);
  });
});
