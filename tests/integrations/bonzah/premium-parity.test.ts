// =============================================================================
// integrations/bonzah — PREMIUM PARITY (B): DO WE AGREE WITH BONZAH?
//
// LAYER 2 for the cases that call out; LAYER 1 for the guard that keeps them in
// the sandbox. Nothing here contacts anything on a default run.
//
// WHAT THIS FILE PROVES, AND WHY premium-maths.test.ts CANNOT
// -----------------------------------------------------------
// `premium-maths.test.ts` proves the app agrees with ITSELF: rate × days, the
// rounding, the day count, the two copies of the rate card. Every one of those
// assertions still passes on the day Bonzah reprices CDW from $26.95 to $28.95
// — the app would be perfectly self-consistent and quoting last year's price to
// every customer, and the operator would eat the difference on every policy.
//
// THIS file is the one that catches a STALE RATE CARD. It asks Bonzah's SANDBOX
// for a real quote over a known window and compares Bonzah's own binding figure
// with the estimate our rate card produces for the same days and coverages.
//
//     premium-maths.test.ts    we agree with OURSELVES     (always runs)
//     premium-parity.test.ts   we agree with BONZAH        (this file, opt-in)
//
// Neither substitutes for the other. Self-consistency with a wrong number is
// still wrong; agreement with Bonzah on one window says nothing about whether
// the multiplication holds at 30 days or across a DST boundary.
//
// THE CODE'S OWN COMMENT IS THE WHOLE ARGUMENT
// --------------------------------------------
//   "Bonzah prices strictly per 24h with no multi-day/monthly discount, so the
//    estimate is rate × days; THE BINDING AMOUNT STILL COMES FROM THE QUOTE API."
//
// Two claims. `premium-maths.test.ts` checks the first. This file checks the
// second, and checks that the two land on the same number.
//
// WHAT IT COSTS TO RUN, AND WHAT IT DOES NOT DO
// ---------------------------------------------
// A quote is not a payment. `/Bonzah/quote` with `finalize: 1` reserves a
// payment_id and spends NOTHING; the balance is only drawn down by
// `/Bonzah/payment`, which this file never calls. So the cases here sit behind
// D247_LIVE_TESTS + D247_LIVE_ALLOW_WRITES — writes, because they do leave quote
// records at a third party — and NOT behind money movement.
//
// bonzah-confirm-payment is the one that buys. It lives in `functional.test.ts`,
// behind D247_LIVE_ALLOW_MONEY_MOVEMENT + D247_LIVE_BONZAH_MODE=test, and it is
// skipped by default: "Bonzah ki real payments toh test cases mein karenge hi
// nahi."
// =============================================================================

import { describe, expect, it } from "vitest";
import { classifyLive, liveCall } from "../../helpers/live-call";
import { readPremiumModel } from "./rate-card";
import {
  assertBonzahSandboxUrl,
  BONZAH_LIVE_HOST,
  BONZAH_LIVE_URL,
  BONZAH_SANDBOX_HOST,
  BONZAH_SANDBOX_URL,
  BonzahLiveTargetError,
  bonzahFixtureOrNull,
  bonzahSandboxGate,
  bonzahSandboxQuote,
  buildSandboxQuoteBody,
  readQuoteCommonFieldKeys,
  sandboxTripWindow,
} from "./sandbox";

const model = readPremiumModel();

/** Five days — Ghulam's window, with the rate card's real numbers. */
const PARITY_DAYS = 5;
const PARITY_STATE = "Florida";

const PARITY_CASES: { label: string; coverage: Record<string, boolean> }[] = [
  { label: "CDW alone", coverage: { cdw: true, rcli: false, sli: false, pai: false } },
  { label: "RCLI alone", coverage: { cdw: false, rcli: true, sli: false, pai: false } },
  { label: "SLI alone", coverage: { cdw: false, rcli: false, sli: true, pai: false } },
  { label: "PAI alone", coverage: { cdw: false, rcli: false, sli: false, pai: true } },
  { label: "all four", coverage: { cdw: true, rcli: true, sli: true, pai: true } },
];

/**
 * One coverage at a time, deliberately.
 *
 * An all-four comparison can be green while two rates are wrong in opposite
 * directions. Isolating each coverage is what makes a failure name the rate
 * that moved instead of just "the total is off by $4.20".
 */

