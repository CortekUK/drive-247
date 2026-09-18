import { canView } from './auth.ts';
import { object, onlyKeys, SupportError, type SupportContext } from './types.ts';
import type { CalendarClock, Evidence, OperationalResult } from './operational-types.ts';
import { BUSINESS_CATALOG, type Dataset, type Field, type Metric } from './business-catalog.ts';

/**
 * The business query layer: one validated interface between the model and the
 * tenant's own records.
 *
 * The model chooses a DATASET, a METRIC, filters, a period, a grouping and a sort
 * from the catalog (business-catalog.ts) — never a table, a column or SQL. This
 * file validates that choice against the catalog, applies the tenant and the
 * caller's module permissions, reads the authorized rows through the narrow
 * adapter, and computes the answer HERE, deterministically:
 *
 * - counts come from the database's own exact count, not from a page of rows;
 * - money is summed in minor units, never in floating point, and never across
 *   currencies;
 * - a result that could not be completed within its bounds says so (`partial`)
 *   instead of presenting a short total as the answer;
 * - "no rows" and "restricted" and "failed" stay different answers.
 *
 * What it deliberately is not: no SQL from the model, no free-form joins, no
 * write path, no column the catalog has not approved, and no cross-tenant read —
 * the tenant comes from the authenticated context and is applied to every query,
 * including each joined entity's own permission check.
 */

export type FilterOperator = 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'not_null' | 'contains';
export interface QueryFilter { field: string; op: FilterOperator; value?: unknown }
export interface QueryPeriod { basis: string; from?: string | null; to?: string | null; preset?: string | null }
export interface QuerySpec {
  dataset: string;
  metric: string;
  filters: QueryFilter[];
  period?: QueryPeriod | null;
  groupBy?: string | null;
  sort?: { by: 'metric' | 'group'; direction: 'asc' | 'desc' } | null;
  limit?: number | null;
}

/** One row of an answer: a group (or the whole set) and its measured value. */
export interface QueryGroup { key: string; label: string; value: string; currency?: string | null; rows: number }
export interface QueryAnswer {
  dataset: string; metric: string; definition: string; dateBasis?: string;
  period?: { basis: string; from: string; to: string; timezone: string } | null;
  groups: QueryGroup[]; total?: QueryGroup[]; rowsRead: number; complete: boolean;
}

/** The narrow read surface. The client itself never reaches the model. */
export interface BusinessQuery extends PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  eq(column: string, value: unknown): BusinessQuery;
  neq(column: string, value: unknown): BusinessQuery;
  in(column: string, values: unknown[]): BusinessQuery;
  gt(column: string, value: unknown): BusinessQuery;
  gte(column: string, value: unknown): BusinessQuery;
  lt(column: string, value: unknown): BusinessQuery;
  lte(column: string, value: unknown): BusinessQuery;
  is(column: string, value: null): BusinessQuery;
  not(column: string, operator: string, value: null): BusinessQuery;
  ilike(column: string, pattern: string): BusinessQuery;
  order(column: string): BusinessQuery;
  range(from: number, to: number): BusinessQuery;
}
export interface BusinessDatabase {
  from(table: string): { select(columns: string, options?: { count?: 'exact'; head?: boolean }): BusinessQuery };
}
export interface BusinessReads {
  /** The exact number of rows the filters match, from the database itself. */
  count(build: (query: BusinessQuery) => BusinessQuery, table: string): Promise<number>;
  /** One bounded page of the approved columns. */
  page(build: (query: BusinessQuery) => BusinessQuery, table: string, columns: string, offset: number, limit: number): Promise<{ rows: Record<string, unknown>[]; total: number }>;
}

export function createBusinessReads(db: BusinessDatabase): BusinessReads {
  const run = async (query: PromiseLike<{ data: unknown; error: unknown; count?: number | null }>) => {
    const result = await query;
    if (result.error) throw new SupportError('live_read_failed', 'That query could not be completed, so its result is unknown.', 503);
    return result;
  };
  return {
    count: async (build, table) => {
      const result = await run(build(db.from(table).select('id', { count: 'exact', head: true })));
      if (!Number.isSafeInteger(result.count) || result.count! < 0) throw new SupportError('incomplete_read', 'An exact total was not returned.', 503);
      return result.count!;
    },
    page: async (build, table, columns, offset, limit) => {
      const result = await run(build(db.from(table).select(columns, { count: 'exact' })).order('id').range(offset, offset + limit - 1));
      if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count! < 0) throw new SupportError('incomplete_read', 'A complete page was not returned.', 503);
      return { rows: result.data as Record<string, unknown>[], total: result.count! };
    },
  };
}

