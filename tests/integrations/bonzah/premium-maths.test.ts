// =============================================================================
// integrations/bonzah — PREMIUM MATHS (A): DOES THE APP AGREE WITH ITSELF?
//
// LAYER 3. Pure. No network, no mocks, no env. Always runs.
//
// WHAT THIS FILE PROVES, AND WHAT IT CANNOT
// -----------------------------------------
// It proves the app is SELF-CONSISTENT: that the rate card in the source is the
// published one, that rate × days is applied the way it is documented, that the
// day count underneath it is right at the boundaries, and that the two separate
// copies of that arithmetic — the estimator the customer sees while ticking
// boxes, and the fallback the quote function bills with — produce the same cent.
//
// It CANNOT tell you the rate card is still what Bonzah charges. If Bonzah puts
// CDW up to $28.95 tomorrow, every assertion in this file still passes and every
// customer is quoted the old price. That is `premium-parity.test.ts`'s job, it
// talks to Bonzah's sandbox, and neither file substitutes for the other:
//
//     premium-maths.test.ts    we agree with OURSELVES     (this file, always runs)
//     premium-parity.test.ts   we agree with BONZAH        (opt-in, sandbox only)
//
// WHERE THE SHAPE OF THIS TEST CAME FROM
// --------------------------------------
// Ghulam, on the whiteboard, splitting testing in two — "FUNCTIONAL test hai,
// aur phir MATHS wale test hain… maths wale test bade important hain", because
// "jab payments layenge toh maths aana shuru ho jayega" — and then sketching one:
//
//     "agar woh Bonzah ki pehli wali insurance leta hai aur uske din hote hain
//      PAANCH, toh uska TOTAL 200 banna chahiye"          vitest 1 === 5 === 200
//
// THE 200 WAS ILLUSTRATIVE — HE WAS DRAWING THE SHAPE, NOT QUOTING A PRICE.
// Nothing in the live rate card equals 200 at five days:
//
//     CDW  26.95/day  × 5 = 134.75
//     RCLI 23.18/day  × 5 = 115.90
//     SLI  20.18/day  × 5 = 100.90
//     PAI   6.90/day  × 5 =  34.50      all four × 5 = 386.05
//
// So the five-day case below is his case, with the real numbers. Encoding 200
// would have failed, and "fixing" the code to match a whiteboard sketch would
// have broken real pricing for every operator selling Bonzah.
//
// HOW THIS AVOIDS BEING VACUOUS
// -----------------------------
// A maths test that computes its expectation with the same expression the source
// uses proves only that one person typed one formula twice, and it stays green
// when the formula changes. So the two sides here come from different places and
// cannot move together:
//
//   EXPECTED — every number below is a LITERAL, worked out by hand from the
//              published per-24h rate card and typed into this file. There is no
//              `RATES.CDW * days` anywhere in it.
//   ACTUAL   — `rate-card.ts` lifts the REAL expressions out of
//              supabase/functions/bonzah-*/index.ts and executes them:
//              `body.cdw_cover ? Math.round(RATES.CDW * days * 100) / 100 : 0`
//              is run verbatim, with the rate read from the shipped table.
//
// Change `CDW: 26.95` to `CDW: 27.95` and this file goes red. Change the
// rounding to `Math.floor`, or drop a coverage out of the total, or rename
// `cdw_cover`, and it goes red. That is the whole point.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import {
  PREMIUM_FN,
  QUOTE_FN,
  liftCalculateDays,
  liftSplitDateRange,
  readPremiumModel,
  readQuoteFallbackModel,
  readRateCard,
  runningInUtc,
} from "./rate-card";

const model = readPremiumModel();
const fallback = readQuoteFallbackModel();

/** The published Bonzah per-24h card, typed by hand. Nothing derived. */
const PUBLISHED_RATES: Record<string, number> = {
  CDW: 26.95,
  RCLI: 23.18,
  SLI: 20.18,
  PAI: 6.9,
};

/** The four coverages, in the order the rate card declares them. */
const COVERAGES = ["cdw", "rcli", "sli", "pai"] as const;
type Coverage = (typeof COVERAGES)[number];

const select = (...on: Coverage[]): Record<string, boolean> =>
  Object.fromEntries(COVERAGES.map((c) => [c, on.includes(c)]));