// ===========================================================================
// LAYER 1 — the sandbox refusal, and the shape of the request.
//
// These always run. They are the reason the Layer 2 cases below are safe to
// enable: the guard is asserted offline, before anybody turns the flags on.
// ===========================================================================
describe("bonzah/premium-parity — the sandbox-only guard (Layer 1)", () => {
  it("knows the two Bonzah worlds from the shipped client, not from a retyped constant", () => {
    // Lifted out of getBonzahApiUrl in _shared/bonzah-client.ts. If someone
    // repoints the sandbox, the guard follows automatically instead of guarding
    // a hostname that no longer exists.
    expect(
      BONZAH_SANDBOX_URL,
      "getBonzahApiUrl('test') no longer returns the Insillion sandbox. Every live case " +
        "in this folder is pointed by that function, so this is where a mis-pointed " +
        "sandbox would first show up.",
    ).toBe("https://bonzah.sb.insillion.com/api/v1");
    expect(BONZAH_LIVE_URL, "getBonzahApiUrl('live') no longer returns the production API").toBe(
      "https://bonzah.insillion.com/api/v1",
    );
    expect(
      BONZAH_SANDBOX_HOST === BONZAH_LIVE_HOST,
      "The sandbox and live Bonzah hosts are now the same string. Every 'sandbox only' " +
        "guarantee in this folder collapses, because the guard cannot tell them apart.",
    ).toBe(false);
  });

  it("accepts the sandbox", () => {
    expect(assertBonzahSandboxUrl(BONZAH_SANDBOX_URL)).toBe(BONZAH_SANDBOX_URL);
    expect(assertBonzahSandboxUrl(`${BONZAH_SANDBOX_URL}/`)).toBe(BONZAH_SANDBOX_URL);
  });

  it("refuses Bonzah's live API, with no override", () => {
    expect(
      () => assertBonzahSandboxUrl(BONZAH_LIVE_URL),
      "The live-API refusal is gone. Every live case in this folder would then be able " +
        'to issue real insurance to real renters — "sandbox mein hi" is the instruction ' +
        "this guard implements.",
    ).toThrow(BonzahLiveTargetError);
    expect(() => assertBonzahSandboxUrl(BONZAH_LIVE_URL)).toThrow(/REFUSING TO CALL BONZAH'S LIVE/);
  });

  it("refuses a host that merely looks like the sandbox", () => {
    // Exact hostname equality, so none of these get through:
    for (const url of [
      "https://bonzah.sb.insillion.com.evil.test/api/v1", // suffix attack
      "https://sb.bonzah.insillion.com/api/v1", // labels reordered
      "https://bonzah.insillion.com/api/v1/../sb", // path games
      "https://proxy.internal/bonzah.sb.insillion.com/api/v1", // host in the path
    ]) {
      expect(
        () => assertBonzahSandboxUrl(url),
        `"${url}" was accepted as the Bonzah sandbox. A substring check would have let ` +
          "it through; only exact hostname equality does not.",
      ).toThrow(BonzahLiveTargetError);
    }
  });

  it("refuses something that is not a URL at all rather than assuming it is safe", () => {
    expect(() => assertBonzahSandboxUrl("bonzah.sb.insillion.com")).toThrow(BonzahLiveTargetError);
    expect(() => assertBonzahSandboxUrl("")).toThrow(BonzahLiveTargetError);
  });

  it("sends the same fields to /Bonzah/quote that bonzah-create-quote sends", () => {
    // The parity case talks to Bonzah directly, so there is no production code
    // path for it to borrow — it builds the request itself. Deriving the
    // expected KEY LIST from the deployed function is what stops that
    // hand-built request from quietly stopping to resemble production's: price
    // a different request and you have measured a different thing.
    const production = new Set(readQuoteCommonFieldKeys());
    const ours = new Set(
      Object.keys(buildSandboxQuoteBody({
        tripStart: "01/01/2027 15:00:00",
        tripEnd: "01/06/2027 15:00:00",
        pickupStateFull: PARITY_STATE,
        coverage: { cdw: true, rcli: true, sli: true, pai: true },
      })),
    );

    // The trip dates are the only fields production adds per chunk rather than
    // in `commonFields`; everything else must line up in both directions.
    ours.delete("trip_start_date");
    ours.delete("trip_end_date");

    const missing = [...production].filter((k) => !ours.has(k)).sort();
    const extra = [...ours].filter((k) => !production.has(k)).sort();

    expect(
      { missing, extra },
      "The parity request no longer matches what bonzah-create-quote sends to Bonzah.\n" +
        `  production sends but this test omits: ${missing.join(", ") || "(none)"}\n` +
        `  this test sends but production does not: ${extra.join(", ") || "(none)"}\n` +
        "\n" +
        "  WHICH SIDE MOVED: bonzah-create-quote's `commonFields`, almost certainly —\n" +
        "  this list is derived from it, not typed out here. Bonzah rates on what it is\n" +
        "  sent, so a parity test that sends a different request is comparing a price\n" +
        "  nobody is ever quoted.\n" +
        "\n" +
        "  THIS IS FAILURE MODE (a). Nothing is broken for an operator; update\n" +
        "  buildSandboxQuoteBody in tests/integrations/bonzah/sandbox.ts to match.",
    ).toEqual({ missing: [], extra: [] });
  });
});

// ===========================================================================
// LAYER 2 — the actual parity check.
//
// WHAT EACH CASE DOES IF ENABLED:
//
//   "live: Bonzah's own quote for <coverage> over 5 days agrees with our rate card"
//       Authenticates against bonzah.sb.insillion.com and POSTs one
//       /Bonzah/quote with finalize: 1. Creates a quote record at Bonzah.
//       Spends nothing. Needs D247_LIVE_TESTS=1 + D247_LIVE_ALLOW_WRITES=1 and
//       the sandbox credentials.
//
//   "live: the deployed bonzah-create-quote returns the same premium"
//       The production path, end to end, through our own edge function. Writes
//       a bonzah_insurance_policies row and touches the rental. Needs the same
//       flags plus rental/customer/tenant fixtures.
//
// NEITHER buys a policy. See functional.test.ts for the one that does.
// ===========================================================================
describe("bonzah/premium-parity — live against Bonzah's sandbox (Layer 2)", () => {
  for (const c of PARITY_CASES) {
    it(`live: Bonzah's own quote for ${c.label} over ${PARITY_DAYS} days agrees with our rate card`, async (ctx) => {
      const gate = bonzahSandboxGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }

      const window = sandboxTripWindow(PARITY_DAYS);
      const quote = await bonzahSandboxQuote(gate.credentials, {
        tripStart: window.start,
        tripEnd: window.end,
        pickupStateFull: PARITY_STATE,
        coverage: c.coverage as { cdw: boolean; rcli: boolean; sli: boolean; pai: boolean },
      });

      expect(
        quote.status,
        `Bonzah's sandbox refused the quote (status ${quote.status}, "${quote.txt ?? ""}").\n` +
          `  ${quote.url}\n` +
          `  window: ${window.start} → ${window.end}, ${PARITY_STATE}, ${c.label}\n` +
          "  FAILURE MODE (b) for the INTEGRATION, not for our arithmetic: no number came\n" +
          "  back, so nothing was compared. Usual causes are stale sandbox credentials,\n" +
          "  a start date Bonzah considers today in America/Los_Angeles, or an\n" +
          "  underwriting rule that rejects this coverage combination outright.",
      ).toBe(0);

      expect(
        quote.totalAmount,
        "Bonzah accepted the quote but returned no `total_amount`.\n" +
          `  raw: ${JSON.stringify(quote.raw).slice(0, 400)}\n` +
          "  This is exactly the case bonzah-create-quote's fallback exists for — and it\n" +
          "  means this run cannot prove parity, because there is no Bonzah number to\n" +
          "  compare against. Do not read a green bar here as agreement.",
      ).not.toBeNull();

      const ours = model.quote(PARITY_DAYS, c.coverage).total;
      const theirs = Number(quote.totalAmount);
      const delta = Math.round((theirs - ours) * 100) / 100;

      expect(
        theirs,
        [
          "",
          `BONZAH AND OUR RATE CARD DISAGREE — ${c.label}, ${PARITY_DAYS} days, ${PARITY_STATE}`,
          "",
          `  OUR ESTIMATE   ${ours.toFixed(2)}`,
          `    from  ${model.file}  (const RATES × ${PARITY_DAYS} days)`,
          `    rates ${JSON.stringify(model.card.rates)}`,
          "",
          `  BONZAH'S QUOTE ${theirs.toFixed(2)}`,
          `    from  POST ${quote.url}  ->  data.total_amount`,
          `    quote ${quote.quoteId ?? "(none)"}  window ${window.start} → ${window.end}`,
          "",
          `  DIFFERENCE     ${delta > 0 ? "+" : ""}${delta.toFixed(2)}  over ${PARITY_DAYS} days`,
          `                 ${(delta / PARITY_DAYS > 0 ? "+" : "") + (delta / PARITY_DAYS).toFixed(4)} per 24h`,
          "",
          "  WHICH SIDE MOVED:",
          "",
          "  A STALE RATE CARD is the likely one, and it is the reason this file exists.",
          "  Bonzah repriced and the two `const RATES` tables in supabase/functions/",
          "  bonzah-calculate-premium and bonzah-create-quote were not updated. Every",
          "  customer is being quoted the old price; the operator absorbs the difference",
          "  on every policy sold since the change. Check the per-24h figure above",
          "  against Bonzah's current card, update BOTH tables, then update the",
          "  hand-worked totals in premium-maths.test.ts — they were computed from the",
          "  old numbers and are now wrong too.",
          "",
          "  A BROKEN CALCULATION is the other reading, and premium-maths.test.ts tells",
          "  you which: if it is green, rate × days is still being done correctly and only",
          "  the rate is stale. If it is ALSO red, the arithmetic moved and the rate card",
          "  is innocent.",
          "",
          "  A DIFFERENT REQUEST is the third. Bonzah rates on pickup state, dates and",
          "  coverage; the Layer 1 case above asserts this request still carries the same",
          "  fields bonzah-create-quote sends, so check that it passed before assuming a",
          "  reprice.",
          "",
        ].join("\n"),
      ).toBe(ours);
    });
  }

  it("live: the deployed bonzah-create-quote returns the same premium our rate card does", async (ctx) => {
    const gate = bonzahSandboxGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }

    const rentalId = bonzahFixtureOrNull("D247_LIVE_BONZAH_RENTAL_ID");
    const customerId = bonzahFixtureOrNull("D247_LIVE_BONZAH_CUSTOMER_ID");
    const tenantId = bonzahFixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    if (!rentalId || !customerId || !tenantId) {
      ctx.skip(
        "D247_LIVE_BONZAH_RENTAL_ID / _CUSTOMER_ID / _TENANT_ID are not all set. This " +
          "case goes through our own deployed function, so it needs real rows to hang a " +
          "policy off. It also needs that tenant to have bonzah_sandbox_override = true: " +
          "getBonzahSellability refuses every test-mode sale without it, deliberately, " +
          "and would answer 403 rather than a premium.",
      );
      return;
    }

    // Dates in YYYY-MM-DD, which is what CreateQuoteRequest.trip_dates takes —
    // the function does its own Pacific clamp and MM/DD/YYYY formatting.
    const iso = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const coverage = { cdw: true, rcli: true, sli: true, pai: true };

    const res = await liveCall("bonzah-create-quote", {
      rental_id: rentalId,
      customer_id: customerId,
      tenant_id: tenantId,
      trip_dates: { start: iso(2), end: iso(2 + PARITY_DAYS) },
      pickup_state: "FL",
      coverage,
      renter: {
        first_name: "Drive247",
        last_name: "SpineSuite",
        dob: "1990-01-01",
        email: "spine-suite@drive-247.invalid",
        phone: "10000000000",
        address: { street: "123 Main St", city: "Miami", state: "FL", zip: "33101" },
        license: { number: "N/A", state: "FL" },
      },
      // The rental may already carry a policy from an earlier pass; this case
      // is about the PRICE, and the duplicate guard is asserted separately in
      // functional.test.ts.
      force_duplicate: true,
    });

    expect(
      res.status,
      "bonzah-create-quote did not return 200.\n" +
        `  ${res.status}: ${res.text.slice(0, 400)}\n` +
        "  A 403 means getBonzahSellability refused a test-mode sale — set\n" +
        "  bonzah_sandbox_override on the fixture tenant. A 409 means the duplicate guard\n" +
        "  fired despite force_duplicate. Otherwise: " +
        classifyLive(res).explain,
    ).toBe(200);

    const ours = model.quote(PARITY_DAYS, coverage).total;
    expect(
      Number(res.json?.total_premium),
      [
        "",
        "THE DEPLOYED QUOTE FUNCTION AND OUR RATE CARD DISAGREE",
        "",
        `  OUR ESTIMATE            ${ours.toFixed(2)}   (${model.file}, all four × ${PARITY_DAYS} days)`,
        `  bonzah-create-quote     ${res.json?.total_premium}   (total_premium, ${res.json?.policy_count} policy/policies)`,
        "",
        "  READ THIS ONE CAREFULLY. bonzah-create-quote reports ONE number and does not",
        "  say where it came from: `total_amount` when Bonzah finalized a figure, and",
        "  OUR OWN rate card when it did not. So equality here is agreement OR the",
        "  fallback agreeing with itself, and this test cannot tell which. The",
        "  per-coverage cases above talk to Bonzah directly and can.",
        "",
        "  A DIFFERENCE, on the other hand, is unambiguous and is real: Bonzah quoted a",
        "  binding amount that our estimator would not have shown the customer. Whatever",
        "  is stored as premium_amount is what the operator's balance is charged.",
        "",
      ].join("\n"),
    ).toBe(ours);
  });
});
