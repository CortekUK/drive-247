// =============================================================================
// integrations/bonzah — FUNCTIONAL.
//
// The other half of the split Ghulam drew this morning: "FUNCTIONAL test hai,
// aur phir MATHS wale test hain". The maths lives in `premium-maths.test.ts` and
// `balance-maths.test.ts`; this file is the payloads, the guards and the order
// they run in — everything that decides WHETHER a policy is sold, as opposed to
// what it costs.
//
// SIX SURFACES, and why each is in scope:
//
//   bonzah-calculate-premium          what the customer is quoted
//   bonzah-create-quote               what is actually bought
//   bonzah-check-vehicle-eligibility  whether the car can be insured at all
//   bonzah-confirm-payment            the one that SPENDS the balance
//   bonzah-get-balance                whether there is anything left to spend
//   _shared/bonzah-client.ts          the credentials, the hosts, and the two
//                                     pure helpers that have each already cost
//                                     a real policy
//
// TWO LAYERS, as everywhere in this suite:
//
//   LAYER 1  contract + guard-ORDER, derived from the functions' own source.
//            No network, no env, always runs. Several of the cases assert that
//            a guard sits ABOVE the call it guards, because a sell-check placed
//            after the sale is not a check.
//   LAYER 2  live. Skipped unless enabled. The read-only probe needs only
//            D247_LIVE_TESTS; bonzah-get-balance needs writes because it can
//            create reminders and send an operator an email; and
//            bonzah-confirm-payment needs the full ladder because it buys.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  assertContract,
  blankComments,
  readEdgeFunction,
  readEdgeFunctionSource,
  type PayloadContract,
} from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus, liveWritesAllowed } from "../../helpers/live-call";
import { liftSharedClient, localIsUtcOrEast, readPremiumModel, readSharedClientSource } from "./rate-card";
import {
  BONZAH_LIVE_HOST,
  BONZAH_SANDBOX_HOST,
  bonzahFixtureOrNull,
  bonzahMoneyGate,
  bonzahMoneyMovementRequested,
} from "./sandbox";

/** Source with prose blanked, so a field named in a comment is never a field. */
const source = (fn: string) => blankComments(readEdgeFunctionSource(fn));

/**
 * Not a spine step — this folder runs independently of the 01..05 chain (see
 * tests/README.md §8). The field is only ever printed inside a drift message.
 */
const AT = "integrations/bonzah";

// ===========================================================================
// 1. bonzah-calculate-premium — the estimate the customer sees
// ===========================================================================
const PREMIUM_CONTRACT: PayloadContract = {
  step: AT,
  fn: "bonzah-calculate-premium",
  // Byte-identical bodies are built in apps/portal/src/hooks/use-bonzah-premium.ts.
  // Both apps poll this on every checkbox tick, debounced.
  builtIn: "apps/booking/src/hooks/useBonzahPremium.ts",
  payload: {
    trip_start_date: "2026-03-01",
    trip_end_date: "2026-03-06",
    pickup_state: "FL",
    cdw_cover: true,
    rcli_cover: false,
    sli_cover: false,
    pai_cover: false,
  },
};

