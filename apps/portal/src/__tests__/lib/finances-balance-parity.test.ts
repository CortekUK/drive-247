/**
 * Behaviour-preserving refactor: hooks/use-customer-balance.ts now calls
 * lib/finances/balance.ts instead of its inline loops. This suite runs the
 * ORIGINAL inline code — copied VERBATIM below from
 * `git show HEAD:apps/portal/src/hooks/use-customer-balance.ts` (bf9e4a1e) —
 * and the extracted functions over the same fixtures, and requires the results
 * to be identical (`Object.is`, so even float drift is a failure).
 *
 * Fixtures cover the cases that have gone wrong before: cancelled and rejected
 * rentals, PAYG rentals, future-due / due-today / past-due Rental charges, a
 * Rental charge with no due date, negative Adjustments, the Security Deposit
 * charge, fines on no rental, null remaining amounts, uncaptured holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocalDate } from '@/lib/date-utils';
import {
  CAPTURED_CREDIT_STATUSES,
  sumAvailableCredit,
  sumLedgerBalance,
  sumPaygAccruals,
  summarizeCustomerLedger,
} from '@/lib/finances/balance';

/* ══════════════ ORIGINAL CODE — verbatim from HEAD, do not edit ══════════════ */

// use-customer-balance.ts:34-39 (fetchPaygOutstandingForCustomer, after the read)
function originalPaygTotal(data: any, excludedRentalIds: Set<string>) {
  let total = 0;
  (data as any[])?.forEach(a => {
    if (a.rental_id && excludedRentalIds.has(a.rental_id)) return;
    total += Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0);
  });
  return total;
}

// use-customer-balance.ts:104-113 (useCustomerBalance)
function originalLedgerBalance(data: any[], excludedRentalIds: Set<string>, paygRentalIds: Set<string>) {
      const ledgerBalance = data.reduce((sum, entry) => {
        if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return sum;
        if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return sum;
        // For rental charges, only include if currently due (due_date <= today)
        if (entry.category === 'Rental' && entry.due_date && parseLocalDate(entry.due_date) > new Date()) {
          return sum;
        }
        // Include all other charges (fines, etc.) regardless of due date
        return sum + (entry.remaining_amount || 0);
      }, 0);
      return ledgerBalance;
}

// use-customer-balance.ts:169-220 (useCustomerBalanceWithStatus)
function originalWithStatus(ledgerData: any[], paymentsData: any[], excludedRentalIds: Set<string>, paygRentalIds: Set<string>) {
      // Calculate totals, excluding charges from cancelled/rejected rentals
      let totalCharges = 0;
      let totalPayments = 0;
      let outstandingDebt = 0; // Sum of remaining_amount on due charges
      let availableCredit = 0; // Sum of unapplied payment amounts

      ledgerData.forEach(entry => {
        if (entry.type === 'Charge') {
          // Skip charges from cancelled/rejected rentals
          if (entry.rental_id && excludedRentalIds.has(entry.rental_id)) return;

          totalCharges += entry.amount;

          // Skip ledger contribution from PAYG rentals — payg_accruals is the
          // authoritative source for those and gets added separately below.
          // Including both sums the same open day twice.
          if (entry.rental_id && paygRentalIds.has(entry.rental_id)) return;

          // For rental charges, only include remaining if currently due
          if (entry.category === 'Rental' && entry.due_date && parseLocalDate(entry.due_date) > new Date()) {
            // Future charge - don't add to outstanding
            return;
          }
          // Add remaining amount to outstanding debt
          outstandingDebt += (entry.remaining_amount || 0);
        } else if (entry.type === 'Payment') {
          totalPayments += Math.abs(entry.amount);
        }
      });

      // Sum up unapplied payment amounts (credit available). ONLY captured,
      // settled money counts. Whitelist the settled statuses — matching the
      // booking app (portal/bookings/[id]/page.tsx uses
      // .in('status', ['Applied','Credit','Partial'])) — so this excludes BOTH
      // uncaptured Stripe holds (status='Pending' / capture_status=
      // 'requires_capture', which carry remaining_amount = the full amount but
      // are NOT real money) AND Refunded/Cancelled rows that reject-rental can
      // leave with remaining_amount > 0. Counting any of those inflated
      // availableCredit and, because netBalance = outstandingDebt - availableCredit,
      // could flip a customer who actually owed money into a bogus "In Credit" —
      // hiding the debt (e.g. a $147 debtor shown as ~$1,577 credit from stale holds).
      const CAPTURED_CREDIT_STATUSES = ['Applied', 'Credit', 'Partial'];
      paymentsData?.forEach((payment: any) => {
        if (!CAPTURED_CREDIT_STATUSES.includes(payment.status)) return;
        // Belt-and-suspenders: a genuinely captured payment never keeps
        // capture_status='requires_capture'. Excluding it too means a hold
        // mislabeled with a captured-looking status (e.g. Credit/Partial that is
        // still requires_capture) can't inflate credit either — the status
        // whitelist alone would miss those.
        if (payment.capture_status === 'requires_capture') return;
        availableCredit += (payment.remaining_amount || 0);
      });
      return { totalCharges, totalPayments, outstandingDebt, availableCredit };
}

