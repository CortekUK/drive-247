/**
 * Customer balances: what each customer owes this account, and who owes the most.
 *
 * This is not a single-table sum, so it is not a catalog dataset. Three sources
 * point at the same money and must be kept disjoint, which is the whole reason
 * the application has one authoritative rule for it. That rule lives in
 * apps/portal/src/hooks/use-customer-balance.ts and is reproduced here exactly:
 *
 *   outstanding = ledger charges that are DUE
 *                   - excluding rentals that are Cancelled or rejected
 *                   - excluding PAYG rentals (their money is in payg_accruals;
 *                     counting both double-charges every open day)
 *                   - a 'Rental' charge with a future due_date is not yet due;
 *                     other categories (fines, fees) count whatever their due date
 *                 + open PAYG accruals (daily_rate + tax + service fee) on
 *                   rentals that are not closed and not Cancelled/rejected
 *   credit      = payments with remaining_amount not yet applied, counting ONLY
 *                 captured money: status in (Applied, Credit, Partial) and
 *                 capture_status <> 'requires_capture'. An uncaptured hold is not
 *                 credit, and counting it has previously turned a debtor into a
 *                 bogus "in credit", hiding the debt.
 *   net         = outstanding - credit
 *
 * Arithmetic is in integer minor units so repeated addition cannot drift, and
 * every row is checked to belong to the authorized account before it is counted.
 */
import { SupportError, object, onlyKeys, UUID, type SupportContext } from './types.ts';
import { canView } from './auth.ts';
import type { OperationalResult } from './operational-types.ts';
import { toMinorUnits, fromMinorUnits, type BusinessContext, type BusinessQuery } from './business-query.ts';

/** The definition TRAX must state alongside the figure. */
export const BALANCE_DEFINITION =
  'Outstanding is the remaining amount on charges that are already due, excluding cancelled and rejected rentals, '
  + 'with pay-as-you-go rentals taken from their open daily accruals instead of the ledger so the same day is not counted twice. '
  + 'Credit is captured payment money not yet applied to a charge; authorizations awaiting capture are not credit. '
  + 'Net is outstanding minus credit. Figures are the account records, not a bank or Stripe balance.';

const PAGE = 1000;
const ROW_CAP = 50_000;
const CAPTURED_CREDIT_STATUSES = ['Applied', 'Credit', 'Partial'];
const EXCLUDED_RENTAL_STATUS = 'Cancelled';
const REJECTED_APPROVAL = 'rejected';

export interface BalanceRequest {
  /** How many customers to return, highest net first. */
  limit: number;
  /** Only customers whose net is at least this much, in major units. */
  minimumOwed: number | null;
  /** A single customer, when the question is about one. */
  customerId: string | null;
  /** Include customers in credit (negative net) instead of only debtors. */
  includeCredit: boolean;
}

export function parseBalanceRequest(input: unknown): BalanceRequest {
  const args = object(input);
  onlyKeys(args, ['limit', 'minimumOwed', 'customerId', 'includeCredit']);
  const limit = args.limit == null ? 10 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new SupportError('invalid_input', 'Ask for between one and fifty customers.');
  }
  const minimumOwed = args.minimumOwed == null ? null : Number(args.minimumOwed);
  if (minimumOwed !== null && (!Number.isFinite(minimumOwed) || minimumOwed < 0)) {
    throw new SupportError('invalid_input', 'A minimum amount must be a positive number.');
  }
  const customerId = args.customerId == null ? null : String(args.customerId);
  if (customerId !== null && !UUID.test(customerId)) {
    throw new SupportError('invalid_input', 'A customer must be identified by an ID a tool returned.');
  }
  return { limit, minimumOwed, customerId, includeCredit: args.includeCredit === true };
}

