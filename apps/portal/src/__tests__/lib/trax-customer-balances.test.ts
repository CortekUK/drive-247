import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { calendarClock } from '../../../../../supabase/functions/trax-support/support/calendar-clock';
import { createBusinessReads, type BusinessDatabase } from '../../../../../supabase/functions/trax-support/support/business-query';
import { queryCustomerBalances, computeBalances, parseBalanceRequest, BALANCE_DEFINITION } from '../../../../../supabase/functions/trax-support/support/balance-tools';
import type { BusinessContext } from '../../../../../supabase/functions/trax-support/support/business-query';
import type { SupportContext, Permission } from '../../../../../supabase/functions/trax-support/support/types';
import { postgrestShim, type Row, type Statement } from '../helpers/postgrest-shim';

/*
 * Customer balances, against expected values worked out by hand from the rule in
 * apps/portal/src/hooks/use-customer-balance.ts. Every figure below is derived in
 * a comment beside it, so the test disagrees with the code rather than echoing it.
 *
 * The fixture is deliberately built out of the cases that have gone wrong before:
 * a PAYG rental whose ledger rows and accruals describe the same money, a
 * cancelled rental, a rejected rental, a future-dated rental charge, and an
 * uncaptured card hold that must not read as credit.
 */
const tenant = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const C = {
  ada: '00000000-0000-4000-8000-0000000000a1',     // fixed-term debtor with some credit
  ben: '00000000-0000-4000-8000-0000000000b1',     // PAYG debtor
  cleo: '00000000-0000-4000-8000-0000000000c1',    // only cancelled/rejected rentals
  dev: '00000000-0000-4000-8000-0000000000d1',     // small debt behind a big uncaptured hold
  eve: '00000000-0000-4000-8000-0000000000e1',     // in credit
};
const now = Date.parse('2026-09-18T09:00:00Z');
const clock = calendarClock(fromZonedTime, formatInTimeZone);

let tables: Record<string, Row[]>;
let statements: Statement[];
let role: SupportContext['role'];
let permissions: Permission[];
let scopes: string[];

const auth = (): SupportContext => ({
  userId: 'user', staffId: 'staff', tenant: { id: tenant, slug: 'northwind', status: 'active' } as never,
  role, superAdmin: false, permissions, scope: 'scope',
} as SupportContext);
const context = (): BusinessContext => {
  const shim = postgrestShim(() => tables, statements);
  return {
    auth: auth(),
    business: createBusinessReads(shim.database as unknown as BusinessDatabase),
    clock, now,
    timezone: async () => 'Europe/London',
    currency: async () => 'GBP',
    financeScopes: scopes,
  } as unknown as BusinessContext;
};

