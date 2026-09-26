/**
 * Finances UI fixtures — rows shaped exactly like the model's (lib/finances/types),
 * with the figures from the design's own worked example (FINANCES_DESIGN §3.1),
 * derived by hand:
 *
 *   R1 · Booking      Rental 500.00 (paid) + Tax 50.00 (30.00 paid) + Adjustment −20.00
 *                     → Total 550.00 · Paid 530.00 · Credited 20.00 · Balance 0.00
 *   R1 · Extension #1 200.00, nothing paid, past due → Balance 200.00, overdue
 *   R2 · Booking      100.00 charged, remaining 0, no applications
 *                     → doesn't add up by 100.00
 */
import type { BillRow, ReceiptRow, UpcomingRow } from '@/lib/finances/types';

export function bill(over: Partial<BillRow> & { key: string }): BillRow {
  return {
    rentalId: 'r1',
    rentalRef: 'R-1001',
    extensionId: null,
    label: 'Booking',
    customerId: 'c1',
    customerName: 'Ghulam Ilyas',
    vehicleReg: 'NW-01',
    invoiceNumber: null,
    issuedOn: '2026-09-01',
    dueOn: '2026-09-01',
    totalCents: 0,
    paidCents: 0,
    creditedCents: 0,
    balanceCents: 0,
    tiesOut: true,
    mismatchCents: 0,
    status: 'paid',
    overdueDays: null,
    lines: [],
    outstandingCents: 0,
    overdueCents: 0,
    paygOpenCents: 0,
    isPayg: false,
    excludedReason: null,
    onRental: true,
    ...over,
  };
}

/** Design §3.1, R1 · Booking: 500 + 50 − 20. */
export const R1_BOOKING = bill({
  key: 'r1:booking',
  totalCents: 55000,
  paidCents: 53000,
  creditedCents: 2000,
  balanceCents: 0,
  status: 'paid',
  outstandingCents: 0,
  overdueCents: 0,
  invoiceNumber: 'INV-1001',
  lines: [
    { chargeId: 'ch-rent', category: 'Rental', amountCents: 50000, remainingCents: 0, appliedCents: 50000, dueDate: '2026-09-01', entryDate: '2026-09-01', applications: [{ paymentId: 'p1', amountCents: 50000 }], countsTowardOutstanding: true },
    { chargeId: 'ch-tax', category: 'Tax', amountCents: 5000, remainingCents: 2000, appliedCents: 3000, dueDate: '2026-09-01', entryDate: '2026-09-01', applications: [{ paymentId: 'p1', amountCents: 3000 }], countsTowardOutstanding: true },
    { chargeId: 'ch-adj', category: 'Adjustment', amountCents: -2000, remainingCents: -2000, appliedCents: 0, dueDate: '2026-09-01', entryDate: '2026-09-02', applications: [], countsTowardOutstanding: true },
  ],
});

/** Design §3.1, R1 · Extension #1: 200.00, nothing paid, past due. */
export const R1_EXTENSION = bill({
  key: 'r1:ext:e1',
  extensionId: 'e1',
  label: 'Extension #1',
  totalCents: 20000,
  paidCents: 0,
  creditedCents: 0,
  balanceCents: 20000,
  status: 'overdue',
  overdueDays: 12,
  outstandingCents: 20000,
  overdueCents: 20000,
  lines: [
    { chargeId: 'ch-ext', category: 'Extension Rental', amountCents: 20000, remainingCents: 20000, appliedCents: 0, dueDate: '2026-09-10', entryDate: '2026-09-10', applications: [], countsTowardOutstanding: true },
  ],
});

/** Design §3.1 drift case: 100.00 charged, remaining 0, no applications. */
export const DRIFT = bill({
  key: 'r2:booking',
  rentalId: 'r2',
  rentalRef: 'R-1002',
  customerId: 'c2',
  customerName: 'Kristen Moss',
  totalCents: 10000,
  paidCents: 0,
  creditedCents: 0,
  balanceCents: 0,
  tiesOut: false,
  mismatchCents: 10000,
  status: 'paid',
});

export function receipt(over: Partial<ReceiptRow> & { paymentId: string }): ReceiptRow {
  return {
    date: '2026-09-20',
    customerId: 'c1',
    customerName: 'Ghulam Ilyas',
    rentalId: 'r1',
    rentalRef: 'R-1001',
    vehicleReg: 'NW-01',
    amountCents: 53000,
    refundedCents: 0,
    unappliedCents: 0,
    method: 'Card',
    provider: 'stripe',
    providerRef: 'pi_3PabcDEF123',
    providerMode: 'live',
    status: 'approved',
    appliedTo: [
      { chargeId: 'ch-rent', category: 'Rental', rentalRef: 'R-1001', amountCents: 50000 },
      { chargeId: 'ch-tax', category: 'Tax', rentalRef: 'R-1001', amountCents: 3000 },
    ],
    planLabel: null,
    occurrenceId: null,
    rawStatus: 'Applied',
    paymentType: 'Payment',
    countsAsReceived: true,
    netCents: 53000,
    references: ['pi_3PabcDEF123'],
    providerAccount: null,
    checkoutSessionId: null,
    verificationStatus: 'auto_approved',
    recordedById: null,
    recordedAt: '2026-09-20T15:04:00Z',
    extensionId: null,
    ...over,
  };
}

export const upcoming = (over: Partial<UpcomingRow> & { occurrenceId: string }): UpcomingRow => ({
  planId: 'plan-1',
  rentalId: 'r1',
  rentalRef: 'R-1001',
  customerId: 'c1',
  customerName: 'Ghulam Ilyas',
  dueDate: '2026-09-28',
  seqLabel: 'Payment 2 of 5',
  amountCents: 20000,
  method: 'auto_charge',
  status: 'scheduled',
  effectiveOn: '2026-09-28',
  nextAttemptOn: null,
  planStatus: 'active',
  ...over,
});

