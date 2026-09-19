/**
 * The rest of the business modules TRAX can be asked about.
 *
 * Every column name, enum value and unit below was read from the deployed
 * database on 2026-09-18 (information_schema for columns, `select distinct` for
 * the value sets) — none is guessed. Where a value set is open-ended in practice
 * (fine types, expense categories) the field is `text` rather than `enum`, so a
 * filter is not silently rejected for a value the account legitimately uses.
 *
 * Money gating: a dataset that exists to describe money carries `financeScope`,
 * so the whole dataset needs the finance grant. A dataset that is operational but
 * happens to hold an amount (extensions, deposits) carries the scope on the money
 * METRIC instead, so a role without finance can still count rows.
 */
import type { Dataset } from './business-catalog.ts';
import { CUSTOMER_REF, VEHICLE_REF, RENTAL_REF } from './business-catalog-refs.ts';

/* ── Invoices ────────────────────────────────────────────────────────────── */
export const INVOICES: Dataset = {
  name: 'invoices', title: 'Invoices', table: 'invoices', tenantColumn: 'tenant_id', permission: 'invoices', financeScope: 'rental_payments',
  meaning: 'Invoice documents this account has issued. An invoice is what was billed, which is not the same as what was collected (payments) or what is still owed (customer balances). `status` is the invoice document state, not a payment state.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: ['pending', 'paid'], label: 'Status', groupable: true, filterable: true, meaning: 'Only these two values are stored; there is no cancelled or void state on the invoice itself.' },
    CUSTOMER_REF,
    RENTAL_REF,
    VEHICLE_REF,
  ],
  metrics: [
    { name: 'invoice_count', label: 'Invoices', kind: 'count', currency: 'none', definition: 'Number of invoice records matching the filters.', dateBasis: 'invoice_date' },
    { name: 'invoiced_total', label: 'Invoiced', kind: 'sum', column: 'total_amount', currency: 'per_currency', definition: 'Sum of invoice totals, tax included. This is money billed, not money received: compare with the payments dataset for what arrived.', dateBasis: 'invoice_date' },
    { name: 'invoiced_tax', label: 'Invoiced tax', kind: 'sum', column: 'tax_amount', currency: 'per_currency', definition: 'Tax billed on those invoices. Tax is collected on behalf of the authority and is not sales revenue.', dateBasis: 'invoice_date' },
    { name: 'invoiced_deposits', label: 'Invoiced security deposits', kind: 'sum', column: 'security_deposit', currency: 'per_currency', definition: 'Security deposit billed on those invoices. Held for the customer, never revenue.', dateBasis: 'invoice_date' },
  ],
  dateBases: [
    { name: 'invoice_date', column: 'invoice_date', kind: 'date', meaning: 'The date the invoice is dated — the basis for "invoiced last month".' },
    { name: 'due_date', column: 'due_date', kind: 'date', meaning: 'When the invoice falls due — the basis for overdue questions.' },
  ],
  links: [{ name: 'customer', dataset: 'customers', column: 'customer_id', permission: 'customers' }],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (invoices, read 2026-09-18)'],
};

/* ── Fines ───────────────────────────────────────────────────────────────── */
export const FINES: Dataset = {
  name: 'fines', title: 'Fines and penalty charges', table: 'fines', tenantColumn: 'tenant_id', permission: 'fines', financeScope: 'rental_payments',
  meaning: 'Fines and penalty charges recorded against a rental, vehicle or customer — tolls, PCNs, cleaning and damage charges. `liability` says who is responsible. A fine that is Open has not been settled; Waived means it was written off and is not owed.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: ['Open', 'Paid', 'Waived'], label: 'Status', groupable: true, filterable: true },
    { name: 'type', column: 'type', kind: 'text', label: 'Type', groupable: true, filterable: true, meaning: 'Free text as entered by staff (Toll Fees, PCN, Key Replacement, Speeding, …), so it is not a fixed list.' },
    { name: 'liability', column: 'liability', kind: 'text', label: 'Liability', groupable: true, filterable: true, meaning: 'Who is responsible for the fine; every stored row currently says Customer.' },
    CUSTOMER_REF,
    VEHICLE_REF,
    RENTAL_REF,
  ],
  metrics: [
    { name: 'fine_count', label: 'Fines', kind: 'count', currency: 'none', definition: 'Number of fine records matching the filters.', dateBasis: 'issue_date' },
    { name: 'fine_total', label: 'Fine amount', kind: 'sum', column: 'amount', currency: 'per_currency', definition: 'Sum of fine amounts matching the filters, whatever their status. Filter status to Open for what is still outstanding; a Waived fine is included unless excluded, because it was still issued.', dateBasis: 'issue_date' },
  ],
  dateBases: [
    { name: 'issue_date', column: 'issue_date', kind: 'date', meaning: 'When the fine was issued by the authority or recorded.' },
    { name: 'due_date', column: 'due_date', kind: 'date', meaning: 'When the fine must be paid.' },
    { name: 'charged_at', column: 'charged_at', kind: 'timestamp', meaning: 'When the fine was charged on to the customer.' },
  ],
  links: [{ name: 'customer', dataset: 'customers', column: 'customer_id', permission: 'customers' }],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (fines, read 2026-09-18)'],
};