beforeEach(() => {
  statements = []; role = 'admin'; permissions = []; scopes = ['rental_payments', 'account_balance'];
  tables = {
    customers: [
      { id: C.ada, tenant_id: tenant, name: 'Ada Okafor' },
      { id: C.ben, tenant_id: tenant, name: 'Ben Marsh' },
      { id: C.cleo, tenant_id: tenant, name: 'Cleo Ng' },
      { id: C.dev, tenant_id: tenant, name: 'Dev Patel' },
      { id: C.eve, tenant_id: tenant, name: 'Eve Bloom' },
      { id: 'foreign-customer', tenant_id: other, name: 'Other Account Ltd' },
    ],
    rentals: [
      { id: 'r-ada', tenant_id: tenant, customer_id: C.ada, status: 'Active', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null },
      { id: 'r-ben', tenant_id: tenant, customer_id: C.ben, status: 'Started', approval_status: 'approved', is_pay_as_you_go: true, payg_closed_at: null },
      { id: 'r-ben-closed', tenant_id: tenant, customer_id: C.ben, status: 'Completed', approval_status: 'approved', is_pay_as_you_go: true, payg_closed_at: '2026-08-01' },
      { id: 'r-cleo-cancelled', tenant_id: tenant, customer_id: C.cleo, status: 'Cancelled', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null },
      { id: 'r-cleo-rejected', tenant_id: tenant, customer_id: C.cleo, status: 'Pending', approval_status: 'rejected', is_pay_as_you_go: false, payg_closed_at: null },
      { id: 'r-dev', tenant_id: tenant, customer_id: C.dev, status: 'Active', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null },
      { id: 'r-foreign', tenant_id: other, customer_id: 'foreign-customer', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null },
    ],
    ledger_entries: [
      // Ada: 100.00 + 50.00 due, one 200.00 rental charge dated in the future, one 30.00 fine.
      { id: 'l1', tenant_id: tenant, customer_id: C.ada, rental_id: 'r-ada', type: 'Charge', category: 'Rental', due_date: '2026-09-01', remaining_amount: 100 },
      { id: 'l2', tenant_id: tenant, customer_id: C.ada, rental_id: 'r-ada', type: 'Charge', category: 'Rental', due_date: '2026-09-15', remaining_amount: 50 },
      { id: 'l3', tenant_id: tenant, customer_id: C.ada, rental_id: 'r-ada', type: 'Charge', category: 'Rental', due_date: '2026-10-15', remaining_amount: 200 },
      { id: 'l4', tenant_id: tenant, customer_id: C.ada, rental_id: 'r-ada', type: 'Charge', category: 'Fine', due_date: '2026-10-20', remaining_amount: 30 },
      // Ada also has a Payment row; balances count charges only.
      { id: 'l5', tenant_id: tenant, customer_id: C.ada, rental_id: 'r-ada', type: 'Payment', category: 'Rental', due_date: null, remaining_amount: 0 },
      // Ben: the PAYG rental's ledger rows describe the same money as its accruals.
      { id: 'l6', tenant_id: tenant, customer_id: C.ben, rental_id: 'r-ben', type: 'Charge', category: 'Rental', due_date: '2026-09-16', remaining_amount: 135 },
      { id: 'l7', tenant_id: tenant, customer_id: C.ben, rental_id: 'r-ben-closed', type: 'Charge', category: 'Rental', due_date: '2026-07-30', remaining_amount: 90 },
      // Cleo: everything belongs to a cancelled or rejected rental.
      { id: 'l8', tenant_id: tenant, customer_id: C.cleo, rental_id: 'r-cleo-cancelled', type: 'Charge', category: 'Rental', due_date: '2026-09-01', remaining_amount: 500 },
      { id: 'l9', tenant_id: tenant, customer_id: C.cleo, rental_id: 'r-cleo-rejected', type: 'Charge', category: 'Rental', due_date: '2026-09-01', remaining_amount: 300 },
      // Dev: a small real debt.
      { id: 'l10', tenant_id: tenant, customer_id: C.dev, rental_id: 'r-dev', type: 'Charge', category: 'Rental', due_date: '2026-09-10', remaining_amount: 50 },
      { id: 'l-foreign', tenant_id: other, customer_id: 'foreign-customer', rental_id: 'r-foreign', type: 'Charge', category: 'Rental', due_date: '2026-09-01', remaining_amount: 9999 },
    ],
    payg_accruals: [
      // Ben, three open days at 40 + 4 + 1 = 45 each.
      { id: 'a1', tenant_id: tenant, rental_id: 'r-ben', invoice_status: 'open', daily_rate: 40, tax_amount: 4, service_fee_amount: 1 },
      { id: 'a2', tenant_id: tenant, rental_id: 'r-ben', invoice_status: 'open', daily_rate: 40, tax_amount: 4, service_fee_amount: 1 },
      { id: 'a3', tenant_id: tenant, rental_id: 'r-ben', invoice_status: 'open', daily_rate: 40, tax_amount: 4, service_fee_amount: 1 },
      // Settled day, and a day on a closed PAYG rental: neither is outstanding.
      { id: 'a4', tenant_id: tenant, rental_id: 'r-ben', invoice_status: 'settled', daily_rate: 40, tax_amount: 4, service_fee_amount: 1 },
      { id: 'a5', tenant_id: tenant, rental_id: 'r-ben-closed', invoice_status: 'open', daily_rate: 40, tax_amount: 4, service_fee_amount: 1 },
      { id: 'a-foreign', tenant_id: other, rental_id: 'r-foreign', invoice_status: 'open', daily_rate: 500, tax_amount: 0, service_fee_amount: 0 },
    ],
    payments: [
      // Ada: 20.00 captured and unapplied.
      { id: 'p1', tenant_id: tenant, customer_id: C.ada, status: 'Applied', capture_status: null, remaining_amount: 20 },
      // Dev: a 1,000.00 hold awaiting capture. Not money, not credit.
      { id: 'p2', tenant_id: tenant, customer_id: C.dev, status: 'Pending', capture_status: 'requires_capture', remaining_amount: 1000 },
      // Dev: a captured-looking status that still awaits capture — also excluded.
      { id: 'p3', tenant_id: tenant, customer_id: C.dev, status: 'Credit', capture_status: 'requires_capture', remaining_amount: 500 },
      // Dev: a refunded row that kept a remaining amount.
      { id: 'p4', tenant_id: tenant, customer_id: C.dev, status: 'Refunded', capture_status: null, remaining_amount: 300 },
      // Eve: 75.00 of captured credit and nothing owed.
      { id: 'p5', tenant_id: tenant, customer_id: C.eve, status: 'Credit', capture_status: null, remaining_amount: 75 },
      { id: 'p-foreign', tenant_id: other, customer_id: 'foreign-customer', status: 'Applied', capture_status: null, remaining_amount: 4444 },
    ],
  };
});