// ===========================================================================
// 1. THE RATE CARD ITSELF
//
// Asserted separately from the multiplication so a failure says which half
// moved: a rate change is a business decision someone made, a broken
// multiplication is a bug. One message cannot say both.
// ===========================================================================
describe("bonzah/premium-maths — the rate card", () => {
  it("prices exactly four coverages: CDW, RCLI, SLI, PAI", () => {
    expect(
      model.card.keys,
      "The set of Bonzah coverages changed.\n" +
        `  ${model.card.file} now prices: ${model.card.keys.join(", ")}\n` +
        "  A FIFTH coverage means every total in this file is now a partial total, and\n" +
        "  the booking UI, the portal selector and coverage-labels.ts each enumerate the\n" +
        "  four by hand — check all of them before updating this list.",
    ).toEqual(["CDW", "RCLI", "SLI", "PAI"]);
  });

  it("charges the published per-24h rate for each one", () => {
    for (const [key, published] of Object.entries(PUBLISHED_RATES)) {
      expect(
        model.card.rates[key],
        `The ${key} rate in ${model.card.file} is no longer $${published}/24h.\n` +
          `  shipped: ${model.card.rates[key]}   published (this test): ${published}\n` +
          "  If Bonzah genuinely repriced, update PUBLISHED_RATES here AND the hand-worked\n" +
          "  totals below — they were computed from these four numbers and are now wrong.\n" +
          "  If nobody repriced anything, somebody has just changed what every operator\n" +
          "  charges for insurance.",
      ).toBe(published);
    }
  });

  it("keeps the estimator's rate card and the quote fallback's identical", () => {
    // Two files, two copies of the same table. The estimator's is what the
    // customer is shown while choosing; the quote function's is what gets
    // written to bonzah_insurance_policies.premium_amount when Bonzah's
    // response omits total_amount. A drift between them is a customer quoted
    // one price and billed another.
    const estimator = readRateCard(PREMIUM_FN);
    const biller = readRateCard(QUOTE_FN);
    expect(
      biller.rates,
      "The two copies of the Bonzah rate card have drifted apart:\n" +
        `  ${estimator.file}  ${JSON.stringify(estimator.rates)}\n` +
        `  ${biller.file}  ${JSON.stringify(biller.rates)}\n` +
        "  The first quotes the customer. The second is what is stored as the premium\n" +
        "  when Bonzah's quote response carries no total_amount. Quoted one price,\n" +
        "  billed another.",
    ).toEqual(estimator.rates);
  });

  it("wires each RATES key to the matching request field and premium variable", () => {
    // RATES.CDW must be the rate gated on `cdw_cover` and stored under
    // `breakdown.cdw`. A crossed wire here prices SLI at the CDW rate and
    // nothing else in the suite would notice: the total would still be a
    // plausible number.
    const wiring = model.lines.map((l) => `${l.ratesKey}/${l.bodyField}/${l.varName}`);
    expect(
      wiring,
      "A RATES key is no longer wired to the request field and premium variable that\n" +
        "  share its name:\n" +
        `    ${wiring.join("\n    ")}\n` +
        "  Crossed wires here price one coverage at another's rate and still return a\n" +
        "  perfectly plausible-looking total.",
    ).toEqual([
      "CDW/cdw_cover/cdwPremium",
      "RCLI/rcli_cover/rcliPremium",
      "SLI/sli_cover/sliPremium",
      "PAI/pai_cover/paiPremium",
    ]);
  });

  it("wires the quote fallback's coverage flags to the same rates", () => {
    expect(
      fallback.terms.map((t) => `${t.coverageKey}->${t.ratesKey}`),
      `The fallback arithmetic in ${fallback.file} maps coverage flags to rates ` +
        "differently from the estimator. The customer would be quoted one coverage's " +
        "price and billed another's.",
    ).toEqual(["cdw->CDW", "rcli->RCLI", "sli->SLI", "pai->PAI"]);
  });
});

