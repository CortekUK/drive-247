/**
 * Finances polish — the model side (reviewer defects D2, D4; roadmap A1).
 *
 *  D2  EVERY invoice is reachable. The lookups used to keep only the EARLIEST
 *      `invoices` row per rental and drop rows with no rental, so a rental's
 *      2nd+ invoice, an invoice on no rental, and an invoice whose rental has
 *      no charges had no Send / Delete anywhere. Now every bill of a rental
 *      lists all of its invoices (newest first — the payment window's
 *      `latestInvoice`), and an invoice that belongs to no bill is an
 *      "Invoice only" row: status Draft, its own total, no ledger math.
 *  D4  An "Auto-approved" Received filter the old Payments tab had, told apart
 *      from "Received" (which is unchanged).
 *  A1  An off-platform payment counts as money received, and is never matched
 *      to a processor.
 *
 * Every figure below is a literal worked out by hand from the rows above it.
 */
import { describe, expect, it } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { billStatusText, INVOICE_ONLY_LABEL, invoiceOnlyKey } from '@/lib/finances/bills';
import { AUTO_APPROVED_STATUS, BILL_STATUSES, narrowBills, narrowReceipts, selectFinances } from '@/lib/finances/filters';
import { buildLookups, newestInvoiceFirst } from '@/lib/finances/lookups';
import { financesRedirectFor } from '@/lib/finances-nav';
import type { RawInvoice } from '@/lib/finances/types';
import { accrual, charge, CTX, emptyRaw, payment, rental } from '../helpers/finances-fixture';

const inv = (id: string, rental_id: string | null, invoice_number: string, created_at: string, total_amount: number, extra: Partial<RawInvoice> = {}): RawInvoice => ({
  id,
  rental_id,
  invoice_number,
  created_at,
  customer_id: 'c1',
  vehicle_id: null,
  invoice_date: created_at.slice(0, 10),
  total_amount,
  status: 'pending',
  ...extra,
});

function invoicesFixture() {
  const raw = emptyRaw();
  raw.customers = [
    { id: 'c1', name: 'Ada Okafor' },
    { id: 'c2', name: 'Ben Marsh' },
  ];
  raw.vehicles = [{ id: 'v2', reg: 'NW-02' }];
  raw.rentals = [
    rental('r1', 'c1'),
    // r2 has an invoice and NO charge rows at all.
    rental('r2', 'c2', { vehicle_id: 'v2' }),
    // r3 is billed only through an open accrual: it still has a bill.
    rental('r3', 'c1', { is_pay_as_you_go: true }),
  ];
  raw.extensions = [{ id: 'e1', rental_id: 'r1', sequence_number: 1, status: 'paid' }];
  raw.charges = [
    charge('k1', 'r1', 'c1', 'Rental', 100.0, 100.0, '2026-09-30'),
    charge('k2', 'r1', 'c1', 'Extension Rental', 40.0, 40.0, '2026-09-30', { extension_id: 'e1' }),
  ];
  raw.accruals = [accrual('r3', 'c1', 10.0, 1.0, 0)];
  raw.invoices = [
    // r1: two invoices, the SECOND written later — it is the newest.
    inv('i-old', 'r1', 'INV-0001', '2026-09-01T10:00:00Z', 100.0),
    inv('i-new', 'r1', 'INV-0002', '2026-09-05T10:00:00Z', 140.0),
    // r2: an invoice whose rental has no charges.
    inv('i-r2', 'r2', 'INV-0003', '2026-09-03T10:00:00Z', 75.5, { customer_id: 'c2', status: 'paid' }),
    // No rental at all (the column is NOT NULL today; the reader must not depend on it).
    inv('i-none', null, 'INV-0004', '2026-09-04T10:00:00Z', 20.0),
    // r3 is billed by its accrual: its invoice hangs on that bill.
    inv('i-r3', 'r3', 'INV-0005', '2026-09-02T10:00:00Z', 11.0),
  ];
  return raw;
}

