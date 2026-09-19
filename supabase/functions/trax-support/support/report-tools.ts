/**
 * Report generation: a real file, from the same figures the answer states.
 *
 * The rule that matters here is that a report is not a second calculation. It
 * runs the SAME query the chat answer runs — `runBusinessQuery` or
 * `queryCustomerBalances` — and formats that one result. So the file cannot
 * disagree with the summary, and neither can be produced without passing the
 * authorization those functions already apply: the tenant comes from the
 * authenticated staff row, money needs the finance grant, and every row is
 * re-checked against the account before it is counted.
 *
 * A report therefore adds no read authority. It adds a file, a job record and a
 * time-limited download.
 */
import { SupportError, object, onlyKeys, type SupportContext } from './types.ts';
import type { OperationalResult } from './operational-types.ts';
import { parseSpec, runBusinessQuery, type BusinessContext } from './business-query.ts';
import { queryCustomerBalances, parseBalanceRequest } from './balance-tools.ts';
import { render, MEDIA_TYPES, FORMATS, type ReportFormat, type ReportTable } from './report-format.ts';

/** How long a download link stays valid. Short: a report can be regenerated. */
export const DOWNLOAD_TTL_SECONDS = 15 * 60;
/** A refusal rather than a truncated file presented as complete. */
export const MAX_REPORT_ROWS = 50_000;

export type JobState = 'queued' | 'running' | 'ready' | 'failed';

export interface ReportJob {
  id: string;
  tenantId: string;
  requestedBy: string;
  kind: string;
  format: ReportFormat;
  state: JobState;
  rows?: number;
  bytes?: number;
  path?: string;
  error?: string;
}