// ===========================================================================
// 2. calculateDays() — the multiplier
//
// A per-24h price is only ever as correct as the day count under it, and this
// repo has a history of date-counting bugs (see the DST note in memory:
// duplicated pricing engines, DST day-count rule). So the day count is pinned
// on its own, before any money is multiplied by it.
//
// Every expected value below is a calendar fact, worked out by hand.
// ===========================================================================
const DAY_CASES: { start: string; end: string; days: number; why: string }[] = [
  { start: "2026-03-01", end: "2026-03-01", days: 1, why: "zero-length window still bills one 24h period (Math.max floor)" },
  { start: "2026-03-01", end: "2026-03-02", days: 1, why: "one night" },
  { start: "2026-03-01", end: "2026-03-06", days: 5, why: "Ghulam's five-day case" },
  { start: "2026-03-01", end: "2026-03-08", days: 7, why: "a week" },
  { start: "2026-02-28", end: "2026-03-01", days: 1, why: "2026 is not a leap year — Feb 28 to Mar 1 is one day" },
  { start: "2028-02-28", end: "2028-03-01", days: 2, why: "2028 IS a leap year — Feb 29 exists, so it is two" },
  { start: "2026-01-31", end: "2026-03-01", days: 29, why: "across a short month" },
  { start: "2026-01-01", end: "2026-02-15", days: 45, why: "a long rental, past the 30-day policy limit" },
  { start: "2026-01-01", end: "2026-12-31", days: 364, why: "a year, to catch an off-by-one that only shows up at scale" },
  { start: "2026-03-10", end: "2026-03-01", days: 9, why: "reversed dates: Math.abs makes the count symmetric" },
  // DST. Date-only strings parse as UTC midnight, so these are 24h-exact
  // wherever this test runs. If someone 'fixes' the parse to local time, the
  // fall-back case below becomes 49 hours and starts billing a third day.
  { start: "2026-03-07", end: "2026-03-09", days: 2, why: "spans US spring-forward (2026-03-08)" },
  { start: "2026-10-31", end: "2026-11-02", days: 2, why: "spans US fall-back (2026-11-01) — 49 local hours, still 2 days" },
];

describe("bonzah/premium-maths — calculateDays()", () => {
  const days = liftCalculateDays(PREMIUM_FN).call;

  for (const c of DAY_CASES) {
    it(`counts ${c.start} → ${c.end} as ${c.days} day(s) — ${c.why}`, () => {
      expect(
        days(c.start, c.end),
        `Day count changed for ${c.start} → ${c.end} (${c.why}).\n` +
          `  Every premium is rate × this number, so an off-by-one here is an off-by-one\n` +
          `  day's insurance on every policy sold for that window.`,
      ).toBe(c.days);
    });
  }

  it("rounds a part-day UP to a whole 24h period", () => {
    // Bonzah sells 24h periods, not hours. Twelve hours is a day; twenty-five
    // hours is two. Explicit `Z` so the assertion is the same in every timezone.
    expect(
      days("2026-03-01T00:00:00Z", "2026-03-01T12:00:00Z"),
      "A half-day window no longer bills a full 24h period. Bonzah has no part-day " +
        "rate, so anything under a day that bills less than a day is unfunded cover.",
    ).toBe(1);
    expect(
      days("2026-03-01T00:00:00Z", "2026-03-02T01:00:00Z"),
      "25 hours no longer bills two 24h periods. Math.ceil is what makes the hour past " +
        "midnight a second insured day; without it the second day is uncovered.",
    ).toBe(2);
    expect(
      days("2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"),
      "Exactly 24 hours must be exactly one day — the boundary must not round up to two.",
    ).toBe(1);
  });

  it("never returns less than one day", () => {
    expect(
      days("2026-03-01", "2026-03-01"),
      "The Math.max(diffDays, 1) floor is gone. A same-day window now prices at $0, " +
        "which reads on screen as 'insurance included, free' and issues no policy.",
    ).toBeGreaterThanOrEqual(1);
  });

  it("counts days identically in the estimator and the quote function", () => {
    // Two copies of calculateDays, one per file. The estimator's number is what
    // the customer is shown; the quote function's is what the fallback bills.
    const other = liftCalculateDays(QUOTE_FN).call;
    for (const c of DAY_CASES) {
      expect(
        other(c.start, c.end),
        `The two copies of calculateDays disagree on ${c.start} → ${c.end}:\n` +
          `  ${PREMIUM_FN}: ${days(c.start, c.end)}\n` +
          `  ${QUOTE_FN}: ${other(c.start, c.end)}\n` +
          "  The first quotes, the second bills. Any gap is a customer shown one number\n" +
          "  and charged another.",
      ).toBe(days(c.start, c.end));
    }
  });
});