const answerOf = (result: Awaited<ReturnType<typeof queryCustomerBalances>>) => result.data!.answer as {
  groups: { key: string; label: string; value: string; outstanding: string; credit: string; currency: string | null }[];
  total: string; customersWithBalance: number; complete: boolean; definition: string; timezone: string; asOf: string;
};

describe('who owes the most', () => {
  it('ranks debtors by net, with figures that match the hand calculation', async () => {
    const answer = answerOf(await queryCustomerBalances({}, context()));

    // Ada:  100.00 + 50.00 due rental charges  (the 200.00 due 2026-10-15 is not yet due)
    //     +  30.00 fine (a non-Rental category counts whatever its due date)
    //     = 180.00 outstanding, minus 20.00 captured unapplied credit = 160.00
    // Ben:  3 open accrual days x (40 + 4 + 1) = 135.00
    //       the 135.00 ledger charge on the same PAYG rental is NOT added
    //       the 90.00 charge on the closed PAYG rental is also a PAYG rental, so excluded
    //     = 135.00 outstanding, no credit = 135.00
    // Dev:   50.00 outstanding; the 1,000.00 and 500.00 rows await capture and the
    //        300.00 is refunded, so credit is 0.00 = 50.00
    // Cleo:  500.00 + 300.00 belong to a cancelled and a rejected rental = 0.00, not listed
    // Eve:   0.00 outstanding, 75.00 credit, net -75.00, not a debtor
    expect(answer.groups.map((group) => [group.label, group.value])).toEqual([
      ['Ada Okafor', '160.00'],
      ['Ben Marsh', '135.00'],
      ['Dev Patel', '50.00'],
    ]);
    expect(answer.groups[0]).toMatchObject({ outstanding: '180.00', credit: '20.00', currency: 'GBP' });
    expect(answer.groups[1]).toMatchObject({ outstanding: '135.00', credit: '0.00' });
    expect(answer.groups[2]).toMatchObject({ outstanding: '50.00', credit: '0.00' });
    // 160.00 + 135.00 + 50.00
    expect(answer.total).toBe('345.00');
    expect(answer.customersWithBalance).toBe(3);
    expect(answer.complete).toBe(true);
    expect(answer.definition).toBe(BALANCE_DEFINITION);
    expect(answer.timezone).toBe('Europe/London');
    expect(answer.asOf).toBe('2026-09-18');
  });

  it('does not count a PAYG day twice, which is the error this rule exists to prevent', async () => {
    // Ben's ledger says 135.00 and his accruals say 135.00: the same three days.
    const answer = answerOf(await queryCustomerBalances({}, context()));
    const ben = answer.groups.find((group) => group.label === 'Ben Marsh')!;
    expect(ben.outstanding).toBe('135.00');
    expect(ben.outstanding).not.toBe('270.00');
  });

  it('does not let an uncaptured hold hide a debt', async () => {
    const answer = answerOf(await queryCustomerBalances({}, context()));
    const dev = answer.groups.find((group) => group.label === 'Dev Patel')!;
    // With the holds counted as credit this would be 50 - 1800 = a bogus 1,750.00 in credit.
    expect(dev.value).toBe('50.00');
    expect(dev.credit).toBe('0.00');
  });

  it('lists customers in credit only when asked, and never as debtors', async () => {
    const debtors = answerOf(await queryCustomerBalances({}, context()));
    expect(debtors.groups.map((g) => g.label)).not.toContain('Eve Bloom');
    const withCredit = answerOf(await queryCustomerBalances({ includeCredit: true }, context()));
    const eve = withCredit.groups.find((group) => group.label === 'Eve Bloom')!;
    expect(eve.value).toBe('-75.00');
    expect(eve.credit).toBe('75.00');
    // Still ranked highest debt first.
    expect(withCredit.groups[0].label).toBe('Ada Okafor');
    expect(withCredit.groups[withCredit.groups.length - 1].label).toBe('Eve Bloom');
  });

  it('answers for one customer when the question is about one', async () => {
    const answer = answerOf(await queryCustomerBalances({ customerId: C.ada }, context()));
    expect(answer.groups).toHaveLength(1);
    expect(answer.groups[0]).toMatchObject({ label: 'Ada Okafor', value: '160.00' });
  });

  it('applies a minimum and a limit, and says how many matched', async () => {
    const big = await queryCustomerBalances({ minimumOwed: 100 }, context());
    expect(answerOf(big).groups.map((g) => g.value)).toEqual(['160.00', '135.00']);
    const top = await queryCustomerBalances({ limit: 1 }, context());
    expect(answerOf(top).groups).toHaveLength(1);
    expect(answerOf(top).customersWithBalance).toBe(3);
    expect(top.limitations.join(' ')).toMatch(/3 customers matched/);
  });

  it('reports an empty result as empty, not as zero owed', async () => {
    tables.ledger_entries = []; tables.payg_accruals = [];
    const result = await queryCustomerBalances({}, context());
    expect(answerOf(result).groups).toEqual([]);
    expect(result.findings[0].code).toBe('no_matching_records');
  });

  it('names a customer whose record has no name, without inventing one', async () => {
    tables.customers = tables.customers.map((row) => (row.id === C.ada ? { ...row, name: null } : row));
    const answer = answerOf(await queryCustomerBalances({}, context()));
    expect(answer.groups[0].label).toBe('Name unavailable');
  });
});

