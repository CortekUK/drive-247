/**
 * Raw-row builders for the Finances model tests. Every money value in a test
 * is a LITERAL written by hand in that test — these helpers only fill the
 * columns a test does not care about.
 */
import type {
  FinanceContext,
  FinanceRawData,
  RawAccrual,
  RawApplication,
  RawAttempt,
  RawCharge,
  RawOccurrence,
  RawPayment,
  RawPlan,
  RawRental,
} from '@/lib/finances/types';

export const TODAY = '2026-09-25';
export const CTX: FinanceContext = { today: TODAY, timeZone: 'America/New_York', currency: 'USD' };

export function emptyRaw(): FinanceRawData {
  return {
    rentals: [],
    charges: [],
    applications: [],
    payments: [],
    invoices: [],
    extensions: [],
    accruals: [],
    customers: [],
    vehicles: [],
    plans: [],
    occurrences: [],
    attempts: [],
  };
}

export const rental = (id: string, customer_id: string, extra: Partial<RawRental> = {}): RawRental => ({
  id,
  rental_number: id.toUpperCase(),
  customer_id,
  vehicle_id: null,
  status: 'Active',
  approval_status: 'approved',
  is_pay_as_you_go: false,
  payg_closed_at: null,
  start_date: '2026-09-01',
  created_at: '2026-09-01T10:00:00Z',
  ...extra,
});

export const charge = (
  id: string,
  rental_id: string | null,
  customer_id: string | null,
  category: string,
  amount: number,
  remaining_amount: number,
  due_date: string | null,
  extra: Partial<RawCharge> = {},
): RawCharge => ({
  id,
  type: 'Charge',
  rental_id,
  customer_id,
  vehicle_id: null,
  extension_id: null,
  category,
  amount,
  remaining_amount,
  due_date,
  entry_date: due_date ?? '2026-09-01',
  created_at: '2026-09-01T10:00:00Z',
  reference: null,
  ...extra,
});

export const application = (payment_id: string, charge_entry_id: string, amount_applied: number): RawApplication => ({
  id: `${payment_id}>${charge_entry_id}`,
  payment_id,
  charge_entry_id,
  amount_applied,
});

export const payment = (id: string, customer_id: string, rental_id: string | null, amount: number, extra: Partial<RawPayment> = {}): RawPayment => ({
  id,
  customer_id,
  rental_id,
  vehicle_id: null,
  extension_id: null,
  amount,
  remaining_amount: 0,
  refund_amount: null,
  status: 'Applied',
  capture_status: 'captured',
  payment_type: 'Payment',
  method: 'Card',
  payment_date: TODAY,
  paid_at: null,
  created_at: `${TODAY}T15:00:00Z`,
  verification_status: 'approved',
  stripe_payment_intent_id: null,
  stripe_checkout_session_id: null,
  square_payment_id: null,
  square_order_id: null,
  square_payment_link_id: null,
  payment_provider: 'stripe',
  booking_source: 'admin',
  ...extra,
});

export const accrual = (rental_id: string, customer_id: string, daily_rate: number, tax_amount: number, service_fee_amount: number): RawAccrual => ({
  id: `acc-${rental_id}-${daily_rate}-${tax_amount}`,
  rental_id,
  daily_rate,
  tax_amount,
  service_fee_amount,
  rentals: { customer_id, payg_closed_at: null },
});

export const plan = (id: string, rental_id: string, customer_id: string, extra: Partial<RawPlan> = {}): RawPlan => ({
  id,
  rental_id,
  customer_id,
  status: 'active',
  timezone: 'America/New_York',
  ...extra,
});

export const occurrence = (
  id: string,
  plan_id: string,
  rental_id: string,
  seq: number,
  due_date: string,
  amount: number,
  amount_paid: number,
  status: string,
  extra: Partial<RawOccurrence> = {},
): RawOccurrence => ({
  id,
  plan_id,
  rental_id,
  seq,
  due_date,
  amount,
  amount_paid,
  collection_method: 'auto_charge',
  status,
  next_attempt_at: null,
  ...extra,
});

export const attempt = (id: string, occurrence_id: string, attempt_no: number, extra: Partial<RawAttempt> = {}): RawAttempt => ({
  id,
  occurrence_id,
  attempt_no,
  status: 'failed',
  provider: 'stripe',
  provider_account: null,
  provider_mode: null,
  provider_ref: null,
  checkout_session_id: null,
  payment_id: null,
  decline_code: null,
  error_code: null,
  created_by: null,
  created_at: '2026-09-20T14:00:00Z',
  ...extra,
});