describe('D2 — every invoice is reachable', () => {
  const model = buildFinanceModel(invoicesFixture(), CTX);
  const byKey = (k: string) => model.bills.find((b) => b.key === k)!;

  it('keeps every invoices row in the lookups, newest first (the payment window’s latestInvoice order)', () => {
    const lk = buildLookups(invoicesFixture());
    expect(lk.invoicesByRental.get('r1')!.map((i) => i.id)).toEqual(['i-new', 'i-old']);
    expect(lk.invoiceByRental.get('r1')!.id).toBe('i-new');
    expect(lk.invoicesWithoutRental.map((i) => i.id)).toEqual(['i-none']);
    // A tie on created_at falls to the invoice date, then the id: a stable order.
    const a = inv('a', 'r', 'A', '2026-09-01T00:00:00Z', 1, { invoice_date: '2026-09-02' });
    const b = inv('b', 'r', 'B', '2026-09-01T00:00:00Z', 1, { invoice_date: '2026-09-01' });
    expect([b, a].sort(newestInvoiceFirst).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('the booking bill names the NEWEST invoice, and lists both', () => {
    const booking = byKey('r1:booking');
    expect([booking.invoiceNumber, booking.invoiceId]).toEqual(['INV-0002', 'i-new']);
    expect(booking.invoices!.map((i) => [i.id, i.number, i.totalCents, i.date])).toEqual([
      ['i-new', 'INV-0002', 14000, '2026-09-05'],
      ['i-old', 'INV-0001', 10000, '2026-09-01'],
    ]);
  });

  it('an extension bill lists the rental’s invoices too, but names none of its own', () => {
    const ext = byKey('r1:ext:e1');
    expect([ext.invoiceNumber, ext.invoiceId]).toEqual([null, null]);
    expect(ext.invoices!.map((i) => i.id)).toEqual(['i-new', 'i-old']);
  });

  it('a rental billed only by an accrual keeps its invoice on that bill — no invoice-only row', () => {
    expect(byKey('r3:booking').invoices!.map((i) => i.id)).toEqual(['i-r3']);
    expect(model.bills.find((b) => b.key === invoiceOnlyKey('i-r3'))).toBeUndefined();
  });

  it('an invoice whose rental has no charges is an "Invoice only" row: Draft, its own total, no math', () => {
    const row = byKey(invoiceOnlyKey('i-r2'));
    expect(row).toMatchObject({
      label: INVOICE_ONLY_LABEL,
      invoiceOnly: true,
      status: 'draft',
      rentalId: 'r2',
      rentalRef: 'R2',
      onRental: true,
      customerId: 'c2',
      customerName: 'Ben Marsh',
      vehicleReg: 'NW-02',
      invoiceNumber: 'INV-0003',
      invoiceId: 'i-r2',
      invoiceTotalCents: 7550,
      issuedOn: '2026-09-03',
      // It claims nothing the ledger does not say.
      totalCents: 0,
      paidCents: 0,
      creditedCents: 0,
      balanceCents: 0,
      outstandingCents: 0,
      overdueCents: 0,
      tiesOut: true,
      mismatchCents: 0,
      lines: [],
    });
    expect(row.invoices!.map((i) => [i.id, i.status])).toEqual([['i-r2', 'paid']]);
    expect(billStatusText(row)).toBe('Draft');
  });

  it('an invoice on no rental is an "Invoice only" row off any rental', () => {
    const row = byKey(invoiceOnlyKey('i-none'));
    expect([row.onRental, row.rentalId, row.rentalRef, row.customerName, row.invoiceTotalCents]).toEqual([false, '', '—', 'Ada Okafor', 2000]);
  });

  it('exactly two invoice-only rows, and nothing else changed: 7 invoices → 5 on bills, 2 alone', () => {
    expect(model.bills.filter((b) => b.invoiceOnly).map((b) => b.key).sort()).toEqual(['invoice:i-none', 'invoice:i-r2']);
    const reachable = new Set(model.bills.flatMap((b) => (b.invoices ?? []).map((i) => i.id)));
    expect([...reachable].sort()).toEqual(['i-new', 'i-none', 'i-old', 'i-r2', 'i-r3']);
  });

  it('invoice-only rows add nothing to any figure: Outstanding is the ledger’s 40.00 + the accrual 11.00', () => {
    const sel = selectFinances(model, { period: 'all' }, CTX.today);
    // k1 (a Rental charge due 30 Sep, after today) does not count yet; k2 (an
    // Extension Rental) does: 4000. r3's accrual: 10.00 + 1.00 = 1100. 5100.
    expect(sel.stats.outstandingCents).toBe(5100);
    expect(sel.stats.overdueCents).toBe(0);
    const outstandingRows = selectFinances(model, { period: 'all', card: 'outstanding' }, CTX.today).bills;
    expect(outstandingRows.some((b) => b.invoiceOnly)).toBe(false);
  });

  it('"draft" is a bill status the filter knows, and it keeps just the invoice-only rows', () => {
    expect(BILL_STATUSES).toContain('draft');
    expect(narrowBills(model.bills, { period: 'all', statuses: ['draft'] }).map((b) => b.key).sort()).toEqual(['invoice:i-none', 'invoice:i-r2']);
    expect(narrowBills(model.bills, { period: 'all', statuses: ['open'] }).some((b) => b.invoiceOnly)).toBe(false);
  });

  it('search finds a bill by its OLDER invoice’s number too', () => {
    expect(narrowBills(model.bills, { period: 'all', search: 'inv-0001' }).map((b) => b.key).sort()).toEqual(['r1:booking', 'r1:ext:e1']);
  });
});

describe('D4 — Auto-approved, told apart from Received', () => {
  const raw = emptyRaw();
  raw.customers = [{ id: 'c1', name: 'Ada Okafor' }];
  raw.rentals = [rental('r1', 'c1')];
  raw.payments = [
    payment('p-auto', 'c1', 'r1', 50.0, { verification_status: 'auto_approved', stripe_payment_intent_id: 'pi_1' }),
    payment('p-hand', 'c1', 'r1', 20.0, { verification_status: 'approved' }),
    // Auto-approved and refunded in full: still auto-approved, whatever became of the money.
    payment('p-auto-refunded', 'c1', 'r1', 30.0, { verification_status: 'auto_approved', refund_amount: 30.0, stripe_payment_intent_id: 'pi_2' }),
  ];
  const model = buildFinanceModel(raw, CTX);

  it('keeps exactly the rows the old option selected (verification_status = auto_approved), in any money status', () => {
    const ids = narrowReceipts(model.receipts, { period: 'all', statuses: [AUTO_APPROVED_STATUS] }).map((r) => r.paymentId).sort();
    expect(ids).toEqual(['p-auto', 'p-auto-refunded']);
  });

  it('"Received" (approved) is unchanged: money landed, however it was checked', () => {
    const ids = narrowReceipts(model.receipts, { period: 'all', statuses: ['approved'] }).map((r) => r.paymentId).sort();
    expect(ids).toEqual(['p-auto', 'p-hand']);
  });

  it('an old Payments link to the option keeps its meaning', () => {
    expect(financesRedirectFor('/payments', 'status=auto_approved')).toBe('/finances?view=received&status=auto_approved');
    expect(financesRedirectFor('/payments', 'verificationStatus=approved')).toBe('/finances?view=received&status=approved');
  });
});

describe('A1 — an off-platform payment', () => {
  const raw = emptyRaw();
  raw.customers = [{ id: 'c1', name: 'Ada Okafor' }];
  raw.rentals = [rental('r1', 'c1')];
  raw.payments = [
    // Even if a processor id were somehow on the row, it is not matched to one.
    payment('p-off', 'c1', 'r1', 300.0, { method: 'Cash', is_off_platform: true, stripe_checkout_session_id: 'cs_live_x', payment_provider: 'stripe' }),
    payment('p-card', 'c1', 'r1', 100.0, { stripe_payment_intent_id: 'pi_live_1' }),
  ];
  raw.offPlatformAvailable = true;
  const model = buildFinanceModel(raw, CTX);
  const off = model.receipts.find((r) => r.paymentId === 'p-off')!;
  const card = model.receipts.find((r) => r.paymentId === 'p-card')!;

  it('is marked, and matched to no processor: no reference, no mode, no account', () => {
    expect([off.isOffPlatform, off.provider, off.providerRef, off.providerMode, off.providerAccount]).toEqual([true, 'manual', null, null, null]);
    expect([card.isOffPlatform, card.provider, card.providerRef]).toEqual([false, 'stripe', 'pi_live_1']);
  });

  it('counts as money received, like cash: Collected is 300.00 + 100.00', () => {
    expect(off.countsAsReceived).toBe(true);
    const sel = selectFinances(model, { period: 'all' }, CTX.today);
    expect(sel.stats.collectedCents).toBe(40000);
    expect(sel.stats.collectedCount).toBe(2);
  });
});