describe('the account boundary', () => {
  it('never reads or counts another account’s rows', async () => {
    const answer = answerOf(await queryCustomerBalances({}, context()));
    // The other account holds 9,999 + 500 owed and 4,444 credit. None of it appears.
    expect(JSON.stringify(answer)).not.toContain('9999');
    expect(JSON.stringify(answer)).not.toContain('4444');
    expect(JSON.stringify(answer)).not.toContain('Other Account');
    // Every statement carried the account predicate before anything else.
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(statement.filters[0]).toBe(`tenant_id=eq.${tenant}`);
  });

  it('refuses the result if the database returns a row from another account', async () => {
    // A filter that silently failed, or a policy change mid-request.
    const leaky = {
      from: () => ({
        select: () => {
          const query: Record<string, unknown> = {
            eq: () => query, neq: () => query, in: () => query, gt: () => query, gte: () => query,
            lt: () => query, lte: () => query, is: () => query, not: () => query, ilike: () => query,
            order: () => query, range: () => query,
            then: (ok: (value: unknown) => unknown) => Promise.resolve().then(() => ok({
              data: [{ id: 'x', tenant_id: other, customer_id: 'foreign-customer', status: 'Active' }], error: null, count: 1,
            })),
          };
          return query;
        },
      }),
    };
    const env = { ...context(), business: createBusinessReads(leaky as unknown as BusinessDatabase) } as BusinessContext;
    await expect(queryCustomerBalances({}, env)).rejects.toMatchObject({ code: 'isolation_violation' });
  });

  it('rejects a customer id that is not an id', async () => {
    for (const bad of ['all', '1 OR 1=1', 'C.ada', '']) {
      expect(() => parseBalanceRequest({ customerId: bad })).toThrow(/identified by an ID/);
    }
  });

  it('rejects an unsupported argument or an out-of-range limit', async () => {
    expect(() => parseBalanceRequest({ tenantId: tenant })).toThrow();
    expect(() => parseBalanceRequest({ limit: 0 })).toThrow(/between one and fifty/);
    expect(() => parseBalanceRequest({ limit: 5000 })).toThrow(/between one and fifty/);
    expect(() => parseBalanceRequest({ minimumOwed: -5 })).toThrow(/positive number/);
  });
});

