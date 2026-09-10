// =============================================================================
// integrations/stripe — AUTO-CHARGE AND CAPTURE.
//
// The team lead's question, in his words: "can I auto charge?" — and its
// follow-up, "what circus happens on insufficient balance?". This file answers
// both by reading the code that does the charging, and it stays inside axis 1:
// the RENTAL operator taking money from THEIR customer. Drive247 billing its
// own tenants is a different axis and already has a file
// (tests/integrations/stripe/checkout.test.ts); nothing here touches
// tenant_subscriptions, and extensions / auto-extension / pay-as-you-go /
// installments are parked.
//
// The five money moves in scope, and which function owns each:
//
//   charge a card on file, nobody present   charge-saved-card
//   capture a booking authorisation         capture-booking-payment
//   capture a deposit hold (full/partial)   capture-deposit-hold
//   release a booking authorisation         cancel-booking-preauth
//   reconcile a row against Stripe          sync-payment-intent,
//                                           process-pending-payment,
//                                           apply-payment (the settle hand-off)
//
// THREE LAYERS, the same as the spine and the sibling Stripe files:
//
//   LAYER 1  source-derived, no network, always runs. Most of the file. Several
//            cases assert the ORDER of a guard rather than its existence,
//            because a ceiling below `paymentIntents.capture` is not a ceiling,
//            it is a log line written after the money moved.
//   LAYER 3  pure arithmetic with hand-typed expected values. Every figure below
//            was derived with a pencil and carries its working in a comment. The
//            capability table is imported and executed for real; the minor-unit
//            conversions cannot be imported (they are inline in Deno modules
//            that `import` from https://esm.sh, which no Node loader resolves),
//            so those cases pair hand arithmetic with a pin on the exact source
//            expression, and say so.
//   LAYER 2  live HTTP, opt-in, skipped by default through helpers/live-call.ts.
//            Production (hviqoaokxvlancmftwuo) is refused by that helper and
//            nothing here weakens it.
//
// ---------------------------------------------------------------------------
// KNOWN DEFECTS ARE NEVER ASSERTED AS CORRECT.
//
// Where the code is wrong, this file carries a PAIR:
//
//   * a PIN, which records the wrong behaviour so its size is on the record;
//   * an `it.fails(...)` immediately after it, asserting what SHOULD be true.
//
// `it.fails` passes while the bug exists and goes RED the day someone fixes it,
// which forces the fixer to come here and read the pair. Both halves of a pair
// go red together on a fix, and each pin's message says so, with the fix
// instruction: delete the pin, drop the `.fails`.
//
// ---------------------------------------------------------------------------
// WHY `readEdgeFunction` IS NOT USED FOR EVERY FUNCTION HERE.
//
// helpers/edge-contract.ts parses three request-parsing shapes and THROWS on a
// fourth rather than silently reporting zero fields. Two functions in this
// family use a fourth and a fifth:
//
//   charge-saved-card   `let body: Record<string, unknown>` — the parser reads
//                       `Record` as a named interface, finds none, and throws.
//   apply-payment       `let body;` with no annotation at all.
//
// Teaching the parser is a change to a shared helper that five other test files
// depend on, and this task is one file. So those two are read as SOURCE via
// `readEdgeFunctionSource` + `blankComments` — the same primitives the helper
// itself uses — with a local field reader that applies the helper's documented
// member-access rule (`body.x` / `body?.x`) and nothing else. The three
// functions the helper CAN parse go through `assertContract` as normal.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertContract,
  blankComments,
  FUNCTIONS_DIR,
  readEdgeFunction,
  readEdgeFunctionSource,
  REPO_ROOT,
  type PayloadContract,
} from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveMoneyGate, liveMoneyMovementRequested, liveStatus } from "../../helpers/live-call";
import {
  capabilitiesFor,
  SQUARE_CAPABILITIES,
  STRIPE_CAPABILITIES,
} from "@fn/_shared/payments/capabilities.ts";
import { isStripeTenant } from "@fn/_shared/payments/guard.ts";

// ---------------------------------------------------------------------------
// Small local readers. Both delegate to edge-contract for the actual file read
// and the comment blanking, so prose can never be mistaken for code.
// ---------------------------------------------------------------------------

/** An edge function's source with every comment blanked, offsets intact. */
function code(fn: string): string {
  return blankComments(readEdgeFunctionSource(fn));
}

/** A `supabase/functions/_shared/*.ts` module's source, comments blanked. */
function shared(file: string): string {
  return blankComments(readFileSync(join(FUNCTIONS_DIR, "_shared", file), "utf8"));
}

/**
 * Every field name a function reads off its JSON body via `body.x` / `body?.x`.
 *
 * The same rule `readEdgeFunction` applies for its "member-access" origin, used
 * only for the two functions whose declaration shape that parser rejects. It
 * deliberately does NOT fall back to an empty set: an empty set would make a
 * contract assertion pass against a function that reads nothing.
 */