// ===========================================================================
// 3. rate × days — the totals
//
// EVERY NUMBER IN THESE TWO TABLES IS HAND-COMPUTED FROM THE RATE CARD ABOVE.
// None of it is derived at runtime. Worked examples:
//
//   CDW  26.95 × 5 = 134.75          all four, one day:
//   RCLI 23.18 × 5 = 115.90            26.95 + 23.18 + 20.18 + 6.90 = 77.21
//   SLI  20.18 × 5 = 100.90          all four, five days:
//   PAI   6.90 × 5 =  34.50            134.75 + 115.90 + 100.90 + 34.50 = 386.05
// ===========================================================================
const PER_COVERAGE: Record<Coverage, Record<number, number>> = {
  cdw: { 1: 26.95, 2: 53.9, 3: 80.85, 5: 134.75, 7: 188.65, 14: 377.3, 30: 808.5, 45: 1212.75 },
  rcli: { 1: 23.18, 2: 46.36, 3: 69.54, 5: 115.9, 7: 162.26, 14: 324.52, 30: 695.4, 45: 1043.1 },
  sli: { 1: 20.18, 2: 40.36, 3: 60.54, 5: 100.9, 7: 141.26, 14: 282.52, 30: 605.4, 45: 908.1 },
  pai: { 1: 6.9, 2: 13.8, 3: 20.7, 5: 34.5, 7: 48.3, 14: 96.6, 30: 207, 45: 310.5 },
};

const COMBINATIONS: { days: number; on: Coverage[]; total: number; why: string }[] = [
  { days: 5, on: ["cdw"], total: 134.75, why: "Ghulam's case: 'pehli wali insurance', five days" },
  { days: 5, on: ["cdw", "rcli", "sli", "pai"], total: 386.05, why: "all four at five days" },
  { days: 1, on: ["cdw", "rcli", "sli", "pai"], total: 77.21, why: "all four, the one-day floor" },
  { days: 3, on: ["cdw", "sli"], total: 141.39, why: "80.85 + 60.54" },
  { days: 5, on: ["cdw", "pai"], total: 169.25, why: "134.75 + 34.50" },
  { days: 7, on: ["rcli", "sli", "pai"], total: 351.82, why: "162.26 + 141.26 + 48.30" },
  { days: 7, on: ["cdw", "rcli", "sli", "pai"], total: 540.47, why: "a week of everything" },
  { days: 14, on: ["cdw", "rcli", "sli", "pai"], total: 1080.94, why: "a fortnight" },
  { days: 30, on: ["cdw", "rcli", "sli", "pai"], total: 2316.3, why: "the 30-day single-policy maximum" },
  { days: 45, on: ["cdw", "rcli", "sli", "pai"], total: 3474.45, why: "past the maximum — this one gets chunked" },
  { days: 5, on: [], total: 0, why: "no coverage selected costs nothing" },
];

