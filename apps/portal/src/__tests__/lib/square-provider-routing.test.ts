import { describe, it, expect } from "vitest";
import { readEdgeSource, liftDeclaration, compile } from "../helpers/edge-source";

/**
 * Guards for the Square provider wiring.
 *
 * THE ONE RULE THESE ALL SERVE
 *
 * Adding Square must not change what a Stripe tenant does. Every assertion below
 * is either "Square is handled" or "the Stripe path is untouched", and the second
 * kind is the one that matters: 52 live tenants and 1,026 payments are on Stripe,
 * and a regression there is the most expensive outcome available.
 *
 * Source assertions rather than executions: this logic lives in Deno modules that
 * Vitest cannot import, and there is no edge-function test harness in this repo.
 * Asserting on the shipped file is honest about that; pasting the logic into the
 * test and asserting on the paste would only prove the paste works.
 */

const fn = (name: string) => readEdgeSource(`${name}/index.ts`);
const shared = (name: string) => readEdgeSource(`_shared/payments/${name}.ts`);

/** Comments necessarily quote the wrong-rail names they warn about. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the Stripe rail is never re-routed", () => {
  it("process-refund still gates its Stripe branch on the same expression", () => {
    // The Square branch is nested in the ELSE. If someone ever converts this to
    // `if (!square && stripe...)` the Stripe predicate is no longer byte-identical
    // and the zero-diff claim quietly stops being true.
    expect(fn("process-refund")).toContain("if (payment?.stripe_payment_intent_id) {");
  });

  it("cancel-rental-refund still gates its Stripe branch on the same expression", () => {
    expect(fn("cancel-rental-refund")).toContain(
      'if (payment?.stripe_payment_intent_id && refundType !== "none") {',
    );
  });

  it("deduct-from-deposit still gates its Stripe branch on the same expression", () => {
    expect(fn("deduct-from-deposit")).toContain("if (payment?.stripe_payment_intent_id) {");
  });

  it("void-payment-link keeps the Stripe expire call", () => {
    expect(fn("void-payment-link")).toContain("stripe.checkout.sessions.expire");
  });
});

describe("refunds reach the rail the charge was taken on", () => {
  const refunders = [
    "process-refund",
    "process-scheduled-refund",
    "cancel-rental-refund",
    "reject-rental",
    "deduct-from-deposit",
  ];

  for (const name of refunders) {
    it(`${name} dispatches Square refunds through the shared seam`, () => {
      const s = fn(name);
      expect(s, `${name} must import the seam`).toContain("tryProviderRefund");
      expect(s, `${name} must branch on the record's provider`).toMatch(
        /payment(Record)?\??\.payment_provider === ['"]square['"]|payment\.payment_provider === ['"]square['"]/,
      );
    });
  }

  it("routes on the PAYMENT RECORD, never the tenant's current provider", () => {
    // A tenant could in principle be read mid-migration; the charge's own rail is
    // the only correct answer for where to send its refund.
    expect(shared("refund")).toContain("spec.paymentRecord.payment_provider");
  });

  it("refuses rather than guessing square_mode when the tenant row is unreadable", () => {
    // Guessing would attempt a LIVE refund against the sandbox host and quietly
    // do nothing.
    expect(shared("refund")).toContain("square_tenant_unreadable");
  });

  it("never reports a Square refund as settled on submission", () => {
    // Square refunds sit PENDING for days; square-webhook writes the terminal
    // state. Saying "completed" here tells an operator the customer has been paid.
    for (const name of ["process-refund", "cancel-rental-refund", "process-scheduled-refund"]) {
      expect(fn(name), `${name} must report processing, not completed`).toContain("processing");
    }
  });

  it("never writes a stripe_* handle onto a Square row", () => {
    // payments_provider_handle_exclusivity_check would throw AFTER the money moved.
    //
    // Bounded to the payments UPDATE inside the Square branch, not a fixed
    // character window: both files legitimately set stripe_refund_id further
    // down, on the Stripe branch, and a loose window reads that as a failure.
    for (const name of ["deduct-from-deposit", "process-scheduled-refund"]) {
      const s = fn(name);

      const marker = /payment(?:\??)\.payment_provider === ['"]square['"]/.exec(s);
      expect(marker, `${name} must have a Square branch`).not.toBeNull();

      const afterMarker = s.slice(marker!.index);
      const updateStart = afterMarker.indexOf(".update({");
      expect(updateStart, `${name}'s Square branch must update the payments row`)
        .toBeGreaterThan(-1);

      const updateEnd = afterMarker.indexOf("})", updateStart);
      // Comments stripped: the code deliberately explains WHY it omits
      // stripe_refund_id, and that sentence contains the very token being
      // banned. Asserting on prose makes the test fail on its own documentation.
      const updateBlock = codeOnly(afterMarker.slice(updateStart, updateEnd));

      expect(updateBlock, `${name} must record the Square refund id`)
        .toContain("square_refund_id");
      expect(updateBlock, `${name} must not set stripe_refund_id on a square row`)
        .not.toMatch(/stripe_refund_id:\s/);
    }
  });
});

describe("selection queries were widened, not narrowed", () => {
  const widened = ["process-refund", "cancel-rental-refund", "deduct-from-deposit"];

  for (const name of widened) {
    it(`${name} selects payments on either rail`, () => {
      // `stripe_payment_intent_id IS NOT NULL` silently means "is a Stripe
      // payment" once a second rail exists, so a real Square charge is never
      // selected and the customer is told they were refunded when they were not.
      expect(fn(name)).toContain(
        "stripe_payment_intent_id.not.is.null,square_payment_id.not.is.null",
      );
    });
  }

  it("the shared predicate keeps both halves in one place", () => {
    const s = shared("predicates");
    expect(s).toContain("applyElectronicPaymentFilter");
    expect(s).toContain("isElectronicPayment");
  });
});

describe("Stripe-only sweepers are fenced", () => {
  it("recover-pending-stripe-payments fences BOTH passes", () => {
    // jobid 34, every minute, the only webhook-miss recovery in the system.
    // Fencing one pass and not the other lets a Square row in the back door.
    const s = fn("recover-pending-stripe-payments");
    expect((s.match(/\.eq\('payment_provider', 'stripe'\)/g) ?? []).length).toBe(2);
  });

  it("uses the only sanctioned predicate form", () => {
    // .neq('payment_provider','square') and .is(...,null) are banned: they behave
    // differently the moment a third provider exists or a row is null.
    const s = codeOnly(fn("recover-pending-stripe-payments"));
    expect(s).not.toContain("neq('payment_provider'");
    expect(s).not.toContain('neq("payment_provider"');
  });

  it("sync-payment-intent refuses a Square payment by name", () => {
    expect(fn("sync-payment-intent")).toContain("square_payment");
  });
});

describe("features Square cannot do are refused, not attempted", () => {
  const gated: [string, string][] = [
    ["place-deposit-hold", "authorisation hold"],
    ["charge-saved-card", "stored card"],
    ["create-hold-checkout", "authorisation hold"],
    ["create-preauth-checkout", "pre-authorise"],
  ];

  for (const [name] of gated) {
    it(`${name} skips for a Square tenant`, () => {
      const s = fn(name);
      expect(s, `${name} must select the provider column`).toContain("payment_provider");
      expect(s, `${name} must name the reason`).toContain("square_tenant");
    });
  }

  it("they SKIP rather than throw", () => {
    // A throw turns a deliberately-absent feature into a failed booking and a
    // pager alert. These paths already use skipped:true for the charged-deposit
    // case; Square reuses that shape.
    for (const [name] of gated) {
      expect(fn(name), `${name} must skip`).toContain("skipped: true");
    }
  });

  it("installment refunds refuse outright — a Square tenant cannot have a plan", () => {
    // installments_enabled is forced false at tenant creation. Falling through
    // would record every installment as 'no_stripe_charge' and tell the customer
    // they were refunded.
    const s = fn("refund-installment-payments");
    expect(s).toContain("payment_provider");
    expect(s).toContain("cannot support installment plans");
  });
});

describe("void-payment-link keeps its stated guarantee on both rails", () => {
  const s = () => fn("void-payment-link");

  it("accepts a Square link as a link", () => {
    expect(s()).toContain("!payment.square_payment_link_id");
  });

  it("counts a settled Square charge as real money", () => {
    // Otherwise it would 'void' a link the customer has already paid.
    expect(s()).toContain("payment.square_payment_id != null");
  });

  it("guards the concurrency race on both rails", () => {
    const src = s();
    expect(src).toContain('.is("stripe_payment_intent_id", null)');
    expect(src).toContain('.is("square_payment_id", null)');
  });

  it("refuses to mark a link dead when it cannot actually revoke it", () => {
    // Square links never expire on their own. Reporting a void we did not perform
    // is worse than refusing: the operator collects again and the customer pays twice.
    expect(s()).toContain("it cannot be revoked at Square");
  });

  it("does not silently swallow a Square revoke failure", () => {
    const src = s();
    expect(src).toContain("The link is still live");
  });
});

describe("the payment-link id is persisted, or nothing can be voided", () => {
  it("the adapter writes square_payment_link_id alongside the order id", () => {
    const s = shared("square-adapter");
    expect(s).toContain("square_payment_link_id: link.id");
  });

  it("treats an already-deleted link as success", () => {
    // The caller's goal is "this link cannot be paid". A link that does not exist
    // satisfies it.
    const s = shared("square-adapter");
    const v = s.slice(s.indexOf("voidSquarePaymentLink"));
    expect(v).toContain("404");
  });
});

describe("readDocId-style tolerance is NOT applied to money", () => {
  it("a failed Square checkout is an error, never a silent 200", () => {
    // The seam's own docs call this out: without it, a Square outage returns
    // HTTP 200 with no payment link and the operator sees a success.
    expect(shared("checkout")).toContain("routed.error");
    expect(shared("square-adapter")).toContain("square_checkout_failed");
  });
});

describe("checkout creators route by provider", () => {
  it("create-extension-checkout dispatches, and does not require a stored card", () => {
    // This session sets no setup_future_usage, so nothing charges the card
    // again later — a one-off extension is squarely within what Square can do.
    const s = fn("create-extension-checkout");
    expect(s).toContain("tryProviderCheckout");
    expect(s).toContain("requiresStoredCredential: false");
  });

  it("send-invoice-email dispatches without demanding a vaulted card", () => {
    // Its setup_future_usage exists solely so create-deposit-hold can preauth
    // afterwards. Square tenants never place a hold, so gating on the Stripe
    // rail's requirement would deny them invoice links for a feature they do
    // not have.
    const s = fn("send-invoice-email");
    expect(s).toContain("tryProviderCheckout");
    expect(s).toContain("requiresStoredCredential: false");
  });

  it("send-invoice-email still sends the email when Square fails", () => {
    // The enclosing catch already degrades Stripe failures to "no payment link,
    // email still goes". A Square outage must not suppress an email Stripe
    // tenants would still receive.
    expect(fn("send-invoice-email")).toContain("sending invoice without a payment link");
  });

  it("create-checkout-session no longer hardcodes the vault requirement", () => {
    // It used to pass `requiresStoredCredential: true` unconditionally, on the
    // reasoning that the Stripe session always sets setup_future_usage. That
    // reasoning skipped Square on EVERY booking — and this is the function the
    // booking app calls to take payment, so Square tenants could not sell at all.
    //
    // The vault serves held deposits, instalments and PAYG. A Square tenant has
    // none of them, so the requirement is computed per request instead.
    const s = fn("create-checkout-session");
    expect(s).not.toContain("requiresStoredCredential: true");
    expect(s).toContain("requiresStoredCredential: needsStoredCredential");
  });
});

describe("installment paths refuse Square instead of half-working", () => {
  const installmentFns = [
    "create-upfront-checkout",
    "installment-pay-link",
    "pay-installment-early",
    "process-installment-payment",
    "refund-installment-payments",
  ];

  for (const name of installmentFns) {
    it(`${name} refuses a Square tenant`, () => {
      const s = fn(name);
      expect(s, `${name} must read the provider`).toContain("payment_provider");
      // Quote style differs across these files; the behaviour is what matters.
      expect(s, `${name} must compare the provider to 'square'`).toMatch(
        /payment_provider === ['"]square['"]/,
      );
    });
  }

  it("the batch runner SKIPS the plan rather than aborting the run", () => {
    // A multi-tenant batch: one anomalous plan must not starve every Stripe
    // tenant's instalments queued behind it.
    const s = fn("process-installment-payment");
    const sq = s.slice(s.indexOf("payment_provider?: string"));
    expect(sq.slice(0, 900)).toContain("continue");
  });

  it("the customer-facing link returns a readable page, not JSON", () => {
    // Opened by a renter from an email; a JSON error or Stripe exception is not
    // an acceptable thing to show them.
    const s = fn("installment-pay-link");
    const sq = s.slice(s.indexOf("payment_provider?: string"));
    expect(sq.slice(0, 900)).toContain("htmlPage");
  });
});

describe("PAYG is fenced where data does not already exclude Square", () => {
  it("send-payg-reminders fences the tenant prefetch", () => {
    // rentals.payg_auto_reminders_enabled DEFAULTS TO TRUE, so unlike
    // auto-extend, PAYG is NOT excluded by data and needs a real fence.
    expect(fn("send-payg-reminders")).toContain('.eq("payment_provider", "stripe")');
  });

  it("the fence reuses the loop's existing skip-and-count", () => {
    const s = fn("send-payg-reminders");
    expect(s).toContain("skipped++");
  });

  it("send-payg-manual-reminder returns no Stripe context for Square", () => {
    expect(fn("send-payg-manual-reminder")).toContain("no Stripe context");
  });
});

describe("both tenant-creation paths set the provider", () => {
  it("create-sales-onboarding accepts and persists a provider", () => {
    const s = fn("create-sales-onboarding");
    expect(s).toContain("paymentProvider");
    expect(s).toContain("providerCols");
  });

  it("it validates the Square country list before inserting", () => {
    // tenants_square_country_supported_check would otherwise abort onboarding
    // after several side effects have already run.
    expect(fn("create-sales-onboarding")).toContain("SQUARE_COUNTRIES");
  });

  it("it forces the Square invariants at birth", () => {
    const s = fn("create-sales-onboarding");
    const block = s.slice(s.indexOf("const providerCols"));
    expect(block.slice(0, 700)).toContain("deposit_charge_enabled: true");
    expect(block.slice(0, 700)).toContain("installments_enabled: false");
  });

  it("defaults to Stripe when the caller says nothing", () => {
    // Every existing script-driven onboarding omits it; this must stay inert
    // for them.
    expect(fn("create-sales-onboarding")).toContain('paymentProvider ?? "stripe"');
  });
});

describe("the booking flow actually works for a Square tenant", () => {
  const s = () => fn("create-checkout-session");

  it("decides the vault requirement per request, not per provider", () => {
    // This is the function the booking app invokes to take payment. Hardcoding
    // `requiresStoredCredential: true` made every Square tenant skip it, which
    // meant their customers could not book at all.
    expect(s()).toContain("const needsStoredCredential =");
    expect(s()).toContain("requiresStoredCredential: needsStoredCredential");
  });

  it("only demands a vault when something later actually charges the card", () => {
    // Held deposits, instalments and PAYG are the three consumers of the vault.
    // A Square tenant has none of them.
    const src = s();
    const expr = src.slice(src.indexOf("const needsStoredCredential ="), src.indexOf("const needsStoredCredential =") + 220);
    expect(expr).toContain("depositChargeEnabled");
    expect(expr).toContain("installmentId");
    expect(expr).toContain("paygAccrualId");
  });

  it("expresses it as a property of the request, never a provider-name test", () => {
    // So a third processor needs no new branch here.
    const src = codeOnly(s());
    const expr = src.slice(src.indexOf("const needsStoredCredential ="), src.indexOf("const needsStoredCredential =") + 220);
    expect(expr).not.toContain("square");
  });

  it("a skip is a loud refusal, not a 200 with no payment link", () => {
    // This endpoint's whole job is to return a link. A quiet 200 would show a
    // customer mid-booking a success that did not happen.
    const src = s();
    expect(src).toContain("routed.handled && routed.skipped");
    expect(src).toContain("status: 409");
  });
});
