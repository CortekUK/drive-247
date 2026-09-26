/**
 * Finances — the model's contract (docs/FINANCES_DESIGN.md §8.1).
 *
 * The first block is the PINNED API, exactly as the design states it; the UI
 * builds against it. Fields may be ADDED (each addition is marked "added") but
 * nothing pinned is renamed or removed.
 *
 * Money is integer CENTS everywhere in this directory. Dates are 'YYYY-MM-DD'
 * calendar days in the TENANT's timezone (`tenants.timezone`), never UTC.
 *
 * The second block is the raw rows the loader (`hooks/use-finances-data.ts`)
 * reads from Postgres, snake_case and in dollars, exactly as PostgREST hands
 * them over. Dollars become cents in ONE place (`toCents`, lib/finances/balance.ts).
 */

/* ══════════════════════════════════════════════════════════════════════════
   Pinned (§8.1)
   ══════════════════════════════════════════════════════════════════════════ */

export type FinanceView = "billed" | "received" | "upcoming" | "fines";
export type Period = "today" | "7d" | "month" | "all" | { from: string; to: string };
export interface FinanceScope {
  rentalId?: string;
  customerId?: string;
}
export type FinanceCard = "outstanding" | "overdue" | "collected" | "upcoming";
export interface FinanceFilters {
  search?: string;
  statuses?: string[];
  methods?: string[];
  period: Period;
  card?: FinanceCard | null;
}
export interface FinanceStats {
  outstandingCents: number;
  outstandingCustomers: number;
  overdueCents: number;
  overdueRentals: number;
  collectedCents: number;
  collectedCount: number;
  refundedCents: number;
  upcomingCents: number;
  upcomingCount: number;
  upcomingAuto: number;
  upcomingLinks: number;
}

export interface BillLine {
  chargeId: string;
  category: string;
  amountCents: number;
  remainingCents: number;
  appliedCents: number;
  dueDate: string | null;
  /** added — `ledger_entries.entry_date` (day part). */
  entryDate: string | null;
  /** added — the payments applied to this charge (`payment_applications`), one entry per payment. */
  applications: { paymentId: string; amountCents: number }[];
  /** added — this line's `remaining_amount` counts toward Outstanding (the useCustomerBalance rule). */
  countsTowardOutstanding: boolean;
}

export type BillStatus = "paid" | "open" | "overdue" | "credit";

export interface BillRow {
  key: string;
  /** "" for a customer's charges that sit on no rental (see `onRental`). */
  rentalId: string;
  rentalRef: string;
  extensionId: string | null;
  label: string;
  customerId: string;
  customerName: string;
  vehicleReg: string | null;
  invoiceNumber: string | null;
  issuedOn: string;
  dueOn: string | null;
  totalCents: number;
  paidCents: number;
  creditedCents: number;
  balanceCents: number;
  tiesOut: boolean;
  /** (Total − Paid − Credited) − Balance. 0 when it ties out; the UI shows |mismatchCents|. */
  mismatchCents: number;
  status: BillStatus;
  overdueDays: number | null;
  lines: BillLine[];
  /**
   * added — this bill's part of the Outstanding card: Σ remaining on its lines
   * that count (not a cancelled/rejected/PAYG rental, not a Rental charge due
   * after today), plus — on a PAYG rental's booking bill — its open accruals.
   * Σ over the Outstanding card's rows = `FinanceStats.outstandingCents`.
   */
  outstandingCents: number;
  /** added — the part of `outstandingCents` on charges whose due date is before today. */
  overdueCents: number;
  /** added — open PAYG accrual day-totals (booking bill of a PAYG rental only; else 0). */
  paygOpenCents: number;
  /** added — the rental is pay-as-you-go (its outstanding comes from accruals, not the ledger). */
  isPayg: boolean;
  /** added — why this rental's charges never count toward Outstanding. */
  excludedReason: "cancelled" | "rejected" | null;
  /** added — false for the per-customer "Not on a rental" bill (`rentalId` is ""). */
  onRental: boolean;
  /** added — the rental's vehicle (else the first charge's), for the vehicle link the old Payments rows had. */
  vehicleId?: string | null;
  /** added — the `invoices` row behind `invoiceNumber` (booking bill only), for Email and Delete invoice. */
  invoiceId?: string | null;
}

export type ReceiptStatus = "approved" | "pending_review" | "rejected" | "refunded" | "partially_refunded" | "pending";