describe("bonzah/premium-maths — rate × days", () => {
  for (const coverage of COVERAGES) {
    for (const [dayText, expected] of Object.entries(PER_COVERAGE[coverage])) {
      const days = Number(dayText);
      it(`${coverage.toUpperCase()} for ${days} day(s) is $${expected}`, () => {
        const { breakdown, total } = model.quote(days, select(coverage));
        expect(
          breakdown[coverage],
          `${coverage.toUpperCase()} × ${days} days is no longer $${expected}.\n` +
            `  shipped arithmetic returned ${breakdown[coverage]}\n` +
            `  hand-computed from the published card: ${PUBLISHED_RATES[coverage.toUpperCase()]} × ${days} = ${expected}\n` +
            "  Either the rate moved (the rate-card test above says so) or the\n" +
            "  multiplication did. Both are real money.",
        ).toBe(expected);

        // One coverage selected means the other three contribute nothing, and
        // the total is that one line. A total larger than its own breakdown is
        // a customer charged for cover they did not pick.
        expect(
          total,
          `Only ${coverage.toUpperCase()} was selected, but the total (${total}) is not its ` +
            `line (${breakdown[coverage]}). Something is being added that was not chosen.`,
        ).toBe(expected);
        for (const other of COVERAGES) {
          if (other === coverage) continue;
          expect(breakdown[other], `${other} was not selected but priced at ${breakdown[other]}`).toBe(0);
        }
      });
    }
  }

  for (const c of COMBINATIONS) {
    const label = c.on.length ? c.on.map((x) => x.toUpperCase()).join(" + ") : "nothing";
    it(`${label} for ${c.days} day(s) totals $${c.total} — ${c.why}`, () => {
      const { breakdown, total } = model.quote(c.days, select(...c.on));
      expect(
        total,
        `${label} × ${c.days} days no longer totals $${c.total}.\n` +
          `  shipped arithmetic: ${total}\n` +
          `  hand-computed:      ${c.total}   (${c.why})\n` +
          `  breakdown returned: ${JSON.stringify(breakdown)}\n` +
          "  This is the number the customer is charged for insurance.",
      ).toBe(c.total);

      // The total must be the sum of exactly the selected lines — it is
      // possible to get the total right while pricing the wrong coverage, and
      // the breakdown is what the booking widget itemises on screen.
      for (const coverage of COVERAGES) {
        const expected = c.on.includes(coverage) ? PER_COVERAGE[coverage][c.days] : 0;
        expect(
          breakdown[coverage],
          `The ${coverage.toUpperCase()} line is ${breakdown[coverage]} but should be ${expected} ` +
            `for this selection. The total can be right while the itemisation shown to the ` +
            `customer is wrong.`,
        ).toBe(expected);
      }
    });
  }

  it("bills the quote fallback at the same cent as the estimator", () => {
    // The estimator rounds each coverage line and then rounds the sum; the
    // fallback in bonzah-create-quote sums the four raw products and rounds
    // ONCE. Different order of operations, same money required — the customer
    // is shown the first number and billed the second.
    for (const c of COMBINATIONS) {
      const billed = fallback.premium(c.days, select(...c.on));
      expect(
        billed,
        `Quoted and billed disagree for ${c.on.join("+") || "nothing"} × ${c.days} days:\n` +
          `  shown to the customer  ${c.total}   (${model.file})\n` +
          `  written as the premium ${billed}   (${fallback.file}, the no-total_amount fallback)\n` +
          "  The estimator rounds per line then sums; the fallback sums then rounds once.\n" +
          "  They must still land on the same cent.",
      ).toBe(c.total);
    }
  });
});