/* ── Ledger ──────────────────────────────────────────────────────────────── */
export const LEDGER: Dataset = {
  name: 'ledger', title: 'Ledger entries', table: 'ledger_entries', tenantColumn: 'tenant_id', permission: 'payments', financeScope: 'rental_payments',
  meaning: 'The account’s money spine: every charge raised, payment recorded and refund given, in a category. This is the source the customer balance is built from. `amount` is what the entry was for; `remaining_amount` on a Charge is what is still unsettled on it.',
  fields: [
    { name: 'type', column: 'type', kind: 'enum', values: ['Charge', 'Payment', 'Refund'], label: 'Type', groupable: true, filterable: true },
    { name: 'category', column: 'category', kind: 'text', label: 'Category', groupable: true, filterable: true, meaning: 'Rental, Extension Rental, Tax, Extension Tax, Service Fee, Insurance, Security Deposit, Fine, Delivery Fee, Extras, Excess Mileage, Adjustment and similar.' },
    CUSTOMER_REF,
    RENTAL_REF,
    VEHICLE_REF,
  ],
  metrics: [
    { name: 'entry_count', label: 'Entries', kind: 'count', currency: 'none', definition: 'Number of ledger entries matching the filters.', dateBasis: 'entry_date' },
    { name: 'charged', label: 'Charged', kind: 'sum', column: 'amount', require: { column: 'type', value: 'Charge' }, currency: 'per_currency', definition: 'Sum of charge entries: what was billed to customers, tax and deposits included. Not revenue and not money received.', dateBasis: 'entry_date' },
    { name: 'refunded', label: 'Refunded', kind: 'sum', column: 'amount', require: { column: 'type', value: 'Refund' }, currency: 'per_currency', definition: 'Sum of ledger entries of type Refund — money given back, recorded on the ledger. A refund is also recorded as `payments.refund_amount` on the original payment, so do NOT add this to that figure; they describe the same money from two sides.', dateBasis: 'entry_date' },
    { name: 'unsettled_charges', label: 'Unsettled on charges', kind: 'sum', column: 'remaining_amount', require: { column: 'type', value: 'Charge' }, currency: 'per_currency', definition: 'Sum of remaining_amount on charge entries. This is a RAW ledger total, not a customer balance: it does not exclude cancelled or rejected rentals, does not substitute pay-as-you-go accruals for their ledger rows, and does not net off unapplied credit. For what a customer actually owes, use query_customer_balances.', dateBasis: 'due_date' },
  ],
  dateBases: [
    { name: 'entry_date', column: 'entry_date', kind: 'date', meaning: 'The business date of the entry.' },
    { name: 'due_date', column: 'due_date', kind: 'date', meaning: 'When a charge falls due; the basis for ageing questions.' },
  ],
  links: [{ name: 'customer', dataset: 'customers', column: 'customer_id', permission: 'customers' }],
  currencySource: 'tenant',
  rowCap: 100_000,
  sources: ['information_schema.columns (ledger_entries, read 2026-09-18)', 'apps/portal/src/hooks/use-customer-balance.ts'],
};