/* ═════════════════════════════ END ORIGINAL CODE ═════════════════════════════ */

const excluded = new Set(['r-cancelled', 'r-rejected']);
const payg = new Set(['r-payg']);

// "Now" is 2026-09-25 14:00 local. Local-midnight parsing is used by both sides.
const NOW = new Date(2026, 8, 25, 14, 0, 0);

const ledger: any[] = [
  // Active fixed-term rental: past, today, future and undated Rental charges.
  { type: 'Charge', amount: 500, remaining_amount: 100.1, due_date: '2026-09-01', category: 'Rental', rental_id: 'r-active' },
  { type: 'Charge', amount: 500, remaining_amount: 200.2, due_date: '2026-09-25', category: 'Rental', rental_id: 'r-active' },
  { type: 'Charge', amount: 500, remaining_amount: 500, due_date: '2026-09-26', category: 'Rental', rental_id: 'r-active' },
  { type: 'Charge', amount: 500, remaining_amount: 300.3, due_date: null, category: 'Rental', rental_id: 'r-active' },
  { type: 'Charge', amount: 45.5, remaining_amount: 45.5, due_date: '2026-10-30', category: 'Tax', rental_id: 'r-active' },
  // Negative adjustment and the Security Deposit charge both count.
  { type: 'Charge', amount: -20, remaining_amount: -20, due_date: '2026-09-10', category: 'Adjustment', rental_id: 'r-active' },
  { type: 'Charge', amount: 400, remaining_amount: 400, due_date: '2026-09-20', category: 'Security Deposit', rental_id: 'r-active' },
  // Future-dated fine still counts (only Rental waits for its due date).
  { type: 'Charge', amount: 75, remaining_amount: 75, due_date: '2026-12-01', category: 'Fine', rental_id: null },
  // null remaining_amount.
  { type: 'Charge', amount: 12, remaining_amount: null, due_date: '2026-09-01', category: 'Other', rental_id: 'r-active' },
  // Cancelled / rejected rentals never count.
  { type: 'Charge', amount: 900, remaining_amount: 900, due_date: '2026-09-01', category: 'Rental', rental_id: 'r-cancelled' },
  { type: 'Charge', amount: 60, remaining_amount: 60, due_date: '2026-09-01', category: 'Tax', rental_id: 'r-rejected' },
  // PAYG rental's ledger rows are skipped for outstanding (accruals are the authority).
  { type: 'Charge', amount: 111, remaining_amount: 111, due_date: '2026-09-24', category: 'Rental', rental_id: 'r-payg' },
  // Payments on the ledger (WithStatus totals them).
  { type: 'Payment', amount: -250.25, remaining_amount: 0, due_date: null, category: 'Rental', rental_id: 'r-active' },
  { type: 'Payment', amount: -0.1, remaining_amount: 0, due_date: null, category: 'Tax', rental_id: 'r-cancelled' },
  // Float-hostile amounts: the order of additions must be preserved exactly.
  { type: 'Charge', amount: 0.1, remaining_amount: 0.1, due_date: '2026-09-01', category: 'Tax', rental_id: 'r-active' },
  { type: 'Charge', amount: 0.2, remaining_amount: 0.2, due_date: '2026-09-01', category: 'Tax', rental_id: 'r-active' },
];

