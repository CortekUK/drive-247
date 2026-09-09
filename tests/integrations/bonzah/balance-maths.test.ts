// =============================================================================
// integrations/bonzah — BALANCE MATHS. The other place arithmetic decides money.
//
// LAYER 3. Pure. No network, no mocks, no env. Always runs.
//
// WHY A SECOND MATHS FILE
// -----------------------
// `premium-maths.test.ts` covers what a policy COSTS. This one covers whether
// there is anything left to buy it with, and both halves of that are arithmetic
// that has already gone wrong in production:
//
//   THE SPENDABLE BALANCE. Bonzah runs this platform on an AGENCY-level wallet.
//   The per-sub-user figure in /deposit -> users[].amount is vestigial and reads
//   0.0000 for every tenant, because Bonzah refuses to populate it ("Agency
//   level balance feature enabled. Userwise allocation not allowed"). Preferring
//   that zero told every live tenant "$0.00 available to issue policies" while
//   their money sat spendable at broker level — and prompted a tenant to ask for
//   a top-up they did not need. The expression that fixed it is a one-line
//   ternary, it exists in TWO functions, and nothing was asserting either copy.
//
//   THE ALERT THRESHOLD. `balance <= threshold * 0.5` is the line between a
//   warning and a critical alert, and it decides whether an operator finds out
//   their insurance is about to stop selling. Half of a threshold is arithmetic
//   with a boundary, and boundaries are where these go wrong.
//
// SAME NON-VACUITY RULE AS premium-maths.test.ts: every expected value below is
// a literal worked out by hand; every actual comes from executing the real
// expression lifted out of supabase/functions/bonzah-*/index.ts.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { liftEdgeExpression } from "./rate-card";

const BALANCE_FN = "bonzah-get-balance";
const CONFIRM_FN = "bonzah-confirm-payment";