/* ── Expenses ────────────────────────────────────────────────────────────── */
export const EXPENSES: Dataset = {
  name: 'expenses', title: 'Vehicle and operating expenses', table: 'vehicle_expenses', tenantColumn: 'tenant_id', permission: 'expenses', financeScope: 'rental_payments',
  meaning: 'Money this account spent, recorded against a vehicle or as general overhead — servicing, repairs, insurance, salaries, rent, marketing, tolls and similar. Costs recorded here feed the profit and loss entries; this dataset is the expense records themselves.',
  fields: [
    { name: 'category', column: 'category', kind: 'text', label: 'Category', groupable: true, filterable: true, meaning: 'As entered by staff: Service, Rent, Insurance, Salaries, Repair, Valet, Marketing, Utilities, Tyres, Software, Tolls, Cleaning, Parking, Accessory and similar.' },
    VEHICLE_REF,
    { name: 'vendor', column: 'vendor', kind: 'text', label: 'Vendor', groupable: true, filterable: true },
    { name: 'payment_method', column: 'payment_method', kind: 'text', label: 'Payment method', groupable: true, filterable: true },
    { name: 'is_recurring', column: 'is_recurring', kind: 'boolean', label: 'Recurring', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'expense_count', label: 'Expenses', kind: 'count', currency: 'none', definition: 'Number of expense records matching the filters.', dateBasis: 'expense_date' },
    { name: 'expense_total', label: 'Spent', kind: 'sum', column: 'amount', currency: 'per_currency', definition: 'Sum of recorded expense amounts. These are the expense records as entered; the profit and loss dataset is the accounting view, and vehicle purchases there are capital rather than running cost.', dateBasis: 'expense_date' },
  ],
  dateBases: [
    { name: 'expense_date', column: 'expense_date', kind: 'date', meaning: 'The date the expense is recorded against.' },
    { name: 'expense_at', column: 'expense_at', kind: 'timestamp', meaning: 'Timestamp form of the same expense, where recorded.' },
  ],
  links: [{ name: 'vehicle', dataset: 'vehicles', column: 'vehicle_id', permission: 'vehicles' }],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (vehicle_expenses, read 2026-09-18)'],
};

/* ── Owner payouts ───────────────────────────────────────────────────────── */
export const OWNER_PAYOUTS: Dataset = {
  name: 'owner_payouts', title: 'Owner payouts', table: 'owner_payouts', tenantColumn: 'tenant_id', permission: 'owner_payouts', financeScope: 'rental_payments',
  meaning: 'What this account owes, or has paid, to vehicle owners for a period: gross revenue earned on their vehicles, the commission retained, refund adjustments, and the net owed. A payout is a settlement with an owner, not customer money.',
  fields: [
    { name: 'status', column: 'status', kind: 'text', label: 'Status', groupable: true, filterable: true, meaning: 'Settlement state; every stored row currently says paid.' },
    { name: 'owner_id', column: 'owner_id', kind: 'uuid', label: 'Owner', groupable: true, filterable: true },
    { name: 'payment_method', column: 'payment_method', kind: 'text', label: 'Payment method', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'payout_count', label: 'Payouts', kind: 'count', currency: 'none', definition: 'Number of payout records matching the filters.', dateBasis: 'period_start' },
    { name: 'gross_revenue', label: 'Gross revenue', kind: 'sum', column: 'gross_revenue', currency: 'per_currency', definition: 'Revenue earned on the owner’s vehicles in the period, before commission.', dateBasis: 'period_start' },
    { name: 'commission', label: 'Commission retained', kind: 'sum', column: 'commission_amount', currency: 'per_currency', definition: 'The share this account retained from that gross revenue.', dateBasis: 'period_start' },
    { name: 'net_owed', label: 'Net owed to owners', kind: 'sum', column: 'net_owed', currency: 'per_currency', definition: 'Gross revenue less commission and refund adjustments: what the owner is due for the period.', dateBasis: 'period_start' },
    { name: 'amount_paid', label: 'Paid to owners', kind: 'sum', column: 'amount_paid', currency: 'per_currency', definition: 'What has actually been paid out against those payouts.', dateBasis: 'paid_at' },
  ],
  dateBases: [
    { name: 'period_start', column: 'period_start', kind: 'date', meaning: 'Start of the payout period.' },
    { name: 'period_end', column: 'period_end', kind: 'date', meaning: 'End of the payout period.' },
    { name: 'paid_at', column: 'paid_at', kind: 'timestamp', meaning: 'When the payout was settled.' },
  ],
  links: [],
  currencySource: 'tenant',
  rowCap: 20_000,
  sources: ['information_schema.columns (owner_payouts, read 2026-09-18)'],
};