describe("bonzah/functional — bonzah-calculate-premium", () => {
  it("agrees with the payload both booking widgets build", () => {
    const shape = assertContract(PREMIUM_CONTRACT);
    expect(shape.fields.length, `Parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
    expect(shape.typeName).toBe("CalculatePremiumRequest");
  });

  it("still requires the trip window", () => {
    // Without dates there is no day count, and a premium with no day count is
    // a number with no meaning behind it.
    const src = source("bonzah-calculate-premium");
    expect(
      src,
      "The required-field check on trip_start_date / trip_end_date / pickup_state is " +
        "gone. Missing dates would fall through to calculateDays(undefined, undefined), " +
        "whose NaN arithmetic ends at Math.max(NaN, 1) — a silent one-day premium for a " +
        "three-week rental.",
    ).toMatch(/Missing required fields[^\n]*trip_start_date/);
  });

  it("returns a zero premium with a full zero breakdown when nothing is selected", () => {
    // The booking widget renders `breakdown.cdw` etc. directly. A bare
    // `{ total_premium: 0 }` would render four `undefined`s where the prices go.
    const src = source("bonzah-calculate-premium");
    const noCoverageAt = src.indexOf("hasCoverage");
    // The CALL, not the declaration — calculateDays is defined above the handler.
    const daysAt = src.indexOf("calculateDays(body.");
    expect(noCoverageAt, "The no-coverage-selected short circuit is gone").toBeGreaterThan(-1);
    expect(
      src,
      "The zero-premium response no longer carries a full breakdown. Both selectors read " +
        "breakdown.cdw / .rcli / .sli / .pai unconditionally.",
    ).toMatch(/breakdown:\s*\{\s*cdw:\s*0,\s*rcli:\s*0,\s*sli:\s*0,\s*pai:\s*0\s*\}/);

    // The short circuit must come before the day count: it is the only path
    // that answers without needing a valid window at all.
    expect(
      noCoverageAt < daysAt,
      "The no-coverage short circuit moved below calculateDays(). Harmless today, but it " +
        "is what lets the widget ask for a premium before a date is chosen.",
    ).toBe(true);
  });

  it("itemises exactly the four coverages the UI renders", () => {
    const model = readPremiumModel();
    expect(
      model.lines.map((l) => l.shortKey),
      "The response breakdown keys changed. Both insurance selectors and " +
        "lib/coverage-labels.ts read cdw / rcli / sli / pai by name.",
    ).toEqual(["cdw", "rcli", "sli", "pai"]);
  });

  it("takes a pickup_state it does not price on — and still demands it", () => {
    // KNOWN GAP, asserted so it stays visible rather than being discovered
    // again: Bonzah rates on pickup state, and this estimator does not. The
    // field is required, logged, and then unused by the arithmetic, so the
    // customer's estimate is state-blind while the binding quote is not.
    // `premium-parity.test.ts` is what would surface the size of that gap.
    const shape = readEdgeFunction("bonzah-calculate-premium");
    expect(
      shape.requiredByType,
      "pickup_state is no longer part of the estimate request. It is currently unused by " +
        "the arithmetic, but it is the field that would carry state-based rating if the " +
        "rate card ever gains one — dropping it from the wire is the harder half to undo.",
    ).toContain("pickup_state");

    const model = readPremiumModel();
    const pricesOnState = model.lines.some((l) => /pickup_state/.test(l.expr));
    expect(
      pricesOnState,
      "bonzah-calculate-premium now prices on pickup_state. That is a change worth " +
        "wanting — but premium-maths.test.ts's hand-worked totals were computed with no " +
        "state in them and are now incomplete, and premium-parity.test.ts quotes Florida.",
    ).toBe(false);
  });
});

// ===========================================================================
// 2. bonzah-create-quote — the one that commits
// ===========================================================================
const QUOTE_CONTRACT: PayloadContract = {
  step: AT,
  fn: "bonzah-create-quote",
  builtIn: "apps/portal/src/components/rentals/buy-insurance-dialog.tsx",
  payload: {
    rental_id: "00000000-0000-0000-0000-000000000000",
    customer_id: "00000000-0000-0000-0000-000000000000",
    tenant_id: "00000000-0000-0000-0000-000000000000",
    trip_dates: { start: "2026-03-01", end: "2026-03-06" },
    pickup_state: "FL",
    coverage: { cdw: true, rcli: true, sli: false, pai: false },
    renter: {
      first_name: "A",
      last_name: "B",
      dob: "1990-01-01",
      email: "a@b.invalid",
      phone: "10000000000",
      address: { street: "1 St", city: "Miami", state: "FL", zip: "33101" },
      license: { number: "N/A", state: "FL" },
    },
    // The dialog spreads these in conditionally; the KEY is still part of the
    // contract, because the dialog is what decides per purchase whether to send
    // it. Excusing a field the caller demonstrably sends is the stale excuse
    // tests/README.md §9 warns about.
    policy_type: "extension",
    extension_id: "00000000-0000-0000-0000-000000000000",
    force_duplicate: true,
  },
};

describe("bonzah/functional — bonzah-create-quote", () => {
  it("agrees with the portal's buy-insurance payload", () => {
    const shape = assertContract(QUOTE_CONTRACT);
    expect(shape.typeName).toBe("CreateQuoteRequest");
    expect(shape.requiredByType).toEqual(
      ["coverage", "customer_id", "pickup_state", "rental_id", "renter", "tenant_id", "trip_dates"],
    );
  });

  it("checks whether this tenant may SELL before it does any Bonzah work", () => {
    // The single most expensive ordering in this integration. In test mode the
    // policy is issued in Bonzah's sandbox and is NOT real cover, while
    // stripe_mode is independent — so the customer can still be charged real
    // money for nothing. getBonzahSellability's own header records that this
    // has already shipped sandbox policies to real renters.
    const src = source("bonzah-create-quote");
    const sellAt = src.indexOf("getBonzahSellability(supabase");
    const credsAt = src.indexOf("getTenantBonzahCredentials(supabase");
    const quoteAt = src.indexOf("createSingleQuote(chunk");

    expect(sellAt, "bonzah-create-quote no longer calls getBonzahSellability at all.").toBeGreaterThan(-1);
    expect(quoteAt, "bonzah-create-quote no longer creates any quote.").toBeGreaterThan(-1);
    expect(
      sellAt < credsAt && sellAt < quoteAt,
      "The sellability check has moved BELOW the Bonzah credentials or below the quote " +
        "call.\n" +
        `  sellability@${sellAt}  credentials@${credsAt}  quote@${quoteAt}\n` +
        "  A sell-check that runs after the sale is a log line. Nothing in this repository\n" +
        "  can cancel a policy Bonzah has already issued, and the customer's card has\n" +
        "  already been charged by then.",
    ).toBe(true);
  });

  it("refuses a collapsed window instead of answering 200 with no policy", () => {
    // Bonzah will not insure today, so the start is clamped to Pacific-tomorrow.
    // A rental that ends today or tomorrow collapses to zero chunks, and without
    // this guard the function returns 200 with a null policy_record_id — which
    // the UI reads as "Quote created. Complete it from the rental page." GoNiko
    // was billed $26.95 for a policy that never existed, exactly that way.
    const src = source("bonzah-create-quote");
    const guardAt = src.indexOf("chunks.length === 0");
    const loopAt = src.indexOf("createSingleQuote(chunk");
    expect(guardAt, "The zero-chunk guard is gone — a collapsed window would 200 with no policy.").toBeGreaterThan(-1);
    expect(guardAt < loopAt, "The zero-chunk guard moved below the quote loop.").toBe(true);
    expect(
      src,
      "The zero-chunk refusal no longer tells the operator what to do instead. It is the " +
        "message that stops the same rental being retried until someone pays for a policy " +
        "that cannot exist.",
    ).toMatch(/before the trip's last day/);
  });

  it("blocks a second policy over the same dates unless it is explicitly forced", () => {
    // Two operators on one rental, or one retrying after a confusing attempt,
    // otherwise charge the Bonzah balance twice for cover needed once.
    const src = source("bonzah-create-quote");
    const dupAt = src.indexOf("!body.force_duplicate");
    const quoteAt = src.indexOf("createSingleQuote(chunk");
    expect(dupAt, "The duplicate-policy guard is gone.").toBeGreaterThan(-1);
    expect(
      dupAt < quoteAt,
      "The duplicate-policy guard moved below the quote call — it would now detect the " +
        "duplicate after having created it.",
    ).toBe(true);
    expect(src, "The duplicate guard no longer answers 409, which is what the dialog keys on to " +
      "ask the operator to confirm.").toMatch(/409/);
  });

  it("asks Bonzah to finalize, so a payment_id comes back with the quote", () => {
    const src = source("bonzah-create-quote");
    expect(
      src,
      "`finalize: 1` is gone from the quote request. Without it Bonzah returns no " +
        "payment_id, and bonzah-confirm-payment then half-fails later on an empty one — " +
        "which is what recoverPaymentId in that function exists to clean up.",
    ).toMatch(/finalize:\s*1/);
    expect(
      src,
      "The missing-payment_id check is gone. Bonzah answering with a quote_id and no " +
        "payment_id is an underwriting refusal, and surfacing it here is the difference " +
        "between a clear error and a policy that silently never activates.",
    ).toMatch(/did not finalize the quote/);
  });

  it("sends a 5-digit ZIP, because ZIP+4 silently breaks finalization", () => {
    const src = source("bonzah-create-quote");
    expect(
      src,
      "normalizeZipForBonzah is no longer applied to the renter's ZIP. Bonzah's " +
        "/Bonzah/quote returns status 0 with an EMPTY payment_id for a ZIP+4 like " +
        '"30034-2123" — no error, no policy, and the failure only shows up at ' +
        "confirm-payment.",
    ).toMatch(/normalizeZipForBonzah\(/);
  });

  it("rates on where the car is picked up, not where the renter lives", () => {
    // Flagged by Bonzah 2026-07: a Metairie, LA pickup was pricing as the
    // renter's Florida home because both UIs were filling pickup_state with the
    // customer's residence.
    const src = source("bonzah-create-quote");
    expect(
      src,
      "The pickup-state resolution from the rental/tenant location is gone. The callers " +
        "still send the renter's RESIDENCE state as pickup_state (both label it 'fallback " +
        "only'), so removing this makes every premium track where the renter lives.",
    ).toMatch(/resolvedPickupState/);
    const resolveAt = src.indexOf("resolvedPickupState = locationState");
    const sendAt = src.indexOf("pickup_state: pickupStateFull");
    expect(resolveAt, "The location-derived pickup state is never assigned.").toBeGreaterThan(-1);
    expect(resolveAt < sendAt, "The pickup state is resolved after it has already been sent.").toBe(true);
  });
});

// ===========================================================================
// 3. bonzah-check-vehicle-eligibility — fail OPEN, always
// ===========================================================================
const ELIGIBILITY_CONTRACT: PayloadContract = {
  step: AT,
  fn: "bonzah-check-vehicle-eligibility",
  builtIn: "apps/booking/src/hooks/useBonzahVehicleEligibility.ts",
  payload: { vehicle_make: "Toyota", vehicle_model: "Corolla" },
};

describe("bonzah/functional — bonzah-check-vehicle-eligibility", () => {
  it("agrees with the booking hook's payload", () => {
    const shape = assertContract(ELIGIBILITY_CONTRACT);
    expect(shape.typeName).toBe("EligibilityRequest");
  });

  it("fails OPEN on every AI failure path", () => {
    // An LLM is deciding whether a car can be insured. Every way that call can
    // go wrong — thrown, empty, unparseable, wrong shape — must end in
    // `eligible: true`, because refusing insurance on a technical failure loses
    // a booking and blames the customer's car.
    const src = source("bonzah-check-vehicle-eligibility");
    const opens = [...src.matchAll(/jsonResponse\(\{\s*eligible:\s*true\s*\}\)/g)];
    expect(
      opens.length,
      "There are now fewer than three unconditional `{ eligible: true }` returns in " +
        "bonzah-check-vehicle-eligibility. The three are: an empty AI response, a " +
        "non-boolean `eligible`, and a thrown call. If one has become a refusal, an " +
        "OpenAI outage now blocks insurance on every vehicle.",
    ).toBeGreaterThanOrEqual(3);
    expect(src, "The fail-open catch around the AI call is gone.").toMatch(/failing open/);
  });

  it("asks the model deterministically", () => {
    const src = source("bonzah-check-vehicle-eligibility");
    expect(
      src,
      "temperature is no longer 0. The same vehicle would start getting different " +
        "eligibility answers on different attempts, which is unarguable to a customer and " +
        "unreproducible for support.",
    ).toMatch(/temperature:\s*0\b/);
  });

  it("still carries the exclusion lists the answer depends on", () => {
    const src = source("bonzah-check-vehicle-eligibility");
    // A sample from each list. An empty EXCLUDED_BRANDS would make every
    // vehicle eligible and the function would look like it was working.
    for (const brand of ["Ferrari", "Lamborghini", "Rolls Royce", "Porsche"]) {
      expect(src, `"${brand}" fell out of EXCLUDED_BRANDS`).toContain(brand);
    }
    for (const model of ["Corvette", "Cybertruck", "G-Class"]) {
      expect(src, `"${model}" fell out of EXCLUDED_MODELS`).toContain(model);
    }
  });
});

// ===========================================================================
// 4. bonzah-confirm-payment — the one that spends
// ===========================================================================
const CONFIRM_CONTRACT: PayloadContract = {
  step: AT,
  fn: "bonzah-confirm-payment",
  builtIn: "apps/portal/src/components/rentals/buy-insurance-dialog.tsx",
  payload: {
    policy_record_id: "00000000-0000-0000-0000-000000000000",
    stripe_payment_intent_id: "pi_test_spine_suite",
  },
};

describe("bonzah/functional — bonzah-confirm-payment", () => {
  it("agrees with the portal's confirm payload", () => {
    const shape = assertContract(CONFIRM_CONTRACT);
    expect(shape.typeName).toBe("ConfirmPaymentRequest");
  });

  it("declares a stripe_payment_intent_id that it never reads", () => {
    // Documented, not fixed, because the fix is a product decision. The field
    // is in the request type and every caller fills it — the portal sends the
    // literal string `portal-admin-${rental.id}`, which is not a PaymentIntent
    // at all — and the function never looks at it. So nothing links the Stripe
    // charge for insurance to the Bonzah policy it paid for, and a reconciler
    // has no key to join on.
    const shape = readEdgeFunction("bonzah-confirm-payment");
    expect(shape.fields, "stripe_payment_intent_id left the request type").toContain("stripe_payment_intent_id");
    expect(
      shape.origin["stripe_payment_intent_id"],
      "bonzah-confirm-payment has started READING stripe_payment_intent_id. That is an " +
        "improvement, but the portal currently sends `portal-admin-<rental id>` there, " +
        "which is not a PaymentIntent — check that caller before relying on the value.",
    ).toEqual(["declared-type"]);
  });

  it("short-circuits when every policy in the chain is already active", () => {
    // Idempotency, and it is money: the portal retries confirmation from two
    // screens and the booking-success page retries on load. Without this, a
    // second confirm calls /Bonzah/payment again and buys the same cover twice.
    const src = source("bonzah-confirm-payment");
    const guardAt = src.indexOf("allActive");
    const payAt = src.indexOf("processSinglePayment(supabase");
    expect(guardAt, "The already-active short circuit is gone.").toBeGreaterThan(-1);
    expect(
      guardAt < payAt,
      "The already-active check moved below the payment loop. Re-confirming an active " +
        "policy would spend the Bonzah balance a second time for cover that already exists.",
    ).toBe(true);
    expect(src, "The already_processed flag the callers key on is gone.").toMatch(/already_processed/);
  });

  it("classifies a low balance the same way in both code paths", () => {
    // The keyword list appears TWICE — once inside processSinglePayment and
    // once in the handler's own catch. They decide between status
    // 'insufficient_balance' (recoverable: top up and retry) and 'failed'
    // (dead). A drift between the copies means the same Bonzah error is
    // recoverable down one path and terminal down the other.
    const src = source("bonzah-confirm-payment");
    const lists = [...src.matchAll(/const\s+balanceKeywords\s*=\s*\[([^\]]*)\]/g)].map((m) =>
      m[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean),
    );

    expect(
      lists.length,
      "Expected two copies of `balanceKeywords` in bonzah-confirm-payment (one in " +
        "processSinglePayment, one in the handler's catch). Finding a different number " +
        "means the duplication was resolved — good — or that one path stopped " +
        "classifying at all.",
    ).toBe(2);
    expect(
      lists[1],
      "The two balanceKeywords lists have drifted apart:\n" +
        `  processSinglePayment: ${JSON.stringify(lists[0])}\n` +
        `  handler catch:        ${JSON.stringify(lists[1])}\n` +
        "  The same Bonzah error would be marked recoverable ('insufficient_balance', " +
        "retry after top-up) down one path and terminal ('failed') down the other.",
    ).toEqual(lists[0]);

    for (const kw of ["insufficient", "balance", "fund", "credit"]) {
      expect(
        lists[0],
        `"${kw}" left the balance-error keyword list. A Bonzah refusal that mentions it ` +
          "would now be recorded as a permanent failure instead of 'top up and retry', " +
          "and the operator would never get the low-balance email.",
      ).toContain(kw);
    }
  });

  it("stops the chain at the first balance failure instead of retrying every policy", () => {
    // A 70-day rental is three policies. Once the balance is out, attempting the
    // remaining two just produces two more identical failures against Bonzah.
    const src = source("bonzah-confirm-payment");
    expect(src, "The break-on-balance-error is gone from the chain loop.").toMatch(/if\s*\(\s*isBalanceError\s*\)\s*break/);
    expect(
      src,
      "The remaining chain policies are no longer marked insufficient_balance, so they " +
        "would sit in 'quoted' looking purchasable.",
    ).toMatch(/insufficient_balance/);
  });

  it("answers 422 with the balance and the premium, not a bare 500", () => {
    // The dialog reads these to tell the operator how much to top up. A 500
    // with a stack-shaped message reads as "our software broke".
    const src = source("bonzah-confirm-payment");
    expect(src, "The insufficient-balance response no longer uses 422.").toMatch(/\}\s*,\s*422\s*\)/);
    for (const key of ["cd_balance", "premium", "chain_confirmed", "chain_total"]) {
      expect(src, `The insufficient-balance response no longer carries \`${key}\`.`).toContain(key);
    }
  });
});

