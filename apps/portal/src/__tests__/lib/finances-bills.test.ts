/**
 * The Billed view. The §3.1 fixture (docs/FINANCES_DESIGN.md) is written here
 * as LITERALS, hand-derived — the test disagrees with the code rather than
 * echoing it:
 *
 *   R1 (dues in the past): Rental 500.00 (rem 0, applied 500.00) · Tax 50.00
 *   (rem 20.00, applied 30.00) · Adjustment −20.00 (rem −20.00).
 *   Extension E1 on R1: Extension Rental 200.00 (rem 200.00, applied 0).
 *
 *   R1 · Booking      Total 55000  Paid 53000  Credited 2000  Balance 0      ties out
 *   R1 · Extension #1 Total 20000  Paid 0      Credited 0     Balance 20000  ties out
 *   Outstanding for R1's customer = 0 + 2000 − 2000 + 20000 = 20000.
 *
 *   Drift: one charge 100.00, remaining 0, no applications →
 *   Total 10000, Paid 0, Credited 0, Balance 0 → doesn't add up by 10000.
 */
import { describe, expect, it } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { billMathText, billStatusText, tieOutText } from '@/lib/finances/bills';
import { tenantToday } from '@/lib/finances/period';
import { accrual, application, charge, CTX, emptyRaw, payment, rental } from '../helpers/finances-fixture';

function fixture31() {
  const raw = emptyRaw();
  raw.rentals = [rental('r1', 'c1')];
  raw.customers = [{ id: 'c1', name: 'Ada Okafor' }];
  raw.extensions = [{ id: 'e1', rental_id: 'r1', sequence_number: 1, status: 'paid' }];
  raw.charges = [
    charge('ch-rent', 'r1', 'c1', 'Rental', 500.0, 0, '2026-09-01'),
    charge('ch-tax', 'r1', 'c1', 'Tax', 50.0, 20.0, '2026-09-01'),
    charge('ch-adj', 'r1', 'c1', 'Adjustment', -20.0, -20.0, '2026-09-10'),
    charge('ch-ext', 'r1', 'c1', 'Extension Rental', 200.0, 200.0, '2026-09-15', { extension_id: 'e1' }),
  ];
  raw.payments = [payment('p1', 'c1', 'r1', 530.0)];
  raw.applications = [application('p1', 'ch-rent', 500.0), application('p1', 'ch-tax', 30.0)];
  return raw;
}

describe('§3.1 — the bill math, by hand', () => {
  const model = buildFinanceModel(fixture31(), CTX);
  const booking = model.bills.find((b) => b.key === 'r1:booking')!;
  const ext = model.bills.find((b) => b.key === 'r1:ext:e1')!;

  it('R1 · Booking: 55000 / 53000 / 2000 / 0, ties out', () => {
    expect(booking.label).toBe('Booking');
    expect(booking.rentalRef).toBe('R1');
    expect([booking.totalCents, booking.paidCents, booking.creditedCents, booking.balanceCents]).toEqual([55000, 53000, 2000, 0]);
    expect(booking.tiesOut).toBe(true);
    expect(booking.mismatchCents).toBe(0);
    expect(booking.status).toBe('paid');
    expect(billStatusText(booking)).toBe('Paid');
  });

  it('R1 · Extension #1: 20000 / 0 / 0 / 20000, ties out', () => {
    expect(ext.label).toBe('Extension #1');
    expect(ext.extensionId).toBe('e1');
    expect([ext.totalCents, ext.paidCents, ext.creditedCents, ext.balanceCents]).toEqual([20000, 0, 0, 20000]);
    expect(ext.tiesOut).toBe(true);
  });

  it("R1's customer owes 20000 (0 + 2000 − 2000 + 20000)", () => {
    const owed = model.bills.filter((b) => b.customerId === 'c1').reduce((s, b) => s + b.outstandingCents, 0);
    expect(owed).toBe(20000);
    expect(booking.outstandingCents).toBe(0);
    expect(ext.outstandingCents).toBe(20000);
  });

  it('the extension is 10 days overdue on 2026-09-25 (due 2026-09-15)', () => {
    expect(ext.status).toBe('overdue');
    expect(ext.overdueDays).toBe(10);
    expect(ext.overdueCents).toBe(20000);
    expect(billStatusText(ext)).toBe('10 days overdue');
  });

  it('every line carries its own allocations', () => {
    const tax = booking.lines.find((l) => l.chargeId === 'ch-tax')!;
    expect(tax).toMatchObject({ category: 'Tax', amountCents: 5000, remainingCents: 2000, appliedCents: 3000, dueDate: '2026-09-01' });
    expect(tax.applications).toEqual([{ paymentId: 'p1', amountCents: 3000 }]);
  });

  it('writes the math out', () => {
    expect(billMathText(booking)).toBe('Total $550.00 − Paid $530.00 − Credited $20.00 = Balance $0.00');
  });
});