/* ── Rental extensions ───────────────────────────────────────────────────── */
export const RENTAL_EXTENSIONS: Dataset = {
  name: 'rental_extensions', title: 'Rental extensions', table: 'rental_extensions', tenantColumn: 'tenant_id', permission: 'rentals',
  meaning: 'Requests to extend a rental beyond its end date, and what each was worth. An extension that is approved has been agreed; paid means the customer has settled it. Counting extensions is an operational question and needs no finance permission; their value does.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: ['approved', 'paid', 'cancelled'], label: 'Status', groupable: true, filterable: true },
    RENTAL_REF,
    { name: 'sequence_number', column: 'sequence_number', kind: 'number', label: 'Extension number', groupable: true, filterable: true, meaning: 'Which extension this is for that rental: 1 is the first.' },
  ],
  metrics: [
    { name: 'extension_count', label: 'Extensions', kind: 'count', currency: 'none', definition: 'Number of extension records matching the filters. Available without the finance permission.', dateBasis: 'requested_at' },
    { name: 'extension_days', label: 'Days extended', kind: 'sum', column: 'extension_days', currency: 'none', definition: 'Total days added across the matching extensions. A count of days, not money.', dateBasis: 'requested_at' },
    { name: 'extension_value', label: 'Extension value', kind: 'sum', column: 'total_amount', currency: 'per_currency', financeScope: 'rental_payments', definition: 'Sum of extension totals, tax and fees included. What the extensions were billed at, not necessarily collected — filter status to paid for settled ones.', dateBasis: 'requested_at' },
    { name: 'extension_paid', label: 'Extension money received', kind: 'sum', column: 'paid_amount', subtractColumn: 'refunded_amount', currency: 'per_currency', financeScope: 'rental_payments', definition: 'Paid amount on those extensions, net of anything refunded against the same extension.', dateBasis: 'paid_at' },
  ],
  dateBases: [
    { name: 'requested_at', column: 'requested_at', kind: 'timestamp', meaning: 'When the extension was requested.' },
    { name: 'approved_at', column: 'approved_at', kind: 'timestamp', meaning: 'When it was approved.' },
    { name: 'paid_at', column: 'paid_at', kind: 'timestamp', meaning: 'When it was paid.' },
    { name: 'new_end_date', column: 'new_end_date', kind: 'date', meaning: 'The end date the rental was extended to.' },
  ],
  links: [],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (rental_extensions, read 2026-09-18)'],
};