export interface ReceiptRow {
  paymentId: string;
  date: string;
  customerId: string;
  customerName: string;
  rentalId: string | null;
  rentalRef: string | null;
  vehicleReg: string | null;
  amountCents: number;
  refundedCents: number;
  unappliedCents: number;
  method: string | null;
  provider: "stripe" | "square" | "manual";
  providerRef: string | null;
  providerMode: "test" | "live" | null;
  status: ReceiptStatus;
  appliedTo: { chargeId: string; category: string; rentalRef: string | null; amountCents: number }[];
  planLabel: string | null;
  occurrenceId: string | null;
  /** added — `payments.status` as stored (Applied, Credit, Partial, Completed, Pending, Reversed, Refunded, Partial Refund…). */
  rawStatus: string | null;
  /** added — `payments.payment_type` ('Payment' | 'InitialFee'). */
  paymentType: string;
  /** added — money actually landed (lib/payment-status `isMoneyReceived`: a received status and not `requires_capture`). */
  countsAsReceived: boolean;
  /** added — amount − refunded, never below 0; what this row adds to Collected when it is collected. */
  netCents: number;
  /** added — every provider id on the row (intent, checkout session, Square payment/order/link), for search and the side panel. */
  references: string[];
  /** added — the Stripe account the plan attempt recorded (plan payments only), for `dashboardLinkFor`. */
  providerAccount: string | null;
  /** added — `payments.stripe_checkout_session_id`, for `dashboardLinkFor`. */
  checkoutSessionId: string | null;
  /** added — `payments.verification_status`. */
  verificationStatus: string | null;
  /** added — the app_users id that recorded it, when a plan attempt names one. `payments` itself has no author column. */
  recordedById: string | null;
  /** added — `payments.created_at`: when the row was written. */
  recordedAt: string | null;
  /** added — `payments.extension_id`. */
  extensionId: string | null;
  /** added — `payments.vehicle_id`, else the rental's vehicle, for the vehicle link the old Payments rows had. */
  vehicleId?: string | null;
  /**
   * added — a payment link or charge the operator SENT: the row carries a Stripe
   * checkout session or a Square payment link. Exactly the rows the old
   * Invoices tab's "Payment Requests" list selected (hooks/use-payment-links.ts
   * `fetchTenantPaymentRequests`: stripe_checkout_session_id or
   * square_payment_link_id not null), whatever their status.
   */
  isPaymentRequest?: boolean;
}

export type UpcomingMethod = "auto_charge" | "checkout_link" | "manual";

export interface UpcomingRow {
  occurrenceId: string;
  planId: string;
  rentalId: string;
  rentalRef: string;
  customerId: string;
  customerName: string;
  dueDate: string;
  seqLabel: string;
  amountCents: number;
  method: UpcomingMethod;
  status: string;
  /** added — the day the money is next expected: the retry day for a failed occurrence with a retry, else `dueDate`. */
  effectiveOn: string;
  /** added — the retry day (plan timezone) when a failed occurrence will be tried again. */
  nextAttemptOn: string | null;
  /** added — the plan's own status (active / paused / completed / cancelled). */
  planStatus: string;
}

export type AttentionKind = "card_declined" | "needs_customer" | "awaiting_review" | "possible_duplicate" | "unapplied_credit";
export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  amountCents: number;
  rentalId: string | null;
  customerId: string | null;
  paymentIds: string[];
  occurrenceId: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Raw rows (what the loader reads; dollars, snake_case)
   ══════════════════════════════════════════════════════════════════════════ */

type Num = number | string | null | undefined;

export interface RawRental {
  id: string;
  rental_number?: string | null;
  customer_id: string | null;
  vehicle_id?: string | null;
  status?: string | null;
  approval_status?: string | null;
  is_pay_as_you_go?: boolean | null;
  payg_closed_at?: string | null;
  start_date?: string | null;
  created_at?: string | null;
}

/** A `ledger_entries` row with `type = 'Charge'`. */
export interface RawCharge {
  id: string;
  type?: string | null;
  rental_id: string | null;
  customer_id: string | null;
  vehicle_id?: string | null;
  extension_id?: string | null;
  category: string | null;
  amount: Num;
  remaining_amount: Num;
  due_date: string | null;
  entry_date?: string | null;
  created_at?: string | null;
  reference?: string | null;
}

export interface RawApplication {
  id?: string;
  payment_id: string | null;
  charge_entry_id: string | null;
  amount_applied: Num;
}

export interface RawPayment {
  id: string;
  customer_id: string | null;
  rental_id: string | null;
  vehicle_id?: string | null;
  extension_id?: string | null;
  amount: Num;
  remaining_amount?: Num;
  refund_amount?: Num;
  status: string | null;
  capture_status?: string | null;
  payment_type?: string | null;
  method?: string | null;
  payment_date: string | null;
  paid_at?: string | null;
  created_at?: string | null;
  verification_status?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  square_payment_id?: string | null;
  square_order_id?: string | null;
  square_payment_link_id?: string | null;
  payment_provider?: string | null;
  booking_source?: string | null;
  /** Present only when the payment-plan migration is applied (selected only then). */
  payment_plan_occurrence_id?: string | null;
}

export interface RawInvoice {
  id?: string;
  rental_id: string | null;
  invoice_number: string | null;
  created_at?: string | null;
}

export interface RawExtension {
  id: string;
  rental_id: string;
  sequence_number?: number | null;
  status?: string | null;
  created_at?: string | null;
}

