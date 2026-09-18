import { OPEN_RENTAL_STATUSES, OUT_NOW_STATUSES } from './availability-rules.generated.js';

/**
 * The BUSINESS DATA CATALOG: what TRAX is allowed to read, and what each record
 * actually means.
 *
 * This is the only description of the tenant's data the query layer will honour.
 * The model never names a table or a column — it names a dataset, a metric, a
 * field and a date basis from here, and `business-query.ts` compiles that into a
 * tenant-scoped, parameterised read.
 *
 * Every entry states, for review:
 * - `meaning`: what a row IS in the business, not what the table is called;
 * - `permission`: the portal module permission a reader must already hold
 *   (the same keys `canView` uses), and `links` add the permission of each
 *   related entity a query can reach;
 * - `fields`: only columns that are safe to filter or group by. Notes, contact
 *   details, identity documents, tokens and free text stay out; the query layer
 *   cannot read a column that is not listed here;
 * - `metrics`: what a number means, in words, including its date basis;
 * - `dateBases`: which business date a period filters on. There is no default
 *   "created_at means everything".
 *
 * Versioned with the rest of TRAX's knowledge: `CATALOG_VERSION` moves when a
 * definition changes, and docs/trax/data-catalog.md carries the reviewable prose
 * and the source references. Nothing here holds live records or secrets.
 */

export const CATALOG_VERSION = '0.2.0';

import { CUSTOMER_REF, VEHICLE_REF, RENTAL_REF } from './business-catalog-refs.ts';
export { CUSTOMER_REF, VEHICLE_REF, RENTAL_REF };

export type FieldKind = 'text' | 'uuid' | 'number' | 'money' | 'date' | 'timestamp' | 'boolean' | 'enum';
export interface Field {
  name: string; column: string; kind: FieldKind; label: string;
  /** Values the column actually stores, for enums. */
  values?: readonly string[];
  /** Grouping needs a low-cardinality, non-identifying column. */
  groupable?: boolean;
  filterable?: boolean;
  meaning?: string;
  /**
   * Turn a stored id into the name a person uses for it.
   *
   * Grouping by customer_id answered with "9927be94-078c-…" — the raw column value
   * — so "what did each customer pay" was a list of UUIDs, useless to read and
   * impossible to act on. The lookup is tenant-scoped and reads only the columns
   * named here, so it can name a record without widening what the caller can see.
   */
  labels?: { table: string; keyColumn: string; tenantColumn: string; columns: readonly string[] };
}
export interface Metric {
  name: string; label: string; kind: 'count' | 'sum';
  /** The column summed; counts need none. */
  column?: string;
  /** Subtracted per row before the sum, floored at zero — a refund against a payment. */
  subtractColumn?: string;
  /** Rows this metric never counts, and the one value it always requires. */
  exclude?: { column: string; values: readonly string[] };
  require?: { column: string; value: string };
  /** `per_currency` never adds two currencies together. */
  currency: 'per_currency' | 'none';
  definition: string;
  dateBasis?: string;
  /** This metric needs the finance grant even when the dataset does not, so a
   *  non-finance role can still count rows in an otherwise operational dataset
   *  (how many extensions) without being told what they were worth. */
  financeScope?: 'rental_payments' | 'account_balance';
  /** The column already stores minor units (integer cents), so it must not be
   *  scaled again. `tenant_subscriptions.amount` and `deposit_hold_links.amount_cents`
   *  are integers in cents, unlike every `numeric` money column. */
  minorUnits?: boolean;
}
/** A filter the dataset always carries, because the metric is only meaningful with it. */
export interface RequiredFilter { column: string; op: 'eq' | 'neq' | 'in' | 'not_in' | 'gt' | 'is_null' | 'not_null'; value?: unknown; because: string }
export interface DateBasis { name: string; column: string; kind: 'date' | 'timestamp'; meaning: string }
export interface Link { name: string; dataset: string; column: string; permission: string }
export interface Dataset {
  name: string; title: string; table: string; tenantColumn: string; permission: string;
  meaning: string;
  fields: readonly Field[];
  metrics: readonly Metric[];
  dateBases: readonly DateBasis[];
  links: readonly Link[];
  /** Where a row's currency is stored, for per-currency metrics. Operational tables
   *  have none: the amount is in the tenant's own currency (`tenants.currency_code`). */
  currencyColumn?: string;
  currencySource?: 'tenant' | 'row';
  defaultCurrency?: string;
  /** Always applied, and always stated in the answer's scope. */
  requiredFilters?: readonly RequiredFilter[];
  /** Money datasets need the deployment's finance grant, not a module permission:
   *  `canView` withholds every finance key from every role by policy (auth.ts). */
  financeScope?: 'rental_payments' | 'account_balance';
  /** The most rows one synchronous answer will measure before saying "partial". */
  rowCap: number;
  /** Source references for review (file paths, not data). */
  sources: readonly string[];
}