function bodyFieldsRead(fn: string): string[] {
  const found = new Set<string>();
  for (const m of code(fn).matchAll(/\bbody\s*\??\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    found.add(m[1]);
  }
  if (found.size === 0) {
    throw new Error(
      `Found no \`body.x\` reads in ${fn}. Either the function stopped reading its ` +
        `request body that way, or this reader is wrong — both make every contract ` +
        `assertion below pass for the wrong reason.`,
    );
  }
  return [...found].sort();
}

/** Index of a marker in blanked source, asserted present with a human reason. */
function at(src: string, marker: string, why: string): number {
  const i = src.indexOf(marker);
  expect(i, `Marker \`${marker}\` is gone from this function. ${why}`).toBeGreaterThan(-1);
  return i;
}

/**
 * The body of capture-booking-payment's `if (updatePaymentError)` branch — the
 * one that runs when the write of `capture_status: "captured"` fails.
 *
 * Read as code (comments already blanked) rather than by matching the comment
 * that admits the behaviour, so rewording the comment cannot quietly change
 * what these two cases assert.
 */
function captureStatusErrorBranch(): string {
  const src = code("capture-booking-payment");
  return /if \(updatePaymentError\) \{([\s\S]*?)\n    \}/.exec(src)?.[1] ?? "";
}

/**
 * "This function establishes who is calling."
 *
 * Deliberately not the bare word `Authorization`: every one of these files
 * lists that header in its `Access-Control-Allow-Headers` string, which says
 * the header is ACCEPTED, not that anyone reads it. What counts is a read of
 * the header, or a call into the shared guard that reads it for you
 * (_shared/deposit-hold-auth.ts), or the server-to-server platform secret.
 */
const CALLER_IDENTITY =
  /headers\s*\.\s*get\(\s*["'][Aa]uthorization["']|authorizeDepositHoldRequest|deposit-hold-auth|x-platform-secret/;

/** The message every PIN carries, so a fixer knows a red pin is good news. */
function pinNote(whatToDo: string): string {
  return (
    "\n  PINNED DEFECT — this test records BROKEN behaviour so its size is on the\n" +
    "  record. It is not a statement that the behaviour is correct. If it just\n" +
    `  went red, the defect was FIXED: ${whatToDo}\n`
  );
}

// ===========================================================================
// CAPABILITY GATING — the load-bearing rule for "can I auto charge?".
//
// _shared/payments/capabilities.ts:4-11 states it as binding: "every
// behavioural difference between processors lives HERE. Zero hand-written
// provider gates anywhere else. A feature is switched off because a CAPABILITY
// is false, never because `providerId === 'square'`."
//
// So the question "can this tenant be charged off-session?" has exactly one
// correct spelling — `capabilitiesFor(provider).canChargeOffSession` — and any
// other spelling is a finding, not a style preference. These cases execute the
// real table (it is one of the few modules in supabase/functions with no
// https:// import, so it imports cleanly here) and then check who reads it.
// ===========================================================================
describe("stripe/charge-capture — the capability that decides whether a card may be charged at all", () => {
  it("says a Stripe tenant may store a card and charge it with nobody present", () => {
    // These four are the whole of "can I auto charge?" for the native rail.
    expect(STRIPE_CAPABILITIES.supportsStoredCredential).toBe(true);
    expect(STRIPE_CAPABILITIES.canChargeOffSession).toBe(true);
    expect(STRIPE_CAPABILITIES.supportsManualCapture).toBe(true);
    expect(STRIPE_CAPABILITIES.supportsAuthorizationHold).toBe(true);
    // Partial capture is what makes "charge $1 of the $3 hold" expressible.
    expect(STRIPE_CAPABILITIES.supportsPartialCapture).toBe(true);
  });

  it("says a Square tenant has no stored card to charge and no hold to capture", () => {
    // supportsStoredCredential=false is the load-bearing entry per the module's
    // own comment: it is what switches off installments, auto-extend auto_charge,
    // charge-saved-card and deposit holds — without any other file knowing the
    // word "Square".
    expect(SQUARE_CAPABILITIES.supportsStoredCredential).toBe(false);
    expect(SQUARE_CAPABILITIES.canChargeOffSession).toBe(false);
    expect(SQUARE_CAPABILITIES.supportsAuthorizationHold).toBe(false);
    // Square's CompletePayment takes no amount, so a partial capture cannot be
    // expressed on that rail at all.
    expect(SQUARE_CAPABILITIES.supportsPartialCapture).toBe(false);
    // But manual capture EXISTS there, so "capture" as such is not the axis —
    // the stored credential is. A gate written on the wrong axis would wrongly
    // switch off renter-present flows, which must stay on for Square.
    expect(SQUARE_CAPABILITIES.supportsManualCapture).toBe(true);
  });

  it("answers for a provider it has never heard of by handing back the Stripe row", () => {
    // Deliberate fail-OPEN, matching guard.ts's stated FAIL DIRECTION: an
    // unrecognised/unselected provider must never block a live Stripe payment.
    // Worth pinning because the direction is a decision, not an accident — the
    // safety comes from the DB constraint, not from this lookup.
    expect(capabilitiesFor("paypal" as never)).toBe(STRIPE_CAPABILITIES);
    expect(isStripeTenant({ payment_provider: undefined })).toBe(true);
    expect(isStripeTenant({ payment_provider: "square" })).toBe(false);
  });

  it("today no function that moves money in this family reads the capability table", () => {
    // PIN. The table is imported by exactly two functions in the repo
    // (square-webhook, square-oauth-start), neither of which charges or
    // captures. Until that changes, "provider #3 is a table edit" is a claim the
    // money paths do not honour.
    const family = [
      "charge-saved-card",
      "capture-booking-payment",
      "capture-deposit-hold",
      "cancel-booking-preauth",
      "process-pending-payment",
      "fetch-payment-intent",
      "sync-payment-intent",
      "update-payment-method",
      "apply-payment",
      "undo-manual-payment",
    ];
    const readers = family.filter((fn) => /payments\/(capabilities|guard)\.ts/.test(code(fn)));
    expect(
      readers,
      pinNote("delete this pin and drop `.fails` from the two cases below.") +
        `  ${readers.length ? readers.join(", ") + " now read the seam." : ""}`,
    ).toEqual([]);
  });

  it.fails(
    "charge-saved-card decides whether to charge off-session by asking the capability, not by comparing a provider name",
    () => {
      // Remove `.fails` once charge-saved-card imports capabilities.ts.
      //
      // The skip's SHAPE is already right (see the next case) — only the
      // CONDITION is wrong: index.ts:291 reads
      //   if (tenantRow.payment_provider === 'square')
      // which is the exact construction capabilities.ts:4-11 declares banned.
      // Correct spelling: !capabilitiesFor(provider).canChargeOffSession, the
      // flag capabilities.ts:22-34 says exists specifically to switch this
      // function off.
      const src = code("charge-saved-card");
      expect(src, "charge-saved-card still gates on the provider NAME.").not.toMatch(
        /payment_provider\s*===\s*['"]square['"]/,
      );
      expect(src, "charge-saved-card does not read the capability table.").toMatch(
        /canChargeOffSession|supportsStoredCredential/,
      );
    },
  );

  it.fails("sync-payment-intent refuses a Square payment row through the seam rather than a name comparison", () => {
    // Remove `.fails` once sync-payment-intent uses capabilitiesFor(...) or the
    // sanctioned row predicate in _shared/payments/predicates.ts.
    const src = code("sync-payment-intent");
    expect(src).not.toMatch(/payment_provider\s*===\s*['"]square['"]/);
    expect(src).toMatch(/capabilitiesFor|hasProcessorHandle|isElectronicPayment|isStripeTenant/);
  });

  it("turns a provider that cannot be charged away with a 200 skip, never an error", () => {
    // This part is CORRECT today and must survive the fix above. types.ts:66-71
    // and skip() at :88-91 define the contract: a deliberately-absent feature is
    // a no-op for crons and chained callers, not a pager alert. Both in-family
    // gates already obey it, and the gate in place-deposit-hold — the upstream
    // that decides whether a capturable authorisation exists at all — does too.
    for (const fn of ["charge-saved-card", "sync-payment-intent", "place-deposit-hold"]) {
      const src = code(fn);
      expect(src, `${fn}'s provider skip no longer carries skipped:true`).toMatch(/skipped:\s*true/);
      expect(src, `${fn}'s provider skip no longer carries a machine-readable reason`).toMatch(
        /reason:\s*['"]square_(tenant|payment)['"]/,
      );
      // A throw here would turn "this tenant does not do stored cards" into a
      // failed booking. The two words that would signal one:
      expect(src).not.toMatch(/throw new WrongProviderError/);
    }
  });

  it("keeps the hold engine free of any provider branch, which is only safe because the hold is refused upstream", () => {
    // _shared/deposit-hold-refresh.ts is the chained-authorisation engine and
    // mentions no provider at all. That silence is safe ONLY while a Square
    // tenant can never own a hold row for it to find — so the invariant to
    // assert is upstream: place-deposit-hold's refusal sits ABOVE the call that
    // mints an authorisation.
    const refresh = shared("deposit-hold-refresh.ts");
    expect(
      refresh,
      "The refresh engine has grown a provider branch. Either the capability seam " +
        "moved in here (fine — then this test should assert THAT), or a name " +
        "comparison spread into the most carefully written file in the family.",
    ).not.toMatch(/payment_provider|['"]square['"]/);

    const place = code("place-deposit-hold");
    const gateAt = at(
      place,
      'payment_provider === "square"',
      "place-deposit-hold is the reason no Square hold can exist for the refresh engine to meet.",
    );
    const mintAt = at(
      place,
      "createDepositHoldIntentWithFallback(stripe",
      "place-deposit-hold no longer mints the authorisation through the shared helper.",
    );
    expect(
      gateAt < mintAt,
      "place-deposit-hold's provider refusal has moved BELOW the call that authorises " +
        "the card. A hold would then be placed and a hold row written for a tenant " +
        "whose capabilities say holds do not exist — and the refresh engine, which " +
        "asks no provider questions, would keep re-authorising it for ever.",
    ).toBe(true);
  });
});

// ===========================================================================
// CHARGING A STORED CARD OFF-SESSION — charge-saved-card.
//
// The one function in the family that is properly authorised, and the reference
// implementation for everything else here. It is also the only place an operator
// TYPES the amount, which is why it carries the currency work nothing else does.
// ===========================================================================
describe("stripe/charge-capture — charging the card on file with nobody present", () => {
  it("reads exactly the eight fields the portal's payment dialog sends, and no others", () => {
    // The payload is apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx
    // (the single call site — payments-actions.tsx reuses the dialog rather than
    // duplicating it). Four of the eight are conditional spreads there, so they
    // are frequently absent on the wire; the dialog is what decides that, per
    // charge, so they belong in the contract.
    const sent = [
      "rentalId",
      "amount",
      "reason",
      "clientRequestId",
      "confirmDuplicate",
      "targetCategories",
      "extensionId",
      "placeDepositHoldAfter",
    ].sort();

    expect(
      bodyFieldsRead("charge-saved-card"),
      "CONTRACT DRIFT on charge-saved-card.\n" +
        "  The payload is built in apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx\n" +
        "  and read in supabase/functions/charge-saved-card/index.ts.\n" +
        "  A field on the left only: the function grew one nothing sends.\n" +
        "  A field on the right only: the function stopped reading one the dialog still sends.\n" +
        "  This is failure mode (a) — a developer changed a field. Nothing is on fire.",
    ).toEqual(sent);
  });

  it("refuses a caller with no bearer token before it has even parsed the body", () => {
    const src = code("charge-saved-card");
    const authAt = at(src, "req.headers.get('Authorization')", "This is the only authorised function in the family.");
    const bodyAt = at(src, "await req.json()", "charge-saved-card no longer parses a JSON body.");
    const stripeAt = at(src, "paymentIntents.create(", "charge-saved-card no longer charges anything.");
    expect(
      authAt < bodyAt && authAt < stripeAt,
      "The identity check has moved below the body parse or below the charge. This " +
        "function is the pattern the other eleven are measured against; if it stops " +
        "checking first, there is no pattern left.",
    ).toBe(true);
  });

  it("lets head_admin and admin charge, and a manager only with an editor grant on the payments tab", () => {
    const src = code("charge-saved-card");
    expect(src).toMatch(/FULL_ACCESS_ROLES\s*=\s*new Set\(\['head_admin',\s*'admin'\]\)/);
    // ops and viewer are refused by omission from that set, which is the safe
    // direction: a role added to the enum later is denied until someone decides.
    expect(src).not.toMatch(/FULL_ACCESS_ROLES[^)]*['"]ops['"]/);
    // The manager path is an explicit grant lookup, not a role name.
    expect(src).toMatch(/tab_key['"]?,\s*['"]payments['"]/);
    expect(src).toMatch(/access_level\s*===\s*['"]editor['"]/);
    // A deactivated portal user cannot charge even with the right role.
    expect(src).toMatch(/!appUser\.is_active/);
  });

  it("gives SCA its own answer on both routes — the thrown decline and the returned status", () => {
    // "Can I auto charge?" has a third answer besides yes and no: the issuer
    // wants the cardholder present. It is NOT a decline, and the UI branches on
    // the distinction to offer "email a payment link" instead of a blind retry.
    //
    // Two routes reach it and BOTH must carry the same code:
    //   (1) Stripe throws with code 'authentication_required' (index.ts:584)
    //   (2) the PaymentIntent comes back requires_action / requires_confirmation
    //       (index.ts:599) — no throw, so route (1) cannot cover it.
    const src = code("charge-saved-card");
    const occurrences = src.match(/authentication_required/g) ?? [];
    expect(
      occurrences.length,
      "Fewer than three mentions of authentication_required: one of the two SCA " +
        "routes has lost its distinct code and now reports a generic decline. An " +
        "operator reading 'declined' on a perfectly good card retries it.",
    ).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/status\s*===\s*['"]requires_action['"]/);
    expect(src).toMatch(/status\s*===\s*['"]requires_confirmation['"]/);
    // The flag the dialog reads to offer the payment-link fallback, on both routes.
    expect((src.match(/canFallbackToPaymentLink/g) ?? []).length).toBe(2);
  });

  it("reports an insufficient-funds decline as charge_failed 402 carrying Stripe's own decline code", () => {
    // THE "insufficient balance" ANSWER, traced by hand.
    //
    // Stripe throws for that case with code 'card_declined' and decline_code
    // 'insufficient_funds'. charge-saved-card's stripeErrorCode() prefers
    // `code` over `decline_code` (index.ts:118-122), so:
    //
    //   code           = 'card_declined'         -> not authentication_required
    //   -> fail('charge_failed', message, 402, { stripeErrorCode: 'card_declined',
    //                                            stripeDeclineCode: 'insufficient_funds' })
    //
    // So the operator gets a 402 whose body names BOTH: the class of failure and
    // the exact reason. That is the whole circus — no retry loop, no partial
    // charge, no payments row.
    const src = code("charge-saved-card");
    expect(src, "stripeErrorCode no longer prefers `code`, so the 402 body would change shape.").toMatch(
      /e\?\.code\s*\?\?\s*e\?\.raw\?\.code\s*\?\?\s*e\?\.decline_code/,
    );
    expect(src).toMatch(/fail\('charge_failed', message, 402/);
    expect(src).toMatch(/stripeErrorCode:\s*code/);
    expect(src).toMatch(/stripeDeclineCode:\s*declineCode/);
  });

  it("writes an audit row for a decline, then returns above the payments insert so nothing is recorded", () => {
    const src = code("charge-saved-card");
    const auditAt = at(src, "payment_charge_saved_card_failed", "A refused charge is no longer auditable.");
    const declineAt = at(src, "charge_failed", "The generic decline branch is gone.");
    const insertAt = at(src, "method: 'Card'", "The payments insert has changed shape.");
    expect(
      auditAt < insertAt && declineAt < insertAt,
      "A decline path now runs past the payments insert. A declined charge that " +
        "leaves a payments row behind inflates Collected by money the customer " +
        "never paid, and the ledger has no way to tell it from a real charge.",
    ).toBe(true);
  });

  it("refuses a currency whose minor-unit rule is not encoded, before Stripe is called", () => {
    const src = code("charge-saved-card");
    // bhd/jod/kwd/omr/tnd are three-decimal AND must be a multiple of 10 in
    // minor units. Rather than encode a rule no tenant bills in, the function
    // refuses: a rejected charge is recoverable, a 10x one is not.
    expect(src).toMatch(/THREE_DECIMAL_CURRENCIES\s*=\s*new Set\(\['bhd', 'jod', 'kwd', 'omr', 'tnd'\]\)/);
    const guardAt = at(src, "currency_unsupported", "The three-decimal refusal is gone.");
    const chargeAt = at(src, "paymentIntents.create(", "charge-saved-card no longer charges.");
    expect(
      guardAt < chargeAt,
      "The unsupported-currency refusal has moved below paymentIntents.create — the " +
        "charge would be sent first and validated afterwards.",
    ).toBe(true);
  });

  it("converts an operator's typed amount to minor units by currency, so a zero-decimal charge is not multiplied", () => {
    // LAYER 3. Arithmetic first, by hand, from the rule at
    // https://docs.stripe.com/currencies#zero-decimal:
    //
    //   two-decimal (usd):  89.00  -> Math.round(89.00 * 100) = 8900 minor units
    //   two-decimal (usd): 120.55  -> Math.round(120.55 * 100) = 12055
    //   zero-decimal (jpy): 1200   -> 1200 minor units, NOT 1200 x 100 = 120000
    //
    // 120000 JPY where 1200 was meant is one hundred times the money. That is
    // the failure this branch exists to prevent, and it is why the divisor is a
    // property of the currency and never a constant.
    const minorUnits = (amount: number, zeroDecimal: boolean) =>
      zeroDecimal ? Math.round(amount) : Math.round(amount * 100);

    expect(minorUnits(89.0, false)).toBe(8900);
    expect(minorUnits(120.55, false)).toBe(12055);
    expect(minorUnits(1200, true)).toBe(1200);
    // The 100x error, stated once so the number in the pin below is not abstract.
    expect(1200 * 100).toBe(120000);

    // The formula above is hand-written, so it is anchored to the code: this is
    // the expression charge-saved-card actually uses. If the two ever part, this
    // case is asserting arithmetic nothing runs.
    const src = code("charge-saved-card");
    expect(
      src,
      "charge-saved-card's minor-unit expression changed. Re-derive the table above " +
        "against the new one before touching this test.",
    ).toContain("const amountInMinorUnits = isZeroDecimal ? amount : Math.round(amount * 100);");
    expect(src).toMatch(/ZERO_DECIMAL_CURRENCIES[\s\S]{0,200}'jpy'/);
    // A zero-decimal currency has no sub-unit, so a fractional figure is refused
    // rather than silently rounded into something the operator did not confirm.
    expect(src).toMatch(/isZeroDecimal && !Number\.isInteger\(rawAmount\)/);
  });

  it("blocks a second identical amount on the same rental for ten minutes unless the operator confirms", () => {
    const src = code("charge-saved-card");
    // 10 * 60 * 1000 = 600000 ms. The window is a backstop BEHIND the
    // idempotency key: the key stops a replay of one request, this stops two
    // genuinely distinct requests (two operators, two tabs, a reload).
    expect(src).toContain("const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;");
    expect(10 * 60 * 1000).toBe(600_000);
    // Only an explicit `true` gets past it — not a truthy string, not "1".
    expect(src).toContain("const confirmDuplicate = body.confirmDuplicate === true;");
    const dupAt = at(src, "possible_duplicate", "The duplicate backstop is gone.");
    const chargeAt = at(src, "paymentIntents.create(", "charge-saved-card no longer charges.");
    expect(dupAt < chargeAt, "The duplicate guard now runs after the money moves.").toBe(true);
  });

  it("refuses the charge when it cannot prove the payment is not a duplicate", () => {
    // Fail safe, never open: a failed lookup is not permission to charge. 503,
    // because the caller should try again once the database answers.
    const src = code("charge-saved-card");
    const failAt = at(src, "duplicate_check_failed", "The unprovable-duplicate refusal is gone.");
    const chargeAt = at(src, "paymentIntents.create(", "charge-saved-card no longer charges.");
    expect(failAt < chargeAt).toBe(true);
    expect(src).toMatch(/duplicate_check_failed[\s\S]{0,300}503/);
  });

  it("today builds its Stripe idempotency key without the amount in it", () => {
    // PIN. `charge-saved-card-<rentalId>-<clientRequestId>` — no amount term.
    // The guarantee therefore rests entirely on ONE client composing the key
    // from the charge intent (add-payment-dialog.tsx folds the amount, the
    // categories and the extension into it). A second caller that reuses a
    // clientRequestId with a different amount gets Stripe's `idempotency_error`,
    // which stripeErrorCode() surfaces as a generic charge_failed 402 the UI
    // cannot explain.
    expect(
      code("charge-saved-card"),
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain("const idempotencyKey = `charge-saved-card-${rentalId}-${clientRequestId}`;");
  });

  it.fails("binds the amount into the server's own idempotency key rather than trusting the client to", () => {
    // Remove `.fails` once the key carries amountInMinorUnits + currency, or the
    // function refuses a clientRequestId already used on this rental for a
    // different amount with its own code.
    const src = code("charge-saved-card");
    const keyLine = /const idempotencyKey = `[^`]*`/.exec(src)?.[0] ?? "";
    expect(keyLine, "The server key still omits the amount.").toMatch(/amountInMinorUnits|currency/);
  });

  it("never unwinds a successful charge: an unrecordable payment is its own loud 500", () => {
    const src = code("charge-saved-card");
    // Once Stripe says succeeded, the money has moved and no path may delete,
    // refund or roll back. The three outcomes after that point:
    //   replay lookup failed  -> charged_but_not_recorded 500, "do not retry"
    //   payments insert failed-> charged_but_not_recorded 500, naming the PI
    //   apply-payment failed  -> success:true + a warning, row left in place
    expect((src.match(/charged_but_not_recorded/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/Do not retry/);
    expect(src, "The unrecorded-charge outcome is no longer auditable.").toMatch(
      /payment_charge_saved_card_unrecorded/,
    );
    // No refund and no delete anywhere in this function.
    expect(src).not.toMatch(/refunds\.create|\.delete\(\)/);
  });

  it("recognises Stripe's idempotent replay and returns the existing payment instead of a second row", () => {
    const src = code("charge-saved-card");
    const lookupAt = at(src, "eq('stripe_payment_intent_id', paymentIntent.id)", "The replay lookup is gone.");
    const insertAt = at(src, "method: 'Card'", "The payments insert changed shape.");
    expect(
      lookupAt < insertAt,
      "The replay lookup now runs after the insert, so an idempotent retry records " +
        "the same PaymentIntent twice and double-counts the revenue.",
    ).toBe(true);
    expect(src).toMatch(/alreadyRecorded:\s*true/);
  });

  it("hands settlement to apply-payment and calls no settle RPC of its own", () => {
    const src = code("charge-saved-card");
    expect(src).toMatch(/functions\.invoke\('apply-payment'/);
    // Calling the settle RPCs here as well would double-settle against the
    // portal callers that settle on the 'recorded' callback.
    for (const rpc of ["installment_settle_invoice", "finalize_rental_extension", "payg_settle"]) {
      expect(src, `charge-saved-card now calls ${rpc} directly — that is a double-settle.`).not.toContain(rpc);
    }
  });
});

// ===========================================================================
// CAPTURING A BOOKING AUTHORISATION — capture-booking-payment.
//
// "Approve this pending booking": capture the manual-capture PaymentIntent the
// customer authorised at checkout, turn the rental Active and the vehicle
// Rented. All-or-nothing by design.
// ===========================================================================
describe("stripe/charge-capture — approving a pending booking captures its authorisation", () => {
  const CAPTURE_CONTRACT: PayloadContract = {
    step: "05-provision", // not on the spine chain; this folder runs independently
    fn: "capture-booking-payment",
    builtIn: "apps/portal/src/hooks/use-booking-approval.ts",
    payload: {
      paymentId: "00000000-0000-0000-0000-000000000000",
      approvedBy: "some-app-user-id",
    },
  };

  it("agrees with the payload the portal's approve-booking hook sends", () => {
    const shape = assertContract(CAPTURE_CONTRACT);
    expect(shape.fields.length, `Parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
    expect(shape.typeName).toBe("CaptureRequest");
    expect(shape.requiredByType).toContain("paymentId");
  });

  it("ignores the rentalId the rental-detail screen also sends, which is harmless but not a contract", () => {
    // A SECOND caller exists — apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx
    // sends { paymentId, rentalId } — and the function reads only paymentId. The
    // extra key is dropped silently. Recorded rather than "fixed" in a test,
    // because the day someone starts reading `rentalId` here they must decide
    // whether it may disagree with the payment's own rental (it may not: that is
    // the same body-supplied-scope hole this file pins twice below).
    const shape = readEdgeFunction("capture-booking-payment");
    expect(shape.fields).not.toContain("rentalId");
    const page = readFileSync(join(REPO_ROOT, "apps/portal/src/app/(dashboard)/rentals/[id]/page.tsx"), "utf8");
    expect(
      page,
      "The rental-detail approve button no longer sends rentalId. Good — but this " +
        "test existed to record that it did; delete it rather than loosening it.",
    ).toMatch(/invoke\('capture-booking-payment'[\s\S]{0,200}rentalId/);
  });

  it("captures the whole authorisation or none of it: no amount is ever sent to Stripe", () => {
    // Asserted POSITIVELY, as a contract of this path. Booking approval is
    // all-or-nothing — `paymentIntents.capture(id, undefined, options)` with an
    // explicitly undefined params argument, so no amount_to_capture can be
    // carried. Stated here so a future `amount` parameter has to arrive with its
    // own ceiling check (the one capture-deposit-hold has) rather than sliding in
    // behind an existing test.
    const src = code("capture-booking-payment");
    expect(src).toMatch(/paymentIntents\.capture\(\s*paymentIntentId,\s*undefined,\s*stripeOptions\s*\)/);
    expect(
      src,
      "capture-booking-payment now sends a partial capture amount. That needs a " +
        "ceiling against the authorised amount before it goes anywhere near Stripe.",
    ).not.toContain("amount_to_capture");
  });

  it("refuses a second capture on the stored capture_status before Stripe is called", () => {
    const src = code("capture-booking-payment");
    const gateAt = at(src, 'capture_status !== "requires_capture"', "The double-capture state gate is gone.");
    const captureAt = at(src, "paymentIntents.capture(", "capture-booking-payment no longer captures.");
    expect(
      gateAt < captureAt,
      "The capture_status gate has moved below the capture. It is the only thing " +
        "making a double-click idempotent-by-refusal, and it must answer before " +
        "Stripe is asked for the money.",
    ).toBe(true);
    // Step 6 is what closes the gate for the next call.
    expect(src).toMatch(/capture_status:\s*"captured"/);
  });

  it("today decides a PaymentIntent was already captured by matching words inside an error message", () => {
    // PIN. index.ts:201 is `captureError?.message?.includes("already been captured")`.
    // A message is not part of Stripe's API contract, and this one cannot
    // separate the two conditions that reach it:
    //
    //   double capture      -> Stripe raises payment_intent_unexpected_state, and
    //                          the wording MAY contain that phrase
    //   capture after cancel-> Stripe raises payment_intent_unexpected_state too,
    //                          with different wording -> `throw captureError`
    //                          -> the outer catch at :309-326 answers HTTP 500
    //                          with the raw message
    //
    // So "you cancelled this booking, then approved it" is indistinguishable
    // from "the function is broken", and the operator is told the second.
    const src = code("capture-booking-payment");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      'captureError?.message?.includes("already been captured")',
    );
    // And the 500 that a capture-after-cancel therefore lands on.
    expect(src).toMatch(/status:\s*500/);
  });

  it.fails("branches on the Stripe error code and answers from the PaymentIntent's real status", () => {
    // Remove `.fails` once the catch keys on err.code ===
    // 'payment_intent_unexpected_state', retrieves the PaymentIntent and answers
    // from its status: succeeded is an idempotent success, canceled is a distinct
    // 4xx naming the cancelled authorisation, anything else a 4xx naming the
    // status. That exact three-way branch already exists and works in
    // _shared/deposit-hold-refresh.ts:2079-2114 — it should be reused, not
    // re-derived.
    const src = code("capture-booking-payment");
    expect(src, "still matching on a message substring").not.toContain('message?.includes("already been captured")');
    expect(src, "no error-code branch").toMatch(/payment_intent_unexpected_state/);
    expect(src, "a cancelled authorisation is still not named distinctly").toMatch(/["']canceled["']/);
  });

  it("today captures money without checking who asked, and writes the caller's own claim into verified_by", () => {
    // PIN. Two facts, both from the source:
    //   * the file contains no read of the Authorization header at all, while
    //     holding a service-role client. supabase/config.toml declares no block
    //     for it, so the gateway default applies — and that default is satisfied
    //     by the PUBLIC ANON KEY in the booking app's JS bundle
    //     (_shared/deposit-hold-auth.ts:11-23 documents this at length).
    //   * `verified_by: approvedBy` takes the approver's identity from the
    //     request body, so the audit trail records whoever the caller says.
    // A payment UUID is not a capability: they travel in portal URLs,
    // success-page query strings and customer emails.
    // NOTE the shape of the check: the literal word appears in this file's
    // `Access-Control-Allow-Headers` string, which is a header it ACCEPTS, not
    // one it reads. What matters is that nothing ever calls
    // `req.headers.get("Authorization")`.
    const src = code("capture-booking-payment");
    expect(
      src,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  It captures money on a service-role client with no caller identity.",
    ).not.toMatch(CALLER_IDENTITY);
    expect(src).toContain("verified_by: approvedBy");
  });

  it.fails("authorises the caller against the payment's own tenant before capturing, and derives verified_by from that", () => {
    // Remove `.fails` once the caller is authorised. The in-repo pattern is
    // authorizeDepositHoldRequest (_shared/deposit-hold-auth.ts:255-428), which
    // capture-deposit-hold already uses: platform secret / service role /
    // staff-in-own-tenant with a write role / manager+editor grant, viewer
    // refused.
    const src = code("capture-booking-payment");
    expect(src, "no caller identity is read").toMatch(CALLER_IDENTITY);
    expect(src, "verified_by still comes from the request body").not.toContain("verified_by: approvedBy");
  });

  it("today swallows the failure of the very update that stops the next double capture", () => {
    // PIN. Step 6 writes capture_status:'captured'. If that UPDATE fails the
    // function logs and returns success anyway — leaving a row that still says
    // 'requires_capture' behind money that HAS been captured. The next approve
    // click sails through the state gate, Stripe raises unexpected_state, the
    // substring above does not match, and the operator gets a 500. That is the
    // only route back into the broken branch, and it is held open by a comment
    // that says so.
    // Read as CODE, not as the comment that admits it: the branch body must
    // contain nothing but a console.error — no return, no throw, no warning
    // carried back to the caller.
    const branch = captureStatusErrorBranch();
    expect(branch, "The `if (updatePaymentError)` branch is gone from capture-booking-payment.").not.toBe("");
    expect(branch).toMatch(/console\.error/);
    expect(
      branch,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toMatch(/\breturn\b|\bthrow\b/);
  });

  it.fails("surfaces a failed capture_status write instead of reporting success over it", () => {
    // Remove `.fails` once a failed step-6 update is reported to the caller (the
    // shape charge-saved-card uses: success plus an explicit warning, or a
    // distinct code naming the PaymentIntent). Silently returning success is
    // what re-arms the double-capture path.
    const branch = captureStatusErrorBranch();
    expect(
      branch,
      "The failed capture_status write is still swallowed: the branch logs and falls through.",
    ).toMatch(/\breturn\b|\bthrow\b|warning|requiresReconciliation|unrecorded/i);
  });

  it("today divides the captured amount by a hundred whatever the currency was", () => {
    // PIN, with the arithmetic. index.ts:301 is
    // `capturedAmount: capturedPaymentIntent.amount_received / 100`.
    //
    //   usd: 8900 minor units  / 100 = 89.00  correct
    //   jpy: 12000 minor units / 100 = 120    WRONG — 12000 JPY was captured,
    //                                          and the operator is shown 120,
    //                                          one percent of the money
    //
    // Report-only on this path (the DB figure comes from elsewhere), which is
    // why it is medium and not critical — but the same hardcoded conversion in
    // capture-deposit-hold moves money, and both should be fixed from one
    // shared, currency-aware helper.
    expect(8900 / 100).toBe(89);
    expect(12000 / 100).toBe(120);
    expect(
      code("capture-booking-payment"),
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain("capturedAmount: capturedPaymentIntent.amount_received / 100");
  });

  it.fails("reports the captured amount through a currency-aware conversion", () => {
    // Remove `.fails` once the divisor comes from the currency. The sets and the
    // reasoning already exist in charge-saved-card/index.ts:84-102 and should be
    // lifted into _shared so all four call sites share one implementation.
    const src = code("capture-booking-payment");
    expect(src).not.toContain("amount_received / 100");
    expect(src).toMatch(/ZERO_DECIMAL|zeroDecimal|minorUnits/);
  });
});

// ===========================================================================
// DEPOSIT HOLDS — held, captured, released, and the one that already died.
//
// capture-deposit-hold is the only partial-capture path in the family, and the
// only function here besides charge-saved-card with a real authorisation guard.
// Stripe quirk that shapes the whole file: a partial capture RELEASES the
// uncaptured remainder, so "charge $1, keep $2 on hold" needs either
// multicapture or a fresh rollover authorisation.
// ===========================================================================
describe("stripe/charge-capture — capturing a security-deposit hold", () => {
  const HOLD_CONTRACT: PayloadContract = {
    step: "05-provision",
    fn: "capture-deposit-hold",
    builtIn: "apps/portal/src/components/shared/dialogs/charge-deposit-dialog.tsx",
    payload: {
      rentalId: "00000000-0000-0000-0000-000000000000",
      tenantId: "00000000-0000-0000-0000-000000000001",
      amount: 120,
      reason: "cleaning",
    },
  };

  it("agrees with the payload the portal's charge-deposit dialog sends", () => {
    const shape = assertContract(HOLD_CONTRACT);
    expect(shape.fields.length, `Parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
  });

  it("authorises the caller and refuses a body tenantId that disagrees with the rental", () => {
    // This is the pattern the rest of the family is missing, so it is asserted
    // positively and by ORDER: the guard runs before the rental fetch and before
    // every Stripe call, so a refusal costs nothing and leaks nothing.
    const src = code("capture-deposit-hold");
    const authAt = at(src, "authorizeDepositHoldRequest(", "capture-deposit-hold lost its authorisation guard.");
    const rentalAt = at(src, 'from("rentals")', "capture-deposit-hold no longer reads the rental.");
    const stripeAt = at(src, "paymentIntents.retrieve(", "capture-deposit-hold no longer probes the hold.");
    expect(authAt < rentalAt && authAt < stripeAt).toBe(true);
    // tenantId is a HINT for Stripe config only. Disagreement is a 403, never a
    // silent switch of which account the capture is aimed at.
    expect(src).toMatch(/tenantId !== auth\.rental\.tenant_id[\s\S]{0,120}403/);
  });

  it("refuses a capture larger than the authorisation before any Stripe call", () => {
    // ORDER, not presence: a ceiling below the Stripe call is not a ceiling.
    //
    // Hand arithmetic for the boundary: a 300.00 hold accepts 300.00 and refuses
    // 300.01, because the test is `amount > originalHold`.
    expect(300.01 > 300.0).toBe(true);
    expect(300.0 > 300.0).toBe(false);
    const src = code("capture-deposit-hold");
    const ceilingAt = at(src, "exceeds hold amount", "The over-capture ceiling is gone.");
    const probeAt = at(src, "paymentIntents.retrieve(", "capture-deposit-hold no longer probes the hold.");
    const captureAt = at(src, "paymentIntents.capture(", "capture-deposit-hold no longer captures.");
    expect(
      ceilingAt < probeAt && ceilingAt < captureAt,
      "The over-capture ceiling has moved below Stripe. Capturing more than was " +
        "authorised is refused by Stripe today, but relying on that means the " +
        "refusal arrives as an opaque error and the operator learns nothing.",
    ).toBe(true);
  });

  it("splits a partial capture into a captured amount and a remainder that adds back to the hold", () => {
    // LAYER 3, by hand, from index.ts:123-124:
    //   capturedInCents = Math.round(amount * 100)
    //   remainder       = max(0, originalHold - amount)
    //
    //   hold 300.00, capture 120.00 -> 12000 minor units captured
    //                                  300.00 - 120.00 = 180.00 remainder
    //                                  rollover = round(180.00 * 100) = 18000
    //   hold 300.00, capture 300.00 -> 30000 captured, remainder 0, no rollover
    const capturedInCents = (amount: number) => Math.round(amount * 100);
    const remainder = (hold: number, amount: number) => Math.max(0, hold - amount);

    expect(capturedInCents(120.0)).toBe(12000);
    expect(remainder(300.0, 120.0)).toBe(180.0);
    expect(capturedInCents(remainder(300.0, 120.0))).toBe(18000);
    expect(remainder(300.0, 300.0)).toBe(0);
    // 12000 + 18000 = 30000: the two halves must add back to the authorisation,
    // or the renter is either short or over-held by the difference.
    expect(capturedInCents(120.0) + capturedInCents(remainder(300.0, 120.0))).toBe(30000);

    const src = code("capture-deposit-hold");
    expect(src).toContain("const capturedInCents = Math.round(amount * 100);");
    expect(src).toContain("const remainder = Math.max(0, originalHold - amount);");
  });

  it("keeps the remainder on the same authorisation when the card allows multicapture", () => {
    const src = code("capture-deposit-hold");
    // multicapture 'available' + remainder > 0 -> capture with final_capture
    // false, so Stripe keeps the rest authorised on the SAME PaymentIntent.
    expect(src).toMatch(/multicaptureStatus === "available"/);
    expect(src).toContain("{ amount_to_capture: capturedInCents, final_capture: false }");
    // Same PI, same placed_at, same expires_at — only the amount moves, and the
    // status stays 'held' so a second capture is allowed up to the remainder.
    expect(src).toMatch(/if \(usedMulticapture\)[\s\S]{0,200}deposit_hold_status = "held"/);
    expect(src).toMatch(/rentalUpdate\.deposit_hold_amount = remainder/);
  });

  it("replaces a released remainder with a fresh hold and re-anchors every provenance column with it", () => {
    // Single-capture path: Stripe has already released the remainder, so a new
    // manual-capture PaymentIntent is minted for it. The rollover must carry its
    // OWN provenance — a fabricated 4-day fallback deadline wearing the previous
    // link's 'stripe_capture_before' label is a hold nothing downstream can tell
    // from a real one.
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/idempotencyKey: `deposit-rollover-\$\{rentalId\}-\$\{rental\.deposit_hold_payment_intent_id/);
    for (const column of [
      "deposit_hold_payment_intent_id",
      "deposit_hold_amount",
      "deposit_hold_placed_at",
      "deposit_hold_expires_at",
      "deposit_hold_expiry_source",
      "deposit_hold_extended_auth",
      "deposit_hold_window_seconds",
      "deposit_hold_connect_account_id",
      "deposit_hold_stripe_mode",
      "deposit_hold_platform_account",
    ]) {
      expect(
        src,
        `The rollover no longer re-anchors ${column}. A replacement authorisation ` +
          `wearing the previous one's anchors is captured, refreshed or refunded ` +
          `against the wrong account or the wrong deadline.`,
      ).toContain(`rentalUpdate.${column} =`);
    }
  });

  it("captures on an auto-extend rental but deliberately does not re-hold the remainder", () => {
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/isLongRunning = \(rental as any\)\.auto_extend_enabled === true/);
    expect(src).toMatch(/!usedMulticapture && remainder > 0 && !isLongRunning/);
    // Renewal pricing replaces the deposit on those rentals, so a rollover would
    // ring-fence the same money twice.
    expect(src).toMatch(/remainingHeldAmount: usedMulticapture \|\| newHoldPiId \? remainder : 0/);
  });

  it("answers a hold that is no longer capturable with an actionable code at HTTP 200", () => {
    // Card holds lapse (~7 days on the network, and this repo's own fallback
    // window is 4). Capturing a dead authorisation throws and reaches the
    // operator as "Edge Function returned a non-2xx status code", which tells
    // them nothing. Instead: reconcile the row, then answer 200 with
    // {success:false, code:'hold_expired'} so the dialog can offer
    // Refresh-then-Charge. HTTP 200 is deliberate — supabase-js swallows the
    // body of a non-2xx.
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/preCaptureIntent\.status !== "requires_capture"/);
    expect(src).toMatch(/code:\s*"hold_expired"/);
    expect(src).toMatch(/code:\s*"hold_expired"[\s\S]{0,400}200\s*\)/);
    // The reconciling write is a compare-and-set on the PaymentIntent actually
    // probed, so a capture racing the refresh engine cannot stamp `expired` over
    // a freshly placed replacement.
    expect(src).toMatch(
      /deposit_hold_status: "expired" \}\)[\s\S]{0,200}\.eq\("deposit_hold_payment_intent_id", rental\.deposit_hold_payment_intent_id\)/,
    );
    // And the dialog reads that exact code.
    const dialog = readFileSync(
      join(REPO_ROOT, "apps/portal/src/components/shared/dialogs/charge-deposit-dialog.tsx"),
      "utf8",
    );
    expect(dialog).toContain('result?.code === "hold_expired"');
  });

  it("today calls an already-captured hold 'expired' and tells the operator the funds went back", () => {
    // PIN. The branch is `preCaptureIntent.status !== "requires_capture"`, so
    // EVERY other status becomes deposit_hold_status 'expired' plus the message
    // "the funds were released back to the customer". Two of those statuses mean
    // the opposite of released:
    //
    //   succeeded -> the deposit was already CAPTURED. Money taken, not returned.
    //   canceled  -> genuinely released.
    //
    // An operator told "expired, funds returned" about money that is in their
    // own Stripe balance will charge the renter a second time.
    const src = code("capture-deposit-hold");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      'if (preCaptureIntent.status !== "requires_capture") {',
    );
    expect(src).toMatch(/the funds were released back to the customer/);
  });

  it.fails("distinguishes a captured hold from a released one from a lapsed one", () => {
    // Remove `.fails` once the probe branches three ways:
    //   'succeeded' -> deposit_hold_status 'captured' (money taken)
    //   'canceled'  -> 'released'
    //   otherwise   -> 'expired' / 'needs_review'
    // _shared/deposit-hold-refresh.ts:2082-2114 already does exactly this and is
    // the correctness reference. The compare-and-set on the probed PaymentIntent
    // id is right and must be kept in all three branches.
    const src = code("capture-deposit-hold");
    expect(src, "no succeeded branch").toMatch(/preCaptureIntent\.status === "succeeded"/);
    expect(src, "no canceled branch").toMatch(/preCaptureIntent\.status === "canceled"/);
  });

  it("refuses a second capture once the hold has been fully captured", () => {
    const src = code("capture-deposit-hold");
    // The stored status must be exactly 'held'. After a full capture it is
    // 'captured', so the next call is refused with a 400 naming the status —
    // before Stripe is touched.
    expect(src).toMatch(/rental\.deposit_hold_status !== "held"/);
    expect(src).toMatch(/Cannot capture: deposit hold is \$\{rental\.deposit_hold_status\}/);
    expect(src).toMatch(/rentalUpdate\.deposit_hold_status = "captured"/);
    const gateAt = at(src, 'deposit_hold_status !== "held"', "The status gate is gone.");
    const captureAt = at(src, "paymentIntents.capture(", "capture-deposit-hold no longer captures.");
    expect(gateAt < captureAt).toBe(true);
  });

  it("today accepts an amount that is not a number, which walks straight through the ceiling", () => {
    // PIN, and the arithmetic is the point. Validation is `!amount` then
    // `amount <= 0`. The string 'abc' satisfies neither, so:
    //
    //   'abc' > 300            -> false   (the over-capture ceiling never fires)
    //   Math.round('abc' * 100) -> NaN    (sent as amount_to_capture)
    //
    // NaN also reaches the payments insert as the amount and the remainder
    // arithmetic, so a bad type does not merely fail — it fails inconsistently
    // in four places.
    expect(Boolean("abc")).toBe(true);
    expect(("abc" as unknown as number) <= 0).toBe(false);
    expect(("abc" as unknown as number) > 300).toBe(false);
    expect(Math.round(("abc" as unknown as number) * 100)).toBeNaN();
    expect(Math.max(0, 300 - ("abc" as unknown as number))).toBeNaN();

    const src = code("capture-deposit-hold");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      "if (!rentalId || !amount) {",
    );
    expect(src).toContain("if (amount <= 0) {");
  });

  it.fails("requires a finite positive amount, so the over-capture ceiling cannot be bypassed by a type", () => {
    // Remove `.fails` once the check is Number.isFinite(amount) && amount > 0
    // with a 400 — the way charge-saved-card/index.ts:219-225 does it.
    expect(code("capture-deposit-hold")).toMatch(/Number\.isFinite\(/);
  });

  it("writes nothing at all when a newer authorisation has taken over the rental mid-capture", () => {
    // The rental UPDATE is filtered on the PaymentIntent that was captured. Zero
    // rows means the refresh engine landed a replacement while this capture was
    // in flight, and stamping ANYTHING (even 'needs_review') would take that
    // live hold out of the refresh driver's selection — it re-selects only
    // 'held' and 'failed' — so the replacement would stop being renewed and
    // lapse. The capture is already durably recorded in `payments`, so it is
    // still reported as a success, the orphaned rollover is cancelled, and its
    // id is logged because `rentalUpdate` was the only place it existed.
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/\.eq\("deposit_hold_payment_intent_id", rental\.deposit_hold_payment_intent_id\)\s*\n?\s*\.select\("id"\)/);
    expect(src).toMatch(/!capturedRows \|\| capturedRows\.length === 0/);
    expect(src).toMatch(/orphanedRolloverPi: newHoldPiId \?\? null/);
    expect(src).toMatch(/paymentIntents\.cancel\(newHoldPiId, stripeOptions\)/);
    // Reported as success even so — the money moved.
    expect(src).toMatch(/success:\s*true,\s*\n?\s*capturedAmount: amount/);
  });

  it("merges a second same-day capture into the existing Security Deposit charge instead of colliding", () => {
    // ux_rental_charge_unique blocks a second Charge row with the same
    // rental/due_date/type/category, so capturing the hold in chunks on one day
    // has to add to the row that is already there.
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/\.eq\("category", "Security Deposit"\)[\s\S]{0,120}\.eq\("due_date", today\)/);
    expect(src).toMatch(/Number\(existingCharge\.amount \|\| 0\) \+ amount/);
    // 200.00 already captured today + 50.00 now = 250.00 on the one charge row.
    expect(200.0 + 50.0).toBe(250.0);
  });

  it("today converts the captured amount with a hardcoded hundred, on both the capture and the rollover", () => {
    // PIN. Same 100x exposure as capture-booking-payment, except this one MOVES
    // MONEY: index.ts:123 (`Math.round(amount * 100)`) is amount_to_capture, and
    // index.ts:238 (`Math.round(remainder * 100)`) is the amount authorised on
    // the rollover.
    //
    //   1200 JPY captured -> 1200 * 100 = 120000 minor units = 120,000 JPY
    //
    // charge-saved-card resolves isZeroDecimal first and refuses three-decimal
    // currencies outright; this path does neither.
    expect(1200 * 100).toBe(120_000);
    const src = code("capture-deposit-hold");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      "Math.round(amount * 100)",
    );
    expect(src).toContain("Math.round(remainder * 100)");
  });

  it.fails("converts deposit money in a currency-aware way at every conversion site", () => {
    // Remove `.fails` once the zero-decimal / three-decimal handling from
    // charge-saved-card/index.ts:84-102 is shared and used here. 1200 JPY is
    // amount 1200; a three-decimal currency must be refused, not assumed.
    const src = code("capture-deposit-hold");
    expect(src).toMatch(/ZERO_DECIMAL|zeroDecimal|minorUnitsFor/);
  });

  it("today prices the rollover hold in the tenant's CURRENT currency, not the authorisation's", () => {
    // PIN. Every other field on this path is deliberately anchored to the hold
    // (deposit_hold_stripe_mode, deposit_hold_platform_account,
    // deposit_hold_connect_account_id — the block at index.ts:91-95 explains
    // why), yet the currency comes from tenants.currency_code. The probed
    // PaymentIntent, which carries its own currency, is already in hand.
    expect(code("capture-deposit-hold"), pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      'const currency = (tenant?.currency_code || "usd").toLowerCase();',
    );
  });

  it.fails("takes the rollover's currency from the authorisation it is replacing", () => {
    // Remove `.fails` once the currency is read from preCaptureIntent, keeping
    // the anchoring rule the same block documents. A tenant who changed currency
    // mid-rental otherwise gets a rollover in a currency the original
    // authorisation was never taken in.
    expect(code("capture-deposit-hold")).toMatch(/preCaptureIntent\.currency/);
  });
});

// ===========================================================================
// RELEASING AN AUTHORISATION — cancel-booking-preauth ("reject this booking").
//
// The mirror of capture-booking-payment: void the hold, cancel the rental, free
// the vehicle. Its three pre-Stripe guards are good and are asserted as such;
// what happens after the Stripe call is where the defects are.
// ===========================================================================
describe("stripe/charge-capture — rejecting a pending booking releases its hold", () => {
  const CANCEL_CONTRACT: PayloadContract = {
    step: "05-provision",
    fn: "cancel-booking-preauth",
    builtIn: "apps/portal/src/hooks/use-booking-approval.ts",
    payload: {
      paymentId: "00000000-0000-0000-0000-000000000000",
      rejectedBy: "some-app-user-id",
      reason: "no documents",
    },
    serverOnlyOptional: {
      // NOT an excuse — a finding. No caller in the repo sends tenantId, and the
      // function still lets it override which tenant's Stripe keys and connected
      // account the cancel is aimed at. Pinned and paired below.
      tenantId:
        "No client sends it. The function reads it anyway and TRUSTS it: " +
        "`requestTenantId || payment.tenant_id` at index.ts:60.",
    },
  };

  it("agrees with the payload the portal's reject-booking hook sends", () => {
    const shape = assertContract(CANCEL_CONTRACT);
    expect(shape.typeName).toBe("CancelRequest");
    expect(shape.requiredByType).toContain("paymentId");
  });

  it("keeps all three refusals above the Stripe cancel and above every database write", () => {
    // These exist because of a real incident: extension pay-links share the
    // shape the Pending Bookings queue filtered on, so 86 of them sat in that
    // queue — 23 on ACTIVE rentals. One Reject click cancelled a live rental and
    // marked the car Available while the customer was driving it.
    const src = code("cancel-booking-preauth");
    const extensionAt = at(src, "This is an extension payment link", "The extension pay-link refusal is gone.");
    const statusAt = at(src, "not a pending booking", "The non-Pending rental refusal is gone.");
    const captureAt = at(src, "Payment cannot be cancelled", "The capture_status refusal is gone.");
    const cancelAt = at(src, "paymentIntents.cancel(", "cancel-booking-preauth no longer cancels anything.");
    const writeAt = at(src, 'capture_status: "cancelled"', "The payment write changed shape.");

    for (const [name, index] of [
      ["extension pay-link", extensionAt],
      ["rental-not-Pending", statusAt],
      ["capture_status", captureAt],
    ] as const) {
      expect(
        index < cancelAt && index < writeAt,
        `The ${name} refusal has moved below the Stripe cancel or below the first write. ` +
          "Each one of them protects a LIVE rental: past them this function sets " +
          "rentals.status='Cancelled' and the vehicle back to Available.",
      ).toBe(true);
    }
  });

  it("changes nothing when Stripe refuses to release the hold", () => {
    // A documented fix, asserted so it cannot regress: this used to be swallowed
    // with "Don't fail - continue with database updates", which produced a
    // record saying the customer had been refunded, a freed vehicle and a
    // customer notification while the funds stayed held.
    const src = code("cancel-booking-preauth");
    expect(src).toMatch(/Nothing has been changed/);
    expect(src).toMatch(/Do not retry until the payment account is reachable/);
    const refusalAt = at(src, "Nothing has been changed", "The fail-loud branch is gone.");
    const writeAt = at(src, 'capture_status: "cancelled"', "The payment write changed shape.");
    expect(refusalAt < writeAt).toBe(true);
  });

  it("today reads Stripe's resource_missing as proof the hold is gone", () => {
    // PIN. `resource_missing` means "no such PaymentIntent ON THIS ACCOUNT". It
    // is indistinguishable from "we are looking on the wrong account" — which
    // the body-supplied tenantId in this same function makes reachable, and
    // which the UK->UAE platform migration makes ordinary. Treating it as a
    // release marks the payment 'Refunded', cancels the rental and frees the
    // vehicle while the renter's money may still be held somewhere else.
    const src = code("cancel-booking-preauth");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toMatch(
      /stripeError\.code === "resource_missing"[\s\S]{0,80}holdReleased = true/,
    );
  });

  it.fails("refuses on resource_missing and re-reads the PaymentIntent on an unexpected state", () => {
    // Remove `.fails` once this matches _shared/deposit-hold-refresh.ts:
    //   resource_missing              -> change nothing, needs_review, money 'unknown'
    //                                    (deposit-hold-refresh.ts:2057-2076)
    //   payment_intent_unexpected_state -> retrieve and branch on the real status
    //                                    (deposit-hold-refresh.ts:2079-2114)
    const src = code("cancel-booking-preauth");
    expect(src, "resource_missing is still read as a release").not.toMatch(
      /"resource_missing"[\s\S]{0,80}holdReleased = true/,
    );
    expect(src, "an unexpected state is still not resolved by re-reading the intent").toMatch(
      /paymentIntents\.retrieve\(/,
    );
  });

  it("today computes holdReleased and then never reads it, so the success message can be untrue", () => {
    // PIN. `let holdReleased = false;` carries the comment "Nothing below may
    // claim a release happened unless this is true." It is assigned at :172 and
    // :181 and read NOWHERE. When no PaymentIntent could be resolved at all,
    // the function still writes payments.status 'Refunded', cancels the rental,
    // frees the vehicle and answers "Booking rejected and pre-authorization
    // released" — about money that was never taken and a hold that never existed.
    const src = code("cancel-booking-preauth");
    const assignments = src.match(/holdReleased/g) ?? [];
    expect(
      assignments.length,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  Three mentions = declared and assigned twice, never read.",
    ).toBe(3);
    expect(src).toMatch(/message: "Booking rejected and pre-authorization released"/);
  });

  it.fails("gates the release-shaped writes and the release-shaped message on an actual release", () => {
    // Remove `.fails` once holdReleased is READ: with no PaymentIntent there was
    // nothing to release, so payments.status must not become 'Refunded' and the
    // response must not claim a released pre-authorisation. The comment at
    // index.ts:158 already states the rule; the code does not implement it.
    const src = code("cancel-booking-preauth");
    expect(src, "holdReleased is still never read").toMatch(/if \(holdReleased|holdReleased \?|holdReleased &&|!holdReleased/);
  });

  it("today aims its 'void the unpaid charges' step at a table that does not exist", () => {
    // PIN, established from the generated schema rather than from a belief: the
    // types file that is generated from the production database has
    // ledger_entries and payments and NO `charges` table, and ledger_entries has
    // no `status` column either. So this UPDATE can never match anything, its
    // error is only console.error'd, and a rejected booking's outstanding
    // charges are left standing. Two independent errors, so even a rename would
    // not fix it.
    const types = readFileSync(join(REPO_ROOT, "apps/portal/src/integrations/supabase/types.ts"), "utf8");
    expect(types, "The generated types no longer contain ledger_entries — this check is void.").toMatch(
      /^ {6}ledger_entries: \{$/m,
    );
    expect(types, "The generated types no longer contain payments — this check is void.").toMatch(
      /^ {6}payments: \{$/m,
    );
    expect(
      types,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  A `charges` table now exists in the schema, so the write below may be real.",
    ).not.toMatch(/^ {6}charges: \{$/m);
    expect(code("cancel-booking-preauth")).toContain('.from("charges")');
  });

  it.fails("voids the rental's outstanding ledger rows through the table the rest of the system writes", () => {
    // Remove `.fails` once the step targets ledger_entries Charge rows — the
    // table apply-payment and capture-deposit-hold actually read and write — and
    // stops swallowing the error.
    const src = code("cancel-booking-preauth");
    expect(src, "still writing to a non-existent table").not.toContain('.from("charges")');
    expect(src, "the void step no longer exists at all, which is also wrong").toMatch(/ledger_entries/);
  });

  it("today lets the request body choose which tenant's Stripe account the cancel is aimed at", () => {
    // PIN. `const tenantId = requestTenantId || payment.tenant_id;` and the
    // resolved tenant then supplies the Stripe mode and the connected account
    // used for the cancel. Combined with the resource_missing pin above, a
    // caller-chosen account is exactly how "we looked in the wrong place" gets
    // recorded as "the hold is gone".
    expect(
      code("cancel-booking-preauth"),
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toContain("const tenantId = requestTenantId || payment.tenant_id;");
  });

  it.fails("resolves the tenant from the payment record and 403s a body tenantId that disagrees", () => {
    // Remove `.fails` once this matches capture-deposit-hold/index.ts:60-62,
    // which treats a body tenantId as a hint and refuses a mismatch with a 403.
    const src = code("cancel-booking-preauth");
    expect(src).not.toContain("requestTenantId || payment.tenant_id");
    expect(src, "no 403 on a disagreeing tenantId").toMatch(/403/);
  });
});

// ===========================================================================
// RECONCILIATION — the three functions that decide, after the fact, whether
// money moved. They write the same capture_status the capture paths do, from
// much weaker evidence.
// ===========================================================================
describe("stripe/charge-capture — reconciling a payment row against Stripe", () => {
  it("today stamps a payment 'captured' on the strength of a session merely having a PaymentIntent", () => {
    // PIN, and the most serious thing in this file. sync-payment-intent takes
    // paymentId, checkoutSessionId, tenantId and mode straight off the body,
    // retrieves the session, and if it has ANY payment_intent writes
    //   { stripe_payment_intent_id, capture_status: 'captured' }
    // to that paymentId. It never looks at session.payment_status, never looks
    // at the PaymentIntent's status, never proves the session belongs to the
    // payment, and reads no Authorization header.
    //
    // A manual-capture booking session sitting at requires_capture — money
    // authorised, NOT taken — is therefore recordable as captured. Downstream,
    // apply-payment's capture guard (asserted below) keys on exactly
    // capture_status === 'requires_capture', so stamping 'captured' is also what
    // switches that guard off.
    const src = code("sync-payment-intent");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toMatch(
      /\.update\(\{\s*stripe_payment_intent_id: paymentIntentId,\s*capture_status: 'captured'/,
    );
    expect(src, "It still consults nothing about whether the money moved.").not.toContain("payment_status");
  });

  it.fails("writes 'captured' only when Stripe says the money was actually taken", () => {
    // Remove `.fails` once the write is conditional on
    // session.payment_status === 'paid' (or the PaymentIntent's status being
    // 'succeeded'), the session is proved to belong to the payment, `mode` stops
    // being taken from the body, and the caller is authorised.
    const src = code("sync-payment-intent");
    expect(src, "no payment_status / succeeded check").toMatch(/payment_status|['"]succeeded['"]/);
    expect(src, "no caller identity is read").toMatch(CALLER_IDENTITY);
  });

  it("today cannot tell 'Stripe says not paid' from 'we could not reach Stripe'", () => {
    // PIN. Both answers are byte-identical: HTTP 200 {ok:false, notPaidYet:true}
    // — one from the catch around the session retrieve, one from `!sessionPaid`.
    // The booking success page polls this, so an outage is shown to a customer
    // who HAS paid as "you have not paid yet", and the poller has nothing to
    // back off on.
    const src = code("process-pending-payment");
    const occurrences = src.match(/notPaidYet: true/g) ?? [];
    expect(
      occurrences.length,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).toBe(2);
  });

  it.fails("distinguishes an unreachable Stripe from an unpaid session", () => {
    // Remove `.fails` once the unreachable case carries its own flag (e.g.
    // stripeUnavailable) so the poller can back off and the success page can
    // stop claiming the customer simply has not paid.
    const src = code("process-pending-payment");
    expect(src).toMatch(/stripeUnavailable|unreachable|checkFailed/);
  });

  it("today has no terminal-state guard, so a rejected or refunded payment can be re-stamped Completed", () => {
    // PIN. The already-processed check covers Applied, Completed and Partial
    // only. cancel-booking-preauth leaves exactly status 'Refunded' +
    // capture_status 'cancelled' behind — and those fall through to
    //   .update({ status: 'Completed', capture_status: 'captured', paid_at, ... })
    // so a rejected booking whose success page is reopened is resurrected as
    // captured money.
    const src = code("process-pending-payment");
    expect(src, pinNote("delete this pin and drop `.fails` from the case below.")).toContain(
      "if (payment.status === 'Applied' || payment.status === 'Completed' || payment.status === 'Partial') {",
    );
    // The states the guard does not mention, written by the reject path.
    expect(code("cancel-booking-preauth")).toMatch(/status: "Refunded"/);
  });

  it.fails("refuses to resurrect a payment that is already in a terminal state", () => {
    // Remove `.fails` once status in (Cancelled, Refunded, Reversed) or
    // capture_status 'cancelled' is refused with an explicit conflict response.
    const src = code("process-pending-payment");
    expect(src).toMatch(/['"]Refunded['"]|['"]Reversed['"]|['"]Cancelled['"]/);
  });

  it("refuses to allocate a checkout payment Stripe never captured", () => {
    // apply-payment is the shared settlement hand-off every successful charge in
    // this family calls, and this is the guard that stops phantom Collected: a
    // Payment row with a checkout session, no PaymentIntent and capture_status
    // 'requires_capture' means the customer never finished checkout, so there is
    // no money to allocate. Asserted as correct behaviour, in full, because the
    // reconcilers above are precisely what can defeat it by writing 'captured'.
    const src = code("apply-payment");
    for (const term of [
      "payment.payment_type === 'Payment'",
      "payment.stripe_checkout_session_id",
      "!payment.stripe_payment_intent_id",
      "payment.capture_status === 'requires_capture'",
    ]) {
      expect(src, `apply-payment's capture guard lost its \`${term}\` term.`).toContain(term);
    }
    expect(src).toContain("Payment not yet captured by Stripe");
    const guardAt = at(src, "Payment not yet captured by Stripe", "The capture guard is gone.");
    const ledgerAt = at(src, "ledger_entries", "apply-payment no longer writes the ledger.");
    expect(
      guardAt < ledgerAt,
      "The capture guard has moved below the first ledger write. Allocating an " +
        "uncaptured payment inflates Collected, masks the true Balance Due and " +
        "creates phantom payment_applications that have to be hand-reversed.",
    ).toBe(true);
  });

  it("today accepts a paymentId and a set of target categories from anyone who can reach it", () => {
    // PIN. apply-payment reads no Authorization header while holding a
    // service-role client, and `targetCategories` from the body overrides what
    // the payment row says — which moves settled money between ledger
    // categories, and a later refund is only allowed to draw what its category
    // received. Its real callers are charge-saved-card,
    // capture-booking-payment, process-pending-payment and the Stripe webhooks,
    // all of which can present the service-role bearer.
    // Again the check is on the READ, not on the word: `Authorization` appears
    // in this file's Access-Control-Allow-Headers string, which is a header it
    // permits rather than one it inspects.
    const src = code("apply-payment");
    expect(
      src,
      pinNote("delete this pin and drop `.fails` from the case below."),
    ).not.toMatch(CALLER_IDENTITY);
    expect(src).toContain("const { paymentId, targetCategories, holdAsCredit } = body;");
  });

  it.fails("authorises its caller before reallocating settled money", () => {
    // Remove `.fails` once apply-payment accepts the service-role bearer /
    // x-platform-secret or an authorised staff session scoped to the payment's
    // tenant, and refuses everything else.
    expect(code("apply-payment")).toMatch(CALLER_IDENTITY);
  });
});

// ===========================================================================
// THE FAILURE CLASSIFIER — how an unattended retry reads the same decline.
//
// charge-saved-card answers an operator who is watching, so it wants the class
// of failure. The hold-refresh engine retries with nobody watching, so it wants
// the exact decline. The two therefore read Stripe's error object in OPPOSITE
// order, and that is deliberate — asserted here so a well-meaning
// "consolidation" of the two helpers has to come and read this first.
//
// These are source assertions, not executed calls: deposit-hold-refresh.ts
// transitively imports https://esm.sh/stripe, which no Node loader resolves, so
// classifyStripeFailure cannot be called from Vitest. The arithmetic in the
// comments is hand-derived from the ladders in that file.
// ===========================================================================
describe("stripe/charge-capture — how the unattended retry engine reads a decline", () => {
  it("puts insufficient funds and a bare card_declined on the slow ladder, not the dead-card path", () => {
    const src = shared("deposit-hold-refresh.ts");
    const fundsBlock = /const FUNDS_CODES = new Set\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? "";
    expect(fundsBlock, "FUNDS_CODES is gone.").not.toBe("");
    for (const codeName of [
      "insufficient_funds",
      "withdrawal_count_limit_exceeded",
      "card_velocity_exceeded",
      // do_not_honor and generic_decline are the two most common declines in
      // existence; a dead-end 'needs_review' on either would end most chains on
      // a routine hiccup.
      "generic_decline",
      "do_not_honor",
      "card_declined",
    ]) {
      expect(fundsBlock, `${codeName} left the funds class.`).toContain(`"${codeName}"`);
    }
  });

  it("treats an expired or lost card as a dead card, and our own database blip as transient", () => {
    const src = shared("deposit-hold-refresh.ts");
    const dead = /const DEAD_CARD_CODES = new Set\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? "";
    for (const codeName of ["expired_card", "lost_card", "stolen_card", "resource_missing"]) {
      expect(dead, `${codeName} left the dead-card class.`).toContain(`"${codeName}"`);
    }
    const transient = /const TRANSIENT_CODES = new Set\(\[([\s\S]*?)\]\);/.exec(src)?.[1] ?? "";
    expect(
      transient,
      "db_write_failed left the transient class. Untagged it falls through to " +
        "'ambiguous' -> 'needs_review' with next_retry_at NULL, i.e. a PostgREST " +
        "hiccup silently retires a rental from the retry loop.",
    ).toContain('"db_write_failed"');
  });

  it("classifies in the order SCA, funds, dead card, transient, and calls anything else ambiguous", () => {
    // The order is load-bearing: card_declined lives in FUNDS_CODES, and
    // 'authentication_required' must be caught before it so SCA is never read as
    // a money problem. Anything unplaceable goes to 'ambiguous' -> needs_review,
    // never to a terminal status — writing 'expired' because our own code threw
    // is how chains died silently.
    const src = shared("deposit-hold-refresh.ts");
    const scaAt = at(src, 'code === "authentication_required"', "The SCA branch is gone.");
    const fundsAt = at(src, "FUNDS_CODES.has(code)", "The funds branch is gone.");
    const deadAt = at(src, "DEAD_CARD_CODES.has(code)", "The dead-card branch is gone.");
    const transientAt = at(src, "TRANSIENT_CODES.has(code)", "The transient branch is gone.");
    expect(scaAt < fundsAt && fundsAt < deadAt && deadAt < transientAt).toBe(true);
    expect(src).toMatch(/return "ambiguous";/);
    // And it reads decline_code FIRST — the opposite of charge-saved-card, which
    // needs the class rather than the reason.
    expect(src).toMatch(/err\?\.decline_code\s*\?\?\s*err\?\.raw\?\.decline_code\s*\?\?\s*err\?\.code/);
    expect(code("charge-saved-card")).toMatch(/e\?\.code\s*\?\?\s*e\?\.raw\?\.code\s*\?\?\s*e\?\.decline_code/);
  });

  it("stops asking the issuer after eight attempts, on ladders that never shorten a funds decline", () => {
    // Stripe's own guidance: a maximum of eight retries, past which issuers may
    // read further attempts as fraud.
    //
    // Hand arithmetic for the two ladders, from computeRetryAt:
    //   transient, 0 prior failures, deadline now+2h
    //     candidate  = now + 6h
    //     lastChance = max(now + 30min, (now + 2h) - 1h) = now + 1h
    //     6h > 1h    -> retry at now + 1h
    //   transient, 0 prior failures, deadline now+10min
    //     lastChance = max(now + 30min, now - 50min) = now + 30min  (floor wins)
    //   funds, 0 prior failures, deadline now+2h
    //     candidate  = now + 24h, and funds is deliberately NOT clamped -> 24h
    const src = shared("deposit-hold-refresh.ts");
    expect(src).toContain("export const MAX_HOLD_ATTEMPTS = 8;");
    expect(src).toContain("const TRANSIENT_BACKOFF_HOURS = [6, 24, 72];");
    expect(src).toContain("const FUNDS_BACKOFF_HOURS = [24, 72, 72];");
    // The clamp constants the arithmetic above uses: one hour of lead, a thirty
    // minute floor. 3_600_000 ms = 1h; 1_800_000 ms = 30min.
    expect(3_600_000).toBe(60 * 60 * 1000);
    expect(1_800_000).toBe(30 * 60 * 1000);
    expect(src).toContain("Math.max(now.getTime() + 1_800_000, deadline - 3_600_000)");
    expect(src, "The funds ladder is being clamped now, which re-presents a declined card.").toContain(
      'if (failureClass !== "funds" && expiresAt)',
    );
  });

  it("treats the fallback hold window as four days and labels anything derived from it a guess", () => {
    // Visa's card-absent merchant-initiated window is 4d18h. A 7-day guess plus
    // the 2-day lookahead means the row is first examined AFTER the
    // authorisation has died: the row says 'held', the money is back with the
    // renter, and nothing notices. Both constants must agree.
    expect(shared("deposit-hold-refresh.ts")).toContain("export const FALLBACK_HOLD_WINDOW_DAYS = 4;");
    expect(shared("stripe-client.ts")).toContain("export const HOLD_EXPIRY_FALLBACK_DAYS = 4;");
    // 4 days = 345600 seconds, comfortably inside 4d18h = 410400 seconds.
    expect(4 * 24 * 60 * 60).toBe(345_600);
    expect(4 * 24 * 60 * 60 + 18 * 60 * 60).toBe(410_400);
    // And a fabricated deadline must be labelled as one.
    expect(shared("deposit-hold-refresh.ts")).toMatch(/["']fallback["']/);
  });

  it("rotates the replacement authorisation's idempotency key with the attempt and the amount", () => {
    // The old key embedded the OLD PaymentIntent id, which the failure path never
    // updated — so every retry inside Stripe's 24h window replayed the cached
    // decline verbatim, and a rebased amount on the same key returned
    // idempotency_error, which the card-feature ladder does not match and which
    // rethrew straight into a terminal 'expired'.
    expect(shared("deposit-hold-refresh.ts")).toContain(
      "const idempotencyKey = `deposit-refresh-${rentalId}-${attemptSeq}-${amountCents}`;",
    );
  });
});

// ===========================================================================
// LAYER 2 — live. OFF unless the env says otherwise, and production is refused
// by helpers/live-call.ts before any of this runs.
//
// WHAT EACH CASE DOES IF ENABLED:
//
//   "capture-booking-payment answers a payment id that cannot exist"
//       POSTs a non-existent UUID with the anon key. capture-booking-payment
//       looks the row up first and returns 404 before it resolves any Stripe
//       client, so it moves no money and writes nothing. Needs only
//       D247_LIVE_TESTS=1. This folder's harness probe: it proves the suite is
//       reaching a real deployed function.
//
//   "an anon caller is turned away by capture-deposit-hold"
//       POSTs the same non-existent rental at capture-deposit-hold with the anon
//       key. authorizeDepositHoldRequest refuses before the rental fetch and
//       before Stripe, so it is read-only. Needs only D247_LIVE_TESTS=1.
//
//   "capture-deposit-hold refuses to capture more than was authorised"
//       Needs the full ladder (D247_LIVE_TESTS + D247_LIVE_ALLOW_WRITES +
//       D247_LIVE_ALLOW_MONEY_MOVEMENT + D247_LIVE_STRIPE_MODE=test) AND a
//       fixture, because it POSTs at a REAL rental with a live hold. It expects
//       the ceiling to refuse; the ceiling holding is the thing being tested, so
//       it is gated as if it does not.
// ===========================================================================
const NON_EXISTENT_ID = "00000000-0000-0000-0000-0000000000ff";

describe("stripe/charge-capture — live (Layer 2)", () => {
  it("live: capture-booking-payment answers a payment id that cannot exist without capturing anything", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no " +
          "apikey header before the function is ever invoked, so this probe would " +
          "measure the gateway rather than capture-booking-payment.",
      );
      return;
    }

    const res = await liveCall(
      "capture-booking-payment",
      { paymentId: NON_EXISTENT_ID, approvedBy: "drive247 spine suite" },
      { token: status.target.anonKey },
    );

    // A 4xx is the only acceptable family here, and NOT a 5xx: the lookup is the
    // first thing this function does, so an unknown id must be a clean refusal.
    expect(
      res.status >= 400 && res.status < 500,
      `capture-booking-payment answered ${res.status} for a payment id that cannot exist.\n` +
        `  ${classifyLive(res).explain}\n` +
        "  A 5xx means an unknown id now reaches something that throws.",
    ).toBe(true);

    // WHICH 4xx is itself the finding, and it is recorded rather than asserted
    // in only one direction:
    //   404 — the row lookup answered, i.e. the function ran for an unauthorised
    //         caller holding nothing but the public anon key. That is the hole
    //         the Layer 1 pin above records.
    //   401/403 — a caller-authorisation guard has landed. Good news; the
    //         `it.fails` pair for this function will go red and should be closed.
    expect([401, 403, 404]).toContain(res.status);
  });

  it("live: capture-deposit-hold turns an anon caller away before it looks at any money", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set; this probe would measure the gateway.");
      return;
    }

    const res = await liveCall(
      "capture-deposit-hold",
      { rentalId: NON_EXISTENT_ID, amount: 1, reason: "drive247 spine suite — auth probe" },
      { token: status.target.anonKey },
    );

    // authorizeDepositHoldRequest runs above the rental fetch, so the anon key
    // must be refused — not answered with "rental not found", which would mean
    // the guard has moved below the lookup.
    expect(
      [401, 403],
      `Expected capture-deposit-hold to refuse an anon caller.\n` +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 404 means the authorisation guard now sits BELOW the rental fetch, so\n" +
        "  the endpoint is once again answering questions for the public anon key —\n" +
        "  the exact hole _shared/deposit-hold-auth.ts was written to close.\n" +
        `  ${classifyLive(res).explain}`,
    ).toContain(res.status);
  });

  it.skipIf(!liveMoneyMovementRequested())(
    "live: capture-deposit-hold refuses to capture more than the authorisation, before Stripe is called",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      // No fixture helper exists for deposit holds — tests/helpers/stripe-live.ts
      // is built for process-refund — so the rental is named explicitly or the
      // case skips. It must be a rental on the target project with a LIVE hold in
      // test mode, and a portal JWT that may act on it.
      const rentalId = process.env.D247_LIVE_DEPOSIT_HOLD_RENTAL_ID?.trim();
      const jwt = process.env.D247_LIVE_PORTAL_JWT?.trim();
      if (!rentalId || !jwt) {
        ctx.skip(
          "Set D247_LIVE_DEPOSIT_HOLD_RENTAL_ID (a rental with a live test-mode hold) " +
            "and D247_LIVE_PORTAL_JWT (a portal session that may charge it). Without " +
            "both, this case would either measure authorisation or guess a rental.",
        );
        return;
      }

      // Absurd by construction: the per-charge sanity ceiling elsewhere in the
      // family is 100,000 major units, and no deposit hold is 1,000,000.
      const res = await liveCall(
        "capture-deposit-hold",
        { rentalId, amount: 1_000_000, reason: "drive247 spine suite — over-capture probe" },
        { token: jwt },
      );

      expect(
        res.status,
        "capture-deposit-hold did not refuse a capture of 1,000,000.\n" +
          `  ${res.status}: ${res.text.slice(0, 300)}\n` +
          "  FAILURE MODE (b), and the worst kind: the arithmetic that stops an " +
          "operator taking more than the renter authorised did not run.\n" +
          `  ${classifyLive(res).explain}`,
      ).toBe(400);

      // The refusal has to be OUR ceiling, not Stripe's. A Stripe-shaped message
      // would mean the capture was attempted and Stripe declined it — the same
      // outcome by luck rather than by design, and one that would not hold for an
      // amount Stripe happened to accept.
      expect(
        String(res.json?.error ?? res.text),
        "capture-deposit-hold refused, but not with its own ceiling message. Either " +
          "the wording changed (failure mode (a)) or the refusal came from Stripe, " +
          "which means the ceiling now sits below the capture — and the Layer 1 " +
          "order case in this file says that cannot happen.",
      ).toMatch(/exceeds hold amount/i);
    },
  );
});