describe('tie-out', () => {
  it("a zeroed charge with no allocation doesn't add up by 10000", () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r2', 'c2')];
    raw.charges = [charge('ch-drift', 'r2', 'c2', 'Rental', 100.0, 0, '2026-09-01')];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect([bill.totalCents, bill.paidCents, bill.creditedCents, bill.balanceCents]).toEqual([10000, 0, 0, 0]);
    expect(bill.tiesOut).toBe(false);
    expect(bill.mismatchCents).toBe(10000);
    expect(tieOutText(bill)).toBe("Doesn't add up by $100.00");
    expect(billMathText(bill)).toBe("Total $100.00 − Paid $0.00 − Credited $0.00 = $100.00, but the ledger's balance is $0.00");
  });

  it('drift the other way — allocations exceeding the charge (Goniko: 866.95 applied to 525.00)', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r3', 'c3')];
    raw.charges = [charge('ch-over', 'r3', 'c3', 'Extension Rental', 525.0, 0, '2026-09-01')];
    raw.applications = [application('p9', 'ch-over', 866.95)];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    // 52500 − 86695 − 0 − 0 = −34195
    expect(bill.mismatchCents).toBe(-34195);
    expect(bill.tiesOut).toBe(false);
    expect(tieOutText(bill)).toBe("Doesn't add up by $341.95");
  });

  it('a tied-out bill has no tie-out text', () => {
    const [bill] = buildFinanceModel(fixture31(), CTX).bills.filter((b) => b.key === 'r1:booking');
    expect(tieOutText(bill)).toBeNull();
  });

  it('says what happened, instead of "doesn\'t add up", when a rejected or cancelled booking had its charges cleared', () => {
    // reject_payment zeroes the charges with no allocation: $300 charged, none paid, none credited, $0 left.
    expect(tieOutText({ tiesOut: false, mismatchCents: 30000, excludedReason: 'rejected' })).toBe('Booking rejected — $300.00 cleared without a payment');
    expect(tieOutText({ tiesOut: false, mismatchCents: 30000, excludedReason: 'cancelled' })).toBe('Booking cancelled — $300.00 cleared without a payment');
    // Any other gap on such a booking is still drift, and an ordinary booking is always drift.
    expect(tieOutText({ tiesOut: false, mismatchCents: -5000, excludedReason: 'rejected' })).toBe("Doesn't add up by $50.00");
    expect(tieOutText({ tiesOut: false, mismatchCents: 30000, excludedReason: null })).toBe("Doesn't add up by $300.00");
  });
});

describe('what counts toward Outstanding (the useCustomerBalance rule)', () => {
  it('a Rental charge due after today is billed but not outstanding; other categories count whatever their date', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r4', 'c4')];
    raw.charges = [
      charge('a', 'r4', 'c4', 'Rental', 300.0, 300.0, '2026-09-26'),
      charge('b', 'r4', 'c4', 'Fine', 40.0, 40.0, '2026-12-01'),
      charge('c', 'r4', 'c4', 'Security Deposit', 250.0, 250.0, '2026-09-20'),
    ];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect(bill.balanceCents).toBe(59000); // 30000 + 4000 + 25000
    expect(bill.outstandingCents).toBe(29000); // 4000 + 25000; the Rental waits for the 26th
    expect(bill.overdueCents).toBe(25000); // only the deposit's due date (20th) is before today
    expect(bill.lines.find((l) => l.chargeId === 'a')!.countsTowardOutstanding).toBe(false);
  });

  it('a cancelled or rejected rental is billed but never outstanding', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r5', 'c5', { status: 'Cancelled' }), rental('r6', 'c5', { approval_status: 'rejected' })];
    raw.charges = [charge('x', 'r5', 'c5', 'Rental', 100.0, 100.0, '2026-09-01'), charge('y', 'r6', 'c5', 'Tax', 10.0, 10.0, '2026-09-01')];
    const bills = buildFinanceModel(raw, CTX).bills;
    expect(bills.map((b) => [b.rentalId, b.excludedReason, b.balanceCents, b.outstandingCents, b.overdueCents]).sort()).toEqual([
      ['r5', 'cancelled', 10000, 0, 0],
      ['r6', 'rejected', 1000, 0, 0],
    ]);
  });

  it('a PAYG rental owes its open accruals, not its ledger rows (no double count)', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r7', 'c7', { is_pay_as_you_go: true })];
    // Both describe the same unpaid day.
    raw.charges = [charge('d8', 'r7', 'c7', 'Rental', 111.0, 111.0, '2026-09-24')];
    raw.accruals = [accrual('r7', 'c7', 100.0, 8.25, 2.75)];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect(bill.isPayg).toBe(true);
    expect(bill.balanceCents).toBe(11100);
    expect(bill.paygOpenCents).toBe(11100); // 10000 + 825 + 275
    expect(bill.outstandingCents).toBe(11100); // accruals only — not 22200
    expect(bill.overdueCents).toBe(0); // accruals carry no due date
    expect(bill.status).toBe('open');
  });

  it('a PAYG rental with open accruals and no ledger rows still gets a bill', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r8', 'c8', { is_pay_as_you_go: true, start_date: '2026-09-20' })];
    raw.accruals = [accrual('r8', 'c8', 50.0, 0, 0), accrual('r8', 'c8', 50.0, 4.0, 0)];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect(bill.lines).toEqual([]);
    expect(bill.outstandingCents).toBe(10400);
    expect(bill.issuedOn).toBe('2026-09-20');
  });

  it("a charge on no rental is billed on the customer's \"Not on a rental\" bill and counts", () => {
    const raw = emptyRaw();
    raw.customers = [{ id: 'c9', name: 'Cleo Ng' }];
    raw.charges = [charge('f1', null, 'c9', 'Fine', 65.0, 65.0, '2026-09-05', { reference: 'FINE-1' })];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect(bill).toMatchObject({ onRental: false, rentalId: '', label: 'Not on a rental', customerId: 'c9', customerName: 'Cleo Ng' });
    expect(bill.outstandingCents).toBe(6500);
    expect(bill.overdueCents).toBe(6500);
    expect(bill.overdueDays).toBe(20);
  });

  it("uses the category exactly: a ledger fine is 'Fine' (singular)", () => {
    const raw = emptyRaw();
    raw.charges = [charge('f2', null, 'c10', 'Fine', 30.0, 30.0, '2026-09-01')];
    expect(buildFinanceModel(raw, CTX).bills[0].lines[0].category).toBe('Fine');
  });
});