/* Rental status values as the application stores them (availability-rules.generated.js,
   generated from v2/apps/web/src/lib/vehicles/availability-rules.ts). Open statuses hold
   a vehicle; Active and Started are "out now". */
const RENTAL_STATUSES = [...new Set([...OPEN_RENTAL_STATUSES, 'Cancelled', 'Rejected', 'Closed', 'Completed'])] as const;

export const VEHICLES: Dataset = {
  name: 'vehicles', title: 'Vehicles', table: 'vehicles', tenantColumn: 'tenant_id', permission: 'vehicles',
  meaning: 'Every vehicle record this account holds, including paused and disposed ones. A count of vehicles is not a count of vehicles available to rent: availability is a date calculation (find_available_vehicles), not a status.',
  fields: [
    { name: 'registration', column: 'reg', kind: 'text', label: 'Registration', filterable: true, meaning: 'The plate as recorded.' },
    { name: 'make', column: 'make', kind: 'text', label: 'Make', groupable: true, filterable: true },
    { name: 'model', column: 'model', kind: 'text', label: 'Model', groupable: true, filterable: true },
    { name: 'status', column: 'status', kind: 'text', label: 'Status', groupable: true, filterable: true, meaning: 'The vehicle record status shown in the fleet list. Not a live availability answer.' },
    { name: 'paused', column: 'is_paused', kind: 'boolean', label: 'Paused', groupable: true, filterable: true },
    { name: 'disposed', column: 'is_disposed', kind: 'boolean', label: 'Disposed', groupable: true, filterable: true, meaning: 'Sold or written off: still a record, no longer part of the working fleet.' },
    { name: 'on_website', column: 'show_on_website', kind: 'boolean', label: 'Shown on website', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'vehicle_count', label: 'Vehicles', kind: 'count', currency: 'none', definition: 'Number of vehicle records matching the filters, counted by the database itself. Includes paused and disposed vehicles unless filtered out.' },
  ],
  dateBases: [],
  links: [],
  rowCap: 20_000,
  sources: ['supabase/functions/trax-support/support/operational-reads.ts (VEHICLE_COLUMNS)', 'apps/portal/src/app/(dashboard)/vehicles'],
};

export const RENTALS: Dataset = {
  name: 'rentals', title: 'Rentals', table: 'rentals', tenantColumn: 'tenant_id', permission: 'rentals',
  meaning: 'Every booking/rental record, at any stage of its life. A rental holds a vehicle while its status is one of ' + OPEN_RENTAL_STATUSES.join(', ') + '; it is out with a renter now when its status is ' + [...OUT_NOW_STATUSES].join(' or ') + '. Status is the recorded state, not proof of physical possession.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: RENTAL_STATUSES, label: 'Status', groupable: true, filterable: true, meaning: 'The recorded rental state.' },
    VEHICLE_REF,
    { name: 'rental_number', column: 'rental_number', kind: 'text', label: 'Rental number', filterable: true },
    { name: 'pay_as_you_go', column: 'is_pay_as_you_go', kind: 'boolean', label: 'Pay as you go', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'rental_count', label: 'Rentals', kind: 'count', currency: 'none', definition: 'Number of rental records matching the filters, counted by the database itself. Historical rentals are included unless a period or status filter excludes them.', dateBasis: 'start_date' },
  ],
  dateBases: [
    { name: 'start_date', column: 'start_date', kind: 'date', meaning: 'The day the rental period starts — the right basis for "rentals in July".' },
    { name: 'end_date', column: 'end_date', kind: 'date', meaning: 'The day the rental period ends — the right basis for "returns due last week".' },
  ],
  links: [{ name: 'vehicle', dataset: 'vehicles', column: 'vehicle_id', permission: 'vehicles' }],
  rowCap: 20_000,
  sources: ['supabase/functions/trax-support/support/operational-reads.ts (RENTAL_COLUMNS)', 'supabase/functions/trax-support/support/availability-rules.generated.js'],
};