type Row = Record<string, unknown>;
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Read every page of one table, refusing any row outside the account. */
async function readAll(env: BusinessContext, table: string, columns: string, filter: (q: BusinessQuery) => BusinessQuery) {
  const tenant = env.auth.tenant.id;
  const rows: Row[] = [];
  let offset = 0, complete = true;
  for (;;) {
    const page = await env.business.page((query) => filter(query.eq('tenant_id', tenant)), table, columns, offset, PAGE);
    for (const row of page.rows) {
      if (String(row.tenant_id) !== String(tenant)) {
        throw new SupportError('isolation_violation', 'A row outside this account was returned; the result is not trusted.', 503);
      }
      rows.push(row);
    }
    offset += page.rows.length;
    if (page.rows.length < PAGE || offset >= page.total) break;
    if (offset >= ROW_CAP) { complete = false; break; }
  }
  return { rows, complete };
}

export interface CustomerBalance {
  customerId: string;
  name: string | null;
  outstandingMinor: number;
  creditMinor: number;
  netMinor: number;
}

/** The computation, separated from the reads so it can be checked on its own. */
export function computeBalances(input: {
  rentals: Row[]; charges: Row[]; accruals: Row[]; payments: Row[]; today: string;
}): Map<string, CustomerBalance> {
  const excludedRentals = new Set<string>();
  const paygRentals = new Set<string>();
  const rentalCustomer = new Map<string, string>();
  const closedPayg = new Set<string>();
  for (const rental of input.rentals) {
    const id = String(rental.id);
    if (rental.customer_id) rentalCustomer.set(id, String(rental.customer_id));
    if (String(rental.status) === EXCLUDED_RENTAL_STATUS || String(rental.approval_status) === REJECTED_APPROVAL) excludedRentals.add(id);
    if (rental.is_pay_as_you_go === true) paygRentals.add(id);
    if (rental.payg_closed_at != null) closedPayg.add(id);
  }

  const balances = new Map<string, CustomerBalance>();
  const bucket = (customerId: string) => {
    const existing = balances.get(customerId);
    if (existing) return existing;
    const created: CustomerBalance = { customerId, name: null, outstandingMinor: 0, creditMinor: 0, netMinor: 0 };
    balances.set(customerId, created);
    return created;
  };

  // 1. Ledger charges that are due.
  for (const charge of input.charges) {
    const customerId = charge.customer_id ? String(charge.customer_id) : null;
    if (!customerId) continue;
    const rentalId = charge.rental_id ? String(charge.rental_id) : null;
    if (rentalId && (excludedRentals.has(rentalId) || paygRentals.has(rentalId))) continue;
    // A rental charge dated in the future is not yet due; other categories are.
    if (String(charge.category) === 'Rental' && charge.due_date && String(charge.due_date) > input.today) continue;
    bucket(customerId).outstandingMinor += toMinorUnits(num(charge.remaining_amount));
  }

  // 2. Open PAYG accruals, which are the authority for those rentals.
  for (const accrual of input.accruals) {
    const rentalId = accrual.rental_id ? String(accrual.rental_id) : null;
    if (!rentalId || excludedRentals.has(rentalId) || closedPayg.has(rentalId)) continue;
    const customerId = rentalCustomer.get(rentalId);
    if (!customerId) continue;
    const day = num(accrual.daily_rate) + num(accrual.tax_amount) + num(accrual.service_fee_amount);
    bucket(customerId).outstandingMinor += toMinorUnits(day);
  }

  // 3. Captured, unapplied payment money.
  for (const payment of input.payments) {
    const customerId = payment.customer_id ? String(payment.customer_id) : null;
    if (!customerId) continue;
    if (!CAPTURED_CREDIT_STATUSES.includes(String(payment.status))) continue;
    if (String(payment.capture_status) === 'requires_capture') continue;
    bucket(customerId).creditMinor += toMinorUnits(num(payment.remaining_amount));
  }

  for (const balance of balances.values()) balance.netMinor = balance.outstandingMinor - balance.creditMinor;
  return balances;
}

function authorizeBalances(env: BusinessContext) {
  if (!(env.financeScopes ?? []).includes('rental_payments')) {
    throw new SupportError('finance_restricted', 'Customer balances need the finance permission, which is not enabled for your account.', 403);
  }
  // A balance names customers, so it also needs the customers module.
  if (!canView(env.auth, 'customers')) {
    throw new SupportError('restricted', 'Your role cannot read customers, which a balance names.', 403);
  }
}