/* ── Deposits held ───────────────────────────────────────────────────────── */
export const DEPOSITS: Dataset = {
  name: 'deposits', title: 'Security deposit holds', table: 'deposit_hold_links', tenantColumn: 'tenant_id', permission: 'rentals',
  meaning: 'Each attempt to place, extend, capture or release a security deposit hold on a card, with its outcome and the Stripe account and mode it went to. One rental can have several attempts, so a row is an attempt, not a deposit. Whether a deposit is still held today is a state-machine question this dataset does not answer on its own — it shows the attempts and their outcomes.',
  fields: [
    { name: 'action', column: 'action', kind: 'text', label: 'Action', groupable: true, filterable: true, meaning: 'What was attempted on the hold: place, extend, capture, release and similar.' },
    { name: 'outcome', column: 'outcome', kind: 'text', label: 'Outcome', groupable: true, filterable: true, meaning: 'Whether that attempt succeeded, and how it failed if not.' },
    { name: 'stripe_mode', column: 'stripe_mode', kind: 'text', label: 'Stripe mode', groupable: true, filterable: true, meaning: 'test or live. A test-mode hold is not real money.' },
    { name: 'platform_account', column: 'platform_account', kind: 'text', label: 'Platform account', groupable: true, filterable: true },
    { name: 'extended_auth_status', column: 'extended_auth_status', kind: 'text', label: 'Extended authorization', groupable: true, filterable: true },
    { name: 'card_funding', column: 'card_funding', kind: 'text', label: 'Card funding', groupable: true, filterable: true },
    RENTAL_REF,
  ],
  metrics: [
    { name: 'attempt_count', label: 'Hold attempts', kind: 'count', currency: 'none', definition: 'Number of deposit hold attempts matching the filters. One rental may have several. Available without the finance permission.', dateBasis: 'created_at' },
    { name: 'held_amount', label: 'Amount held', kind: 'sum', column: 'amount_cents', minorUnits: true, currency: 'per_currency', financeScope: 'rental_payments', definition: 'Sum of the amounts on those hold attempts. Stored in minor units (cents) and reported in the row’s own currency. An authorization is not collected money, and summing attempts is not the amount currently held — filter by action and outcome for that.', dateBasis: 'created_at' },
  ],
  dateBases: [
    { name: 'created_at', column: 'created_at', kind: 'timestamp', meaning: 'When the attempt was made.' },
    { name: 'completed_at', column: 'completed_at', kind: 'timestamp', meaning: 'When the attempt finished.' },
    { name: 'capture_before', column: 'capture_before', kind: 'timestamp', meaning: 'The deadline for capturing the authorization.' },
  ],
  links: [],
  currencyColumn: 'currency',
  currencySource: 'row',
  rowCap: 50_000,
  sources: ['information_schema.columns (deposit_hold_links, read 2026-09-18)', 'apps/portal/src/lib/payments-model.ts:816'],
};