describe('status in words', () => {
  it('open, in credit', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('ra', 'ca'), rental('rb', 'cb')];
    raw.charges = [
      charge('o1', 'ra', 'ca', 'Rental', 100.0, 100.0, '2026-09-30'),
      charge('o2', 'rb', 'cb', 'Adjustment', -15.0, -15.0, null),
    ];
    const bills = buildFinanceModel(raw, CTX).bills;
    const a = bills.find((b) => b.rentalId === 'ra')!;
    const b = bills.find((x) => x.rentalId === 'rb')!;
    expect([a.status, billStatusText(a)]).toEqual(['open', 'Open']);
    expect([b.status, billStatusText(b)]).toEqual(['credit', 'In credit $15.00']);
  });

  it("overdue days are counted in the TENANT's calendar, not UTC", () => {
    // 02:00 UTC on the 26th is still 22:00 on the 25th in New York.
    const instant = new Date('2026-09-26T02:00:00Z');
    const ny = tenantToday('America/New_York', instant);
    const utc = tenantToday('UTC', instant);
    expect([ny, utc]).toEqual(['2026-09-25', '2026-09-26']);

    const raw = emptyRaw();
    raw.rentals = [rental('rt', 'ct')];
    raw.charges = [
      charge('t1', 'rt', 'ct', 'Tax', 10.0, 10.0, '2026-09-15'),
      // Due on the 26th: not yet due in New York, due in UTC.
      charge('t2', 'rt', 'ct', 'Rental', 90.0, 90.0, '2026-09-26'),
    ];
    const inNy = buildFinanceModel(raw, { ...CTX, today: ny }).bills[0];
    const inUtc = buildFinanceModel(raw, { ...CTX, today: utc, timeZone: 'UTC' }).bills[0];
    expect([inNy.overdueDays, inNy.outstandingCents]).toEqual([10, 1000]);
    expect([inUtc.overdueDays, inUtc.outstandingCents]).toEqual([11, 10000]);
  });

  it('a charge due today is open, not overdue', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('rd', 'cd')];
    raw.charges = [charge('d1', 'rd', 'cd', 'Tax', 10.0, 10.0, '2026-09-25')];
    const [bill] = buildFinanceModel(raw, CTX).bills;
    expect([bill.status, bill.overdueCents, bill.overdueDays, bill.outstandingCents]).toEqual(['open', 0, null, 1000]);
  });

  it('shows the invoice number on the booking bill when an invoices row exists', () => {
    const raw = fixture31();
    raw.invoices = [{ id: 'i1', rental_id: 'r1', invoice_number: 'INV-0042', created_at: '2026-09-01T00:00:00Z' }];
    const bills = buildFinanceModel(raw, CTX).bills;
    expect(bills.find((b) => b.key === 'r1:booking')!.invoiceNumber).toBe('INV-0042');
    expect(bills.find((b) => b.key === 'r1:ext:e1')!.invoiceNumber).toBeNull();
  });
});