/** The storage and bookkeeping a report needs, injected so it can be tested. */
export interface ReportStore {
  /** Records the job before any work, so a failure is visible rather than silent. */
  createJob(job: Omit<ReportJob, 'id' | 'state'> & { state: JobState }): Promise<{ id: string }>;
  updateJob(id: string, patch: Partial<Pick<ReportJob, 'state' | 'rows' | 'bytes' | 'path' | 'error'>>): Promise<void>;
  /** Writes into the private bucket. The path always begins with the tenant id. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A time-limited URL for that object, created with server credentials. */
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export interface ReportContext extends BusinessContext {
  reports: ReportStore;
}

export interface ReportRequest {
  kind: 'query' | 'customer_balances';
  format: ReportFormat;
  /** For `query`: the same shape query_business_data accepts. */
  query?: Record<string, unknown>;
  /** For `customer_balances`: the same shape query_customer_balances accepts. */
  balances?: Record<string, unknown>;
}

export function parseReportRequest(input: unknown): ReportRequest {
  const args = object(input);
  onlyKeys(args, ['report', 'format', 'dataset', 'metric', 'filters', 'period', 'groupBy', 'sort', 'limit', 'minimumOwed', 'customerId', 'includeCredit']);

  const format = String(args.format ?? 'csv').toLowerCase() as ReportFormat;
  if (!FORMATS.includes(format)) {
    throw new SupportError('invalid_input', `A report can be csv, xlsx or pdf. "${String(args.format)}" is not one of those.`);
  }
  const report = args.report == null ? (args.dataset == null ? null : 'query') : String(args.report);
  if (report === 'customer_balances') {
    return {
      kind: 'customer_balances', format,
      // Validated by the balance tool's own parser, so the rules cannot drift apart.
      balances: { limit: args.limit, minimumOwed: args.minimumOwed, customerId: args.customerId, includeCredit: args.includeCredit },
    };
  }
  if (report === 'query') {
    return {
      kind: 'query', format,
      query: { dataset: args.dataset, metric: args.metric, filters: args.filters, period: args.period, groupBy: args.groupBy, sort: args.sort, limit: args.limit },
    };
  }
  throw new SupportError('invalid_input', 'Say which report to generate: a dataset and metric from discover_business_data, or report "customer_balances".');
}

interface Measured {
  kind: string;
  title: string;
  result: OperationalResult;
  table: ReportTable;
}

const answerOf = (result: OperationalResult) => (result.data as {
  answer?: {
    dataset?: string; metric?: string; definition?: string; timezone?: string; asOf?: string;
    period?: { from?: string; to?: string; timezone?: string } | null;
    groups?: { key: string; label: string; value: string; currency?: string | null; rows?: number; outstanding?: string; credit?: string }[];
    total?: string; complete?: boolean;
  };
} | undefined)?.answer;

/** Turn one measured result into the table the writers render. */
function tableFor(kind: string, title: string, result: OperationalResult, tenantName: string): ReportTable {
  const answer = answerOf(result);
  const groups = answer?.groups ?? [];
  const notes: string[] = [];
  if (answer?.definition) notes.push(`Definition: ${answer.definition}`);
  if (answer?.period?.from && answer?.period?.to) {
    notes.push(`Period: ${answer.period.from} to ${answer.period.to}${answer.period.timezone ? ` (${answer.period.timezone})` : ''}.`);
  } else if (answer?.asOf) {
    notes.push(`As at ${answer.asOf}${answer.timezone ? ` (${answer.timezone})` : ''}.`);
  }
  notes.push(`Generated ${result.observedAt} for ${tenantName}. Figures are this account's records only.`);
  for (const limitation of result.limitations) notes.push(`Note: ${limitation}`);
  if (answer?.complete === false) notes.push('This report is PARTIAL: more records matched than were measured.');

  const showsCredit = groups.some((group) => group.outstanding !== undefined);
  const columns = showsCredit
    ? ['Customer', 'Outstanding', 'Credit', 'Net', 'Currency']
    : [groups.length > 1 || answer?.metric === undefined ? 'Group' : 'Scope', 'Value', 'Currency', 'Records'];
  const rows = groups.map((group) => (showsCredit
    ? [group.label, group.outstanding ?? '', group.credit ?? '', group.value, group.currency ?? '']
    : [group.label, group.value, group.currency ?? '', String(group.rows ?? '')]));
  if (answer?.total !== undefined && groups.length > 1) {
    rows.push(showsCredit ? ['Total', '', '', answer.total, groups[0]?.currency ?? ''] : ['Total', answer.total, groups[0]?.currency ?? '', '']);
  }
  return { title, subtitle: tenantName, notes, columns, rows, numericColumns: showsCredit ? [1, 2, 3] : [1] };
}

async function measure(request: ReportRequest, env: ReportContext): Promise<Measured> {
  const tenantName = env.auth.tenant.slug ?? 'this account';
  if (request.kind === 'customer_balances') {
    // The balance tool authorizes and computes; the report only formats.
    const result = await queryCustomerBalances(parseBalanceRequest(request.balances ?? {}), env);
    return { kind: 'customer_balances', title: 'Customer balances', result, table: tableFor('customer_balances', 'Customer balances', result, tenantName) };
  }
  const spec = parseSpec(request.query ?? {});
  const result = await runBusinessQuery(spec, env);
  const answer = answerOf(result);
  const title = `${answer?.dataset ?? spec.dataset} — ${answer?.metric ?? spec.metric}`;
  return { kind: `${spec.dataset}.${spec.metric}`, title, result, table: tableFor('query', title, result, tenantName) };
}

const EXTENSION: Record<ReportFormat, string> = { csv: 'csv', xlsx: 'xlsx', pdf: 'pdf' };
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

export async function generateReport(input: unknown, env: ReportContext): Promise<OperationalResult> {
  const request = parseReportRequest(input);
  if (!env.reports) throw new SupportError('reports_unavailable', 'Report generation is not configured in this environment.', 503);

  // Measured FIRST, so an unauthorized or impossible request never creates a job
  // or a file. The authorization lives in the query, not here.
  const measured = await measure(request, env);
  const answer = answerOf(measured.result);
  const rows = answer?.groups?.length ?? 0;
  if (rows > MAX_REPORT_ROWS) {
    throw new SupportError('report_too_large', `This report would contain ${rows} rows. Narrow the period or the grouping, or ask for a smaller breakdown.`);
  }

  const job = await env.reports.createJob({
    tenantId: env.auth.tenant.id, requestedBy: env.auth.staffId,
    kind: measured.kind, format: request.format, state: 'queued', rows,
  });

  let path: string | undefined;
  try {
    await env.reports.updateJob(job.id, { state: 'running' });
    const bytes = render(request.format, measured.table);
    // The tenant id leads the path, so an object can never be written into, or
    // read from, another account's prefix.
    path = `${env.auth.tenant.id}/${slug(measured.title)}-${job.id}.${EXTENSION[request.format]}`;
    await env.reports.put(path, bytes, MEDIA_TYPES[request.format]);
    await env.reports.updateJob(job.id, { state: 'ready', bytes: bytes.length, path });
    const downloadUrl = await env.reports.signedUrl(path, DOWNLOAD_TTL_SECONDS);

    return {
      ...measured.result,
      checks: [...measured.result.checks, `report:${request.format}`],
      sources: [...measured.result.sources, {
        id: `report:${job.id}`, table: 'trax_report_jobs', title: `${measured.title} (${request.format.toUpperCase()})`,
        observedAt: measured.result.observedAt, recordId: job.id,
      }],
      data: {
        ...(measured.result.data as Record<string, unknown>),
        report: {
          jobId: job.id, state: 'ready' as JobState, format: request.format,
          filename: path.split('/').pop(), rows, bytes: bytes.length,
          downloadUrl, expiresInSeconds: DOWNLOAD_TTL_SECONDS,
          // Stated so the answer can say it without the model inventing a claim.
          contains: `${rows} row${rows === 1 ? '' : 's'} measured for this account only.`,
        },
      },
    };
  } catch (error) {
    await env.reports.updateJob(job.id, { state: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : 'unknown' }).catch(() => {});
    if (error instanceof SupportError) throw error;
    throw new SupportError('report_failed', 'The report could not be produced, so no file was created.', 503);
  }
}

export const REPORT_TOOLS = Object.freeze({ generate_report: generateReport });