export const CUSTOMERS: Dataset = {
  name: 'customers', title: 'Customers', table: 'customers', tenantColumn: 'tenant_id', permission: 'customers',
  meaning: 'Every customer record this account holds, including blocked and inactive ones. A customer is a person or company that can hold rentals; counting customers is not counting renters with an open rental.',
  fields: [
    { name: 'status', column: 'status', kind: 'text', label: 'Status', groupable: true, filterable: true, meaning: 'The customer record status (for example active or inactive).' },
    { name: 'customer_type', column: 'customer_type', kind: 'text', label: 'Type', groupable: true, filterable: true, meaning: 'Individual or company.' },
    { name: 'blocked', column: 'is_blocked', kind: 'boolean', label: 'Blocked', groupable: true, filterable: true },
    { name: 'identity_verification', column: 'identity_verification_status', kind: 'enum', values: ['unverified', 'pending', 'verified', 'rejected'], label: 'Identity verification', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'customer_count', label: 'Customers', kind: 'count', currency: 'none', definition: 'Number of customer records matching the filters, counted by the database itself. Blocked and inactive customers are included unless filtered out.', dateBasis: 'created_at' },
  ],
  dateBases: [{ name: 'created_at', column: 'created_at', kind: 'timestamp', meaning: 'When the customer record was created — the basis for "new customers this month".' }],
  links: [],
  rowCap: 20_000,
  sources: ['apps/portal/src/integrations/supabase/types.ts (customers)', 'supabase/migrations/20251219083413_remote_schema.sql:4093 (identity_verification_status)'],
};

/**
 * Money RECEIVED, by the application's own definition (apps/portal/src/lib/payment-status.ts):
 * only payments whose status says the money arrived, never an uncaptured authorization,
 * and each row counts `amount - refund_amount`. A payment's face `amount` alone is an
 * intent, not money: void and reversed rows keep their face value.
 */
export const PAYMENTS: Dataset = {
  name: 'payments', title: 'Payments received', table: 'payments', tenantColumn: 'tenant_id', permission: 'payments', financeScope: 'rental_payments',
  meaning: 'Payment records as Drive247 stores them. The collected metric counts only money the application treats as received — not authorizations waiting to be captured, and net of refunds recorded against the same payment. It is not a Stripe balance and not an amount owed.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: ['Applied', 'Credit', 'Partial', 'Reversed', 'Pending', 'Completed', 'Refunded', 'Partial Refund'], label: 'Status', groupable: true, filterable: true },
    { name: 'payment_type', column: 'payment_type', kind: 'text', label: 'Type', groupable: true, filterable: true },
    CUSTOMER_REF,
    RENTAL_REF,
  ],
  metrics: [
    { name: 'collected', label: 'Collected', kind: 'sum', column: 'amount', subtractColumn: 'refund_amount', currency: 'per_currency', definition: 'Money the application records as received: payments with a received status, excluding authorizations still awaiting capture, each counted as its amount minus any refund recorded against it (payment-status.ts). Not a Stripe payout, balance or bank figure.', dateBasis: 'payment_date' },
    { name: 'payment_count', label: 'Payments', kind: 'count', currency: 'none', definition: 'Number of received payment records matching the filters.', dateBasis: 'payment_date' },
  ],
  dateBases: [
    { name: 'payment_date', column: 'payment_date', kind: 'date', meaning: 'The business date of the payment — the basis for "collected last month".' },
    { name: 'paid_at', column: 'paid_at', kind: 'timestamp', meaning: 'When the payment was recorded as paid.' },
  ],
  links: [],
  currencySource: 'tenant',
  requiredFilters: [
    { column: 'status', op: 'in', value: ['Applied', 'Credit', 'Partial', 'Completed', 'Partial Refund'], because: 'Only these statuses mean the money arrived (payment-status.ts RECEIVED_PAYMENT_STATUSES).' },
    { column: 'capture_status', op: 'neq', value: 'requires_capture', because: 'An authorization awaiting capture is not collected money.' },
  ],
  rowCap: 50_000,
  sources: ['apps/portal/src/lib/payment-status.ts', 'supabase/migrations/20260121100000_add_reversed_payment_status.sql:8'],
};