// ===========================================================================
// 5. bonzah-get-balance
// ===========================================================================
const BALANCE_CONTRACT: PayloadContract = {
  step: AT,
  fn: "bonzah-get-balance",
  builtIn: "apps/portal/src/hooks/use-bonzah-balance.ts",
  payload: {
    tenant_id: "00000000-0000-0000-0000-000000000000",
    // The second query in that hook sends `mode: 'test'` to read the sandbox
    // balance while the tenant is live.
    mode: "test",
  },
};

describe("bonzah/functional — bonzah-get-balance", () => {
  it("agrees with the portal's balance hook", () => {
    const shape = assertContract(BALANCE_CONTRACT);
    expect(shape.typeName).toBe("GetBalanceRequest");
    expect(shape.requiredByType, "mode must stay optional — most callers omit it").toEqual(["tenant_id"]);
  });

  it("surfaces the original error only when BOTH balance endpoints failed", () => {
    // /Bonzah/cdBalance errors for some tenants, so /deposit is a real fallback.
    // Reporting the first failure immediately would show "balance unavailable"
    // to operators whose balance is perfectly readable the other way.
    const src = source("bonzah-get-balance");
    expect(
      src,
      "The both-endpoints-failed condition changed. If cdBalance alone failing now " +
        "surfaces an error, every tenant whose broker endpoint errors sees no balance at " +
        "all despite /deposit answering.",
    ).toMatch(/brokerBalance === null && allocatedBalance === null/);
  });

  it("never claims an allocation is needed on the strength of a zero allocation", () => {
    // Bonzah runs this platform on agency-level balance: users[].amount is
    // vestigial and always 0.0000. Reporting a hard 0 told every live tenant
    // "$0.00 available" while their money sat spendable at broker level, and
    // prompted a top-up nobody needed.
    const src = source("bonzah-get-balance");
    expect(src, "needsAllocation is no longer pinned to false.").toMatch(/const\s+needsAllocation\s*=\s*false/);
  });
});