export interface BusinessContext {
  auth: SupportContext; business: BusinessReads; clock: CalendarClock; now: number;
  /** The tenant's own timezone, for every relative period. */
  timezone(tenant: string): Promise<string | null>;
  /** The tenant's own currency code: operational tables carry no per-row currency. */
  currency?: (tenant: string) => Promise<string | null>;
  /** The deployment's finance grant for this caller (finance-types.ts financeScopes). */
  financeScopes?: readonly string[];
  reauthorize?: () => Promise<void>;
}

/* ── money, exactly ─────────────────────────────────────────────────────────
   Amounts are accumulated in integer minor units. A value the catalog calls
   money must parse exactly; anything else is a failed read, not a zero. */
const MINOR = 100;
export function toMinorUnits(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'number' ? value.toFixed(6) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new SupportError('incomplete_read', 'A stored amount could not be read exactly.', 503);
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const minor = Number(whole) * MINOR + Number((fraction + '00').slice(0, 2));
  const rounded = Number(fraction.slice(2, 3)) >= 5 ? minor + 1 : minor;
  if (!Number.isSafeInteger(rounded)) throw new SupportError('incomplete_read', 'A stored amount is outside the supported range.', 503);
  return text.startsWith('-') ? -rounded : rounded;
}
/** A column that already holds integer minor units (cents). Never rescaled. */
export function wholeMinorUnits(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) throw new SupportError('incomplete_read', 'A stored amount in cents could not be read exactly.', 503);
  const minor = Number(text);
  if (!Number.isSafeInteger(minor)) throw new SupportError('incomplete_read', 'A stored amount is outside the supported range.', 503);
  return minor;
}
export const fromMinorUnits = (minor: number) => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / MINOR)}.${String(Math.abs(minor) % MINOR).padStart(2, '0')}`;

/* ── periods, in the tenant's own timezone ─────────────────────────────────── */
const PRESETS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year', 'last_7_days', 'last_30_days', 'last_90_days'] as const;
export type Preset = typeof PRESETS[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const addMonths = (date: string, months: number) => {
  const [year, month] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  return target.toISOString().slice(0, 10);
};
/** Resolve a preset to inclusive calendar bounds in the tenant's timezone. */
export function resolvePreset(preset: Preset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'this_week': { const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; return { from: addDays(today, -weekday), to: today }; }
    case 'last_week': { const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; const start = addDays(today, -weekday - 7); return { from: start, to: addDays(start, 6) }; }
    case 'this_month': return { from: monthStart(today), to: today };
    case 'last_month': { const start = addMonths(monthStart(today), -1); return { from: start, to: addDays(monthStart(today), -1) }; }
    case 'this_year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'last_year': { const year = Number(today.slice(0, 4)) - 1; return { from: `${year}-01-01`, to: `${year}-12-31` }; }
    case 'last_7_days': return { from: addDays(today, -6), to: today };
    case 'last_30_days': return { from: addDays(today, -29), to: today };
    case 'last_90_days': return { from: addDays(today, -89), to: today };
  }
}

/* ── validation against the catalog ────────────────────────────────────────── */
const OPERATORS: Record<FilterOperator, string[]> = {
  eq: ['text', 'uuid', 'enum', 'boolean', 'number', 'money', 'date', 'timestamp'],
  neq: ['text', 'uuid', 'enum', 'boolean', 'number', 'money', 'date', 'timestamp'],
  in: ['text', 'uuid', 'enum'],
  gt: ['number', 'money', 'date', 'timestamp'], gte: ['number', 'money', 'date', 'timestamp'],
  lt: ['number', 'money', 'date', 'timestamp'], lte: ['number', 'money', 'date', 'timestamp'],
  is_null: ['text', 'uuid', 'enum', 'date', 'timestamp', 'number', 'money', 'boolean'],
  not_null: ['text', 'uuid', 'enum', 'date', 'timestamp', 'number', 'money', 'boolean'],
  contains: ['text'],
};
export function datasetFor(name: unknown): Dataset {
  const dataset = BUSINESS_CATALOG.datasets.find((d) => d.name === name);
  if (!dataset) throw new SupportError('invalid_input', 'That dataset is not in the approved catalog.');
  return dataset;
}
function fieldFor(dataset: Dataset, name: unknown, use: 'filter' | 'group'): Field {
  const field = dataset.fields.find((f) => f.name === name);
  if (!field) throw new SupportError('invalid_input', `"${String(name)}" is not a field of ${dataset.name}.`);
  if (use === 'filter' && field.filterable === false) throw new SupportError('invalid_input', `${field.name} cannot be filtered.`);
  if (use === 'group' && !field.groupable) throw new SupportError('invalid_input', `${field.name} cannot be grouped.`);
  return field;
}
function metricFor(dataset: Dataset, name: unknown): Metric {
  const metric = dataset.metrics.find((m) => m.name === name);
  // Name the valid metrics. A refusal the caller cannot act on just produces another
  // guess: asked for a CSV of payments the model tried "null", then "records", and
  // gave up and told the user to use an export screen. Metric names are catalog
  // schema, not tenant data, and the finance gate still refuses the read itself.
  if (!metric) throw new SupportError('invalid_input', `"${String(name)}" is not a metric of ${dataset.name}. Use one of: ${dataset.metrics.map((m) => m.name).join(', ')}.`);
  return metric;
}
/** Every dataset the caller's role may actually read, with what it offers. */
/** A money dataset is gated by the finance grant, not by a module permission:
 *  `canView` withholds every finance key from every role by policy (auth.ts). */
const permitted = (auth: SupportContext, scopes: readonly string[] | undefined, dataset: Dataset) =>
  (dataset.financeScope ? (scopes ?? []).includes(dataset.financeScope) : canView(auth, dataset.permission))
  && dataset.links.every((link) => canView(auth, link.permission));

export function authorizedDatasets(auth: SupportContext, scopes?: readonly string[]) {
  return BUSINESS_CATALOG.datasets.filter((dataset) => permitted(auth, scopes, dataset));
}
/** Metrics the caller may use: a money metric inside an operational dataset needs
 *  the finance grant, so counting extensions never discloses what they were worth. */
export const metricPermitted = (scopes: readonly string[] | undefined, metric: Metric) =>
  !metric.financeScope || (scopes ?? []).includes(metric.financeScope);

export function authorizedMetrics(dataset: Dataset, scopes?: readonly string[]) {
  return dataset.metrics.filter((metric) => metricPermitted(scopes, metric));
}

function authorize(env: BusinessContext, dataset: Dataset, metric?: Metric) {
  if (dataset.financeScope && !(env.financeScopes ?? []).includes(dataset.financeScope)) {
    throw new SupportError('finance_restricted', `${dataset.title} need the finance permission, which is not enabled for your account.`, 403);
  }
  if (metric && !metricPermitted(env.financeScopes, metric)) {
    throw new SupportError('finance_restricted', `${metric.label} needs the finance permission, which is not enabled for your account. The row count is available without it.`, 403);
  }
  if (!dataset.financeScope && !canView(env.auth, dataset.permission)) throw new SupportError('restricted', `Your role cannot read ${dataset.title.toLowerCase()}.`, 403);
  // A joined entity carries its own permission: reading rentals never grants customers.
  for (const link of dataset.links) {
    if (!canView(env.auth, link.permission)) throw new SupportError('restricted', `Your role cannot read the ${link.name} this query needs.`, 403);
  }
}

export function parseSpec(input: unknown): QuerySpec {
  const args = object(input);
  onlyKeys(args, ['dataset', 'metric', 'filters', 'period', 'groupBy', 'sort', 'limit']);
  const dataset = datasetFor(args.dataset);
  const metric = metricFor(dataset, args.metric);
  const filters: QueryFilter[] = [];
  if (args.filters != null) {
    if (!Array.isArray(args.filters) || args.filters.length > 8) throw new SupportError('invalid_input', 'Use up to eight filters.');
    for (const raw of args.filters) {
      const filter = object(raw);
      onlyKeys(filter, ['field', 'op', 'value']);
      const field = fieldFor(dataset, filter.field, 'filter');
      const op = String(filter.op) as FilterOperator;
      if (!OPERATORS[op]) throw new SupportError('invalid_input', `"${String(filter.op)}" is not a supported comparison.`);
      if (!OPERATORS[op].includes(field.kind)) throw new SupportError('invalid_input', `${field.name} cannot use ${op}.`);
      if (op === 'in') {
        if (!Array.isArray(filter.value) || !filter.value.length || filter.value.length > 20) throw new SupportError('invalid_input', 'Give one to twenty values.');
        for (const value of filter.value) assertValue(field, value);
      } else if (op !== 'is_null' && op !== 'not_null') {
        assertValue(field, filter.value);
      }
      filters.push({ field: field.name, op, value: filter.value });
    }
  }
  let period: QueryPeriod | null = null;
  if (args.period != null) {
    // A period sent as the bare string "last_month" used to fail the generic object
    // guard, whose whole message is "Invalid request." — so the caller was told a
    // report was impossible rather than which shape to send.
    if (typeof args.period !== 'object' || args.period === null || Array.isArray(args.period)) {
      throw new SupportError('invalid_input', `A period is an object, for example {"basis":"${dataset.dateBases[0]?.name ?? 'created_at'}","preset":"last_month"}. "${String(args.period)}" is not one. Presets: ${PRESETS.join(', ')}.`);
    }
    const raw = args.period as Record<string, unknown>;
    onlyKeys(raw, ['basis', 'from', 'to', 'preset']);
    const basis = dataset.dateBases.find((b) => b.name === raw.basis);
    if (!basis) throw new SupportError('invalid_input', `${dataset.name} has no "${String(raw.basis)}" date basis. Use one of: ${dataset.dateBases.map((b) => b.name).join(', ')}.`);
    if (raw.preset != null && !PRESETS.includes(String(raw.preset) as Preset)) throw new SupportError('invalid_input', `"${String(raw.preset)}" is not a supported period. Use one of: ${PRESETS.join(', ')}.`);
    for (const key of ['from', 'to'] as const) if (raw[key] != null && !DATE.test(String(raw[key]))) throw new SupportError('invalid_input', 'Dates use YYYY-MM-DD.');
    if (raw.preset == null && (raw.from == null || raw.to == null)) throw new SupportError('invalid_input', 'Give a preset, or both a from and a to date.');
    period = { basis: basis.name, from: raw.from as string | null, to: raw.to as string | null, preset: raw.preset as string | null };
  }
  const groupBy = args.groupBy == null ? null : fieldFor(dataset, args.groupBy, 'group').name;
  let sort: QuerySpec['sort'] = null;
  if (args.sort != null) {
    const raw = object(args.sort);
    onlyKeys(raw, ['by', 'direction']);
    if (!['metric', 'group'].includes(String(raw.by)) || !['asc', 'desc'].includes(String(raw.direction))) throw new SupportError('invalid_input', 'Sort by metric or group, asc or desc.');
    sort = { by: raw.by as 'metric' | 'group', direction: raw.direction as 'asc' | 'desc' };
  }
  if (args.limit != null && (!Number.isSafeInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) throw new SupportError('invalid_input', 'Return between one and one hundred groups.');
  return { dataset: dataset.name, metric: metric.name, filters, period, groupBy, sort, limit: args.limit == null ? null : Number(args.limit) };
}
function assertValue(field: Field, value: unknown) {
  if (field.kind === 'enum') {
    if (!field.values?.includes(String(value))) throw new SupportError('invalid_input', `${field.name} accepts: ${field.values?.join(', ')}.`);
    return;
  }
  if (field.kind === 'boolean') { if (typeof value !== 'boolean') throw new SupportError('invalid_input', `${field.name} is true or false.`); return; }
  if (field.kind === 'number' || field.kind === 'money') { if (typeof value !== 'number' || !Number.isFinite(value)) throw new SupportError('invalid_input', `${field.name} takes a number.`); return; }
  if (field.kind === 'date' || field.kind === 'timestamp') { if (typeof value !== 'string' || !DATE.test(value)) throw new SupportError('invalid_input', `${field.name} takes a YYYY-MM-DD date.`); return; }
  if (typeof value !== 'string' || !value.length || value.length > 120) throw new SupportError('invalid_input', `${field.name} takes a short text value.`);
  if (field.kind === 'uuid' && !/^[0-9a-f-]{36}$/i.test(value)) throw new SupportError('invalid_input', `${field.name} takes a record id.`);
}

/* ── execution ─────────────────────────────────────────────────────────────── */
const PAGE = 1000;

/**
 * Run one validated spec against the tenant's own rows and compute the answer.
 *
 * Counting is the database's own exact count. Anything summed is read in bounded
 * pages and added here in minor units, per currency. Reaching the dataset's row
 * cap makes the answer `partial` with the reason stated — a capped sum is never
 * presented as the total.
 */
export async function runBusinessQuery(spec: QuerySpec, env: BusinessContext): Promise<OperationalResult> {
  const dataset = datasetFor(spec.dataset);
  const metric = metricFor(dataset, spec.metric);
  authorize(env, dataset, metric);
  await env.reauthorize?.();

  const observedAt = new Date(env.now).toISOString();
  const checks = [`${dataset.name}.${metric.name}`];
  const limitations: string[] = [];
  const sources: Evidence[] = [{ id: `business_query:${dataset.name}:${metric.name}`, table: 'business_query', title: `${dataset.title} — ${metric.label}`, observedAt }];

  // The period, in the tenant's own timezone. Without one a relative period is a
  // failure, never a guess at "today".
  let period: QueryAnswer['period'] = null;
  if (spec.period) {
    const basis = dataset.dateBases.find((b) => b.name === spec.period!.basis)!;
    const timezone = await env.timezone(env.auth.tenant.id);
    if (!timezone) throw new SupportError('timezone_unavailable', 'The account timezone is not configured, so a date period cannot be resolved.', 503);
    const today = env.clock.today(timezone, env.now);
    const bounds = spec.period.preset ? resolvePreset(spec.period.preset as Preset, today) : { from: spec.period.from!, to: spec.period.to! };
    if (bounds.from > bounds.to) throw new SupportError('invalid_input', 'The period starts after it ends.');
    period = { basis: basis.name, from: bounds.from, to: bounds.to, timezone };
    checks.push(`period:${basis.name}:${bounds.from}..${bounds.to}`);
  }

  const build = (query: BusinessQuery): BusinessQuery => {
    let next = query.eq(dataset.tenantColumn, env.auth.tenant.id);
    // What the dataset and the metric always mean, before anything the model asked for.
    for (const required of dataset.requiredFilters ?? []) {
      if (required.op === 'in') next = next.in(required.column, required.value as unknown[]);
      else if (required.op === 'not_in') for (const value of required.value as unknown[]) next = next.neq(required.column, value);
      else if (required.op === 'is_null') next = next.is(required.column, null);
      else if (required.op === 'not_null') next = next.not(required.column, 'is', null);
      else next = (next[required.op] as (c: string, v: unknown) => BusinessQuery)(required.column, required.value);
    }
    if (metric.require) next = next.eq(metric.require.column, metric.require.value);
    for (const value of metric.exclude?.values ?? []) next = next.neq(metric.exclude!.column, value);
    for (const filter of spec.filters) {
      const field = dataset.fields.find((f) => f.name === filter.field)!;
      const column = field.column;
      if (filter.op === 'is_null') next = next.is(column, null);
      else if (filter.op === 'not_null') next = next.not(column, 'is', null);
      else if (filter.op === 'in') next = next.in(column, filter.value as unknown[]);
      else if (filter.op === 'contains') next = next.ilike(column, `%${String(filter.value).replace(/[%_,()]/g, ' ')}%`);
      else next = (next[filter.op] as (c: string, v: unknown) => BusinessQuery)(column, filter.value);
    }
    if (period) {
      const basis = dataset.dateBases.find((b) => b.name === period!.basis)!;
      // A timestamp basis runs to the start of the day after the last day, so the
      // whole final day counts whatever time it carries.
      next = next.gte(basis.column, period.from);
      next = basis.kind === 'timestamp' ? next.lt(basis.column, addDays(period.to, 1)) : next.lte(basis.column, period.to);
    }
    return next;
  };

  // Operational tables hold no per-row currency: the amount is in the tenant's own.
  let tenantCurrency: string | null = null;
  if (metric.currency === 'per_currency' && dataset.currencySource !== 'row') {
    tenantCurrency = (await env.currency?.(env.auth.tenant.id)) ?? dataset.defaultCurrency ?? null;
    if (!tenantCurrency) limitations.push('The account currency is not configured, so this total is shown without one.');
  }

  const answer: QueryAnswer = {
    dataset: dataset.name, metric: metric.name, definition: metric.definition,
    dateBasis: period?.basis ?? metric.dateBasis, period, groups: [], rowsRead: 0, complete: true,
  };

  // A plain count of matching rows is the database's own exact count.
  if (metric.kind === 'count' && !spec.groupBy) {
    const total = await env.business.count(build, dataset.table);
    answer.groups = [{ key: 'all', label: dataset.title, value: String(total), rows: total }];
    answer.rowsRead = total;
  } else {
    const groupField = spec.groupBy ? dataset.fields.find((f) => f.name === spec.groupBy)! : null;
    const columns = [...new Set(['id', dataset.tenantColumn, metric.column, metric.subtractColumn, dataset.currencySource === 'row' ? dataset.currencyColumn : null, groupField?.column].filter(Boolean) as string[])].join(',');
    const totals = new Map<string, { key: string; label: string; currency: string | null; minor: number; rows: number }>();
    let offset = 0, total = 0;
    for (;;) {
      const page = await env.business.page(build, dataset.table, columns, offset, PAGE);
      total = page.total;
      for (const row of page.rows) {
        if (String(row[dataset.tenantColumn]) !== env.auth.tenant.id) throw new SupportError('record_unavailable', 'A row outside this account was returned; the result is not trusted.', 403);
        const currency = metric.currency !== 'per_currency' ? null
          : dataset.currencySource === 'row' ? (String(row[dataset.currencyColumn ?? ''] ?? '').toUpperCase() || null)
          : tenantCurrency;
        const raw = groupField ? row[groupField.column] : 'all';
        const groupValue = raw === null || raw === undefined ? '' : String(raw);
        const key = JSON.stringify([groupValue, currency]);
        const bucket = totals.get(key) ?? { key: groupValue, label: groupValue || (groupField ? `No ${groupField.label.toLowerCase()}` : dataset.title), currency, minor: 0, rows: 0 };
        bucket.rows += 1;
        // Net of what was given back on the same row, never below zero (payment-status.ts).
        if (metric.kind === 'sum') {
          // A column already in minor units is taken as it stands; a decimal one is scaled.
          const amount = (value: unknown) => (metric.minorUnits ? wholeMinorUnits(value) : toMinorUnits(value));
          bucket.minor += Math.max(0, amount(row[metric.column!]) - (metric.subtractColumn ? amount(row[metric.subtractColumn]) : 0));
        }
        totals.set(key, bucket);
      }
      answer.rowsRead += page.rows.length;
      offset += page.rows.length;
      if (!page.rows.length || offset >= total) break;
      if (offset >= dataset.rowCap) {
        answer.complete = false;
        limitations.push(`This query matched ${total} records and was measured over the first ${offset}. The figure shown is partial; narrow the period or the filters, or ask for a report.`);
        break;
      }
    }
    answer.groups = [...totals.values()]
      .map((bucket) => ({ key: bucket.key, label: bucket.label, currency: bucket.currency, rows: bucket.rows, value: metric.kind === 'sum' ? fromMinorUnits(bucket.minor) : String(bucket.rows) }))
      .sort((a, b) => {
        // Largest first unless the caller asked for ascending; ties read alphabetically.
        const order = spec.sort?.direction === 'asc' ? 1 : -1;
        if (spec.sort?.by === 'group') return a.label.localeCompare(b.label) * order;
        return (Number(a.value) - Number(b.value)) * order || a.label.localeCompare(b.label);
      });
    if (spec.limit && answer.groups.length > spec.limit) {
      limitations.push(`${answer.groups.length} groups matched; the ${spec.limit} shown are the ${spec.sort?.direction === 'asc' ? 'lowest' : 'highest'} by ${metric.label.toLowerCase()}.`);
      answer.groups = answer.groups.slice(0, spec.limit);
    }
  }

  const result: OperationalResult = {
    status: answer.complete ? 'verified' : 'partial',
    observedAt, checks, findings: [], sources, navigation: [], limitations,
    data: {
      answer,
      scope: {
        dataset: dataset.name, title: dataset.title, meaning: dataset.meaning,
        metric: metric.name, metricLabel: metric.label, definition: metric.definition,
        currency: metric.currency === 'per_currency' ? 'Totals are separated by currency and never added together.' : undefined,
        period: period ? `${period.from} to ${period.to} (${period.basis}, ${period.timezone})` : 'All records, no period filter.',
        filters: spec.filters.map((f) => `${f.field} ${f.op}${f.op === 'is_null' || f.op === 'not_null' ? '' : ` ${Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}`}`),
        alwaysApplied: [
          ...(dataset.requiredFilters ?? []).map((r) => r.because),
          ...(metric.require ? [`Only ${metric.require.column} ${metric.require.value} entries.`] : []),
          ...(metric.exclude ? [`${metric.exclude.values.join(', ')} are excluded from this figure.`] : []),
        ],
        groupBy: spec.groupBy ?? null,
      },
    },
  };
  if (!answer.groups.length) {
    result.findings.push({ code: 'no_matching_records', summary: 'No records matched this query. That is an empty result, not a zero total.', sourceIds: [sources[0].id], blocking: false });
  }
  return result;
}