export async function queryCustomerBalances(input: unknown, env: BusinessContext): Promise<OperationalResult> {
  const request = parseBalanceRequest(input);
  authorizeBalances(env);
  const observedAt = new Date(env.now).toISOString();
  const timezone = (await env.timezone?.(env.auth.tenant.id)) ?? 'UTC';
  const today = env.clock.today(timezone, env.now);
  const currency = (await env.currency?.(env.auth.tenant.id)) ?? null;

  const customerFilter = (query: BusinessQuery) => (request.customerId ? query.eq('customer_id', request.customerId) : query);
  const [rentals, charges, accruals, payments] = await Promise.all([
    readAll(env, 'rentals', 'id,tenant_id,customer_id,status,approval_status,is_pay_as_you_go,payg_closed_at', (q) => customerFilter(q)),
    readAll(env, 'ledger_entries', 'id,tenant_id,customer_id,rental_id,type,category,due_date,remaining_amount', (q) => customerFilter(q).eq('type', 'Charge')),
    readAll(env, 'payg_accruals', 'id,tenant_id,rental_id,invoice_status,daily_rate,tax_amount,service_fee_amount', (q) => q.eq('invoice_status', 'open')),
    readAll(env, 'payments', 'id,tenant_id,customer_id,status,capture_status,remaining_amount', (q) => customerFilter(q)),
  ]);

  const balances = computeBalances({ rentals: rentals.rows, charges: charges.rows, accruals: accruals.rows, payments: payments.rows, today });

  // Names, for one bounded page of the customers being reported.
  const ranked = [...balances.values()]
    .filter((balance) => (request.includeCredit ? balance.netMinor !== 0 : balance.netMinor > 0))
    .filter((balance) => request.minimumOwed === null || balance.netMinor >= toMinorUnits(request.minimumOwed))
    .sort((a, b) => b.netMinor - a.netMinor);
  const shown = ranked.slice(0, request.limit);
  if (shown.length) {
    const wanted = new Set(shown.map((balance) => balance.customerId));
    const names = await readAll(env, 'customers', 'id,tenant_id,name', (q) => (request.customerId ? q.eq('id', request.customerId) : q));
    const byId = new Map(names.rows.filter((row) => wanted.has(String(row.id))).map((row) => [String(row.id), row.name == null ? null : String(row.name)]));
    for (const balance of shown) balance.name = byId.get(balance.customerId) ?? null;
  }

  const complete = rentals.complete && charges.complete && accruals.complete && payments.complete;
  const limitations: string[] = [];
  if (!complete) limitations.push('More records matched than could be read in one request, so these balances are partial.');
  if (!currency) limitations.push('The account currency is not configured, so these totals are shown without one.');
  if (ranked.length > shown.length) {
    limitations.push(`${ranked.length} customers matched; the ${shown.length} shown are the highest.`);
  }

  const totalMinor = ranked.reduce((sum, balance) => sum + balance.netMinor, 0);
  return {
    status: complete ? 'verified' : 'partial',
    observedAt,
    checks: ['customer_balances'],
    findings: shown.length ? [] : [{ code: 'no_matching_records', summary: 'No customer has an outstanding balance on these records.', sourceIds: ['business_query:customers:balance'], blocking: false }],
    sources: [{ id: 'business_query:customers:balance', table: 'business_query', title: 'Customers — outstanding balance', observedAt }],
    navigation: [],
    limitations,
    data: {
      answer: {
        dataset: 'customers', metric: 'balance', definition: BALANCE_DEFINITION,
        dateBasis: 'due_date', period: null, timezone, asOf: today,
        groups: shown.map((balance) => ({
          key: balance.customerId,
          label: balance.name ?? 'Name unavailable',
          currency,
          rows: 1,
          value: fromMinorUnits(balance.netMinor),
          outstanding: fromMinorUnits(balance.outstandingMinor),
          credit: fromMinorUnits(balance.creditMinor),
        })),
        total: fromMinorUnits(totalMinor),
        customersWithBalance: ranked.length,
        complete,
      },
    },
  };
}

export const BALANCE_TOOLS = Object.freeze({ query_customer_balances: queryCustomerBalances });
