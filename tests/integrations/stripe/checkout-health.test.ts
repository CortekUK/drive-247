// =============================================================================
// integrations/stripe — RENTAL CHECKOUT: the health check, then the contract.
//
// SCOPE: axis 1 — the rental operator collecting money from their renter. The
// nine edge functions that mint a Stripe Checkout Session for a rental:
//
//   create-checkout-session            the rental checkout (portal + booking)
//   create-preauth-checkout            authorise-now, capture-after-approval
//   create-hold-checkout               the deposit authorisation
//   send-excess-mileage-payment-link   a one-off charge, emailed
//   create-upfront-checkout            instalment upfront (PARKED scope, read
//                                      only as the family's correct example)
//   void-payment-link / get-stripe-config / probe-checkout-sessions
//
// OUT OF SCOPE, deliberately: the PLATFORM subscription axis — Drive247 billing
// its tenants — which is a different Stripe account with its own keys and is
// already covered by tests/integrations/stripe/checkout.test.ts. Nothing here
// re-asserts or contradicts that file. Extensions, auto-extension,
// pay-as-you-go and instalments are parked.
//
// THE ORDER THE TEAM LEAD ASKED FOR
//
//   1. "a checkout of any number, of anything, gets created ... this is just to
//      see whether Stripe on its own is working fine." That is the first
//      describe: a deliberately dumb health check. If minting a link is broken,
//      every other payments assertion in this folder is noise.
//   2. then the real rental paths — where the amount comes from, what the
//      session says, and what a second click does.
//
// THREE LAYERS, as in the rest of the suite:
//
//   LAYER 1  source-derived. Reads supabase/functions/<fn>/index.ts as TEXT
//            through helpers/edge-contract. No network, runs in CI, cannot lie
//            about what the deployed file says — but also cannot run it. Most
//            of this file.
//   LAYER 2  real HTTP, through helpers/live-call. OFF unless the full ladder
//            of env vars is set, and it refuses the production project ref
//            (hviqoaokxvlancmftwuo) before the first fetch.
//   LAYER 3  pure maths on importable modules, with every expected value
//            derived BY HAND and the arithmetic written in the comment.
//
// HOW A DEFECT IS RECORDED HERE (read this before editing anything below)
//
// Where the code is wrong, there are TWO tests:
//
//   * one plain test that PINS THE ACTUAL, wrong behaviour, so the size and
//     shape of the bug is on record; and
//   * one `it.fails(...)` asserting the CORRECT behaviour. `it.fails` passes
//     while the bug exists and turns RED the day someone fixes it, which forces
//     a human to come back here, delete the pin, and drop the `.fails` marker.
//
// A plain test asserting the broken shape would go red on the fix instead. That
// mistake has already been made five times in this repo and had to be undone
// each time. Every `it.fails` below carries the "remove .fails when fixed" note.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  assertContract,
  blankComments,
  readEdgeFunction,
  readEdgeFunctionSource,
  REPO_ROOT,
  type PayloadContract,
} from "../../helpers/edge-contract";
import {
  classifyLive,
  isProductionRef,
  liveCall,
  liveMoneyGate,
  liveMoneyMovementRequested,
  mentionsProductionRef,
  liveStatus,
} from "../../helpers/live-call";
import { resolveRefundFixture } from "../../helpers/stripe-live";
import { majorToMinorUnits } from "@fn/_shared/payments/square-adapter.ts";
import { STRIPE_CAPABILITIES, capabilitiesFor } from "@fn/_shared/payments/capabilities.ts";

// ---------------------------------------------------------------------------
// Local reading helpers.
//
// Everything is read through `src()`, which blanks comments first. That is not
// tidiness: these nine files are among the most heavily commented in the repo,
// and several of them DISCUSS the very strings being asserted. create-hold-
// checkout's header, for instance, contains the sentence "It read no
// Authorization header" — so a naive search for "Authorization" in that file
// finds the prose and concludes the guard exists.
// ---------------------------------------------------------------------------

const srcCache = new Map<string, string>();
function src(fn: string): string {
  const hit = srcCache.get(fn);
  if (hit !== undefined) return hit;
  const text = blankComments(readEdgeFunctionSource(fn));
  srcCache.set(fn, text);
  return text;
}

/**
 * The rental-axis creators, in the order money meets them. `create-upfront-
 * checkout` is included because it is a checkout creator that this axis'
 * guards are read by (void/refund read the row it writes), even though
 * instalments themselves are parked.
 */
const RENTAL_CREATORS = [
  "create-checkout-session",
  "create-preauth-checkout",
  "create-hold-checkout",
  "send-excess-mileage-payment-link",
  "create-upfront-checkout",
] as const;

/** The three that take money on the caller's word and check nobody's identity. */
const ANONYMOUS_CREATORS = [
  "create-checkout-session",
  "create-preauth-checkout",
  "send-excess-mileage-payment-link",
] as const;