/**
 * A small tenant with every case the cards distinguish. Hand-derived figures
 * for it live in the tests that use it (finances-stats-filters, finances-series).
 */
export function tenantFixture(): FinanceRawData {
  const raw = emptyRaw();
  raw.customers = [
    { id: 'c1', name: 'Ada Okafor' },
    { id: 'c2', name: 'Ben Marsh' },
    { id: 'c3', name: 'Cleo Ng' },
    { id: 'c4', name: 'Dev Patel' },
  ];
  raw.vehicles = [{ id: 'v1', reg: 'AB12 CDE' }];
  raw.rentals = [
    rental('r1', 'c1', { vehicle_id: 'v1' }),
    rental('r2', 'c2', { is_pay_as_you_go: true }),
    rental('r3', 'c3', { status: 'Cancelled' }),
    rental('r4', 'c4'),
  ];
  raw.charges = [
    charge('k1', 'r1', 'c1', 'Rental', 300.0, 300.0, '2026-09-10'), // overdue
    charge('k2', 'r1', 'c1', 'Tax', 30.0, 30.0, '2026-09-10'), // overdue
    charge('k3', 'r1', 'c1', 'Rental', 300.0, 300.0, '2026-10-10'), // not yet due
    charge('k4', 'r2', 'c2', 'Rental', 111.0, 111.0, '2026-09-24'), // PAYG: accruals instead
    charge('k5', 'r3', 'c3', 'Rental', 500.0, 500.0, '2026-09-01'), // cancelled
    charge('k6', 'r4', 'c4', 'Fine', 65.0, 65.0, '2026-09-30'), // counts, not overdue
    charge('k7', 'r4', 'c4', 'Adjustment', -10.0, -10.0, null), // counts
    charge('k8', null, 'c1', 'Fine', 40.0, 40.0, '2026-09-01'), // no rental, overdue
  ];
  raw.accruals = [accrual('r2', 'c2', 100.0, 8.25, 2.75)];
  raw.payments = [
    payment('p1', 'c1', 'r1', 200.0, { payment_date: '2026-09-20', stripe_payment_intent_id: 'pi_777' }),
    payment('p2', 'c1', 'r1', 100.0, { payment_date: '2026-09-21', status: 'Partial Refund', refund_amount: 40.0 }),
    payment('p3', 'c2', 'r2', 50.0, { payment_date: '2026-09-22', status: 'Pending', capture_status: 'requires_capture' }),
    payment('p4', 'c4', 'r4', 75.0, { payment_date: '2026-09-23', payment_type: 'InitialFee' }),
    payment('p5', 'c1', 'r1', 80.0, { payment_date: '2026-08-31' }),
    payment('p6', 'c4', 'r4', 25.0, { payment_date: '2026-09-24', status: 'Refunded', refund_amount: 25.0 }),
    payment('p7', 'c2', 'r2', 60.0, { payment_date: '2026-09-25', status: 'Credit', remaining_amount: 60.0, square_payment_id: 'sqp_42', method: 'Card' }),
    payment('p8', 'c1', null, 10.0, { payment_date: '2026-09-01', status: 'Completed', capture_status: null, method: 'Cash' }),
  ];
  raw.plans = [plan('pl1', 'r1', 'c1'), plan('pl2', 'r4', 'c4', { status: 'paused' })];
  raw.occurrences = [
    occurrence('o1', 'pl1', 'r1', 1, '2026-09-20', 100.0, 100.0, 'paid'),
    occurrence('o2', 'pl1', 'r1', 2, '2026-09-25', 100.0, 0, 'due'),
    occurrence('o3', 'pl1', 'r1', 3, '2026-09-28', 100.0, 0, 'scheduled', { collection_method: 'checkout_link' }),
    occurrence('o4', 'pl1', 'r1', 4, '2026-10-01', 100.0, 40.0, 'partially_paid', { collection_method: 'manual' }),
    occurrence('o5', 'pl1', 'r1', 5, '2026-10-02', 100.0, 0, 'scheduled'),
    occurrence('o6', 'pl1', 'r1', 6, '2026-09-18', 100.0, 0, 'failed', { next_attempt_at: '2026-09-27T14:00:00Z' }),
    occurrence('o7', 'pl1', 'r1', 7, '2026-09-19', 100.0, 0, 'failed'),
    occurrence('o8', 'pl1', 'r1', 8, '2026-09-26', 100.0, 0, 'requires_action'),
    occurrence('o9', 'pl1', 'r1', 9, '2026-09-26', 100.0, 0, 'processing'),
    occurrence('o10', 'pl2', 'r4', 1, '2026-09-26', 100.0, 0, 'scheduled'),
  ];
  return raw;
}
