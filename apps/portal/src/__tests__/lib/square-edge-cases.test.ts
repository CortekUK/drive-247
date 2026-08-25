import { describe, it, expect } from "vitest";
import { readEdgeSource, readRepoSource, liftDeclaration, compile, codeOnly } from "../helpers/edge-source";

/**
 * Edge-case suite for the Square integration, following the risk register in
 * docs/square-integration/03-STRIPE-SAFETY-AND-EDGE-CASES.md.
 *
 * WHERE THESE DIFFER FROM square-provider-routing.test.ts
 *
 * That file asserts the wiring is present. This one attacks the behaviour: the
 * status map is LIFTED AND EXECUTED against every value Square can send,
 * including the ones with no Stripe analogue, because those are where a mapping
 * error turns into money that looks collected and is not.
 *
 * The single invariant behind most of it: `payments.status = 'Completed'` means
 * money has irrevocably moved. Eight database triggers key off that column —
 * `auto_fifo_on_payment_completed` allocates against charges, a customer
 * notification fires, a RAG row is queued — and none of them can be undone by an
 * edge function noticing later that Square said APPROVED, not COMPLETED.
 */

const statusMapSrc = () => readEdgeSource("_shared/payments/square-status-map.ts");
const fn = (name: string) => readEdgeSource(`${name}/index.ts`);
const shared = (name: string) => readEdgeSource(`_shared/payments/${name}.ts`);

// These are pure, dependency-free functions, so they are compiled and RUN
// rather than pattern-matched. A source assertion cannot tell you what
// mapSquarePaymentStatus('APPROVED') actually returns.
const mapPayment = compile<(s: string) => string>(
  [liftDeclaration(statusMapSrc(), "mapSquarePaymentStatus")],
  "mapSquarePaymentStatus",
);
const mapRefund = compile<(s: string) => string>(
  [liftDeclaration(statusMapSrc(), "mapSquareRefundStatus")],
  "mapSquareRefundStatus",
);
const isTerminal = compile<(s: string) => boolean>(
  [liftDeclaration(statusMapSrc(), "isTerminalSquareStatus")],
  "isTerminalSquareStatus",
);

describe("R-04 · an authorisation must never read as collected money", () => {
  it("APPROVED is Pending, not Completed", () => {
    // Square's APPROVED means authorised and NOT captured. It has no Stripe
    // analogue in this flow. Mapping it to Completed fires the FIFO trigger and
    // allocates money that does not exist — in the database, below the level any
    // edge-function guard can see.
    expect(mapPayment("APPROVED")).toBe("Pending");
  });

  it("only COMPLETED becomes Completed", () => {
    const collected = ["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"]
      .filter((s) => mapPayment(s) === "Completed");
    expect(collected).toEqual(["COMPLETED"]);
  });

  it("maps the rest to states that move no money", () => {
    expect(mapPayment("PENDING")).toBe("Pending");
    expect(mapPayment("CANCELED")).toBe("Cancelled");
    expect(mapPayment("FAILED")).toBe("Failed");
  });

  it("an unknown status is Pending — never Completed", () => {
    // Square can add a status without telling us. The safe default is the one
    // that allocates nothing.
    for (const s of ["", "WEIRD_NEW_STATUS", "completed", "Completed", "null", "undefined"]) {
      expect(mapPayment(s), `${s} must not be treated as collected`).not.toBe("Completed");
      expect(mapPayment(s)).toBe("Pending");
    }
  });

  it("is case-sensitive on purpose — lowercase 'completed' is not COMPLETED", () => {
    // Square sends uppercase. A lowercase value means something has been
    // transformed somewhere it should not have been, and guessing would be worse
    // than refusing.
    expect(mapPayment("completed")).toBe("Pending");
  });
});

describe("refund statuses — Square settles asynchronously and can still fail", () => {
  it("PENDING is Pending, so the operator is never told 'refunded' early", () => {
    // A Stripe refund is done when the API returns. A Square refund comes back
    // PENDING and can land REJECTED days later.
    expect(mapRefund("PENDING")).toBe("Pending");
  });

  it("REJECTED and FAILED are Failed, not silently dropped", () => {
    expect(mapRefund("REJECTED")).toBe("Failed");
    expect(mapRefund("FAILED")).toBe("Failed");
  });

  it("only COMPLETED closes a refund", () => {
    const done = ["PENDING", "COMPLETED", "REJECTED", "FAILED"]
      .filter((s) => mapRefund(s) === "Completed");
    expect(done).toEqual(["COMPLETED"]);
  });

  it("an unknown refund status stays Pending rather than closing the case", () => {
    expect(mapRefund("SOMETHING_ELSE")).toBe("Pending");
  });
});