// ===========================================================================
// 4. THE ROUNDING RULE
//
// Asserted, not assumed. Two independent ways, because each catches something
// the other cannot:
//
//   (a) a rate that only rounds correctly under Math.round — a PROBE rate is
//       pushed through the SHIPPED expression, which pins the direction of the
//       tie-break (half up) and rules out floor/trunc/toFixed-style banker's
//       rounding;
//   (b) a real rate whose float product is visibly not the decimal answer:
//       23.18 × 3 is 69.53999999999999 in IEEE 754, so a total of exactly 69.54
//       is only possible if the rounding actually ran.
// ===========================================================================
describe("bonzah/premium-maths — the rounding rule", () => {
  it("rounds to the cent, half UP (Math.round), not down and not to even", () => {
    const line = model.lines[0];
    const probe = { [line.ratesKey]: 0.005 };
    expect(
      line.evaluate(probe, 1, true),
      "The cent-rounding rule changed.\n" +
        `  expression: ${line.expr}\n` +
        "  half a cent (0.005 × 1 day) must round UP to 0.01.\n" +
        "  0    means it now truncates or floors — every premium loses up to a cent.\n" +
        "  0.005 means the rounding was removed entirely and raw float noise is being\n" +
        "        billed (see the next case).",
    ).toBe(0.01);

    // Two and a half cents, to rule out a rule that only happens to be right at
    // one value. Half up again: 0.025 -> 0.03, not 0.02.
    expect(
      line.evaluate({ [line.ratesKey]: 0.005 }, 5, true),
      "0.005 × 5 days = 0.025, which must round half-up to 0.03.",
    ).toBe(0.03);
  });

  it("actually applies the rounding — 3 days of RCLI is 69.54, not 69.53999999999999", () => {
    // 23.18 * 3 === 69.53999999999999 in IEEE 754 double arithmetic. This
    // assertion is strict equality against the decimal answer, so it can only
    // pass if the shipped Math.round(x * 100) / 100 ran.
    const { total } = model.quote(3, select("rcli"));
    expect(
      total,
      "Three days of RCLI came back as raw float arithmetic instead of a rounded cent.\n" +
        `  got ${total}, expected 69.54\n` +
        "  23.18 × 3 is 69.53999999999999 as a double. Unrounded, that reaches Stripe as\n" +
        "  a charge amount and the ledger as a premium, and every downstream comparison\n" +
        "  against 69.54 fails.",
    ).toBe(69.54);

    // Same story on PAI: 6.9 * 3 === 20.700000000000003.
    expect(model.quote(3, select("pai")).total, "6.90 × 3 must be exactly 20.7").toBe(20.7);
  });

  it("rounds the total as well as each line", () => {
    expect(
      model.totalExpr,
      "The line that sums the four coverage premiums no longer rounds.\n" +
        `  ${model.totalExpr}\n` +
        "  Four rounded lines can still add up to a float with a tail; the total is what " +
        "  is charged.",
    ).toMatch(/Math\.round\([^\n]*\*\s*100\s*\)\s*\/\s*100/);

    const { total } = model.quote(3, select("cdw", "rcli", "sli", "pai"));
    expect(total, "All four at 3 days must be exactly 231.63").toBe(231.63);
  });

  it("rounds the amount Bonzah itself returns before storing it as the premium", () => {
    // The OTHER branch of bonzah-create-quote: when Bonzah does send
    // total_amount, that figure is the binding one and the fallback never runs
    // — but it still has to land on a cent before it becomes
    // premium_amount, rentals.insurance_premium and a Stripe charge.
    const src = blankComments(readEdgeFunctionSource(QUOTE_FN));
    expect(
      src,
      "bonzah-create-quote no longer rounds Bonzah's own total_amount to the cent.\n" +
        "  That number is stored as premium_amount and charged; a third-party float with a\n" +
        "  tail on it reaches Stripe and every later comparison against the stored premium.",
    ).toMatch(/Math\.round\(\s*response\.data\.total_amount\s*\*\s*100\s*\)\s*\/\s*100/);

    // And the fallback's own rounding, which is the branch this file exercises.
    expect(fallback.roundExpr, "The fallback's rounding expression went missing").toMatch(/Math\.round/);
  });
});