/** Balanced `{ ... }` starting at the first `{` after `marker`. Inner text only. */
function objectBlockAfter(text: string, marker: string, which: "first" | "last" = "last"): string {
  const at = which === "last" ? text.lastIndexOf(marker) : text.indexOf(marker);
  if (at === -1) throw new Error(`marker not found: ${marker}`);
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

/**
 * Depth-0 entries of an object literal: the plain `key:` names, and how many
 * `...(cond ? { ... } : {})` conditional spreads sit alongside them. Depth
 * matters — a nested `product_data: { name: ... }` is not a top-level key.
 */
function topLevelEntries(block: string): { keys: string[]; spreads: number; spreadNames: string[] } {
  const keys: string[] = [];
  const spreadNames: string[] = [];
  let spreads = 0;
  let depth = 0;
  let start = 0;
  const segments: string[] = [];
  const padded = `${block},`;
  for (let i = 0; i < padded.length; i += 1) {
    const c = padded[i];
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (c === "," && depth === 0) {
      segments.push(padded.slice(start, i));
      start = i + 1;
    }
  }
  for (const seg of segments) {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(seg);
    if (m) {
      keys.push(m[1]);
      continue;
    }
    if (seg.trim().startsWith("...(")) {
      spreads += 1;
      continue;
    }
    // `...metadata` — a whole object spread in by name. create-upfront-checkout
    // builds one `metadata` const and spreads it into BOTH the PaymentIntent and
    // the session, so the keys that matter are not written at this level at all.
    const named = /^\s*\.\.\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(seg);
    if (named) spreadNames.push(named[1]);
  }
  return { keys, spreads, spreadNames };
}

/**
 * Top-level key names of a function's SESSION metadata, following any
 * `...identifier` spread back to the object literal that identifier was
 * declared from. Without the follow-through, a function that composes its
 * metadata once and spreads it twice looks like it carries no correlation
 * fields at all.
 */
function sessionMetadataKeys(fn: string): string[] {
  const s = src(fn);
  const { keys, spreadNames } = topLevelEntries(objectBlockAfter(s, "metadata: {"));
  const merged = [...keys];
  for (const name of spreadNames) {
    merged.push(...topLevelEntries(objectBlockAfter(s, `const ${name} = {`, "first")).keys);
  }
  return merged;
}

/**
 * The managed-model fall-through in `getConnectAccountId`: the live +
 * onboarding-complete branch returns the tenant's own Connect account, and
 * anything else — live with onboarding INCOMPLETE included — drops out of the
 * function on a bare `return null`, which every caller turns into "no
 * stripeAccount", which Stripe reads as "charge the platform".
 *
 * Matched as code rather than as the line's comment, so the pin does not rot if
 * someone rewords the comment without changing the behaviour.
 */
const LIVE_ONBOARDING_FALLS_THROUGH_TO_PLATFORM =
  /if \(tenant\.stripe_mode === 'live' && tenant\.stripe_onboarding_complete\) \{[\s\S]{0,200}?return tenant\.stripe_account_id;[\s\S]{0,80}?\}\s*return null;/;

/** Does this file read the caller's Authorization header at all? */
const READS_AUTH_HEADER = /headers\s*\.\s*get\(\s*["'`]?authorization/i;
/** Does it resolve that header to a person? */
const RESOLVES_CALLER = /auth\s*\.\s*getUser\s*\(|authorize[A-Z]\w*\s*\(/;

// ===========================================================================
// 1. THE HEALTH CHECK — "does a link get created at all"
// ===========================================================================
describe("stripe/checkout — the health check: can a payment link be created at all", () => {
  it("every rental checkout creator answers with both an identifier and a payable URL", () => {
    // The seam's own docs record the incident this prevents: an operator
    // clicked "create payment link", got HTTP 200, and no link existed. A
    // success response that carries no URL is indistinguishable from a real one
    // at the call site, so both halves have to be in the response.
    const expected: Record<string, [string, string]> = {
      "create-checkout-session": ["sessionId: session.id", "url: session.url"],
      "create-preauth-checkout": ["sessionId: session.id", "url: session.url"],
      "create-hold-checkout": ["sessionId: session.id", "url: session.url"],
      "send-excess-mileage-payment-link": ["sessionId", "sessionUrl: paymentUrl"],
      "create-upfront-checkout": ["sessionId: session.id", "url: session.url"],
    };
    for (const fn of RENTAL_CREATORS) {
      const [id, url] = expected[fn];
      const s = src(fn);
      expect(s, `${fn} no longer returns a session identifier (${id})`).toContain(id);
      expect(
        s,
        `${fn} no longer returns the payment URL (${url}). A caller cannot tell that ` +
          `from success, and the customer is shown a Pay button that goes nowhere.`,
      ).toContain(url);
    }
  });

  it("the rental checkout takes one line item, in payment mode, and returns it with a 200", () => {
    // The three things the dumb health check depends on. Asserted from source so
    // they hold on the default offline run, and so the Layer 2 case below is
    // known to be exercising this exact shape.
    const s = src("create-checkout-session");
    expect(s).toContain("mode: 'payment'");
    expect(s).toContain("line_items: [");
    expect(s).toContain("await stripe.checkout.sessions.create(sessionConfig, stripeOptions)");
    expect(s).toContain("status: 200,");
  });

  it("the live layer recognises the production project ref wherever it is written", () => {
    // Layer 2 in this family CREATES a real, payable Stripe link and a real
    // payments row. One mis-set env var against production would mint live
    // payment links on paying operators' accounts, so the refusal is asserted
    // before anything else in this file is allowed to make a call.
    expect(isProductionRef("hviqoaokxvlancmftwuo")).toBe(true);
    expect(
      mentionsProductionRef("https://hviqoaokxvlancmftwuo.supabase.co/functions/v1"),
      "the canonical production URL is no longer recognised",
    ).toBe("hviqoaokxvlancmftwuo");
    // Not only in the first host label: a proxy or a path-mounted gateway hides
    // the ref from the canonical parse, and D247_LIVE_PROJECT_REF exists to
    // declare a target away — which must never be able to declare production
    // away. Substring, case-insensitive.
    expect(mentionsProductionRef("https://api.drive-247.com/HVIQOAOKXVLANCMFTWUO/functions/v1")).toBe(
      "hviqoaokxvlancmftwuo",
    );
    expect(mentionsProductionRef("https://ksmreaadhbirzakkxqrq.supabase.co/functions/v1")).toBe(null);
  });

  it("the live layer throws rather than calling a target that names production", () => {
    // Env is mutated and restored. `liveStatus()` reads process.env at call
    // time, which is what makes this assertable with no network at all.
    const saved = {
      tests: process.env.D247_LIVE_TESTS,
      url: process.env.D247_LIVE_FUNCTIONS_URL,
      ref: process.env.D247_LIVE_PROJECT_REF,
      key: process.env.D247_LIVE_ANON_KEY,
      jwt: process.env.D247_LIVE_SESSION_JWT,
    };
    try {
      process.env.D247_LIVE_TESTS = "1";
      process.env.D247_LIVE_FUNCTIONS_URL = "https://hviqoaokxvlancmftwuo.supabase.co/functions/v1";
      // The escape hatch, pointed somewhere harmless. It must not launder the
      // URL above — that combination is exactly how a run lands on production.
      process.env.D247_LIVE_PROJECT_REF = "ksmreaadhbirzakkxqrq";
      delete process.env.D247_LIVE_ANON_KEY;
      delete process.env.D247_LIVE_SESSION_JWT;
      expect(() => liveStatus()).toThrow(/hviqoaokxvlancmftwuo|production/i);
    } finally {
      for (const [k, v] of Object.entries({
        D247_LIVE_TESTS: saved.tests,
        D247_LIVE_FUNCTIONS_URL: saved.url,
        D247_LIVE_PROJECT_REF: saved.ref,
        D247_LIVE_ANON_KEY: saved.key,
        D247_LIVE_SESSION_JWT: saved.jwt,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  // -------------------------------------------------------------------------
  // LAYER 2 — the team lead's health check, for real.
  //
  // WHAT IT DOES WHEN ENABLED: POSTs at create-checkout-session with the
  // fixture rental and an arbitrary 12.34, and expects a Stripe session id and
  // a checkout.stripe.com URL back.
  //
  // WHY IT IS BEHIND THE MONEY GATE even though it moves no money: it mints a
  // LIVE PAYABLE LINK on an operator's Connect account and writes a Pending
  // `payments` row against a real rental. Nothing in this process can tell a
  // test-mode tenant from a live-mode one — `tenants.stripe_mode` is a column,
  // not a property of the database — so the run has to say so by hand
  // (D247_LIVE_STRIPE_MODE=test), which is exactly what liveMoneyGate() is for.
  //
  // Ladder: D247_LIVE_TESTS=1 + D247_LIVE_ALLOW_WRITES=1 +
  // D247_LIVE_ALLOW_MONEY_MOVEMENT=1 + D247_LIVE_STRIPE_MODE=test, on a
  // non-production project, plus D247_LIVE_CHECKOUT_RENTAL_ID (falls back to
  // D247_LIVE_REFUND_RENTAL_ID) and D247_LIVE_PORTAL_JWT.
  // -------------------------------------------------------------------------
  it.skipIf(!liveMoneyMovementRequested())(
    "live: a checkout of an arbitrary amount comes back with a Stripe session id and a payable URL",
    async (ctx) => {
      const gate = liveMoneyGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveRefundFixture({ rentalIdVar: "D247_LIVE_CHECKOUT_RENTAL_ID" });

      // 12.34 for a reason: it is not a round number, so the response also
      // proves the major->minor conversion did not truncate (12.34 x 100 = 1234).
      const res = await liveCall(
        "create-checkout-session",
        {
          rentalId: fixture.rentalId,
          totalAmount: 12.34,
          customerName: "drive247 suite — checkout health check",
          source: "portal",
        },
        { token: fixture.portalJwt },
      );

      expect(
        res.status,
        "create-checkout-session did not mint a link.\n" +
          `  ${res.status}: ${res.text.slice(0, 300)}\n` +
          "  This is the health check: until it is green, no other finding in this " +
          "folder can be trusted to be about the thing it names.\n  " +
          classifyLive(res).explain,
      ).toBe(200);

      expect(
        String(res.json?.sessionId ?? ""),
        "200 with no session id. The webhook correlates on this value, so a link " +
          "without one can never be reconciled to a payments row.",
      ).toMatch(/^cs_/);
      expect(
        String(res.json?.url ?? ""),
        "200 with no payable URL — the exact shape the seam's docs record an " +
          "operator hitting: success, and no link.",
      ).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    },
  );
});

// ===========================================================================
// 2. WHERE THE AMOUNT COMES FROM — the security question
// ===========================================================================
describe("stripe/checkout — where the amount comes from", () => {
  it("PINS TODAY'S BEHAVIOUR: the caller names the price, and it reaches Stripe unchecked", () => {
    // ON RECORD, and this is the largest finding in the subsystem.
    //
    // create-checkout-session destructures `totalAmount` off the request body
    // and renders it straight into the Stripe line item. The only thing between
    // a request and a charge amount is "is it a finite number above zero".
    // Nothing re-derives the figure from the rental's charges, and — see the
    // next test — nothing checks who is asking. The payload is built in the
    // browser (apps/booking/src/components/BookingCheckoutStep.tsx,
    // apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx), and
    // the public anon key that authenticates the call ships in the booking
    // app's JavaScript bundle.
    //
    // The companion `it.fails` below asserts the correct property. THIS test
    // exists only so the shape of the defect is recorded; delete it in the same
    // change that fixes the function.
    const s = src("create-checkout-session");
    expect(s).toContain("unit_amount: Math.round(totalAmount * 100)");
    expect(s).toContain("if (!Number.isFinite(amountNum) || amountNum <= 0)");
    // Same story on the pre-auth path (body.totalAmount) and the excess-mileage
    // path (amount), and that last one emails the tenant's customer about it.
    expect(src("create-preauth-checkout")).toContain("unit_amount: Math.round(body.totalAmount * 100)");
    expect(src("send-excess-mileage-payment-link")).toContain("unit_amount: Math.round(amount * 100)");
  });

  it("PINS TODAY'S BEHAVIOUR: no rental checkout creator asks who the caller is", () => {
    // ON RECORD. create-hold-checkout's own header states the threat model:
    // "It read no Authorization header, so the only check was the gateway's
    // `verify_jwt = true` default — satisfied by the PUBLIC ANON KEY that ships
    // in the booking app's JavaScript bundle." That function was fixed. These
    // three were not, and none of the nine appears in supabase/config.toml, so
    // every one of them sits behind that same gateway default.
    for (const fn of ANONYMOUS_CREATORS) {
      const s = src(fn);
      expect(
        READS_AUTH_HEADER.test(s),
        `${fn} now reads an Authorization header. That is the FIX landing — delete ` +
          `this pin and drop the .fails marker from the companion case below.`,
      ).toBe(false);
      expect(RESOLVES_CALLER.test(s), `${fn} now resolves the caller`).toBe(false);
    }
  });

  it.fails(
    "the rental checkout amount is derived server-side, not taken from the request body",
    () => {
      // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
      //
      // The correct property is the one the platform axis already holds itself
      // to — tests/integrations/stripe/checkout.test.ts:38, "resolves the amount
      // from the plan, never from the request". The rental axis must not be
      // tested to a weaker standard than the axis that bills the operators.
      //
      // The shape of the fix already exists inside this family:
      // create-upfront-checkout takes an id, reads `installment_plans.
      // upfront_amount` and renders THAT. A fixed create-checkout-session reads
      // an identifier and prices the rental itself (or refuses a body total that
      // disagrees with its own figure).
      const s = src("create-checkout-session");
      expect(
        s,
        "create-checkout-session still hands the caller's own totalAmount to Stripe as " +
          "the charge amount. Anyone holding the public anon key can name any price on " +
          "any rental.",
      ).not.toContain("unit_amount: Math.round(totalAmount * 100)");
    },
  );

  it.fails("a rental checkout request is refused unless the caller can be tied to the rental", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // "Authenticated" is not a boundary here, because the credential that
    // satisfies the gateway is public. The check has to resolve the bearer to a
    // person and then ask whether that person is the rental's customer or staff
    // of the rental's tenant — the shape create-hold-checkout uses via
    // authorizeDepositHoldRequest, and charge-saved-card via app_users.
    for (const fn of ANONYMOUS_CREATORS) {
      const s = src(fn);
      expect(READS_AUTH_HEADER.test(s), `${fn} reads no Authorization header`).toBe(true);
      expect(RESOLVES_CALLER.test(s), `${fn} never resolves the bearer to a caller`).toBe(true);
    }
  });

  it("the deposit-hold checkout, which mints the same kind of link, authorises before it reads anything", () => {
    // The one function in the family with a real check — and the proof that the
    // fix is cheap. Order is the whole point: a guard that runs after the rental
    // read has already leaked the tenant's deposit configuration, and a guard
    // after sessions.create has already minted a payable link.
    const s = src("create-hold-checkout");
    const authAt = s.indexOf("authorizeDepositHoldRequest(");
    const rentalReadAt = s.indexOf(".from('rentals')");
    const stripeAt = s.indexOf("checkout.sessions.create(");

    expect(authAt, "create-hold-checkout no longer authorises the caller at all").toBeGreaterThan(-1);
    expect(rentalReadAt).toBeGreaterThan(-1);
    expect(stripeAt).toBeGreaterThan(-1);
    expect(
      authAt < rentalReadAt && authAt < stripeAt,
      "The deposit-hold auth check has moved BELOW the rental read or below Stripe.\n" +
        `  auth@${authAt}  rental@${rentalReadAt}  stripe@${stripeAt}\n` +
        "  Below the read it leaks the tenant's deposit figure and company name to an " +
        "anon caller; below Stripe it has already minted a live payment URL on their " +
        "connected account.",
    ).toBe(true);
  });

  it("the instalment upfront checkout reads the money out of the database, which is the shape the rental path needs", () => {
    // PARKED scope, read only as the family's correct example: the request names
    // a plan, the server reads the amount, and each refusal names its cause.
    const shape = readEdgeFunction("create-upfront-checkout");
    expect(shape.fields.sort()).toEqual(["customerId", "installmentPlanId"]);
    expect(
      shape.fields,
      "create-upfront-checkout now accepts an amount from the caller. It was the one " +
        "creator in this family that could not be told what to charge.",
    ).not.toContain("amount");

    const s = src("create-upfront-checkout");
    expect(s).toContain("unit_amount: Math.round(plan.upfront_amount * 100)");
    // And every refusal is its own sentence, so the operator knows which one fired.
    expect(s).toContain("Installment plan not found or not in pending status");
    expect(s).toContain("Upfront amount has already been paid");
    expect(s).toContain("Invalid upfront amount");
  });

  it("charging a card already on file requires an authenticated portal admin first", () => {
    // Way (1) of the four, and the internal proof that identity checks on this
    // surface are a solved problem: charge-saved-card resolves the bearer, reads
    // app_users, requires head_admin/admin (or a manager with EDITOR on the
    // payments tab) and refuses everything else — before any money moves.
    //
    // readEdgeFunctionSource, not readEdgeFunction: this file parses its body as
    // `let body: Record<string, unknown>`, a fourth shape the contract parser
    // does not know, and it throws rather than reporting zero fields.
    const s = blankComments(readEdgeFunctionSource("charge-saved-card"));
    expect(s).toMatch(/headers\.get\('Authorization'\)/);
    expect(s).toContain("callerClient.auth.getUser()");
    expect(s).toContain("from('app_users')");
    expect(s).toContain("FULL_ACCESS_ROLES");
    expect(s).toContain("'Your role cannot charge a saved card'");

    const authAt = s.indexOf("callerClient.auth.getUser()");
    const chargeAt = s.indexOf("paymentIntents.create(");
    expect(chargeAt).toBeGreaterThan(-1);
    expect(
      authAt < chargeAt,
      "charge-saved-card now resolves the caller AFTER charging the card. The role " +
        "check is the only thing standing between a leaked token and an off-session " +
        "charge on a renter's stored card.",
    ).toBe(true);
  });
});

// ===========================================================================
// 3. CURRENCY, MODE, AND THE CORRELATION FIELDS
// ===========================================================================
describe("stripe/checkout — currency, mode and the fields a webhook resolves on", () => {
  it("every rental session is a one-off payment, never a subscription", () => {
    // A rental link that silently became a subscription would bill the renter
    // every month. It is also what keeps this axis separable from the platform
    // subscription axis that checkout.test.ts covers.
    for (const fn of RENTAL_CREATORS) {
      const s = src(fn);
      expect(s, `${fn} no longer creates the session in payment mode`).toMatch(
        /mode:\s*['"]payment['"]/,
      );
      expect(s, `${fn} now creates a subscription-mode session`).not.toMatch(
        /mode:\s*['"]subscription['"]/,
      );
      expect(s, `${fn} now sends a recurring price`).not.toContain("recurring:");
    }
  });

  it("the session currency is the tenant's configured currency, lower-cased", () => {
    // Stripe requires lower case. More importantly this column is the single
    // source both rails read: the Square adapter refuses a currency that
    // disagrees with the connected location, so a divergence here is a refusal
    // at money time rather than a cosmetic difference.
    expect(src("create-checkout-session")).toContain("(tenant.currency_code || 'USD').toLowerCase()");
    expect(src("create-preauth-checkout")).toContain("(tenantData?.currency_code || 'USD').toLowerCase()");
    expect(src("create-hold-checkout")).toContain("(tenant.currency_code || 'usd').toLowerCase()");
    expect(src("send-excess-mileage-payment-link")).toContain("currencyCode.toLowerCase()");
    expect(src("create-upfront-checkout")).toContain(".toLowerCase()");
  });

  it("PINS TODAY'S BEHAVIOUR: the rental checkout falls back to GBP where every sibling falls back to USD", () => {
    // ON RECORD. `let currencyCode = 'gbp'` is the value that survives when NO
    // tenant row resolves at all — a path that should not reach session creation
    // in the first place (see the no-Connect-account cases below). The same file
    // falls back to USD when a tenant row merely lacks the column.
    expect(src("create-checkout-session")).toContain("let currencyCode = 'gbp'");
    expect(src("create-preauth-checkout")).toContain("|| 'USD'");
    expect(src("create-hold-checkout")).toContain("|| 'usd'");
    expect(src("create-upfront-checkout")).toContain("|| 'USD'");
  });

  it.fails("all rental creators share one fallback currency", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The same rental can be billed in a different currency depending on which
    // endpoint the UI happened to call. Whichever fallback is chosen, it has to
    // be the same one in all five files — and the no-tenant-row path should be
    // refused rather than priced.
    expect(
      src("create-checkout-session"),
      "create-checkout-session still defaults to GBP when no tenant row resolves, " +
        "while every sibling defaults to USD.",
    ).not.toContain("let currencyCode = 'gbp'");
  });

  it("every rental session stamps the rental id into its metadata", () => {
    // Every webhook resolves the rental from here (or from client_reference_id,
    // below). A session that carries neither is money that arrives attributable
    // to nothing.
    for (const fn of RENTAL_CREATORS) {
      expect(
        sessionMetadataKeys(fn),
        `${fn}'s session metadata no longer carries rental_id`,
      ).toContain("rental_id");
    }
  });

  it("tenant_id reaches Stripe on every rental path, though the pre-auth path puts it on the PaymentIntent only", () => {
    // Asserted as the asymmetry it is, rather than smoothed over. Four creators
    // stamp tenant_id in the SESSION metadata, which is what
    // stripe-webhook-{test,live} reads (`session.metadata?.tenant_id`).
    for (const fn of ["create-checkout-session", "create-hold-checkout", "send-excess-mileage-payment-link", "create-upfront-checkout"] as const) {
      expect(
        sessionMetadataKeys(fn),
        `${fn}'s session metadata no longer carries tenant_id`,
      ).toContain("tenant_id");
    }
    // create-preauth-checkout's SESSION metadata deliberately does not: it
    // carries rental_id, customer_id, booking_source, preauth_mode,
    // stripe_account_id, stripe_mode, and puts tenant_id on the PaymentIntent's
    // metadata instead. That is survivable only because this function writes its
    // own payments row (with tenant_id) at creation time, so the webhook never
    // has to resolve the tenant from the session.
    const preauth = src("create-preauth-checkout");
    const sessionKeys = sessionMetadataKeys("create-preauth-checkout");
    expect(sessionKeys).toContain("preauth_mode");
    expect(sessionKeys).not.toContain("tenant_id");
    expect(preauth, "the pre-auth PaymentIntent metadata no longer carries the tenant either").toContain(
      "tenant_id: tenantId || ''",
    );
    expect(preauth, "the pre-auth payments row no longer records the tenant").toContain("tenant_id: tenantId,");
  });

  it("the rental checkout's metadata bag stays well inside Stripe's 50-key ceiling", () => {
    // Hand-derived bound. The block has 6 unconditional keys (booking_id,
    // rental_id, customer_name, tenant_id, tenant_slug, stripe_mode) and 8
    // conditional spreads, one of which (hold_as_credit) contributes two keys.
    // Worst case if every spread carried two: 6 + (8 x 2) = 22 keys, against
    // Stripe's declared limit of 50. Real worst case is 6 + 9 = 15.
    const { keys, spreads } = topLevelEntries(objectBlockAfter(src("create-checkout-session"), "metadata: {"));
    expect(keys.sort()).toEqual([
      "booking_id",
      "customer_name",
      "rental_id",
      "stripe_mode",
      "tenant_id",
      "tenant_slug",
    ]);
    expect(spreads).toBe(8);
    expect(
      keys.length + spreads * 2,
      "The metadata bag has grown. Re-derive the bound by hand: Stripe rejects the " +
        "whole session once the key count passes the limit, so this is a 400 at money " +
        "time and not a truncation.",
    ).toBeLessThanOrEqual(STRIPE_CAPABILITIES.maxMetadataKeys);

    // The one unbounded VALUE in the bag. A long category list stringified into
    // a single metadata value is the realistic way to breach the 500-char limit,
    // which is why it must be JSON and not a raw array.
    expect(src("create-checkout-session")).toContain("target_categories: JSON.stringify(targetCategories)");
  });

  it("client_reference_id carries the rental on the paths a return page has to reconcile", () => {
    // The second, independent correlation handle: the webhook prefers
    // `session.client_reference_id || session.metadata?.rental_id`, so this is
    // what survives if the metadata bag is ever truncated.
    expect(src("create-checkout-session")).toContain("client_reference_id: referenceId");
    expect(src("create-checkout-session")).toContain("const referenceId = rentalId || bookingId");
    expect(src("create-preauth-checkout")).toContain("client_reference_id: body.rentalId");
    expect(src("create-upfront-checkout")).toContain("client_reference_id: plan.rental_id");
    // And the two that deliberately omit it — pinned as the difference it is,
    // because both are correlated through metadata plus their own payments row.
    expect(src("create-hold-checkout")).not.toContain("client_reference_id");
    expect(src("send-excess-mileage-payment-link")).not.toContain("client_reference_id");
  });

  it("the success URL carries the session id template so the return page can find what was just paid", () => {
    // apps/booking/src/app/booking-success/page.tsx reads that session id to
    // sync the payment_intent_id. Dropping the template breaks the
    // reconciliation the customer sees in the first five seconds after paying.
    for (const fn of ["create-checkout-session", "create-preauth-checkout", "create-hold-checkout", "create-upfront-checkout"] as const) {
      expect(src(fn), `${fn}'s success_url no longer carries {CHECKOUT_SESSION_ID}`).toContain(
        "session_id={CHECKOUT_SESSION_ID}",
      );
    }
    // The rental checkout's default also names the rental, so the return page
    // works even when the session lookup fails.
    expect(src("create-checkout-session")).toContain("&rental_id=${rentalId}");
  });

  it("a cancel URL is always supplied, which Stripe honours and Square cannot", () => {
    // Stripe requires the field. STRIPE_CAPABILITIES.supportsCancelUrl is true
    // while Square's is false — this is the property that difference describes,
    // and it is why an abandoned Stripe checkout can land the renter back on a
    // page that reflects the abandoned rental.
    expect(STRIPE_CAPABILITIES.supportsCancelUrl).toBe(true);
    expect(capabilitiesFor("square").supportsCancelUrl).toBe(false);
    for (const fn of RENTAL_CREATORS) {
      expect(src(fn), `${fn} no longer sends a cancel_url`).toContain("cancel_url:");
    }
    expect(src("create-checkout-session")).toContain("/booking-cancelled?rental_id=${rentalId}");
    expect(src("create-hold-checkout")).toContain("?hold=cancelled");
  });

  it("PINS TODAY'S BEHAVIOUR: the rental checkout's redirect fallback is a developer's laptop", () => {
    // ON RECORD. A server-to-server or cron-style call carries no Origin header,
    // and this is the value that then builds success_url and cancel_url — so a
    // renter who has just paid is redirected to http://localhost:5173. The three
    // siblings already default to a real domain.
    expect(src("create-checkout-session")).toContain("req.headers.get('origin') || 'http://localhost:5173'");
    expect(src("create-preauth-checkout")).toContain("req.headers.get('origin') || 'https://drive-247.com'");
    expect(src("create-upfront-checkout")).toContain("req.headers.get('origin') || 'https://drive-247.com'");
    // create-hold-checkout defaults to an empty string, which produces a
    // relative URL that Stripe rejects outright — a different bug, same cause.
    expect(src("create-hold-checkout")).toContain("req.headers.get('origin') || ''");
  });

  it.fails("the redirect-URL fallback is a production domain on every rental path", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    const s = src("create-checkout-session");
    expect(
      s,
      "create-checkout-session still falls back to http://localhost:5173 for the " +
        "post-payment redirect when the request carries no Origin header.",
    ).not.toContain("'http://localhost:5173'");
  });

  it.fails("a caller-supplied success or cancel URL is validated before it reaches Stripe", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Both create-checkout-session and create-hold-checkout take successUrl and
    // cancelUrl off the request and hand them to Stripe raw. Combined with the
    // absent identity check on create-checkout-session, that is an open redirect
    // attached to a payment page: the renter pays and is then sent wherever the
    // caller named. create-hold-checkout's own header lists caller-supplied
    // redirect URLs as a reason the endpoint must not be anonymous — it fixed
    // the anonymity, not the validation.
    const s = src("create-checkout-session");
    expect(
      /new URL\(\s*successUrl|allowedOrigin|isAllowedRedirect|assertSameOrigin/.test(s),
      "create-checkout-session performs no validation on the caller's successUrl / " +
        "cancelUrl before handing them to Stripe as redirect targets.",
    ).toBe(true);
  });
});

// ===========================================================================
// 4. SESSION EXPIRY
// ===========================================================================
describe("stripe/checkout — how long a rental payment link stays payable", () => {
  it("no rental creator sets expires_at, so every link lives Stripe's default 24 hours", () => {
    // Stripe Checkout sessions expire ~24h after creation unless `expires_at`
    // says otherwise (and it may only ever shorten that window). Nothing in this
    // family sets it, which is a decision the rest of the system leans on rather
    // than an oversight — see the next case.
    for (const fn of RENTAL_CREATORS) {
      // `\bexpires_at:` and not a plain substring, because create-preauth-checkout
      // writes a DB column called preauth_expires_at — a conservative floor for
      // the card authorisation's capture deadline, which is a different thing
      // entirely from a Checkout Session's life.
      expect(
        /\bexpires_at\s*:/.test(src(fn)),
        `${fn} now sets expires_at on the Checkout Session. Two things then need ` +
          `re-reading: void-payment-link's best-effort expire (which is only safe ` +
          `because an old session is already dead Stripe-side), and the portal's ` +
          `24h age rule that marks an unpaid link Expired.`,
      ).toBe(false);
    }
    // The pre-auth column that is NOT a session expiry, pinned so the two are
    // never conflated: it is the capture deadline of the authorisation, written
    // as a floor at creation and reconciled by the webhook from Stripe's own
    // capture_before.
    expect(src("create-preauth-checkout")).toContain("preauth_expires_at: preauthExpiresAtIso,");
    // Stripe CAN shorten a link's life, and the capability table says so — this
    // is a "we do not use it" not a "we cannot".
    expect(STRIPE_CAPABILITIES.supportsPaymentLinkExpiry).toBe(true);
    expect(capabilitiesFor("square").supportsPaymentLinkExpiry).toBe(false);
  });

  it("voiding a link is best-effort at Stripe precisely because a session older than a day is already dead", () => {
    // The dependency written down. If a creator ever set a longer expiry, this
    // swallowed failure would stop being harmless and would start leaving a live,
    // payable link behind a row the UI shows as void.
    const s = src("void-payment-link");
    expect(s).toContain("checkout.sessions.expire(");
    expect(s).toContain("stripeExpired");
    expect(s).toContain("stripeNote");
    // The Square branch documents the opposite decision for a rail with no
    // expiry at all: refuse rather than report a void that did not happen.
    expect(s).toContain("The link is still live, so the payment row was left untouched.");
  });
});

// ===========================================================================
// 5. THE MONEY ARITHMETIC — Layer 3
//
// Every expected value below was derived by hand and is written as a literal
// with its arithmetic in the comment. None was copied from a program's output:
// that would assert only that the code agrees with itself.
// ===========================================================================
describe("stripe/checkout — the money arithmetic (Layer 3)", () => {
  it("converting major to minor units rounds, so 19.99 becomes 1999 and never 1998", () => {
    // 19.99 x 100 = 1999 on paper. In IEEE-754 it is 1998.9999999999998, and a
    // bare multiply therefore sends a non-integer amount to the money API —
    // rejected by Square with EXPECTED_INTEGER, and by Stripe as an invalid
    // unit_amount. Math.round is load-bearing, not defensive styling.
    expect(majorToMinorUnits(19.99)).toBe(1999);
    // 10.1 x 100 = 1010 exactly, even in floating point. This is why an
    // unrounded multiply passes casual testing and then fails on a real price.
    expect(majorToMinorUnits(10.1)).toBe(1010);
    // 89.00 x 100 = 8900 — the daily rate used in the pricing spine.
    expect(majorToMinorUnits(89.0)).toBe(8900);
    // 12.34 x 100 = 1234 — the amount the Layer 2 health check above sends.
    expect(majorToMinorUnits(12.34)).toBe(1234);
    // 0.005 x 100 = 0.5, which rounds to 1 minor unit. Half a cent cannot be
    // charged, so it becomes one — asserted so the direction is on record.
    expect(majorToMinorUnits(0.005)).toBe(1);
  });

  it("the values that silently become zero are refused instead of converted", () => {
    // Number(null) === 0, Number('') === 0 and Number([]) === 0. On a money path
    // each of those would become a zero-amount charge that looks deliberate, so
    // the helper returns null and forces the caller to decide.
    expect(majorToMinorUnits(null)).toBe(null);
    expect(majorToMinorUnits(undefined)).toBe(null);
    expect(majorToMinorUnits("")).toBe(null);
    expect(majorToMinorUnits("   ")).toBe(null);
    expect(majorToMinorUnits({})).toBe(null);
    expect(majorToMinorUnits([])).toBe(null);
    expect(majorToMinorUnits(Number.NaN)).toBe(null);
    expect(majorToMinorUnits(Number.POSITIVE_INFINITY)).toBe(null);
    // Zero: Stripe and Square both reject a zero-amount link, and a caller that
    // got here with 0 computed something wrong upstream.
    expect(majorToMinorUnits(0)).toBe(null);
    // Negative: on a money path a sign flip reverses the DIRECTION of the money.
    expect(majorToMinorUnits(-5)).toBe(null);
    expect(majorToMinorUnits(-0.01)).toBe(null);
    // A numeric string is still money and is accepted: "42.50" x 100 = 4250.
    expect(majorToMinorUnits("42.50")).toBe(4250);
  });

  it("an amount above zero but under Stripe's 50-cent minimum clears the only local guard we have", () => {
    // Hand arithmetic: Stripe's minimum charge in USD is $0.50, i.e. 50 minor
    // units. 0.10 x 100 = 10 minor units, which is 40 short of the floor.
    const tenCents = majorToMinorUnits(0.1);
    expect(tenCents).toBe(10); // 0.10 x 100 = 10
    const STRIPE_USD_MINIMUM_MINOR_UNITS = 50; // $0.50, hand-typed from Stripe's published floor
    expect(tenCents! < STRIPE_USD_MINIMUM_MINOR_UNITS).toBe(true);

    // And our own guard lets it through, deliberately: the comment above it
    // says sub-minimum amounts are left to Stripe, because only Stripe knows the
    // threshold for the tenant's currency. What must hold is that Stripe's
    // message reaches the operator instead of being swallowed — the catch
    // returns error.message with a 400, so it does.
    const s = src("create-checkout-session");
    expect(s).toContain("if (!Number.isFinite(amountNum) || amountNum <= 0)");
    expect(s).toContain("JSON.stringify({ error: error.message })");
    expect(s).toContain("status: 400,");
  });

  it("the capability table's Stripe limits are the numbers the gates are written against", () => {
    // Hand-typed from Stripe's published limits. If these drift from reality
    // every gate that reads them is wrong at once, and they are read to decide
    // whether a metadata bag or an idempotency key will be accepted.
    expect(STRIPE_CAPABILITIES.maxMetadataKeys).toBe(50);
    expect(STRIPE_CAPABILITIES.maxMetadataValueChars).toBe(500);
    expect(STRIPE_CAPABILITIES.maxIdempotencyKeyChars).toBe(255);
    // The three that make the rental paths possible at all.
    expect(STRIPE_CAPABILITIES.supportsStoredCredential).toBe(true);
    expect(STRIPE_CAPABILITIES.supportsAuthorizationHold).toBe(true);
    expect(STRIPE_CAPABILITIES.supportsManualCapture).toBe(true);
    // An unknown provider falls back to the Stripe table rather than throwing.
    // Degrading to Stripe fails visibly at the Stripe call; throwing would break
    // live money on any environment whose schema lags.
    expect(capabilitiesFor("not-a-provider" as never)).toBe(STRIPE_CAPABILITIES);
  });

  it("the Stripe rail rounds to minor units at every one of its call sites, and to cents in the ledger row", () => {
    // Six separate copies of one rule, because the Stripe creators inline the
    // arithmetic instead of calling the shared helper tested above. A bare
    // multiply in any of them is either a Stripe rejection or a half-cent drift
    // between what the session charges and what the payments row records.
    const unitAmounts: Record<string, string> = {
      "create-checkout-session": "unit_amount: Math.round(totalAmount * 100)",
      "create-preauth-checkout": "unit_amount: Math.round(body.totalAmount * 100)",
      "create-hold-checkout": "unit_amount: Math.round(depositAmount * 100)",
      "send-excess-mileage-payment-link": "unit_amount: Math.round(amount * 100)",
      "create-upfront-checkout": "unit_amount: Math.round(plan.upfront_amount * 100)",
    };
    for (const [fn, expr] of Object.entries(unitAmounts)) {
      expect(src(fn), `${fn} no longer rounds its unit_amount`).toContain(expr);
    }
    // The ledger side of the same rule: Math.round(x * 100) / 100 gives a value
    // that is exact to the cent. 12.345 -> round(1234.5)/100 = 12.35.
    expect(src("create-checkout-session")).toContain("Math.round(totalAmount * 100) / 100");
  });

  it("PINS TODAY'S BEHAVIOUR: the pre-auth session can authorise more than its payments row records", () => {
    // ON RECORD. The session gets a second line item for insuranceAmount, and
    // the payments row is written with body.totalAmount alone — so the amount
    // authorised (and later captured by capture-booking-payment, which captures
    // the whole PaymentIntent) exceeds the recorded figure by the premium.
    // Downstream, FIFO allocation is short by exactly that amount.
    const s = src("create-preauth-checkout");
    expect(s).toContain("unit_amount: Math.round(body.insuranceAmount * 100)");
    expect(s).toContain("amount: body.totalAmount,");
    // Hand arithmetic for the size of it: a 267.00 rental with a 42.00 premium
    // authorises 267.00 + 42.00 = 309.00 while the row says 267.00 — a 42.00
    // hole, which is the premium counted once in the session and zero times in
    // the ledger.
    expect(267.0 + 42.0).toBe(309.0);
  });

  it.fails("the pre-auth session's line items sum to the amount its payments row records", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Two ways to fix it and the test allows either: stop appending the second
    // line item (the browser's getPayableAmount() already includes the premium —
    // BookingCheckoutStep.tsx:308 adds effectiveBonzahPremium into
    // calculateGrandTotal, and :612 then sends it AGAIN as insuranceAmount), or
    // keep the line item and record the sum. What must not survive is a session
    // total the ledger cannot explain.
    const s = src("create-preauth-checkout");
    const appendsInsuranceLine = s.includes("unit_amount: Math.round(body.insuranceAmount * 100)");
    const recordsOnlyTotal = s.includes("amount: body.totalAmount,");
    expect(
      appendsInsuranceLine && recordsOnlyTotal,
      "create-preauth-checkout still authorises totalAmount + insuranceAmount while " +
        "recording totalAmount. The premium is charged and never accounted for.",
    ).toBe(false);
  });
});

// ===========================================================================
// 6. A SECOND CALL FOR THE SAME RENTAL
// ===========================================================================
describe("stripe/checkout — what a second click does", () => {
  it("PINS TODAY'S BEHAVIOUR: no creator passes an idempotency key, so a repeat mints a second payable link", () => {
    // ON RECORD. Stripe de-duplicates a repeated request only when it carries an
    // idempotency key; none of these six sends one, so two clicks are two
    // sessions on two different links, both payable.
    for (const fn of RENTAL_CREATORS) {
      expect(
        src(fn),
        `${fn} now passes an idempotency key — that is the FIX landing. Delete this ` +
          `pin and drop the .fails marker from the companion case below.`,
      ).not.toMatch(/idempotencyKey/i);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the second call cannot adopt the first row, so it inserts another Pending payment", () => {
    // ON RECORD, and this is the half that costs money rather than tidiness.
    // The UPDATE that attaches a session id to an existing Pending row filters
    // `.is('stripe_checkout_session_id', null)` — the first call already filled
    // that column, so the second call matches nothing and falls through to the
    // INSERT. Two Pending rows for one debt.
    const s = src("create-checkout-session");
    expect(s).toContain(".is('stripe_checkout_session_id', null)");
    expect(s).toContain(".eq('status', 'Pending')");
    expect(s).toContain("No existing payment found, creating new payment record for rental:");
    // The other rail has the same shape written down as a real incident: two
    // Pending rows stamped with one order id, and recover-pending-square-payments
    // then allocating the same collection twice.
    expect(blankComments(readEdgeFunctionSource("recover-pending-stripe-payments"))).toContain("payments");
  });

  it.fails("two identical checkout requests for one rental produce one session and one Pending row", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // Either pass Stripe an idempotency key built from the same identity the
    // Square rail already uses — reference + currency + amount, so a CORRECTED
    // amount is a new key rather than a permanent IDEMPOTENCY_KEY_REUSED 400 —
    // or return the still-open session for that rental. Both satisfy this.
    const s = src("create-checkout-session");
    expect(
      /idempotencyKey/i.test(s),
      "create-checkout-session sends no idempotency key, so a double-click, a retried " +
        "request or a re-sent email mints a second live link and a second Pending row " +
        "for one debt.",
    ).toBe(true);
  });

  it.fails("a rental whose checkout has already been paid is refused a second link", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The Square rail states this as a rule and enforces it — "refusing to issue
    // a second payment link for a checkout that has already been paid", surfaced
    // to the portal as reason `square_payment_already_settled`, which
    // add-payment-dialog already knows how to render as "Already paid". Nothing
    // on the Stripe rail checks it, so the customer can be handed a second link
    // for a debt they have cleared.
    const s = src("create-checkout-session");
    expect(
      /already_settled|already been paid|alreadyPaid/i.test(s),
      "create-checkout-session never checks whether this rental's payment is already " +
        "settled before minting another link.",
    ).toBe(true);
  });

  it("the stored-card path refuses to move money without an idempotency key, and de-duplicates behind it", () => {
    // The internal precedent, green today. charge-saved-card demands a
    // clientRequestId, refuses to mint one server-side, builds the Stripe
    // idempotency key from it, AND keeps a duplicate window behind that for two
    // genuinely distinct requests (two operators, two tabs, a reload that lost
    // the key) — because an idempotency key only stops a replay.
    const s = blankComments(readEdgeFunctionSource("charge-saved-card"));
    expect(s).toContain("A clientRequestId is required");
    expect(s).toContain("const idempotencyKey = `charge-saved-card-${rentalId}-${clientRequestId}`");
    expect(s).toContain("idempotencyKey");
    expect(s).toContain("confirmDuplicate");
  });

  it("the Square rail folds the amount and currency into its key, which is the identity the Stripe rail needs", () => {
    // Read as text: checkoutIdempotencySeed is module-private, so it cannot be
    // imported and unit-tested (the subsystem map claimed it could — it cannot).
    // The identity is what matters here: `chk-<reference>-<scope>-<currency>-
    // <amountCents>`, empty parts dropped. Pinned to the reference alone, a
    // corrected amount produced a permanent 400 that no retry could clear, and a
    // second legitimate charge of the same amount silently returned the first
    // link.
    const adapter = blankComments(
      readFileText("supabase/functions/_shared/payments/square-adapter.ts"),
    );
    expect(adapter).toContain("function checkoutIdempotencySeed(");
    expect(adapter).toContain('[`chk`, reference, scope ?? "", currency, String(spec.amountCents)]');
    // A reference-less checkout gets a RANDOM key rather than a stable one: two
    // unrelated charges of equal amount would otherwise collapse into one link.
    expect(adapter).toContain("chk-anon-");
  });
});

// ===========================================================================
// 7. THE FOUR WAYS A PAYMENT IS TAKEN
//
// The team lead enumerated them: an auto charge on a stored card; the on-screen
// "pay directly via Stripe" checkout; the SAME checkout link sent by email; and
// a manually recorded payment. This describe covers the CREATION side of each.
// ===========================================================================
describe("stripe/checkout — the four ways money is taken, at the point the link is made", () => {
  it("way 1: an auto charge on a stored card mints no checkout session at all", () => {
    // It confirms a PaymentIntent off-session instead, on the account the RENTAL
    // was created under (getStripeClientForRecord, not the tenant's current
    // model) — because the saved Customer and PaymentMethod live on that
    // account, and resolving from today's config after a UK->UAE flip produces
    // "No such customer" on every charge.
    const s = blankComments(readEdgeFunctionSource("charge-saved-card"));
    expect(s).not.toContain("checkout.sessions.create(");
    expect(s).toContain("off_session: true");
    expect(s).toContain("confirm: true");
    expect(s).toContain("getStripeClientForRecord");
    // An off-session charge the issuer wants SCA on is not a decline: it gets
    // its own code so the UI can offer the emailed link (way 3) instead.
    expect(s).toContain("authentication_required");
  });

  it("way 2: the on-screen 'pay via Stripe' checkout sends exactly the fields create-checkout-session reads", () => {
    // A real contract test, in the idiom of tests/integrations/stripe/refund.test.ts:
    // one side of the contract is written down by hand (the payload the portal
    // dialog builds) and the other is DERIVED from the function's source, so a
    // field that moves on either side shows up here on the next run.
    const shape = assertContract(STRIPE_CHECKOUT_CONTRACT);
    expect(shape.fields.length, `parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
    // Destructured with no annotation, which is why there is no request
    // interface to read requiredness from — a fact worth pinning, because it
    // means every field on this endpoint is optional as far as types go,
    // including the amount.
    expect(shape.typeName).toBe(null);
    expect(shape.fields).toContain("totalAmount");
  });

  it("way 3: the emailed link is the SAME session, and send-invoice-email only mints one when none is handed to it", () => {
    // add-payment-dialog's two buttons build ONE payload: "Charge via Stripe"
    // window.open()s the returned url, "Email Stripe Link" passes that same url
    // to send-invoice-email as paymentUrl. Same session, same amount, same
    // payments row — which is also why a re-send needs the idempotency fix
    // above, since each send currently mints a fresh link.
    const s = blankComments(readEdgeFunctionSource("send-invoice-email"));
    expect(s).toContain("paymentUrl: externalPaymentUrl");
    expect(s).toContain("let paymentUrl: string | undefined = externalPaymentUrl || undefined;");
    // It can mint its own link when the caller passes none (the invoice flow),
    // and that branch is guarded by the absence of an external URL rather than
    // running unconditionally — otherwise every email would create a second
    // session for a debt that already had one.
    const guardAt = s.indexOf("if (!paymentUrl)");
    const createAt = s.indexOf("checkout.sessions.create(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(
      guardAt < createAt,
      "send-invoice-email now creates a Checkout Session before checking whether the " +
        "caller already supplied one. Every emailed link would become a second link.",
    ).toBe(true);
    // The Pay Now button is only rendered when a URL exists — an empty href is
    // indistinguishable from a real button to the customer.
    expect(s).toContain("const payNowButton = paymentUrl ?");
  });

  it("way 4: a manually recorded payment never touches Stripe, and cannot be allocated as if it had", () => {
    // The manual path inserts a payments row and settles through apply-payment.
    // apply-payment mints nothing — and it refuses to allocate a row that DOES
    // carry a checkout session but no captured PaymentIntent, which is the
    // guard that stops an unpaid link being spent as if the customer had paid.
    const s = blankComments(readEdgeFunctionSource("apply-payment"));
    expect(s).not.toContain("checkout.sessions.create(");
    expect(s).toContain("stripe_checkout_session_id");
    expect(s).toContain("Refusing to allocate uncaptured Stripe payment");
  });

  it("PINS TODAY'S BEHAVIOUR: the instalment upfront row claims to be captured before anyone has paid", () => {
    // ON RECORD (parked scope, but the row shape is read by the shared void and
    // refund guards on this axis). create-upfront-checkout writes
    // capture_status 'captured' and verification_status 'auto_approved'
    // immediately after creating the session — before the link has been opened.
    // void-payment-link treats capture_status === 'captured' as proof of real
    // money and refuses to void, so an unpaid link becomes un-cancellable.
    const s = src("create-upfront-checkout");
    expect(s).toContain("capture_status: 'captured'");
    expect(s).toContain("verification_status: 'auto_approved'");
    // The honest pair, written by the rental checkout for the same situation.
    expect(src("create-checkout-session")).toContain("capture_status: 'requires_capture'");
    expect(src("create-checkout-session")).toContain("verification_status: 'pending'");
  });

  it.fails("a payments row written before the customer pays never claims to be captured", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    // Only the webhook may set 'captured'; the row at creation time is
    // requires_capture (or null) and verification_status 'pending'.
    const s = src("create-upfront-checkout");
    expect(
      s,
      "create-upfront-checkout still inserts capture_status 'captured' before the " +
        "checkout link has been opened, which makes an unpaid link look like money in " +
        "hand to void-payment-link and to every capture guard that reads that column.",
    ).not.toContain("capture_status: 'captured'");
  });
});

// ===========================================================================
// 8. THE REFUSALS — every way this should say no
// ===========================================================================
describe("stripe/checkout — the refusals", () => {
  it("a zero total is refused with an instruction, before any Stripe client is built", () => {
    // Stripe accepts a 0-amount line item and still fires
    // checkout.session.completed, so a $0 link looks PAID to every downstream
    // consumer. Order matters as much as existence: the guard has to sit above
    // the Stripe client construction and above sessions.create, or the refusal
    // arrives after the link.
    const s = src("create-checkout-session");
    const guardAt = s.indexOf("if (!Number.isFinite(amountNum) || amountNum <= 0)");
    const clientAt = s.indexOf("const stripe = getStripeClientForAccount(");
    const sessionAt = s.indexOf("checkout.sessions.create(");

    expect(guardAt, "the amount guard is gone from create-checkout-session").toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(-1);
    expect(
      guardAt < clientAt && guardAt < sessionAt,
      "The zero-amount guard has moved BELOW the Stripe client or below session " +
        `creation.\n  guard@${guardAt}  client@${clientAt}  session@${sessionAt}\n` +
        "  A live link collecting nothing still completes, and every consumer reads " +
        "that completion as payment.",
    ).toBe(true);

    // And it says what to do, not just what went wrong.
    expect(s).toContain("Select at least one charge with an amount greater than zero.");
  });

  it("a negative or missing total is refused by that same guard", () => {
    // One expression covers all three shapes and this test says why:
    //   -5        -> Number.isFinite(-5) is true, but -5 <= 0        -> refused
    //   undefined -> Number(undefined) is NaN, not finite            -> refused
    //   ""        -> Number("") is 0, finite, and 0 <= 0             -> refused
    // The last one is the trap: an empty string is a falsy value that converts
    // to a perfectly valid zero, which is how a blank input becomes a $0 link.
    expect(Number.isFinite(Number(undefined))).toBe(false);
    expect(Number("")).toBe(0);
    expect(src("create-checkout-session")).toContain("const amountNum = Number(totalAmount)");
    expect(src("create-checkout-session")).toContain("if (!Number.isFinite(amountNum) || amountNum <= 0)");
  });

  it("the excess-mileage link refuses a non-positive amount before it emails anybody", () => {
    // This one creates a link AND emails the tenant's customer, so a bad amount
    // is not just a dead link — it is a branded Pay Now button for the wrong
    // figure, already in the customer's inbox and unretractable.
    const s = src("send-excess-mileage-payment-link");
    const guardAt = s.indexOf("if (!rentalId || !amount || amount <= 0)");
    const sessionAt = s.indexOf("checkout.sessions.create(");
    const emailAt = s.indexOf("sendResendEmail(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt < sessionAt && guardAt < emailAt).toBe(true);
    // And a provider skip is treated as a failure rather than a send: a 409 with
    // no email, because "no link" is not "sent".
    expect(s).toContain("No email has been sent.");
    expect(s).toContain("Could not create a payment link; no email sent.");
  });

  it("PINS TODAY'S BEHAVIOUR: the pre-auth path validates no amount whatsoever", () => {
    // ON RECORD. The body is parsed and reaches Stripe with nothing in between,
    // so Math.round(undefined * 100) goes out as NaN and a zero total mints a
    // $0 authorisation — plus a Pending payments row with capture_status
    // 'requires_capture' that the portal will show as a live hold.
    const s = src("create-preauth-checkout");
    expect(s).not.toContain("Number.isFinite");
    const parseAt = s.indexOf("const body: PreAuthCheckoutRequest = await req.json()");
    const unitAt = s.indexOf("unit_amount: Math.round(body.totalAmount * 100)");
    expect(parseAt).toBeGreaterThan(-1);
    expect(unitAt).toBeGreaterThan(parseAt);
    expect(
      s.slice(parseAt, unitAt),
      "an amount guard has appeared between the parse and the Stripe call — that is " +
        "the FIX landing. Delete this pin and drop the .fails marker below.",
    ).not.toMatch(/totalAmount\s*<=\s*0/);

    // Its own sibling documents why the guard exists, which is the argument for
    // copying it rather than inventing one.
    expect(src("create-checkout-session")).toContain("Select at least one charge with an amount greater than zero.");
  });

  it.fails("the pre-auth path refuses a zero, negative or missing total before calling Stripe", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    // Same guard, same message shape as create-checkout-session, and no payments
    // row on the refusal path.
    const s = src("create-preauth-checkout");
    expect(
      /Number\.isFinite/.test(s),
      "create-preauth-checkout still performs no amount validation: an undefined total " +
        "reaches Stripe as NaN and a zero total mints a $0 authorisation with a Pending " +
        "payments row behind it.",
    ).toBe(true);
  });

  it("PINS TODAY'S BEHAVIOUR: a live tenant with unfinished Connect onboarding is charged to the Drive247 platform account", () => {
    // ON RECORD, and this is the one that puts a renter's money in the wrong
    // business. getConnectAccountId returns null for a MANAGED tenant in live
    // mode whose onboarding is incomplete, the creators turn null into
    // `stripeOptions: undefined`, and Stripe then creates the session on the
    // platform account — Drive247's own balance — with no Connect routing.
    //
    // It also contradicts what the portal tells the operator:
    // apps/portal/src/lib/rental-gate-dismissal.ts states "The server still
    // refuses to charge without a connected Stripe account". It does not.
    const shared = blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"));
    expect(
      LIVE_ONBOARDING_FALLS_THROUGH_TO_PLATFORM.test(shared),
      "getConnectAccountId no longer falls through to `return null` (= no Connect " +
        "routing = the platform's own balance) for a live managed tenant whose " +
        "onboarding is incomplete. That is the FIX landing: delete this pin and drop " +
        "the .fails marker from the companion case below.",
    ).toBe(true);
    expect(src("create-checkout-session")).toContain(
      "const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;",
    );
    expect(src("create-checkout-session")).toContain("Creating checkout session on platform account");
  });

  it.fails("a live managed tenant with no completed Connect onboarding is refused, not silently rerouted", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // The correct behaviour already exists in the same function for the OWN
    // model: it throws, naming the missing connection. The managed model needs
    // the same loud failure — a non-2xx that says the Connect account is
    // missing, and no session created.
    const shared = blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"));
    expect(
      LIVE_ONBOARDING_FALLS_THROUGH_TO_PLATFORM.test(shared),
      "getConnectAccountId still returns null (= charge the platform) for a live " +
        "managed tenant whose Stripe onboarding is incomplete, instead of failing the " +
        "way the 'own' model does.",
    ).toBe(false);
  });

  it("an own-Stripe tenant going live with no OAuth connection fails loudly instead of charging the platform", () => {
    // The fail-loud half of the same decision, and the model for the case above.
    const shared = blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"));
    expect(shared).toContain("if (!tenant.own_stripe_account_id)");
    expect(shared).toContain("Connect Stripe (OAuth) before taking live payments.");
  });

  it("a test-mode tenant is routed to the shared test Connect account", () => {
    // Every test tenant shares one Connect account, so an unset env var is the
    // difference between "every test booking works" and "every test booking
    // quietly bills the platform" — the same null-means-platform path as above.
    const shared = blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"));
    expect(shared).toContain("if (tenant.stripe_mode === 'test')");
    expect(shared).toContain("Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null");
    // New money objects go to the platform account the tenant's model implies.
    expect(shared).toContain("return tenant.payment_model === 'own' ? 'uae' : 'uk';");
    // And a missing secret key for that account+mode throws with both named,
    // rather than producing an unauthenticated call.
    expect(shared).toContain("Missing Stripe secret key for account=${account} mode=${mode}");
  });

  it("PINS TODAY'S BEHAVIOUR: voiding a link resolves Stripe from the tenant's CURRENT config, not the payment's", () => {
    // ON RECORD. The rule is written in stripe-client.ts itself: "Operations on
    // EXISTING records ... must use the account the record was created under —
    // payments.platform_account / rentals.platform_account — NEVER the tenant's
    // current model." void-payment-link uses getChargePlatformAccount(tenant)
    // and the tenant's current stripe_mode, so after a payment_model flip (or a
    // test->live flip) the expire call is made with the wrong account's key. It
    // throws, the throw is swallowed, and the row is soft-cancelled anyway —
    // leaving a payable link behind a UI that says the link is void.
    const s = src("void-payment-link");
    expect(s).toContain("const platformAccount = getChargePlatformAccount(tenant);");
    expect(s).toContain('const mode = (tenant.stripe_mode as StripeMode) || "test";');
    expect(s).not.toContain("getStripeClientForRecord");
    // The purpose-built helper exists and is used elsewhere on this axis.
    expect(blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"))).toContain(
      "export function getStripeClientForRecord(",
    );
    expect(blankComments(readEdgeFunctionSource("charge-saved-card"))).toContain("getStripeClientForRecord");
  });

  it.fails("voiding a link expires it on the account the payment was created under", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    // payments.platform_account is written at creation time by
    // create-checkout-session, so the information needed is already on the row.
    const s = src("void-payment-link");
    expect(
      /getStripeClientForRecord/.test(s),
      "void-payment-link still resolves the Stripe account and mode from the tenant's " +
        "CURRENT config rather than from payments.platform_account, so a flipped tenant's " +
        "link is expired on the wrong account — and the failure is swallowed while the " +
        "row is marked void.",
    ).toBe(true);
  });

  it("a payment carrying real money can never be voided as a link, and a mid-request payment is not either", () => {
    // The fail-closed guards, green today, and the concurrency filter behind
    // them: if a webhook settles the payment between the guard and the UPDATE,
    // the .is(...) filters match nothing and the caller gets a 409 instead of a
    // success that voided money already taken.
    const s = src("void-payment-link");
    expect(s).toContain('payment.capture_status === "captured"');
    expect(s).toContain('.is("stripe_payment_intent_id", null)');
    expect(s).toContain('.is("square_payment_id", null)');
    expect(s).toContain('.is("paid_at", null)');
    expect(s).toContain("from(\"payment_applications\")");
    // And the tenant boundary, which is the only one there is: the mutation runs
    // with the service-role client, so RLS is bypassed.
    expect(s).toContain('from("app_users")');
    expect(s).toContain("auth.getUser");
  });

  it("a deposit of zero is a skip, never a zero-amount authorisation link", () => {
    // The deposit figure comes from a three-level resolution (per-rental
    // override, per-vehicle, tenant global) and a zero from any level means "no
    // deposit". A $0 authorisation link would tell the operator a hold exists
    // when none can.
    const s = src("create-hold-checkout");
    expect(s).toContain("if (depositAmount <= 0)");
    expect(s).toContain("skipped: 'deposit_amount_is_zero'");
    expect(s).toContain("skipped: 'deposit_disabled_for_tenant'");
    // A charged-deposit tenant never gets a hold on top of the charge, and an
    // auto-extend rental carries no deposit at all.
    expect(s).toContain("skipped: 'deposit_charge_enabled'");
    expect(s).toContain("skipped: 'auto_extend_rental'");
    // All of them before any Stripe call.
    const sessionAt = s.indexOf("checkout.sessions.create(");
    expect(s.indexOf("skipped: 'deposit_amount_is_zero'")).toBeLessThan(sessionAt);
  });

  it("a per-rental deposit override of exactly zero is honoured as an opt-out rather than read as unset", () => {
    // The classic falsy-zero money bug, and it has already shipped once: the old
    // `> 0` guard treated an explicit 0 as "unset", kept the tenant default, and
    // the customer was shown a deposit notice and had a hold placed despite the
    // operator unchecking it.
    const s = src("create-checkout-session");
    expect(s).toContain("if (override !== null && override !== undefined)");
    expect(s).toContain("&& depositHoldAmount > 0;");
    // The disclosure is only made when a hold will actually be placed. It is a
    // statement to the customer at the moment they hand over their card, and it
    // cannot be retracted afterwards.
    expect(s).toContain(
      "const shouldShowDepositNotice = !!placeDepositHoldAfter && securityDepositEnabled",
    );
  });

  it("get-stripe-config refuses a request that names no tenant, and 404s one that is not active", () => {
    // It mints no session, but it is how a client learns which MODE and which
    // publishable key to use — and it has no caller-identity check, so the
    // status filter is the only thing keeping a suspended tenant's
    // configuration from being handed out.
    const s = src("get-stripe-config");
    expect(s).toContain("Missing required parameter: tenantSlug or tenantId");
    expect(s).toContain(".eq('status', 'active')");
    expect(s).toContain("Tenant not found");
    expect(s).not.toContain("checkout.sessions.create(");
  });

  it("PINS TODAY'S BEHAVIOUR: get-stripe-config hands out the UK platform key whichever account the tenant charges on", () => {
    // ON RECORD, currently LATENT: the function selects no payment_model and
    // returns getPublishableKey(mode), which reads the UK platform's keys. An
    // own-Stripe (UAE) tenant's client would be given a key that cannot confirm
    // a PaymentIntent created on the UAE account. grep finds no caller in apps/,
    // which is the only reason this has not bitten anyone.
    const s = src("get-stripe-config");
    expect(s).toContain("getPublishableKey(stripeMode)");
    expect(s).not.toContain("payment_model");
    expect(s).not.toContain("getPublishableKeyForAccount");
    // The account-aware helper exists and has no call sites at all.
    expect(blankComments(readFileText("supabase/functions/_shared/stripe-client.ts"))).toContain(
      "export function getPublishableKeyForAccount(",
    );
  });

  it.fails("get-stripe-config returns the publishable key of the account the tenant's charges are created on", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED — or delete the function, which
    // is the other honest answer for an endpoint with no callers.
    const s = src("get-stripe-config");
    expect(
      /getPublishableKeyForAccount/.test(s),
      "get-stripe-config still returns the UK platform publishable key regardless of " +
        "the tenant's payment_model, so an own-Stripe tenant's client cannot confirm a " +
        "PaymentIntent created on the UAE account.",
    ).toBe(true);
  });
});

// ===========================================================================
// 9. THE PROVIDER SEAM — why the shared guards do not cover the Stripe rail
// ===========================================================================
describe("stripe/checkout — the provider seam, and what it does not protect", () => {
  it("a Stripe tenant returns from the seam before it inspects amount, currency or idempotency", () => {
    // "Zero Stripe diff" is the safety argument for the whole seam, and it is
    // only a slogan until something asserts it. The consequence is the point of
    // this test: the seam's amount, currency and idempotency guards protect the
    // SQUARE rail only, while ~100% of live volume is on Stripe. Every guard
    // must therefore also exist at each Stripe call site.
    const seam = blankComments(readFileText("supabase/functions/_shared/payments/checkout.ts"));
    const returnAt = seam.indexOf('if (resolution.provider === "stripe") return PASSTHROUGH;');
    const capsAt = seam.indexOf("capabilitiesFor(resolution.provider)");
    const squareAt = seam.indexOf("createSquareCheckout(");
    expect(returnAt).toBeGreaterThan(-1);
    expect(returnAt).toBeLessThan(capsAt);
    expect(returnAt).toBeLessThan(squareAt);
  });

  it("the vault requirement is computed from what this request will later need, never from the provider's name", () => {
    // The one place in the family that already follows the binding rule in
    // capabilities.ts, and the model the three violating functions should move
    // to. Hardcoding this to true once made the whole booking flow unavailable
    // to Square tenants — i.e. their customers could not book at all.
    const s = src("create-checkout-session");
    expect(s).toContain("const needsStoredCredential =");
    expect(s).toContain("!depositChargeEnabled || !!installmentId || !!paygAccrualId || !!holdAsCredit");
    expect(s).toContain("requiresStoredCredential: needsStoredCredential,");
    const exprLine = s.slice(s.indexOf("const needsStoredCredential ="), s.indexOf("if (tenantId) {"));
    expect(exprLine, "the vault decision now names a provider").not.toMatch(/square|stripe/i);
  });

  it("PINS TODAY'S BEHAVIOUR: three creators gate a feature on the provider's NAME instead of a capability", () => {
    // ON RECORD, in direct breach of capabilities.ts's own binding rule: "every
    // behavioural difference between processors lives HERE. Zero hand-written
    // provider gates anywhere else. A feature is switched off because a
    // CAPABILITY is false, never because `providerId === 'square'`."
    //
    // The flags that should drive these three already exist and are unused here:
    // supportsAuthorizationHold: false and supportsStoredCredential: false.
    // A third processor silently inherits the Stripe path in all three.
    for (const fn of ["create-preauth-checkout", "create-hold-checkout", "create-upfront-checkout"] as const) {
      expect(src(fn), `${fn} no longer compares payment_provider to 'square'`).toMatch(
        /payment_provider\s*===\s*['"]square['"]/,
      );
      expect(src(fn), `${fn} now consults the capability table`).not.toContain("capabilitiesFor(");
    }
    expect(capabilitiesFor("square").supportsAuthorizationHold).toBe(false);
    expect(capabilitiesFor("square").supportsStoredCredential).toBe(false);
  });

  it.fails("a feature the provider cannot perform is refused because a capability is false", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    //
    // NOTE FOR WHOEVER FIXES IT: apps/portal/src/__tests__/lib/square-provider-routing.test.ts
    // currently REQUIRES the violation — it asserts each of these files matches
    // /payment_provider === 'square'/ and returns the reason 'square_tenant'.
    // Those assertions have to be rewritten in the same change, not preserved:
    // a test that demands a provider-name gate is a test that forbids adding a
    // third processor.
    for (const fn of ["create-preauth-checkout", "create-hold-checkout", "create-upfront-checkout"] as const) {
      expect(
        src(fn).includes("capabilitiesFor("),
        `${fn} still switches the feature off by provider name rather than by capability`,
      ).toBe(true);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: every provider skip is explained to the operator as a saved-card problem", () => {
    // ON RECORD. The machine-readable code is right (`routed.reason`); the human
    // sentence is fixed. A tenant who has simply not finished connecting their
    // provider — reason 'square_not_connected' — is told instalments and held
    // deposits are unavailable, which sends the operator to the wrong fix.
    const s = src("create-checkout-session");
    expect(s).toContain("This payment needs a saved card, which this tenant\\'s payment provider cannot store.");
    expect(s).toContain("code: routed.reason ?? 'provider_cannot_store_credential',");
    expect(blankComments(readFileText("supabase/functions/_shared/payments/square-adapter.ts"))).toContain(
      'skip("square_not_connected"',
    );
  });

  it.fails("the operator-facing refusal is derived from the reason the seam actually raised", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    // 'square_not_connected' must read as "finish connecting the payment
    // provider"; only 'provider_cannot_store_credential' produces the saved-card
    // sentence.
    const s = src("create-checkout-session");
    const skipBranch = s.slice(s.indexOf("if (routed.handled && routed.skipped)"), s.indexOf("if (routed.handled) {"));
    expect(
      /not_connected|switch\s*\(\s*routed\.reason|REASON_MESSAGES/.test(skipBranch),
      "create-checkout-session answers every skip with the same saved-card sentence, " +
        "whatever reason the seam raised.",
    ).toBe(true);
  });

  it("a provider failure becomes a non-2xx and a skip never masquerades as a created link", () => {
    // skip() is success-shaped by design, for crons that want a quiet no-op.
    // This endpoint's entire job is to return a link, so each call site has to
    // decide — and the seam's docs record the incident where one did not: an
    // operator clicked "create payment link", got HTTP 200, and no link existed.
    const s = src("create-checkout-session");
    expect(s).toContain("status: routed.httpStatus ?? 502");
    expect(s).toContain("if (routed.handled && routed.skipped)");
    expect(s).toContain("status: 409");
    // A skip on the emailed path is likewise a refusal, not a send.
    expect(src("send-excess-mileage-payment-link")).toContain("if (routedMileage.skipped)");
    expect(src("send-excess-mileage-payment-link")).toContain("409,");
  });

  it("PINS TODAY'S BEHAVIOUR: a request that resolves no tenant at all is still served, on the platform account", () => {
    // ON RECORD. With tenantData null the provider dispatch is skipped entirely
    // (`if (tenantId)`), the currency silently becomes GBP, and the session is
    // created on Drive247's own platform account with no Connect routing. Three
    // separate defects share this one path, which is why it should be a refusal.
    const s = src("create-checkout-session");
    expect(s).toContain("const platformAccount: PlatformAccount = tenantData ? getChargePlatformAccount(tenantData) : 'uk'");
    expect(s).toContain("const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null");
  });

  it.fails("a checkout request that resolves no tenant is refused", () => {
    // REMOVE THE .fails MARKER WHEN THIS IS FIXED.
    const s = src("create-checkout-session");
    expect(
      /if \(!tenantData\)|if \(!tenantId\) \{[\s\S]{0,200}(throw|status: 4)/.test(s),
      "create-checkout-session continues with tenantData null: no provider dispatch, " +
        "GBP currency, and the session created on the Drive247 platform account.",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The contract for way 2, and the small file reader the shared-module cases use.
//
// Declared at the bottom because they are data, not behaviour — but read them
// before trusting the two tests that consume them.
// ---------------------------------------------------------------------------

/**
 * Read any repo file as text. The edge-contract helper deliberately only knows
 * how to find `supabase/functions/<fn>/index.ts`; three cases above need the
 * SHARED modules those functions import (stripe-client.ts, checkout.ts,
 * square-adapter.ts), which cannot be imported under this config because
 * stripe-client.ts pulls Stripe from esm.sh at module scope.
 */
function readFileText(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/**
 * The body the portal's "Charge via Stripe" / "Email Stripe Link" buttons build
 * — apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx, the
 * `handleStripeCheckout` path. Both buttons build THIS payload; the only
 * difference is whether the returned url is window.open()ed or handed to
 * send-invoice-email.
 *
 * All thirteen keys, because the dialog can send all thirteen. Several are
 * conditional per payment (targetCategories, extensionId, paygAccrualId,
 * installmentId, placeDepositHoldAfter) and JSON.stringify drops the undefined
 * ones on the wire — but the DIALOG is what decides that, per payment, so they
 * belong in the contract rather than being excused.
 */
const STRIPE_CHECKOUT_CONTRACT: PayloadContract = {
  // Not a spine step: this folder runs independently of the onboarding chain.
  step: "integrations/stripe — rental checkout",
  fn: "create-checkout-session",
  builtIn: "apps/portal/src/components/shared/dialogs/add-payment-dialog.tsx",
  payload: {
    rentalId: "00000000-0000-0000-0000-000000000000",
    customerEmail: "renter@example.test",
    customerName: "Contract Fixture",
    totalAmount: 12.34,
    tenantId: "00000000-0000-0000-0000-000000000000",
    successUrl: "https://tenant.portal.drive-247.com/rentals/x?payment=success",
    cancelUrl: "https://tenant.portal.drive-247.com/rentals/x?payment=cancelled",
    source: "portal",
    targetCategories: ["Tax"],
    extensionId: undefined,
    paygAccrualId: undefined,
    installmentId: undefined,
    placeDepositHoldAfter: true,
  },
  serverOnlyOptional: {
    bookingId:
      "Legacy alias for rentalId, used by the booking app's older flow. The portal " +
      "always sends rentalId; the function accepts either (referenceId = rentalId || bookingId).",
    customerId:
      "The portal does not send it: the function resolves the customer from the rental " +
      "itself, which is the one field on this endpoint that IS derived server-side.",
    tenantSlug:
      "The booking app's path — it arrives as the x-tenant-slug header there. The portal " +
      "knows the tenant id outright and sends that instead.",
    bonzahPolicyId:
      "Booking-flow only: set when a Bonzah insurance policy was quoted during checkout. " +
      "A portal-side collection has no policy to stamp.",
    holdAsCredit:
      "The account-level 'collect then decide' flow, raised from the customer screen " +
      "(collect-payment-dialog.tsx), not from a rental's payment dialog.",
  },
};