describe("terminality — when it is safe to stop reconciling", () => {
  it("treats every end state as terminal", () => {
    for (const s of ["COMPLETED", "FAILED", "CANCELED", "REJECTED"]) {
      expect(isTerminal(s), `${s} should be terminal`).toBe(true);
    }
  });

  it("does NOT treat in-flight states as terminal", () => {
    // Stopping here would abandon a refund mid-settlement.
    for (const s of ["PENDING", "APPROVED", ""]) {
      expect(isTerminal(s), `${s} must not be terminal`).toBe(false);
    }
  });

  it("CANCELED is spelled Square's way, not the British way", () => {
    // Square uses one L. A silent mismatch here means a cancelled payment is
    // reconciled forever.
    expect(isTerminal("CANCELED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(false);
  });
});

describe("R-01 · the provider column can never silently disable Stripe recovery", () => {
  it("the fence and the DDL are documented as one decision", () => {
    // `.eq('payment_provider','stripe')` is a no-op under NOT NULL DEFAULT
    // 'stripe' and a total kill switch under nullable-with-no-default. The
    // predicate is only safe because of the column definition.
    expect(shared("predicates")).toContain("NOT NULL DEFAULT");
  });

  it("bans the predicate forms that behave differently under NULL", () => {
    const s = shared("predicates");
    expect(s).toContain("BINDING RULE");
    expect(s).toContain("banned");
  });
});

describe("R-06 · Square ids never occupy Stripe columns", () => {
  it("the adapter writes square_* handles only", () => {
    // codeOnly, because this asserts on what the adapter DOES. The file also
    // discusses these column names in prose, and an earlier version of this test
    // sliced from the literal text "persist: {" — which a later doc comment
    // mentioning that block silently captured instead of the code.
    const s = codeOnly(shared("square-adapter"));

    // The handle write-back, which is the statement that actually makes a
    // payment correlatable. `persist` is returned for callers that want the ids,
    // but nothing depends on a caller reading it any more.
    const back = s.slice(s.indexOf("payment_link ?? {}"));
    const writeBack = back.slice(back.indexOf('.from("payments")'), back.indexOf('.from("payments")') + 400);
    expect(writeBack).toContain("square_order_id");
    expect(writeBack).toContain("square_payment_link_id");
    expect(writeBack).not.toContain("stripe_");
  });

  it("both recovery passes are fenced so Square rows cannot occupy the window", () => {
    // The scan is LIMIT 100. Unresolvable rows in that window starve genuine
    // Stripe recoveries without ever throwing.
    const s = fn("recover-pending-stripe-payments");
    expect((s.match(/\.eq\('payment_provider', 'stripe'\)/g) ?? []).length).toBe(2);
  });
});

describe("R-05 · the Stripe webhooks are never given Square work", () => {
  it("square-webhook is a separate receiver", () => {
    // Repeated 500s inside a Stripe receiver book against Stripe's per-endpoint
    // auto-disable budget, and a disabled endpoint stops settlement for every
    // tenant on the platform.
    expect(() => fn("square-webhook")).not.toThrow();
  });

  it("it reuses the same downstream settlement helpers rather than duplicating them", () => {
    // Duplicated transport is fine; duplicated money logic is not.
    const s = fn("square-webhook");
    expect(s).toMatch(/apply-payment/);
  });
});

describe("money-shape edge cases in the adapter", () => {
  const toMinor = compile<(v: unknown) => number | null>(
    [liftDeclaration(shared("square-adapter"), "majorToMinorUnits")],
    "majorToMinorUnits",
  );

  it("converts whole and fractional amounts without float drift", () => {
    expect(toMinor(10)).toBe(1000);
    expect(toMinor(10.5)).toBe(1050);
    // The classic float case: 19.99 * 100 === 1998.9999999999998 in IEEE754.
    // Without Math.round this reaches Square as a non-integer and is rejected
    // with EXPECTED_INTEGER.
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor(0.1)).toBe(10);
    // Every price a 2-decimal currency can express survives the round trip.
    for (let cents = 1; cents <= 2000; cents++) {
      expect(toMinor(cents / 100), `${cents / 100} must convert to ${cents}`).toBe(cents);
    }
  });

  it("does not pretend to resolve a half-cent", () => {
    // 1.005 is not representable in IEEE754 — it stores just below, so
    // Math.round(100.49999…) is 100. That is correct for a currency with two
    // decimals, where 1.005 is not a price anyone can be charged. Asserting 101
    // here would force a rounding change that breaks the 19.99 case above.
    expect(toMinor(1.005)).toBe(100);
  });

  it("accepts a numeric string, since Postgres numerics arrive as strings", () => {
    expect(toMinor("10.50")).toBe(1050);
  });

  it("refuses values that are not money rather than coercing them to 0", () => {
    // A silent 0 is a free rental.
    for (const bad of [null, undefined, "", "abc", NaN, Infinity, -Infinity]) {
      expect(toMinor(bad as unknown), `${String(bad)} must not become a number`).toBeNull();
    }
  });

  it("refuses a negative amount — a negative refund is a charge", () => {
    expect(toMinor(-5)).toBeNull();
    expect(toMinor("-0.01")).toBeNull();
  });

  it("refuses zero — Square rejects it and it hides an upstream miscalculation", () => {
    expect(toMinor(0)).toBeNull();
    expect(toMinor("0")).toBeNull();
    expect(toMinor("0.00")).toBeNull();
  });
});

describe("R-14 · Square now has a webhook-miss recovery", () => {
  const rec = () => fn("recover-pending-square-payments");

  it("exists at all — Square shipped without one", () => {
    // square-webhook's own comment recorded the gap: when it cannot find a local
    // row, "console.error is currently the only signal". A missed delivery left
    // the customer charged and the row Pending forever.
    expect(() => rec()).not.toThrow();
  });

  it("is Square-fenced, symmetrically with the Stripe recovery", () => {
    // Neither cron may ever pick up the other rail's rows.
    expect(rec()).toContain('.eq("payment_provider", "square")');
  });

  it("only ever advances a row it already has — it cannot invent a payment", () => {
    // It reads orders for existing Pending rows. It never discovers new money.
    const s = rec();
    expect(s).toContain('.eq("status", "Pending")');
    expect(s).toContain('.not("square_order_id", "is", null)');
  });

  it("routes the status decision through the shared map, not a string compare", () => {
    // So APPROVED (authorised, not captured) cannot settle here even though it
    // could look like success on the order.
    expect(rec()).toContain("mapSquarePaymentStatus");
  });

  it("guards the race against square-webhook settling first", () => {
    // Without this, a webhook landing mid-run would get a second paid_at written
    // over it by the cron.
    const s = rec();
    expect(s).toContain('.eq("status", "Pending")');
    expect(s).toContain('.is("paid_at", null)');
  });

  it("does not abort the batch when one merchant is unreachable", () => {
    const s = rec();
    expect(s).toContain("catch");
    expect(s).toContain("continue");
  });

  it("reuses the same FIFO settlement the Stripe recovery calls", () => {
    // Duplicating transport is acceptable; duplicating money logic is not.
    expect(rec()).toContain("payment_apply_fifo_v2");
  });
});

describe("R-22 · a Square tenant is not permanently 'not ready'", () => {
  const mig = () =>
    readRepoSource("supabase/migrations/20260825210000_tenant_readiness_provider_aware.sql");

  it("keeps the stripe_ready expression byte-identical", () => {
    // 52 live tenants are judged by this expression. Changing it — even
    // 'tidying' it — changes who can go live.
    expect(mig()).toContain(
      "t.stripe_mode = 'live'::text AND COALESCE(t.stripe_onboarding_complete, false) AND (COALESCE(t.stripe_account_status, ''::text) = ANY (ARRAY['active'::text, 'enabled'::text]))",
    );
  });

  it("routes overall_ready through the provider-neutral term", () => {
    // Previously `overall_ready = stripe_ready AND ...`, which a Square tenant
    // could never satisfy. The readiness signal gates go-live, and 8 of 52
    // tenants already carry migration_blocker='hard'.
    const s = mig();
    expect(s).toContain("(payments_ready AND boldsign_ready AND bonzah_ready AND subscription_ready) AS overall_ready");
    expect(s).not.toContain("(stripe_ready AND boldsign_ready AND bonzah_ready AND subscription_ready)");
  });

  it("counts issues against the neutral term too", () => {
    const s = mig();
    expect(s).toContain("WHEN (NOT payments_ready) THEN 1");
  });

  it("appends the new columns rather than inserting them", () => {
    // CREATE OR REPLACE VIEW can only add columns at the END. Inserting one
    // mid-list fails with 42P16, which is how this was found.
    const s = mig();
    const overall = s.indexOf("AS overall_ready");
    expect(s.indexOf("    payment_provider,", overall)).toBeGreaterThan(overall);
    expect(s.indexOf("    payments_ready\n", overall)).toBeGreaterThan(overall);
  });

  it("requires a location, not merely a connection, for Square readiness", () => {
    // Without location_id no payment link can be created, so a connected
    // merchant with no location is not actually able to take money.
    expect(mig()).toContain("COALESCE(sc.location_id, ''::text) <> ''::text");
  });
});