// ===========================================================================
// 5. 30-DAY CHUNKING MUST NOT CHANGE THE PRICE
//
// Bonzah will not write a policy longer than 30 days, so bonzah-create-quote
// splits a longer rental into consecutive chunks and issues one policy each.
// Whatever that split does, the customer must pay for the same number of
// insured days: a chunk boundary that drops or double-counts a day is money.
// ===========================================================================
describe("bonzah/premium-maths — 30-day chunking is premium-neutral", () => {
  const split = liftSplitDateRange().call;
  const days = liftCalculateDays(QUOTE_FN).call;

  const RANGES: { start: string; end: string; days: number; chunks: number }[] = [
    { start: "2026-03-06", end: "2026-03-11", days: 5, chunks: 1 },
    { start: "2026-03-06", end: "2026-04-05", days: 30, chunks: 1 },
    { start: "2026-03-06", end: "2026-04-06", days: 31, chunks: 2 },
    { start: "2026-03-06", end: "2026-05-15", days: 70, chunks: 3 },
    { start: "2026-01-01", end: "2026-12-31", days: 364, chunks: 13 },
  ];

  for (const r of RANGES) {
    it(`${r.start} → ${r.end} (${r.days} days) splits into ${r.chunks} policy(ies) covering every day once`, () => {
      const chunks = split(r.start, r.end);
      expect(
        chunks.length,
        `The 30-day split of ${r.start} → ${r.end} produced ${chunks.length} chunk(s), not ${r.chunks}.\n` +
          "  Each chunk is one Bonzah policy and one draw on the operator's Bonzah balance.",
      ).toBe(r.chunks);

      // Contiguous: each chunk starts where the last ended. A gap is an
      // uninsured day the customer paid nothing for and has no cover on; an
      // overlap is a day billed twice.
      for (let i = 1; i < chunks.length; i += 1) {
        expect(
          chunks[i].start,
          `Chunk ${i + 1} starts at ${chunks[i].start} but chunk ${i} ended at ${chunks[i - 1].end}.\n` +
            "  A gap leaves an uninsured day inside a paid-for rental; an overlap bills one\n" +
            "  day of cover twice against the Bonzah balance.",
        ).toBe(chunks[i - 1].end);
      }

      const chunkDays = chunks.reduce((sum, c) => sum + days(c.start, c.end), 0);
      expect(
        chunkDays,
        `The chunks cover ${chunkDays} insured days but the rental is ${r.days}.\n` +
          "  Bonzah is billed per 24h period per policy, so this difference is charged\n" +
          "  to the operator's Bonzah balance and passed on to the customer.",
      ).toBe(r.days);
    });
  }

  it("prices a chunked rental exactly as if one policy could cover it", () => {
    // The customer sees ONE estimate from bonzah-calculate-premium for the
    // whole trip; bonzah-create-quote then buys several policies and adds them
    // up. Those two numbers have to agree or the quote was a lie.
    for (const r of RANGES) {
      const oneShot = model.quote(r.days, select("cdw", "rcli", "sli", "pai")).total;
      const chunked =
        Math.round(
          split(r.start, r.end).reduce(
            (sum, c) => sum + fallback.premium(days(c.start, c.end), select("cdw", "rcli", "sli", "pai")),
            0,
          ) * 100,
        ) / 100;
      expect(
        chunked,
        `Chunking changed the price of ${r.start} → ${r.end}:\n` +
          `  quoted to the customer as one trip  ${oneShot}\n` +
          `  billed as ${r.chunks} chunked policies  ${chunked}\n` +
          "  The estimator never chunks, so the customer is quoted the one-shot figure and\n" +
          "  the operator's balance is drawn down by the chunked one.",
      ).toBe(oneShot);
    }
  });

  it("returns no chunks at all for a window that collapsed to a single day", () => {
    // This is what the "must be added before the trip's last day" 400 in
    // bonzah-create-quote is guarding: after the Pacific-tomorrow clamp, a
    // rental ending today or tomorrow has no insurable window left. Zero chunks
    // means zero policies, and without the guard the function would answer 200
    // with a null policy id — a success for something that never happened.
    expect(
      split("2026-03-06", "2026-03-06"),
      "A zero-length window now produces chunks. Each chunk is a real Bonzah policy, " +
        "so this would sell cover for a trip with no insurable days left.",
    ).toEqual([]);
  });

  it("places the chunk boundaries on the requested calendar dates (UTC runtimes only)", (ctx) => {
    // splitDateRange builds its dates with `new Date('YYYY-MM-DDT00:00:00')` —
    // LOCAL midnight — and reads them back with `toISOString()`, which is UTC.
    // The two only agree at offset 0. Supabase Edge Functions run in UTC, so
    // this is correct in production; on a developer machine east of UTC every
    // boundary comes back a day early.
    //
    // The invariants above (contiguity, day count, premium) hold in EVERY
    // timezone and are asserted unconditionally. Only this exact-date check is
    // runtime-dependent, so it is skipped rather than made to lie.
    if (!runningInUtc()) {
      ctx.skip(
        `This process is at UTC${-new Date().getTimezoneOffset() / 60}, not UTC. splitDateRange ` +
          "mixes local-midnight construction with toISOString(), so its literal chunk dates " +
          "are only the requested ones at offset 0 — which is what the deployed Deno runtime " +
          "is. Run with TZ=UTC to assert them. The premium-neutrality cases above ran.",
      );
      return;
    }
    const chunks = split("2026-03-06", "2026-05-15");
    expect(chunks[0].start, "The first chunk no longer starts on the requested trip start").toBe("2026-03-06");
    expect(chunks[chunks.length - 1].end, "The last chunk no longer ends on the requested trip end").toBe("2026-05-15");
  });
});