// ===========================================================================
// 1. WHICH NUMBER IS SPENDABLE
// ===========================================================================
describe("bonzah/balance-maths — the spendable balance", () => {
  // `const balance = allocatedNum > 0 ? (allocatedBalance as string) : brokerBalance ?? allocatedBalance ?? '0'`
  const spendable = liftEdgeExpression<
    (allocatedNum: number, allocatedBalance: string | null, brokerBalance: string | null) => string
  >(
    BALANCE_FN,
    "the spendable-balance ternary (`const balance = allocatedNum > 0 ? ...`)",
    /\bconst\s+balance\s*=\s*([\s\S]*?allocatedNum[\s\S]*?)\n\s*\n/,
    ["allocatedNum", "allocatedBalance", "brokerBalance"],
  );

  const CASES: { allocated: string | null; broker: string | null; expect: string; why: string }[] = [
    {
      allocated: "0",
      broker: "1234.50",
      expect: "1234.50",
      why: "THE INCIDENT: allocation is 0 for every tenant on this platform, and the broker wallet is what policies actually draw on",
    },
    { allocated: null, broker: "1234.50", expect: "1234.50", why: "/deposit did not answer at all" },
    { allocated: "0.0000", broker: "89.10", expect: "89.10", why: "Bonzah's literal 0.0000, not a plain 0" },
    { allocated: "75", broker: "1234.50", expect: "75", why: "a genuinely allocated sub-user balance IS preferred" },
    { allocated: "75", broker: null, expect: "75", why: "allocation with no broker figure" },
    { allocated: "0", broker: null, expect: "0", why: "broker unreadable, allocation zero — report the zero, not nothing" },
    { allocated: null, broker: null, expect: "0", why: "nothing readable at all (the function 400s before this in practice)" },
  ];

  for (const c of CASES) {
    it(`allocated=${c.allocated} broker=${c.broker} spends "${c.expect}" — ${c.why}`, () => {
      const allocatedNum = c.allocated !== null ? Number(c.allocated) : 0;
      expect(
        spendable.call(allocatedNum, c.allocated, c.broker),
        `The spendable-balance rule changed for allocated=${c.allocated}, broker=${c.broker}.\n` +
          `  lifted: ${spendable.expr}\n` +
          `  got ${spendable.call(allocatedNum, c.allocated, c.broker)}, expected ${c.expect}\n` +
          "  Reporting a hard 0 here is what told every live tenant they had no money to\n" +
          "  issue policies with while the broker wallet was full. Preferring a non-zero\n" +
          "  allocation is the only case where the sub-user figure should win.",
      ).toBe(c.expect);
    });
  }

  it("agrees with the copy of the same rule inside bonzah-confirm-payment", () => {
    // `cdBalance = (allocatedBalance ?? 0) > 0 ? allocatedBalance : (brokerBalance ?? allocatedBalance)`
    // Same decision, second implementation, different types (numbers here,
    // strings there). One shows the operator a balance in the portal; the other
    // puts a balance in the "top up your Bonzah account" email. If they
    // disagree, the email contradicts the screen.
    const confirm = liftEdgeExpression<
      (allocatedBalance: number | null, brokerBalance: number | null) => number | null
    >(
      CONFIRM_FN,
      "the cdBalance ternary",
      /\bcdBalance\s*=\s*(\(allocatedBalance[^\n]+)/,
      ["allocatedBalance", "brokerBalance"],
    );

    // The both-null case is excluded: bonzah-get-balance answers 400 before it
    // reaches its ternary when neither endpoint produced a figure, so the two
    // expressions are never asked that question in the same state.
    for (const c of CASES.filter((x) => x.allocated !== null || x.broker !== null)) {
      const theirs = confirm.call(
        c.allocated !== null ? Number(c.allocated) : null,
        c.broker !== null ? Number(c.broker) : null,
      );
      expect(
        theirs,
        "The two copies of the spendable-balance rule disagree for " +
          `allocated=${c.allocated}, broker=${c.broker}:\n` +
          `  bonzah-get-balance:     ${c.expect}   (shown in the portal)\n` +
          `  bonzah-confirm-payment: ${theirs}   (quoted in the low-balance email)\n` +
          "  The operator would be told two different numbers for the same wallet.",
      ).toBe(Number(c.expect));
    }
  });

  it("sums the sub-user allocations without letting one bad row zero the total", () => {
    // `.reduce((sum, u) => sum + (Number(u.amount) || 0), 0)` — the `|| 0` is
    // load-bearing: one null or non-numeric amount would otherwise turn the
    // whole allocation into NaN, NaN > 0 is false, and the tenant silently
    // falls back to the broker figure instead of their real allocation.
    // The whole expression is captured, `depositData` and all, so what runs is
    // the shipped statement rather than a re-assembled imitation of it.
    const total = liftEdgeExpression<(depositData: unknown) => number>(
      BALANCE_FN,
      "the /deposit allocation sum",
      /\b(depositData\.data\.users\.reduce\([\s\S]*?\n\s*\))/,
      ["depositData"],
    );
    const run = (users: unknown[]) => total.call({ data: { users } });

    expect(run([{ amount: "10.5" }, { amount: "20" }]), "Two allocations must add up").toBe(30.5);
    expect(
      run([{ amount: "10.5" }, { amount: null }, { amount: "abc" }, { amount: "20" }]),
      "A null or non-numeric allocation must count as 0, not poison the sum with NaN.\n" +
        "  NaN > 0 is false, so the tenant would silently drop back to the broker figure.",
    ).toBe(30.5);
    expect(run([]), "An empty user list sums to 0").toBe(0);
    expect(run([{ amount: "0.0000" }]), "Bonzah's vestigial 0.0000 sums to 0").toBe(0);
  });
});

// ===========================================================================
// 2. THE LOW-BALANCE ALERT
//
// `if (balance < threshold)` decides whether an operator is told at all;
// `balance <= threshold * 0.5` decides whether it is urgent. Both boundaries
// are asserted, because "at exactly the threshold" and "at exactly half" are
// the two values a reader would guess wrong.
// ===========================================================================
describe("bonzah/balance-maths — the low-balance alert", () => {
  const severity = liftEdgeExpression<(balance: number, threshold: number) => string>(
    BALANCE_FN,
    "the alert severity ternary",
    /\bconst\s+severity\s*=\s*([^\n]+)/,
    ["balance", "threshold"],
  );

  const SEVERITY_CASES: { balance: number; threshold: number; expect: string; why: string }[] = [
    { balance: 499.99, threshold: 500, expect: "warning", why: "a cent under the threshold" },
    { balance: 250.01, threshold: 500, expect: "warning", why: "a cent above half" },
    { balance: 250, threshold: 500, expect: "critical", why: "EXACTLY half is critical — the comparison is <=, not <" },
    { balance: 249.99, threshold: 500, expect: "critical", why: "a cent under half" },
    { balance: 0, threshold: 500, expect: "critical", why: "empty wallet" },
    { balance: -12.5, threshold: 500, expect: "critical", why: "Bonzah can report a negative balance" },
    { balance: 50, threshold: 100, expect: "critical", why: "half of a different threshold" },
    { balance: 50.01, threshold: 100, expect: "warning", why: "just above half of a different threshold" },
    { balance: 1, threshold: 1, expect: "warning", why: "threshold of 1: half is 0.5, and 1 > 0.5" },
  ];

  for (const c of SEVERITY_CASES) {
    it(`balance ${c.balance} against a ${c.threshold} threshold is "${c.expect}" — ${c.why}`, () => {
      expect(
        severity.call(c.balance, c.threshold),
        `The alert severity rule changed at balance=${c.balance}, threshold=${c.threshold}.\n` +
          `  lifted: ${severity.expr}\n` +
          "  This decides whether the operator gets a red 'critical' notification or an\n" +
          "  amber 'warning' one. Downgrading it is how a tenant finds out their insurance\n" +
          "  stopped selling from a customer rather than from us.",
      ).toBe(c.expect);
    });
  }

  it("alerts strictly BELOW the threshold, not at it", () => {
    const trigger = liftEdgeExpression<(balance: number, threshold: number) => boolean>(
      BALANCE_FN,
      "the low-balance trigger",
      /\bif\s*\((balance\s*<\s*threshold)\)/,
      ["balance", "threshold"],
    );
    expect(trigger.call(499.99, 500), "A cent under the threshold must alert").toBe(true);
    expect(
      trigger.call(500, 500),
      "Sitting exactly on the threshold must NOT alert. `<=` here would fire an alert on " +
        "the operator's chosen number itself, and the reset branch would never run.",
    ).toBe(false);
    expect(trigger.call(500.01, 500), "Above the threshold must not alert").toBe(false);
  });

  it("resets the reminder to monitoring once the balance recovers", () => {
    // The else branch. Without it the reminder stays red for ever after a
    // single dip, and the next genuine low balance is invisible in a list of
    // stale alerts.
    const src = blankComments(readEdgeFunctionSource(BALANCE_FN));
    expect(
      src,
      "The balance-recovered branch is gone. A reminder raised once would stay raised " +
        "after a top-up, and the `alerted` latch would never clear — so the NEXT low " +
        "balance sends no email at all.",
    ).toMatch(/severity:\s*'info'/);
    expect(src, "The alerted latch is no longer cleared on recovery.").toMatch(/alerted:\s*false/);
  });

  it("does not re-email on every poll while the balance stays low", () => {
    // use-bonzah-balance.ts polls this every 60 seconds. The `alerted` flag on
    // the reminder's context is the only thing between that and an email a
    // minute.
    const src = blankComments(readEdgeFunctionSource(BALANCE_FN));
    expect(
      src,
      "The already-alerted short circuit is gone. bonzah-get-balance is polled on a timer, " +
        "so without it a tenant under threshold receives an email and a notification per " +
        "poll.",
    ).toMatch(/Already alerted for this low balance period/);
  });
});

// ===========================================================================
// 3. WHAT A CHAINED PURCHASE COSTS
// ===========================================================================
describe("bonzah/balance-maths — the premium a chained purchase needs", () => {
  // Captured from `policiesToConfirm` onwards, so the filter AND the reduce that
  // ship are what run — including the `status !== 'active'` predicate, which is
  // the half that stops an already-bought policy being counted again.
  const totalPremium = liftEdgeExpression<(policiesToConfirm: unknown[]) => number>(
    CONFIRM_FN,
    "the chain total-premium sum",
    /\bconst\s+totalPremium\s*=\s*(policiesToConfirm[\s\S]*?\.reduce\([^\n]*)/,
    ["policiesToConfirm"],
  );

  const run = (policies: unknown[]) => totalPremium.call(policies);

  it("adds up only the policies that still need buying", () => {
    // A 70-day rental is three policies. Re-confirming after one succeeded must
    // not re-count the one already active, or the low-balance email demands a
    // top-up for money that has already been spent.
    const cents = (n: number) => Math.round(n * 100) / 100;

    expect(run([]), "An empty chain needs nothing").toBe(0);
    expect(
      cents(run([{ status: "quoted", premium_amount: 26.95 }, { status: "quoted", premium_amount: 23.18 }])),
      "Two unbought policies must add to 50.13 (26.95 + 23.18).",
    ).toBe(50.13);
    expect(
      cents(
        run([
          { status: "active", premium_amount: 100 },
          { status: "quoted", premium_amount: 26.95 },
          { status: "quoted", premium_amount: 23.18 },
        ]),
      ),
      "An already-active policy is still being counted. The operator would be told to top " +
        "up by 150.13 when only 50.13 is actually needed — for a policy their balance has " +
        "already paid for.",
    ).toBe(50.13);
    expect(
      run([{ status: "active", premium_amount: 100 }]),
      "A fully-bought chain needs 0 more.",
    ).toBe(0);
  });

  it("treats a missing premium as zero rather than poisoning the total", () => {
    // `p.premium_amount || 0`. Without it a single null premium makes the whole
    // sum NaN, and "Premium: $NaN" is what the operator's email would say.
    expect(
      run([{ status: "quoted", premium_amount: null }, { status: "quoted", premium_amount: 26.95 }]),
      "A null premium_amount now poisons the chain total. The insufficient-balance email " +
        "interpolates this value directly, so the operator would be told 'Premium: $NaN'.",
    ).toBe(26.95);
    expect(run([{ status: "quoted" }]), "A missing premium_amount must count as 0").toBe(0);
  });

  it("prices the chain in the same direction as the number of policies in it", () => {
    // Sanity in the large: N identical chunks cost N times one chunk. It is the
    // property that catches a `.find` where a `.filter` belongs — the kind of
    // change that still returns a plausible number.
    const one = [{ status: "quoted", premium_amount: 77.21 }];
    const three = [...one, ...one, ...one];
    expect(
      Math.round(run(three) * 100) / 100,
      "Three identical chunks no longer cost three times one chunk. The chain sum is what " +
        "the balance is checked against before buying.",
    ).toBe(231.63);
  });
});
