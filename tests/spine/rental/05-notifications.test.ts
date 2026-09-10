/**
 * THE SPINE'S EMAIL AND NOTIFICATION STEP — Layer 1, offline, source-of-record.
 *
 * The team lead nearly forgot this step, then added it by name and told me to
 * reason it out rather than wait for a spec: "where all can email go, where all
 * should I get a notification. If you get confused, ask me."
 *
 * He then gave a worked example, which is the centrepiece of this file:
 *
 *     "I sent him an email. He paid on that email.
 *      Now do I get a notification in the portal or not?"
 *
 * The answer turns out to be YES — but from somewhere nobody would guess, and
 * with a customer-side hole next to it. Both are asserted below.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE READS MIGRATIONS AND NOT JUST EDGE FUNCTIONS
 *
 * The operator's portal bell on this path is NOT emitted by any edge function.
 * It comes from a DATABASE TRIGGER on public.payments. The webhook that flips the
 * payment row says so itself in a comment. So a test that only read the webhook's
 * source would conclude no notification happens, which is the opposite of the
 * truth. The trigger SQL is therefore part of the contract and is read here.
 *
 * That also means this whole path is invisible to any Layer 2 test pointed at a
 * clone: the dispatch trigger's URL is hardcoded to the production project, so on
 * any other database the operator email silently does not exist. Asserted below,
 * because it is the kind of thing that makes a staging test lie.
 *
 * NOT COVERED HERE: SMS delivery content, template rendering, and the reminder
 * cron family — those are their own surface. This file is about whether the
 * right party is told, at all, when money moves on a simple rental.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnSrc = (n: string) => readFileSync(root(`supabase/functions/${n}/index.ts`), "utf8");
const migration = (n: string) => readFileSync(root(`supabase/migrations/${n}`), "utf8");

const CHECKOUT = fnSrc("create-checkout-session");
const INVOICE_EMAIL = fnSrc("send-invoice-email");
const WEBHOOK_TEST = fnSrc("stripe-webhook-test");
const WEBHOOK_LIVE = fnSrc("stripe-webhook-live");
const PAYMENT_TRIGGER = migration("20260718050000_add_payment_received_notification_trigger.sql");
const EMAIL_DISPATCH = migration("20260718050300_add_operator_email_dispatch_trigger.sql");

// @usecase The team lead's own worked example. If this chain breaks, an operator
// emails a payment link and is never told the customer paid — so the rental sits
// unactioned while the money is already banked.
describe("the emailed-payment-link journey — does the operator get told?", () => {
  it("raises the operator's portal bell from a database trigger on payments, not from the webhook", () => {
    /**
     * This is the non-obvious link in the chain. The bell is emitted by
     * on_payment_received_notify on public.payments
     * (20260718050000_add_payment_received_notification_trigger.sql:107-109), so it
     * fires however the row is written — webhook, cron, or a hand-run SQL update.
     * That is a GOOD design, and it is also why reading only the webhook's source
     * would give the wrong answer.
     */
    expect(PAYMENT_TRIGGER).toContain("on_payment_received_notify");
    expect(PAYMENT_TRIGGER).toMatch(/CREATE TRIGGER\s+on_payment_received_notify/);
    expect(PAYMENT_TRIGGER).toMatch(/ON\s+public\.payments/i);
  });

  it("emits nothing from the webhook itself, and says so in its own comment", () => {
    // The comment is load-bearing documentation: without it the next reader adds a
    // second notification here and the operator gets two bells per payment.
    expect(WEBHOOK_TEST).toContain("nothing is emitted here");
  });

  it("flips the pre-created payments row from Pending to Completed when Stripe settles", () => {
    // The bell is a consequence of THIS write, so the write is the contract.
    expect(WEBHOOK_TEST).toContain("checkout.session.completed");
    expect(WEBHOOK_TEST).toMatch(/status:\s*["']Completed["']/);
  });

  it("sends the operator's email through a second trigger on notifications, via pg_net", () => {
    expect(EMAIL_DISPATCH).toContain("net.http_post");
    expect(EMAIL_DISPATCH).toContain("notify-operator-email");
  });
});