/* ── Platform subscription ───────────────────────────────────────────────── */
export const SUBSCRIPTION: Dataset = {
  name: 'subscription', title: 'Drive247 subscription', table: 'tenant_subscriptions', tenantColumn: 'tenant_id', permission: 'settings.subscription', financeScope: 'rental_payments',
  meaning: 'What THIS account pays Drive247 for the platform: plan, status, amount and billing interval. This is the account’s own cost, not rental income and not customer money. It must never be added to revenue or to anything in the payments dataset.',
  fields: [
    { name: 'status', column: 'status', kind: 'enum', values: ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired'], label: 'Status', groupable: true, filterable: true },
    { name: 'plan_name', column: 'plan_name', kind: 'text', label: 'Plan', groupable: true, filterable: true },
    { name: 'interval', column: 'interval', kind: 'text', label: 'Billing interval', groupable: true, filterable: true, meaning: 'Every stored row is month.' },
    { name: 'card_brand', column: 'card_brand', kind: 'text', label: 'Card brand', groupable: true, filterable: true },
  ],
  metrics: [
    { name: 'subscription_count', label: 'Subscription records', kind: 'count', currency: 'none', definition: 'Number of subscription records for this account, including historical and cancelled ones.', dateBasis: 'created_at' },
    { name: 'subscription_amount', label: 'Subscription amount', kind: 'sum', column: 'amount', minorUnits: true, currency: 'per_currency', definition: 'Sum of the subscription amounts on the matching records, stored in minor units (cents) in the row’s own currency. Filter status to active for what is currently billed; summing every historical record is not a monthly cost.', dateBasis: 'created_at' },
  ],
  dateBases: [
    { name: 'created_at', column: 'created_at', kind: 'timestamp', meaning: 'When the subscription record was created.' },
    { name: 'current_period_start', column: 'current_period_start', kind: 'timestamp', meaning: 'Start of the current billing period.' },
    { name: 'current_period_end', column: 'current_period_end', kind: 'timestamp', meaning: 'End of the current billing period — when it renews.' },
  ],
  links: [],
  currencyColumn: 'currency',
  currencySource: 'row',
  rowCap: 5_000,
  sources: ['information_schema.columns (tenant_subscriptions, read 2026-09-18)'],
};

/* ── Maintenance ─────────────────────────────────────────────────────────── */
export const MAINTENANCE: Dataset = {
  name: 'maintenance', title: 'Vehicle maintenance jobs', table: 'vehicle_maintenance_jobs', tenantColumn: 'tenant_id', permission: 'vehicles',
  meaning: 'Servicing and repair jobs scheduled against vehicles, with their priority and state. A scheduled job may block the vehicle for its dates, which is why a vehicle can be unavailable without being paused.',
  fields: [
    { name: 'status', column: 'status', kind: 'text', label: 'Status', groupable: true, filterable: true, meaning: 'Job state such as scheduled, acknowledged or completed.' },
    { name: 'priority', column: 'priority', kind: 'text', label: 'Priority', groupable: true, filterable: true },
    { name: 'category', column: 'category', kind: 'text', label: 'Category', groupable: true, filterable: true },
    { name: 'service_type', column: 'service_type', kind: 'text', label: 'Service type', groupable: true, filterable: true },
    { name: 'vendor_name', column: 'vendor_name', kind: 'text', label: 'Vendor', groupable: true, filterable: true },
    VEHICLE_REF,
  ],
  metrics: [
    { name: 'job_count', label: 'Maintenance jobs', kind: 'count', currency: 'none', definition: 'Number of maintenance jobs matching the filters.', dateBasis: 'scheduled_start' },
  ],
  dateBases: [
    { name: 'scheduled_start', column: 'scheduled_start', kind: 'date', meaning: 'When the job is scheduled to begin.' },
    { name: 'scheduled_end', column: 'scheduled_end', kind: 'date', meaning: 'When it is scheduled to end.' },
    { name: 'completed_at', column: 'completed_at', kind: 'timestamp', meaning: 'When it was completed.' },
  ],
  links: [{ name: 'vehicle', dataset: 'vehicles', column: 'vehicle_id', permission: 'vehicles' }],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (vehicle_maintenance_jobs, read 2026-09-18)'],
};

/* ── Identity verification ───────────────────────────────────────────────── */
export const VERIFICATIONS: Dataset = {
  name: 'verifications', title: 'Identity verifications', table: 'identity_verifications', tenantColumn: 'tenant_id', permission: 'customers',
  meaning: 'Identity and licence verification attempts for customers, and how each was decided. Counts and states only: document numbers, images, dates of birth and addresses are deliberately not exposed to TRAX, so a verification can be counted and grouped but not read out.',
  fields: [
    { name: 'status', column: 'status', kind: 'text', label: 'Status', groupable: true, filterable: true },
    { name: 'review_status', column: 'review_status', kind: 'text', label: 'Review status', groupable: true, filterable: true },
    { name: 'review_result', column: 'review_result', kind: 'text', label: 'Review result', groupable: true, filterable: true },
    { name: 'provider', column: 'provider', kind: 'text', label: 'Provider', groupable: true, filterable: true },
    { name: 'document_type', column: 'document_type', kind: 'text', label: 'Document type', groupable: true, filterable: true, meaning: 'The KIND of document (licence, passport) — never its number.' },
    { name: 'document_country', column: 'document_country', kind: 'text', label: 'Document country', groupable: true, filterable: true },
    CUSTOMER_REF,
  ],
  metrics: [
    { name: 'verification_count', label: 'Verifications', kind: 'count', currency: 'none', definition: 'Number of verification records matching the filters. One customer may have several attempts, so this is attempts, not verified customers.', dateBasis: 'created_at' },
  ],
  dateBases: [
    { name: 'created_at', column: 'created_at', kind: 'timestamp', meaning: 'When the verification was started.' },
    { name: 'verification_completed_at', column: 'verification_completed_at', kind: 'timestamp', meaning: 'When it completed.' },
    { name: 'document_expiry_date', column: 'document_expiry_date', kind: 'date', meaning: 'When the presented document expires — the basis for expiring-licence questions.' },
  ],
  links: [{ name: 'customer', dataset: 'customers', column: 'customer_id', permission: 'customers' }],
  currencySource: 'tenant',
  rowCap: 50_000,
  sources: ['information_schema.columns (identity_verifications, read 2026-09-18)'],
};

export const MODULE_DATASETS: readonly Dataset[] = Object.freeze([
  INVOICES, FINES, LEDGER, EXPENSES, OWNER_PAYOUTS,
  RENTAL_EXTENSIONS, DEPOSITS, SUBSCRIPTION, MAINTENANCE, VERIFICATIONS,
]);