/**
 * Sales and profit come from `pnl_entries` through the corrected money model
 * (apps/portal/src/app/(dashboard)/insights/_money-model.ts): tax, extension tax and
 * security deposits are not revenue, and vehicle purchases/disposals are capital, not
 * operating cost. The lossy `view_pl_*` views are deliberately not used.
 */
export const PROFIT_AND_LOSS: Dataset = {
  name: 'profit_and_loss', title: 'Revenue and cost entries', table: 'pnl_entries', tenantColumn: 'tenant_id', permission: 'pl_dashboard', financeScope: 'rental_payments',
  meaning: 'The accounting entries behind sales and profit. Each row is revenue or cost in a category. Operating revenue excludes tax, extension tax and security deposits, which are collected on behalf of someone else; vehicle acquisition and disposal are capital movements, not operating cost.',
  fields: [
    { name: 'side', column: 'side', kind: 'enum', values: ['Revenue', 'Cost'], label: 'Side', groupable: true, filterable: true },
    { name: 'category', column: 'category', kind: 'text', label: 'Category', groupable: true, filterable: true },
    VEHICLE_REF,
    CUSTOMER_REF,
    RENTAL_REF,
  ],
  metrics: [
    // _money-model.ts: NON_REVENUE_CATEGORIES and CAPITAL_COST_CATEGORIES.
    { name: 'operating_revenue', label: 'Operating revenue', kind: 'sum', column: 'amount', exclude: { column: 'category', values: ['Tax', 'Extension Tax', 'Security Deposit'] }, require: { column: 'side', value: 'Revenue' }, currency: 'per_currency', definition: 'Revenue entries excluding Tax, Extension Tax and Security Deposit, which are held for someone else and are not sales (_money-model.ts). Money earned, not money collected — use the payments dataset for what actually arrived.', dateBasis: 'entry_date' },
    { name: 'operating_cost', label: 'Operating cost', kind: 'sum', column: 'amount', exclude: { column: 'category', values: ['Acquisition', 'Disposal'] }, require: { column: 'side', value: 'Cost' }, currency: 'per_currency', definition: 'Cost entries excluding Acquisition and Disposal, which are vehicle capital movements rather than running cost (_money-model.ts).', dateBasis: 'entry_date' },
  ],
  dateBases: [{ name: 'entry_date', column: 'entry_date', kind: 'date', meaning: 'The accounting date of the entry — the basis for "sales last month".' }],
  links: [
    { name: 'vehicle', dataset: 'vehicles', column: 'vehicle_id', permission: 'vehicles' },
  ],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['apps/portal/src/app/(dashboard)/insights/_money-model.ts', 'supabase/migrations/20260503090449_add_unlimited_mileage_upgrade.sql:42-50'],
};

import { MODULE_DATASETS } from './business-catalog-modules.ts';

export const BUSINESS_CATALOG = Object.freeze({
  version: CATALOG_VERSION,
  datasets: Object.freeze([
    VEHICLES, RENTALS, CUSTOMERS, PAYMENTS, PROFIT_AND_LOSS,
    ...MODULE_DATASETS,
  ]) as readonly Dataset[],
});