const payments: any[] = [
  { status: 'Credit', capture_status: null, remaining_amount: 50.05 },
  { status: 'Partial', capture_status: 'captured', remaining_amount: 10.1 },
  { status: 'Applied', capture_status: null, remaining_amount: 0 },
  // An uncaptured hold carrying a credit-looking status: NOT money.
  { status: 'Credit', capture_status: 'requires_capture', remaining_amount: 1577 },
  // Placeholder link row: NOT money.
  { status: 'Pending', capture_status: 'requires_capture', remaining_amount: 147 },
  { status: 'Refunded', capture_status: 'captured', remaining_amount: 30 },
  { status: 'Cancelled', capture_status: null, remaining_amount: 99 },
  { status: 'Completed', capture_status: 'captured', remaining_amount: 5 },
  { status: 'Partial', capture_status: 'captured', remaining_amount: null },
];

const accruals: any[] = [
  { rental_id: 'r-payg', daily_rate: 100, tax_amount: 8.25, service_fee_amount: 2.75 },
  { rental_id: 'r-payg', daily_rate: '100.10', tax_amount: '8.26', service_fee_amount: null },
  { rental_id: 'r-cancelled', daily_rate: 999, tax_amount: 0, service_fee_amount: 0 },
  { rental_id: null, daily_rate: 0.1, tax_amount: 0.2, service_fee_amount: 0 },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('balance.ts is the hook\'s inline code, extracted', () => {
  it('uses the same captured-credit whitelist', () => {
    expect(CAPTURED_CREDIT_STATUSES).toEqual(['Applied', 'Credit', 'Partial']);
  });

  const moments: [string, Date][] = [
    ['mid-afternoon', NOW],
    ['exactly local midnight (due today is due)', new Date(2026, 8, 25, 0, 0, 0)],
    ['one minute after local midnight', new Date(2026, 8, 25, 0, 1, 0)],
    ['one minute before local midnight', new Date(2026, 8, 25, 23, 59, 0)],
    ['the day after', new Date(2026, 8, 26, 9, 0, 0)],
  ];

  for (const [name, at] of moments) {
    it(`useCustomerBalance's ledger figure is identical (${name})`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(at);
      const ledgerCharges = ledger.filter((e) => e.type === 'Charge');
      expect(Object.is(sumLedgerBalance(ledgerCharges, excluded, payg), originalLedgerBalance(ledgerCharges, excluded, payg))).toBe(true);
    });

    it(`useCustomerBalanceWithStatus's totals are identical (${name})`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(at);
      const original = originalWithStatus(ledger, payments, excluded, payg);
      const next = { ...summarizeCustomerLedger(ledger, excluded, payg), availableCredit: sumAvailableCredit(payments) };
      for (const k of ['totalCharges', 'totalPayments', 'outstandingDebt', 'availableCredit'] as const) {
        expect(Object.is(next[k], original[k]), `${k}: ${next[k]} vs ${original[k]}`).toBe(true);
      }
    });
  }

  it("with the tenant's day: a Rental charge due today is due, due tomorrow is not", async () => {
    const { isNotYetDueRentalCharge } = await import('@/lib/finances/balance');
    const clock = { now: new Date('2026-09-26T02:00:00Z'), timeZone: 'America/New_York' }; // 25 Sep, 22:00 in New York
    expect(isNotYetDueRentalCharge({ category: 'Rental', due_date: '2026-09-25' }, clock)).toBe(false);
    expect(isNotYetDueRentalCharge({ category: 'Rental', due_date: '2026-09-26' }, clock)).toBe(true);
    expect(isNotYetDueRentalCharge({ category: 'Rental', due_date: '2026-09-26' }, { ...clock, today: '2026-09-26' })).toBe(false);
    expect(isNotYetDueRentalCharge({ category: 'Tax', due_date: '2026-12-31' }, clock)).toBe(false);
  });

  it('the PAYG accrual total is identical', () => {
    expect(Object.is(sumPaygAccruals(accruals, excluded), originalPaygTotal(accruals, excluded))).toBe(true);
    expect(Object.is(sumPaygAccruals(null, excluded), originalPaygTotal(null, excluded))).toBe(true);
    expect(Object.is(sumAvailableCredit(null), 0)).toBe(true);
  });

  it('the hand-worked figures (so parity is not parity with a broken rule)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Counted on 2026-09-25 (local): 100.10 + 200.20 (due today) + 300.30 (no date)
    // + 45.50 (Tax, future date — only Rental waits) − 20.00 + 400.00 + 75.00
    // + 0 (null) + 0.10 + 0.20 = 1101.40. Not counted: 500 (due 26th),
    // cancelled 900, rejected 60, PAYG 111.
    expect(sumLedgerBalance(ledger.filter((e) => e.type === 'Charge'), excluded, payg)).toBeCloseTo(1101.4, 9);
    // Credit: 50.05 + 10.10 + 0 + 0 (null) = 60.15. Not: the 1,577 hold, the
    // 147 link, Refunded 30, Cancelled 99, Completed 5 (not in the whitelist).
    expect(sumAvailableCredit(payments)).toBeCloseTo(60.15, 9);
    // PAYG: (100 + 8.25 + 2.75) + (100.10 + 8.26 + 0) + (0.1 + 0.2 + 0) = 219.66; the cancelled 999 is out.
    expect(sumPaygAccruals(accruals, excluded)).toBeCloseTo(219.66, 9);
  });

  it('agrees with the original over 2,000 random ledgers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let seed = 20260925;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    const cats = ['Rental', 'Tax', 'Fine', 'Adjustment', 'Security Deposit', 'Extension Rental', 'Other'];
    const rentals = ['r-active', 'r-cancelled', 'r-rejected', 'r-payg', null];
    const dates = ['2026-09-01', '2026-09-24', '2026-09-25', '2026-09-26', '2026-12-31', null];
    const statuses = ['Applied', 'Credit', 'Partial', 'Pending', 'Completed', 'Refunded', 'Reversed', null];
    const captures = [null, 'captured', 'requires_capture', 'cancelled'];
    for (let run = 0; run < 2000; run++) {
      const n = Math.floor(rnd() * 12);
      const rows = Array.from({ length: n }, () => {
        const amt = Math.round((rnd() * 2000 - 400) * 100) / 100;
        return {
          type: rnd() < 0.8 ? 'Charge' : 'Payment',
          amount: amt,
          remaining_amount: rnd() < 0.1 ? null : Math.round(rnd() * amt * 100) / 100,
          due_date: pick(dates),
          category: pick(cats),
          rental_id: pick(rentals),
        };
      });
      const pays = Array.from({ length: Math.floor(rnd() * 6) }, () => ({
        status: pick(statuses),
        capture_status: pick(captures),
        remaining_amount: rnd() < 0.1 ? null : Math.round(rnd() * 500 * 100) / 100,
      }));
      const charges = rows.filter((r) => r.type === 'Charge');
      expect(Object.is(sumLedgerBalance(charges, excluded, payg), originalLedgerBalance(charges, excluded, payg))).toBe(true);
      const o = originalWithStatus(rows, pays, excluded, payg);
      const s = summarizeCustomerLedger(rows, excluded, payg);
      expect([s.totalCharges, s.totalPayments, s.outstandingDebt, sumAvailableCredit(pays)]).toEqual([
        o.totalCharges,
        o.totalPayments,
        o.outstandingDebt,
        o.availableCredit,
      ]);
    }
  });
});
