/**
 * THE SPINE'S PAYMENT STEP — the four ways money is taken. Layer 1, offline.
 *
 * The team lead enumerated these precisely and wanted all four:
 *
 *   1. AUTO CHARGE on a stored card, nobody present          charge-saved-card
 *   2. the on-screen "pay directly via Stripe" checkout       create-checkout-session
 *   3. THE SAME checkout link, emailed                        send-invoice-email
 *      "we're emailing the same checkout link, nothing else"
 *   4. a MANUALLY recorded payment                            record-authority-payment
 *
 * then the sync back from Stripe by webhook.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS *NOT*
 *
 * tests/integrations/stripe/*.test.ts already covers Stripe's own contracts —
 * whether a session is built correctly, whether a refund is capped, what the
 * webhook verifies. This file does not repeat any of that.
 *
 * This file is about the RENTAL: given that a payment happened, do the four paths
 * AGREE about what they wrote? They all land in the same `payments` table and are
 * read back by the same three screens, so a disagreement between them is invisible
 * until an operator compares two rentals and finds one says "captured" and the
 * other "requires capture" for the same situation. That is the bug class here.
 *
 * NOT COVERED: extensions, auto-extension, pay-as-you-go and installments, all
 * parked by the team lead for this round; and the money arithmetic, which is
 * 01-pricing-maths and 02-invoice-maths.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnSrc = (n: string) => readFileSync(root(`supabase/functions/${n}/index.ts`), "utf8");

const AUTO_CHARGE = fnSrc("charge-saved-card");          // method 1
const CHECKOUT = fnSrc("create-checkout-session");        // method 2 and 3
const INVOICE_EMAIL = fnSrc("send-invoice-email");        // method 3
const MANUAL = fnSrc("record-authority-payment");         // method 4
const UPFRONT = fnSrc("create-upfront-checkout");         // a fifth creator, and the outlier

// @usecase An unattended charge that runs twice takes the renter's money twice,
// and a cron is exactly where a retry happens unseen. This is the only path in the
// whole payment surface that guards against it, so it is the reference standard.
describe("method 1 — auto charge on a stored card", () => {
  it("refuses to run without a caller-supplied request id", () => {
    // charge-saved-card:212-216. The id is mandatory and format-checked, so a
    // caller cannot opt out of idempotency by omitting it.
    expect(AUTO_CHARGE).toMatch(/const clientRequestId = asString\(body\.clientRequestId\)/);
    expect(AUTO_CHARGE).toMatch(/A clientRequestId is required/);
  });

  it("derives its Stripe idempotency key from the rental and that request id", () => {
    // charge-saved-card:541. Stable across retries of one logical charge, distinct
    // between two deliberate charges — which is exactly the property the Square
    // refund path gets wrong (see integrations/square/refund-idempotency.test.ts).
    expect(AUTO_CHARGE).toContain("`charge-saved-card-${rentalId}-${clientRequestId}`");
  });

  it("persists the request id on the payment row so a duplicate can be recognised later", () => {
    expect(AUTO_CHARGE).toMatch(/client_request_id:\s*clientRequestId/);
  });
});

// @usecase A row written before the customer pays must not claim the money
// arrived. Anything reading capture_status to decide "is this paid?" would treat
// an unpaid link as settled.
describe("method 2 — the on-screen checkout, and what it writes before payment", () => {
  it("records a not-yet-paid checkout as requiring capture and pending verification", () => {
    // create-checkout-session:271,529,572 — the honest pair. The money has not
    // moved yet; only the webhook may say otherwise.
    expect(CHECKOUT).toMatch(/verification_status:\s*['"]pending['"]/);
    expect(CHECKOUT).toMatch(/capture_status:\s*['"]requires_capture['"]/);
  });

  it("explains in source why capture_status is requires_capture on the Stripe path", () => {
    // The comment is the contract for the next person who "tidies" this value.
    expect(CHECKOUT).toContain("capture_status is 'requires_capture' on the Stripe path");
  });

  it("stamps payment_date at link creation, which is not when the money arrived", () => {
    /**
     * There are THREE date columns and they mean different things:
     *   paid_at       — Stripe capture time, written by the webhook
     *   payment_date  — operator-recorded date, and what the portal displays
     *   created_at    — row creation
     * create-checkout-session:268 sets payment_date at the moment the LINK is made,
     * so the portal shows a payment date for a payment that has not happened.
     * Pinned rather than watchdogged: which date the portal should show for an
     * unpaid link is a product decision, not a clear defect.
     */
    expect(CHECKOUT).toMatch(/payment_date:\s*new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);
  });
});