// ===========================================================================
// 6. _shared/bonzah-client.ts — credentials, hosts, and two pure helpers
//
// The two helpers are EXECUTED here, lifted straight out of the shipped file.
// Both encode a lesson that cost a real policy.
// ===========================================================================
describe("bonzah/functional — _shared/bonzah-client.ts", () => {
  it("points test mode at the sandbox and live mode somewhere else", () => {
    const apiUrl = liftSharedClient<(mode: string) => string>("getBonzahApiUrl").call;
    expect(
      new URL(apiUrl("test")).hostname,
      "getBonzahApiUrl('test') no longer resolves to the Bonzah sandbox. Every tenant in " +
        "test mode would start transacting against production insurance.",
    ).toBe(BONZAH_SANDBOX_HOST);
    expect(new URL(apiUrl("live")).hostname).toBe(BONZAH_LIVE_HOST);
    expect(
      apiUrl("test") === apiUrl("live"),
      "The two modes now resolve to the same URL, so mode means nothing.",
    ).toBe(false);
    // Anything that is not the string 'live' must fall to the sandbox — the
    // fail-safe direction for a mode column that could hold anything.
    expect(apiUrl("anything-else"), "An unrecognised mode no longer falls back to the sandbox.").toBe(apiUrl("test"));
  });

  it("normalises a ZIP+4 down to five digits", () => {
    // /Bonzah/quote with finalize:1 returns status 0 and an EMPTY payment_id
    // for "30034-2123". No error. The policy then never activates.
    const zip = liftSharedClient<(z: unknown, f?: string) => string>("normalizeZipForBonzah").call;
    expect(zip("30034-2123"), "ZIP+4 is no longer trimmed to five digits").toBe("30034");
    expect(zip("33101")).toBe("33101");
    expect(zip(" 33101 ")).toBe("33101");
    expect(zip("Miami FL 33101")).toBe("33101");
    // Nothing usable falls back rather than sending an empty ZIP, which is the
    // same silent-empty-payment_id failure by another route.
    expect(zip(null), "A null ZIP no longer falls back to the default").toBe("33101");
    expect(zip(""), "An empty ZIP no longer falls back").toBe("33101");
    expect(zip("abcde"), "A non-numeric ZIP no longer falls back").toBe("33101");
    expect(zip("1234"), "A four-digit ZIP no longer falls back").toBe("33101");
    expect(zip("30034-2123", "99999"), "The caller's own fallback is ignored").toBe("30034");
    expect(zip(null, "99999"), "The caller's own fallback is ignored").toBe("99999");
  });

  it("formats a date the way Bonzah requires (MM/DD/YYYY)", () => {
    const fmt = liftSharedClient<(d: string) => string>("formatDateForBonzah").call;
    // Shape holds everywhere: zero-padded month and day, four-digit year.
    expect(fmt("2026-03-06"), "formatDateForBonzah no longer produces MM/DD/YYYY").toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(fmt("2026-12-25")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    if (!localIsUtcOrEast()) {
      // Not skipped as a test — the shape assertions above are the point, and
      // this note is worth printing wherever it is read.
      //
      // formatDateForBonzah parses 'YYYY-MM-DD' (UTC midnight, per the ISO
      // date-only rule) and then formats with the LOCAL getMonth()/getDate().
      // West of UTC that is the previous calendar day. Supabase Edge Functions
      // run in UTC so production is unaffected; a developer machine in the
      // Americas is not, and would send Bonzah a trip start one day early.
      return;
    }
    expect(
      fmt("2026-03-06"),
      "formatDateForBonzah returned the wrong calendar day. It reads local date parts " +
        "off a UTC-midnight Date, so this is exact only at UTC or east of it — which is " +
        "where the deployed runtime is.",
    ).toBe("03/06/2026");
    expect(fmt("2026-12-25")).toBe("12/25/2026");
    expect(fmt("2026-01-01"), "Single-digit month and day must stay zero-padded").toBe("01/01/2026");
  });

  it("trims stray whitespace off stored live credentials", () => {
    // A credential saved with one leading space from a copy/paste is otherwise
    // sent verbatim to /auth and fails every live insurance call, with an error
    // that reads like a wrong password.
    const src = readSharedClientSource();
    expect(
      src,
      "getTenantBonzahCredentials no longer trims the stored username/password. A single " +
        "pasted leading space then breaks every live Bonzah call for that tenant, and the " +
        "error reads as 'Bonzah rejected the login'.",
    ).toMatch(/username:\s*data\.bonzah_username\.trim\(\)/);
    expect(src).toMatch(/password:\s*data\.bonzah_password\.trim\(\)/);
  });

  it("fails CLOSED when it cannot read whether selling is allowed", () => {
    const src = blankComments(readSharedClientSource());
    const errAt = src.indexOf("Could not verify Bonzah configuration");
    expect(
      errAt,
      "getBonzahSellability no longer refuses on a read error. A safety gate that cannot " +
        "read its own configuration must not wave the sale through: the cost of failing " +
        "closed is a retry, the cost of failing open is a sandbox policy sold as real cover.",
    ).toBeGreaterThan(-1);
    expect(src.slice(errAt - 200, errAt)).toMatch(/sellable:\s*false/);
  });

  it("refuses a test-mode sale unless a super admin has overridden it", () => {
    const src = blankComments(readSharedClientSource());
    expect(src, "The integration_bonzah check is gone.").toMatch(/integration_bonzah\s*!==\s*true/);
    expect(src, "The sandbox override escape hatch is gone.").toMatch(/bonzah_sandbox_override\s*===\s*true/);
    expect(
      src,
      "assertBonzahSellable no longer tags its error BONZAH_NOT_SELLABLE. Callers " +
        "distinguish 'this account may not sell' from 'this quote was malformed' by that " +
        "code, and the two need completely different messages in front of an operator.",
    ).toMatch(/BONZAH_NOT_SELLABLE/);
  });

  it("keeps servicing an existing policy working in every mode", () => {
    // Scope note in the shipped header, asserted so it is not quietly widened:
    // the sell gate must not be bolted onto confirm-payment, download, view or
    // balance, or a customer who has already paid is left with no policy and no
    // document.
    for (const fn of ["bonzah-confirm-payment", "bonzah-get-balance"]) {
      expect(
        source(fn),
        `${fn} has started calling the sell gate. That gate blocks SELLING; applying it ` +
          "to servicing strands a customer who has already been charged with no policy " +
          "and no certificate.",
      ).not.toMatch(/assertBonzahSellable|getBonzahSellability/);
    }
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// WHAT EACH CASE DOES IF ENABLED:
//
//   "live: the deployed estimator prices five days the way this repo does"
//       POSTs at bonzah-calculate-premium with an anon key. Pure arithmetic on
//       the other side: no database, no Bonzah call, no writes. Needs only
//       D247_LIVE_TESTS=1. It is this folder's equivalent of the spine's
//       signup-slug-check — and it doubles as a DEPLOYMENT check, because it
//       compares the rate card running in production with the one in this repo.
//
//   "live: the estimator refuses a request with no trip window"
//       Same endpoint, a deliberately empty body. Answered by the required-field
//       check. Writes nothing.
//
//   "live: bonzah-get-balance reads the fixture tenant's balance"
//       Calls Bonzah, and can INSERT a reminder, insert notifications and send
//       the operator an email if the balance is under their threshold. That is
//       why it needs D247_LIVE_ALLOW_WRITES.
//
//   "live: bonzah-confirm-payment buys the fixture policy"
//       SPENDS THE BONZAH BALANCE AND ISSUES A POLICY. Full ladder:
//       D247_LIVE_TESTS + D247_LIVE_ALLOW_WRITES + D247_LIVE_ALLOW_MONEY_MOVEMENT
//       + D247_LIVE_BONZAH_MODE=test + a one-shot fixture policy id. Skipped by
//       default and meant to stay that way: "Bonzah ki real payments toh test
//       cases mein karenge hi nahi."
// ===========================================================================
describe("bonzah/functional — live (Layer 2)", () => {
  it("live: the deployed estimator prices five days exactly the way this repo does", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no apikey " +
          "header before the function is invoked, so this would measure the gateway.",
      );
      return;
    }

    const res = await liveCall(
      "bonzah-calculate-premium",
      {
        trip_start_date: "2026-03-01",
        trip_end_date: "2026-03-06",
        pickup_state: "FL",
        cdw_cover: true,
        rcli_cover: true,
        sli_cover: true,
        pai_cover: true,
      },
      { token: status.target.anonKey },
    );

    expect(
      res.status,
      "bonzah-calculate-premium did not return 200.\n" + classifyLive(res).explain,
    ).toBe(200);

    const model = readPremiumModel();
    const expected = model.quote(5, { cdw: true, rcli: true, sli: true, pai: true });

    expect(
      Number(res.json?.total_premium),
      [
        "",
        "THE DEPLOYED ESTIMATOR AND THIS REPO DISAGREE",
        "",
        `  deployed  ${res.json?.total_premium}   (${status.target.projectRef}, live function)`,
        `  this repo ${expected.total}   (${model.file}, ${JSON.stringify(model.card.rates)})`,
        `  deployed breakdown ${JSON.stringify(res.json?.breakdown)}`,
        "",
        "  This is not a maths failure — premium-maths.test.ts already proved the repo's",
        "  arithmetic offline. It means the DEPLOYED function is a different build:",
        "  somebody changed the rate card and never ran the deploy, or deployed a change",
        "  that is not in this branch. Every customer is being quoted the deployed number.",
        "",
      ].join("\n"),
    ).toBe(expected.total);

    for (const [key, value] of Object.entries(expected.breakdown)) {
      expect(
        Number((res.json?.breakdown ?? {})[key]),
        `The deployed ${key.toUpperCase()} line is ${(res.json?.breakdown ?? {})[key]}, this repo says ${value}.`,
      ).toBe(value);
    }
  });

  it("live: the estimator refuses a request with no trip window", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — see the case above.");
      return;
    }

    const res = await liveCall("bonzah-calculate-premium", { cdw_cover: true }, { token: status.target.anonKey });
    expect(
      res.status,
      "Expected 400 from the required-field check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 200 here means a premium was computed with no dates at all — " +
        "calculateDays(undefined, undefined) ends at Math.max(NaN, 1), so a multi-week " +
        "rental would be quoted as one day.\n" +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/trip_start_date/);
  });

  it("live: bonzah-get-balance reads the fixture tenant's Bonzah balance", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!liveWritesAllowed()) {
      ctx.skip(
        "D247_LIVE_ALLOW_WRITES is not 1. bonzah-get-balance is not read-only: under the " +
          "tenant's configured threshold it INSERTs a reminder, INSERTs a notification per " +
          "admin and emails the operator.",
      );
      return;
    }
    const tenantId = bonzahFixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    if (!tenantId) {
      ctx.skip("D247_LIVE_BONZAH_TENANT_ID is not set. Fixtures are never inferred.");
      return;
    }

    const res = await liveCall("bonzah-get-balance", { tenant_id: tenantId, mode: "test" });
    expect(
      res.status,
      "bonzah-get-balance did not return 200.\n" +
        "  A 400 with a Bonzah message is FAILURE MODE (b) at the INTEGRATION: both " +
        "/Bonzah/cdBalance and /deposit failed, usually stale sandbox credentials.\n" +
        classifyLive(res).explain,
    ).toBe(200);

    expect(
      Number(res.json?.balance),
      `bonzah-get-balance returned a non-numeric balance: ${JSON.stringify(res.json)}\n` +
        "  Every consumer does Number(balance) on it — use-bonzah-balance.ts, the " +
        "integrations panel, and the low-balance threshold check inside the function " +
        "itself. NaN there silently disables the low-balance alert.",
    ).not.toBeNaN();

    expect(
      res.json?.mode,
      "The mode override was ignored. That override is what lets a live tenant read their " +
        "SANDBOX balance from the integrations panel.",
    ).toBe("test");

    expect(
      res.json?.needsAllocation,
      "needsAllocation came back true. Under Bonzah's agency-level balance there is " +
        "nothing for an operator to allocate, and reporting otherwise sends them to a " +
        "Bonzah screen that answers 'Userwise allocation not allowed'.",
    ).toBe(false);
  });

  it.skipIf(!bonzahMoneyMovementRequested())(
    "live: bonzah-confirm-payment buys the fixture policy from the sandbox balance",
    async (ctx) => {
      const gate = bonzahMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const policyRecordId = bonzahFixtureOrNull("D247_LIVE_BONZAH_POLICY_RECORD_ID");
      if (!policyRecordId) {
        ctx.skip(
          "D247_LIVE_BONZAH_POLICY_RECORD_ID is not set. This fixture is ONE-SHOT: " +
            "confirming it issues a policy and draws the sandbox balance down, and the " +
            "second run gets `already_processed`. Point it at a fresh `quoted` row each " +
            "time, or leave this case off.",
        );
        return;
      }

      const res = await liveCall("bonzah-confirm-payment", {
        policy_record_id: policyRecordId,
        stripe_payment_intent_id: "spine-suite",
      });

      if (res.status === 422 && res.json?.error === "insufficient_balance") {
        // Not a failure of the function — it is the function working. Reported
        // rather than asserted, because a sandbox balance runs out and that is
        // a fixture problem, not a regression.
        ctx.skip(
          `The Bonzah sandbox balance is too low to buy this policy: balance ` +
            `${res.json?.cd_balance}, premium ${res.json?.premium}. Top the sandbox up or ` +
            "point the fixture at a cheaper quote. The 422 shape itself is asserted offline.",
        );
        return;
      }

      expect(
        res.status,
        "bonzah-confirm-payment did not return 200.\n" + classifyLive(res).explain,
      ).toBe(200);
      expect(res.json?.success, `Bonzah payment reported failure: ${res.text.slice(0, 300)}`).toBe(true);

      // `policy_issued` is the difference between a payment Bonzah took and a
      // policy Bonzah wrote. The status the function stores says which, and a
      // customer with the first and not the second has paid for nothing.
      expect(
        res.json?.status,
        "The policy was paid for but not issued, so the record is 'payment_confirmed' " +
          "rather than 'active'. The balance has been spent either way — this needs " +
          "chasing at Bonzah, not retrying here.",
      ).toBe("active");
      expect(res.json?.policy_no, "No policy number came back with a 200.").toBeTruthy();

      // Every policy in the chain, or the customer has uninsured days in the
      // middle of a rental they have paid insurance on.
      expect(
        res.json?.chain_confirmed,
        `Only ${res.json?.chain_confirmed} of ${res.json?.chain_total} chained policies were ` +
          "confirmed. A 30-day gap in the middle of a long rental is uninsured cover the " +
          "customer has already been billed for.",
      ).toBe(res.json?.chain_total);
    },
  );
});