/** An OPEN `payg_accruals` row on a rental whose PAYG is not closed (the loader's filters). */
export interface RawAccrual {
  id?: string;
  rental_id: string | null;
  daily_rate: Num;
  tax_amount: Num;
  service_fee_amount: Num;
  rentals?: { customer_id: string | null; payg_closed_at?: string | null } | null;
}

export interface RawCustomer {
  id: string;
  name: string | null;
}

export interface RawVehicle {
  id: string;
  reg: string | null;
}

export interface RawPlan {
  id: string;
  rental_id: string;
  customer_id: string | null;
  status: string;
  timezone?: string | null;
}

export interface RawOccurrence {
  id: string;
  plan_id: string;
  rental_id: string;
  seq: number;
  due_date: string;
  amount: Num;
  amount_paid: Num;
  collection_method: string;
  status: string;
  next_attempt_at?: string | null;
}

export interface RawAttempt {
  id: string;
  occurrence_id: string;
  attempt_no: number;
  status?: string | null;
  provider?: string | null;
  provider_account?: string | null;
  provider_mode?: string | null;
  provider_ref?: string | null;
  checkout_session_id?: string | null;
  payment_id?: string | null;
  decline_code?: string | null;
  error_code?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface FinanceRawData {
  rentals: RawRental[];
  charges: RawCharge[];
  applications: RawApplication[];
  payments: RawPayment[];
  invoices: RawInvoice[];
  extensions: RawExtension[];
  accruals: RawAccrual[];
  customers: RawCustomer[];
  vehicles: RawVehicle[];
  /** Empty when the payment-plan tables are absent. */
  plans: RawPlan[];
  occurrences: RawOccurrence[];
  attempts: RawAttempt[];
  /**
   * Charges OUTSIDE the scope that a scoped payment was applied to — read so a
   * receipt can name what it paid off. Used for lookups only; never billed.
   */
  linkedCharges?: RawCharge[];
  /** The loader's verdict: the payment-plan tables answered a real read. */
  plansAvailable?: boolean;
}

/** Everything the pure builders need besides the rows. */
export interface FinanceContext {
  /** Today in the tenant's timezone, 'YYYY-MM-DD'. */
  today: string;
  /** `tenants.timezone`; null falls back to the browser's zone. */
  timeZone: string | null;
  /** ISO 4217, for the sentences in Needs attention. */
  currency: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   Series for the charts (added) — each built from the SAME rows as the
   headline number it sits under, so a chart can never disagree with it.
   ══════════════════════════════════════════════════════════════════════════ */

/** One bar of the Collected chart: a day, or a Monday-start week clipped to the period. */
export interface CollectedPoint {
  /** First day of the bucket, 'YYYY-MM-DD' (tenant calendar). */
  start: string;
  /** Last day of the bucket, inclusive. Equal to `start` for a day. */
  end: string;
  /** Σ netCents of the collected receipts dated in the bucket. */
  collectedCents: number;
  /** Σ what was refunded off those same receipts (amount − net). */
  refundedCents: number;
  count: number;
}
export interface CollectedSeries {
  /** "day" when the period spans ≤ 31 days, else "week". */
  bucket: "day" | "week";
  points: CollectedPoint[];
  /** === FinanceStats.collectedCents */
  totalCollectedCents: number;
  /** === FinanceStats.refundedCents */
  totalRefundedCents: number;
  /** === FinanceStats.collectedCount */
  totalCount: number;
}

export type AgeingKey = "current" | "d1_30" | "d31_60" | "d60_plus";
export interface AgeingBucket {
  key: AgeingKey;
  /** "Current" · "1–30 days" · "31–60 days" · "Over 60 days" */
  label: string;
  cents: number;
}
export interface OutstandingAgeing {
  /** Always four, in order: current, 1–30, 31–60, over 60 days overdue. */
  buckets: AgeingBucket[];
  /** Σ buckets === FinanceStats.outstandingCents */
  totalCents: number;
  /** Σ non-current buckets === FinanceStats.overdueCents */
  overdueCents: number;
}

export interface UpcomingSplit {
  cents: number;
  count: number;
}
export interface UpcomingDay {
  date: string;
  cents: number;
  count: number;
  auto: UpcomingSplit;
  link: UpcomingSplit;
  manual: UpcomingSplit;
}
export interface UpcomingSeries {
  /** Always 7 days: today and the six after it. */
  days: UpcomingDay[];
  /** === FinanceStats.upcomingCents */
  totalCents: number;
  /** === FinanceStats.upcomingCount */
  totalCount: number;
}

export interface FinanceSeries {
  collected: CollectedSeries;
  ageing: OutstandingAgeing;
  upcoming: UpcomingSeries;
}

/** The whole model, before any filter. */
export interface FinanceModel {
  bills: BillRow[];
  receipts: ReceiptRow[];
  upcoming: UpcomingRow[];
  attention: AttentionItem[];
}