describe('who may ask', () => {
  it('refuses without the finance permission, before any read', async () => {
    scopes = [];
    await expect(queryCustomerBalances({}, context())).rejects.toMatchObject({ code: 'finance_restricted' });
    expect(statements).toEqual([]);
  });

  it('refuses a role that cannot read customers', async () => {
    role = 'manager'; permissions = []; scopes = ['rental_payments'];
    await expect(queryCustomerBalances({}, context())).rejects.toMatchObject({ code: 'restricted' });
    expect(statements).toEqual([]);
  });

  it('allows a manager who holds both permissions', async () => {
    role = 'manager';
    permissions = [{ tab_key: 'customers', access_level: 'viewer' } as Permission];
    scopes = ['rental_payments'];
    const answer = answerOf(await queryCustomerBalances({}, context()));
    expect(answer.groups[0].label).toBe('Ada Okafor');
  });
});

describe('the computation on its own', () => {
  it('is pure arithmetic over the rows it is given', () => {
    const balances = computeBalances({
      rentals: [{ id: 'r1', customer_id: 'c1', status: 'Active', approval_status: 'approved', is_pay_as_you_go: false, payg_closed_at: null }],
      charges: [
        { customer_id: 'c1', rental_id: 'r1', category: 'Rental', due_date: '2026-01-01', remaining_amount: 10.005 },
        { customer_id: 'c1', rental_id: 'r1', category: 'Rental', due_date: '2026-01-01', remaining_amount: 0.1 },
      ],
      accruals: [], payments: [], today: '2026-09-18',
    });
    // 10.005 rounds to 10.01 in minor units, plus 0.10 = 10.11. Repeated addition
    // of floats would drift here; integer minor units cannot.
    expect(balances.get('c1')!.outstandingMinor).toBe(1011);
    expect(balances.get('c1')!.netMinor).toBe(1011);
  });

  it('treats a charge with no customer as unattributable rather than guessing', () => {
    const balances = computeBalances({
      rentals: [], charges: [{ customer_id: null, rental_id: 'r1', category: 'Fine', remaining_amount: 99 }],
      accruals: [], payments: [], today: '2026-09-18',
    });
    expect([...balances.keys()]).toEqual([]);
  });
});