// @usecase The team lead was explicit that this is the SAME link, not a second
// payment mechanism. If it ever diverges, two operators doing what they believe is
// the same action produce different rows.
describe("method 3 — the same checkout link, emailed", () => {
  it("accepts a payment URL created elsewhere rather than minting its own", () => {
    // This is what makes it "the same link": the portal creates the session, then
    // hands the URL to the emailer.
    expect(INVOICE_EMAIL).toMatch(/paymentUrl/);
  });

  it("can also create its own session, which is a second and differently-behaved path", () => {
    /**
     * The asymmetry that matters: send-invoice-email's OWN session sets
     * receipt_email (:360) while a session made by create-checkout-session does not
     * (verified by absence). So whether the customer gets a Stripe receipt depends
     * on which of the two routes the operator happened to take. Traced fully in
     * 05-notifications.test.ts; asserted here because it is a property of the
     * payment method, not only of the notification.
     */
    expect(INVOICE_EMAIL).toMatch(/receipt_email:\s*toEmail/);
    expect(CHECKOUT).not.toContain("receipt_email");
  });
});

// @usecase A hand-entered payment is the operator asserting money arrived outside
// Stripe. It must be distinguishable from a Stripe-settled one, or reconciliation
// against the Stripe dashboard can never balance.
describe("method 4 — a manually recorded payment", () => {
  it("records the operator-supplied payment date rather than inventing one", () => {
    expect(MANUAL).toMatch(/payment_date:\s*paymentDate/);
  });

  it("is not marked auto-approved, because a human is the one asserting it", () => {
    // Only a Stripe settlement may claim auto_approved; see the "AUTO-APPROVED"
    // note in apps/portal/src/lib/tab-tours/payments.ts for the operator-facing
    // meaning of that word.
    expect(MANUAL).not.toMatch(/verification_status:\s*['"]auto_approved['"]/);
  });
});

// @usecase Two creators write opposite values for the same situation. Whichever
// screen an operator happens to look at decides whether an unpaid rental looks
// paid — and one of them also skips the human verification queue entirely.
describe("the creators disagree about a payment that has not happened yet", () => {
  it("marks an upfront checkout captured and auto-approved before the customer pays", () => {
    /**
     * DEFECT, create-upfront-checkout:200,202. Written immediately after
     * sessions.create — before any money moves:
     *     verification_status: 'auto_approved'
     *     capture_status:      'captured'
     * For the identical situation create-checkout-session writes
     * 'pending' / 'requires_capture'. So an unpaid upfront link reads as a settled,
     * already-verified payment, and `auto_approved` means no human ever reviews it.
     */
    expect(UPFRONT).toMatch(/verification_status:\s*['"]auto_approved['"]/);
    expect(UPFRONT).toMatch(/capture_status:\s*['"]captured['"]/);
  });

  it.fails("should write the same not-yet-paid state as every other creator", () => {
    // Remove the `.fails` marker once create-upfront-checkout:200-202 writes
    // 'pending' / 'requires_capture' and lets the webhook promote the row.
    const honest =
      /verification_status:\s*['"]pending['"]/.test(UPFRONT) &&
      /capture_status:\s*['"]requires_capture['"]/.test(UPFRONT);
    expect(honest).toBe(true);
  });

  it.fails("should give every payment creator the idempotency guard auto-charge already has", () => {
    /**
     * Remove the `.fails` marker once the checkout creators take a caller-supplied
     * request id and pass an idempotency key to Stripe, as charge-saved-card:541
     * does. Today a repeated call mints a second payable link AND a second Pending
     * row, and nothing downstream can tell the pair apart.
     */
    const guarded = [CHECKOUT, UPFRONT].every(
      (s) => /idempotencyKey|clientRequestId/.test(s),
    );
    expect(guarded).toBe(true);
  });
});