// @usecase A staging or branch database silently lacks the operator email
// entirely, so any Layer 2 run there would "prove" a path that only works in
// production. This is the assertion that stops that false confidence.
describe("the operator-email dispatch is pinned to one project", () => {
  it("posts to a hardcoded production URL rather than a per-database setting", () => {
    /**
     * DEFECT (cross-environment coupling). The trigger at
     * 20260718050300_add_operator_email_dispatch_trigger.sql:49-50 posts to
     *   https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/notify-operator-email
     * That ref is the PRODUCTION project. On a branch clone the row is inserted and
     * the HTTP call either fails or — worse — reaches production's function with a
     * clone's data. Nothing in the migration reads current_setting() or a vault
     * value, so there is no per-database override.
     */
    expect(EMAIL_DISPATCH).toContain("https://hviqoaokxvlancmftwuo.supabase.co");
    expect(EMAIL_DISPATCH).not.toMatch(/current_setting\s*\(/);
  });

  it.fails("should resolve its own project URL instead of naming one environment", () => {
    // Remove the `.fails` marker once the URL comes from current_setting() or the
    // vault rather than a literal.
    expect(EMAIL_DISPATCH).not.toContain("hviqoaokxvlancmftwuo");
  });
});

// @usecase The renter pays and never receives a receipt, so support fields "did
// my payment go through?" for every operator-emailed link. Two paths that look
// identical to the operator behave differently.
describe("the two emailed-payment-link paths disagree about the customer's receipt", () => {
  it("attaches a receipt address when send-invoice-email creates the session itself", () => {
    // send-invoice-email:360 sets receipt_email, so Stripe emails the payer.
    expect(INVOICE_EMAIL).toMatch(/receipt_email:\s*toEmail/);
  });

  it("attaches no receipt address when the portal creates the session first", () => {
    /**
     * DEFECT. The portal's Record-Payment dialog calls create-checkout-session and
     * then hands the resulting URL to send-invoice-email as an externally-supplied
     * paymentUrl. On that route the session was built by create-checkout-session,
     * which never sets receipt_email at all — verified by absence across the whole
     * file. So Stripe sends the payer nothing.
     */
    expect(CHECKOUT).not.toContain("receipt_email");
  });

  it("also suppresses the webhook's own customer notification for portal-initiated payments", () => {
    /**
     * The second half of the same hole. The webhook decides the payment is
     * portal-initiated from session.metadata.source === 'portal' (:1198) and gates
     * its customer-facing notification behind `!isPortalPayment` (:1202, :1446).
     * Combined with the missing receipt_email above, a customer who pays an
     * operator-emailed link is told by nobody: not Stripe, not us.
     */
    expect(WEBHOOK_TEST).toContain("session.metadata?.source === 'portal'");
    expect(WEBHOOK_TEST).toMatch(/if\s*\(\s*!isPortalPayment/);
  });

  it.fails("should confirm the payment to the customer however the link was created", () => {
    // Remove the `.fails` marker once create-checkout-session sets receipt_email
    // (or the webhook stops suppressing the customer notification for portal
    // payments). Either fix closes it; both together would double-send.
    const customerIsTold =
      CHECKOUT.includes("receipt_email") ||
      !/if\s*\(\s*!isPortalPayment\s*&&\s*finalPaymentId/.test(WEBHOOK_TEST);
    expect(customerIsTold).toBe(true);
  });
});

// @usecase Both webhooks must behave identically. A notification that fires in
// test mode but not live — or the reverse — is the hardest class of bug to see,
// because every rehearsal passes.
describe("the test and live webhooks stay in step on notification behaviour", () => {
  it("gates the customer notification the same way in both modes", () => {
    for (const [name, src] of [["test", WEBHOOK_TEST], ["live", WEBHOOK_LIVE]] as const) {
      expect(src, `${name} webhook lost the portal-payment gate`).toMatch(/if\s*\(\s*!isPortalPayment/);
    }
  });

  it("leaves the operator bell to the database in both modes", () => {
    for (const [name, src] of [["test", WEBHOOK_TEST], ["live", WEBHOOK_LIVE]] as const) {
      expect(src, `${name} webhook started emitting its own operator notification`)
        .toContain("nothing is emitted here");
    }
  });
});

// @usecase A failed email must never undo a successful payment. If a sender throws
// inside the settlement path, Stripe has the money and our ledger does not.
describe("a failed notification never rolls back a settled payment", () => {
  it("dispatches the operator email fire-and-forget, so a dead function cannot block the insert", () => {
    // pg_net's http_post is asynchronous by construction: it queues the request and
    // returns an id, so the trigger cannot fail on a non-2xx. The migration's own
    // header calls this out.
    expect(EMAIL_DISPATCH).toContain("fire-and-forget");
    expect(EMAIL_DISPATCH).toContain("PERFORM net.http_post");
  });

  it("reports success from aws-ses-email even when no message was sent", () => {
    /**
     * DEFECT. aws-ses-email returns a success shape on a path where nothing was
     * dispatched, so a caller cannot distinguish "sent" from "silently skipped".
     * Contrast _shared/resend-service.ts, which reports per-recipient outcomes.
     * Pinned rather than watchdogged because the correct shape is a design choice
     * (throw, or return a discriminated result) rather than a single value.
     */
    const SES = fnSrc("aws-ses-email");
    expect(SES).toMatch(/success:\s*true/);
    const RESEND = readFileSync(root("supabase/functions/_shared/resend-service.ts"), "utf8");
    expect(RESEND).toMatch(/failed|error/i);
  });
});
