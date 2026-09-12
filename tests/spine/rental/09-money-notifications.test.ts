/**
 * THE SPINE'S "MONEY MOVED BACKWARDS — WHO WAS TOLD?" STEP.
 *
 * 05-notifications.test.ts asks the forward question: the customer paid, does the
 * operator hear about it? This file asks the harder half — money goes OUT (a
 * cancellation refund, a scheduled refund, a partial refund, a deposit deduction)
 * and the question is whether the two humans who care are told the truth about it.
 *
 * ---------------------------------------------------------------------------
 * LAYERS, AND WHY
 *
 * L1 (source-of-record) is the bulk of this file. Every assertion here is about
 * WHICH PARTY IS TOLD WHAT, and that is decided by a wiring diagram spread over
 * four kinds of artefact that no runtime test can see all of at once:
 *
 *   edge function source  ->  what payload is built and who it is sent to
 *   migration SQL         ->  the payments trigger that raises the operator bell
 *   a portal React hook   ->  the ONE notification in this product that is sent
 *                             from a browser tab rather than from the server
 *   a repo-wide sweep     ->  whether a deployed notifier has any caller at all
 *
 * Calling the live functions could not answer any of that: a refund notifier that
 * is never invoked returns 200 when you invoke it by hand. The bug IS the absence
 * of the call, which only source can show. Production ref hviqoaokxvlancmftwuo is
 * never contacted.
 *
 * L3 (executable, hand-typed literals) appears twice, where the defect is an
 * arithmetic/rendering fact rather than a wiring fact: the currency a refund
 * receipt quotes when no tenant is passed, and what a template literal prints for
 * a field the caller omitted.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY NOT COVERED HERE
 *
 *   - whether a refund is the RIGHT AMOUNT, or lands in the right ledger
 *     category. That is tests/integrations/stripe/refund-ledger.test.ts and
 *     tests/integrations/stripe/refund-edge-cases.test.ts, which already own the
 *     money maths on every one of these functions. This file assumes the amount
 *     is whatever those files say it is and asks only who gets told.
 *   - the forward payment-received chain (05-notifications.test.ts).
 *   - SES's simulated-success branch, pinned already at 05-notifications.test.ts
 *     ("reports success from aws-ses-email even when no message was sent"). The
 *     SMS twin of that branch is NOT covered anywhere, so it is covered here.
 *   - template rendering content, reminder crons, chat.
 *
 * ---------------------------------------------------------------------------
 * TWO NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
 *
 * 1. THE OPERATOR BELL FOR A REFUND IS NOT EMITTED BY THE REFUNDING FUNCTION.
 *    It comes from a DB trigger on public.payments (notify_refund_processed,
 *    20260719130000_suppress_void_refund_notification.sql). That trigger has TWO
 *    independent suppressions — a first-transition-only guard and a permanent
 *    dedupe on the PAYMENT id — and the operator EMAIL is a second trigger that
 *    fires on the notifications INSERT
 *    (20260718050300_add_operator_email_dispatch_trigger.sql:64). So "no bell"
 *    mechanically means "no operator email" too. Reading only an edge function
 *    will make you draw the wrong conclusion in both directions.
 *
 * 2. `sendEmail` HAS FIVE PARAMETERS AND THE LAST TWO DECIDE THE SENDER.
 *    resend-service.ts:405-418 forwards (supabaseClient, tenantId) into a branch
 *    at :328-336 that rewrites From to `{slug}@drive-247.com` / the tenant's
 *    company name. A three-argument call is not a shorthand — it silently sends
 *    the white-label email as "Drive 247". Arity is therefore load-bearing and is
 *    asserted as such below.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { formatCurrency } from "@fn/_shared/format-utils.ts";

const root = (p: string) => resolve(__dirname, "../../../", p);
const repo = (p: string) => readFileSync(root(p), "utf8");
const fnSrc = (n: string) => repo(`supabase/functions/${n}/index.ts`);
const migration = (n: string) => repo(`supabase/migrations/${n}`);

/** Collapse runs of whitespace so an assertion survives reformatting. */
const flat = (s: string) => s.replace(/\s+/g, " ");

/**
 * Same, but first strips the `//` that begins each line of a block comment — so a
 * prose sentence can be asserted whole regardless of where the author wrapped it.
 */
const flatComment = (s: string) => flat(s.replace(/^\s*\/\/\s?/gm, ""));

/**
 * The text between `from` (inclusive) and the first occurrence of `to` after it
 * (inclusive). Used instead of raw line slices so these tests do not go red the
 * next time somebody inserts a comment forty lines higher up.
 */
const between = (src: string, from: string, to: string): string => {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`marker not found in source: ${from}`);
  const end = src.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`end marker not found after ${from}: ${to}`);
  return src.slice(start, end + to.length);
};

const CANCEL_REFUND = fnSrc("cancel-rental-refund");
const NOTIFY_CANCELLED = fnSrc("notify-booking-cancelled");
const CANCEL_HOOK = repo("apps/portal/src/hooks/use-cancel-rental.ts");
const SUPPRESS_VOID = migration("20260719130000_suppress_void_refund_notification.sql");
const EMAIL_DISPATCH = migration("20260718050300_add_operator_email_dispatch_trigger.sql");
const WEBHOOK_TEST = fnSrc("stripe-webhook-test");
const WEBHOOK_LIVE = fnSrc("stripe-webhook-live");
const NOTIFY_INAPP = repo("supabase/functions/_shared/notify-inapp.ts");
const PROCESS_REFUND = fnSrc("process-refund");
const SCHEDULED_REFUND = fnSrc("process-scheduled-refund");
const NOTIFY_REFUND = fnSrc("notify-refund-processed");
const DEDUCT_DEPOSIT = fnSrc("deduct-from-deposit");
const RESEND = repo("supabase/functions/_shared/resend-service.ts");
const SNS_SMS = fnSrc("aws-sns-sms");
const AWS_CONFIG = repo("supabase/functions/_shared/aws-config.ts");
const PREAUTH_EXPIRING = fnSrc("notify-preauth-expiring");
const INSTALLMENT_FAILED = fnSrc("send-installment-failed");
const INSTALLMENT_RECEIPT = fnSrc("send-installment-receipt");
const INSTALLMENT_SQL = migration("20260201110000_add_installment_automation.sql");
const OPERATOR_EMAIL = fnSrc("notify-operator-email");

// ===========================================================================
// @usecase A cancellation refund throws at Stripe, the ledger correctly records that no money moved — and the customer is still emailed and SMS'd "a full refund of $X has been initiated". They wait ten business days for money that was never sent, and the operator's bell says it was handled.
describe("a cancellation refund that failed at Stripe — the ledger knows, the notification does not", () => {
  /**
   * The author of cancel-rental-refund found this exact bug and wrote the
   * diagnosis into the source at :477-:486. They then fixed the LEDGER half and
   * left the NOTIFICATION half untouched forty lines below.
   */
  const paymentUpdateBlock = between(
    CANCEL_REFUND,
    "const refundActuallyHappened = !!stripeRefundId;",
    "if (refundActuallyHappened) {",
  );
  const notificationLiteral = between(CANCEL_REFUND, "const notificationData = {", "\n    };");

  it("decides the payment's refunded status from stripeRefundId, the one proof money actually moved", () => {
    // cancel-rental-refund/index.ts:485 derives it; :169 declares it null and
    // :202 assigns it only on the line after a successful stripe.refunds.create.
    expect(CANCEL_REFUND).toContain("const refundActuallyHappened = !!stripeRefundId;");
    expect(CANCEL_REFUND).toContain("let stripeRefundId = null;");
    expect(CANCEL_REFUND).toContain("stripeRefundId = refund.id;");
    // :495 / :501 / :506 — every status branch is gated on it.
    expect(flat(paymentUpdateBlock)).toContain('if (refundType === "full" && refundActuallyHappened) {');
    expect(flat(paymentUpdateBlock)).toContain('if (refundType === "partial" && refundActuallyHappened) {');
    expect(flat(paymentUpdateBlock)).toContain('if (refundType !== "none" && !refundActuallyHappened) {');
  });

  it("builds the customer notification from the request parameters instead, with no reference to whether money moved", () => {
    // PINNING. cancel-rental-refund/index.ts:628-640. The literal names neither
    // refundActuallyHappened nor stripeRefundId — the two values the block
    // immediately above it uses to decide the same question.
    expect(notificationLiteral).not.toContain("refundActuallyHappened");
    expect(notificationLiteral).not.toContain("stripeRefundId");
    // :637-:638 — both fields are echoes of the REQUEST.
    expect(flat(notificationLiteral)).toContain("refundType: refundType,");
    expect(flat(notificationLiteral)).toContain(
      'refundAmount: refundType === "partial" ? refundAmount : (refundType === "full" ? payment?.amount : 0),',
    );
  });

  it("renders all three cancellation messages — customer email, customer SMS and operator bell — off data.refundType alone", () => {
    // PINNING. notify-booking-cancelled/index.ts:29-37 (email), :239-247 (SMS),
    // :256-265 (bell). None of them can tell a real refund from a failed one,
    // because the only signal they receive is the request parameter.
    const email = between(NOTIFY_CANCELLED, "const refundMessage = data.refundType", "`;");
    const sms = between(NOTIFY_CANCELLED, "const refundText = data.refundType", '        : "";');
    const bell = between(NOTIFY_CANCELLED, "const refundNote = data.refundType", '        : "";');

    expect(flat(email)).toContain("A <strong>full refund</strong> of");
    expect(flat(email)).toContain("has been initiated.");
    expect(flat(sms)).toContain("Full refund of ${formatCurrency(data.refundAmount || 0, currencyCode)} initiated.");
    expect(flat(bell)).toContain("Full refund of ${formatCurrency(data.refundAmount || 0, currencyCode)} initiated.");

    // The request interface (:22-:23) offers nothing else to key off.
    const iface = between(NOTIFY_CANCELLED, "reason: string;", "}");
    expect(iface).toContain('refundType: "full" | "partial" | "none";');
    expect(iface).not.toContain("stripeRefundId");
  });

  it("promises the money in 5-10 business days, which is the window the customer will wait before calling", () => {
    // notify-booking-cancelled/index.ts:32 — this is why a false positive here
    // costs a week and a half before anyone notices.
    expect(flat(NOTIFY_CANCELLED)).toContain(
      "Please allow 5-10 business days for the refund to appear on your statement.",
    );
  });

  // Remove the .fails marker once supabase/functions/cancel-rental-refund/index.ts:628-640
  // is fixed to carry the outcome of the Stripe call into the notification payload.
  it.fails("should tell the customer a refund was initiated only when a refund actually happened", () => {
    expect(
      notificationLiteral.includes("refundActuallyHappened") ||
        notificationLiteral.includes("stripeRefundId"),
    ).toBe(true);
  });
});

// ===========================================================================
// @usecase The refund is already at Stripe when cancel-rental-refund returns. The email and SMS that tell the customer are then sent by the operator's BROWSER. Close the tab, lose the network, and the money moved with nobody told and no server-side record that a notification was owed.
describe("the cancellation notification that only a browser tab can send", () => {
  it("sends nothing itself: cancel-rental-refund invokes no function anywhere in its source", () => {
    // PINNING. Verified count is zero across the whole file.
    const invokes = CANCEL_REFUND.match(/functions\.invoke/g) ?? [];
    expect(invokes.length).toBe(0);
  });

  it("returns the notification payload in the HTTP response instead of acting on it", () => {
    // cancel-rental-refund/index.ts:659 — notificationData is handed back to the
    // caller as a to-do item.
    expect(flat(CANCEL_REFUND)).toContain("notificationData: notificationData,");
  });

  it("leaves the send to the portal hook, in a try/catch that deliberately swallows the failure", () => {
    // PINNING. apps/portal/src/hooks/use-cancel-rental.ts:62-72.
    expect(flat(CANCEL_HOOK)).toContain(
      'if (data.notificationData && data.notificationData.customerEmail) {',
    );
    expect(flat(CANCEL_HOOK)).toContain('await supabase.functions.invoke("notify-booking-cancelled", {');
    expect(flat(CANCEL_HOOK)).toContain("// Don't fail the whole operation if notification fails");
  });

  it("gates the whole send on customerEmail, so a customer with only a phone number gets no SMS either", () => {
    // Same line. notify-booking-cancelled would have sent the SMS (:245-:250),
    // but the hook never calls it when the email field is empty.
    expect(flat(CANCEL_HOOK)).toContain("data.notificationData.customerEmail");
    expect(flat(NOTIFY_CANCELLED)).toContain("results.customerSMS = await sendSMS(");
  });

  // Remove the .fails marker once supabase/functions/cancel-rental-refund/index.ts:628-659
  // sends the cancellation notification server-side instead of returning it.
  it.fails("should send the cancellation notification from the server, where the refund was issued", () => {
    expect(CANCEL_REFUND).toContain("functions.invoke");
  });
});

// ===========================================================================
// @usecase A second partial refund — or any refund issued from the Stripe Dashboard — produces zero operator bells and, because the operator email fires off the bell's INSERT, zero operator emails. Money leaves the account and nothing on either side of the screen says so.
describe("repeat partial refunds on the webhook path — the bell that fires exactly once, forever", () => {
  it("fires the payments trigger only on the FIRST transition into a refunded state", () => {
    // PINNING. 20260719130000_suppress_void_refund_notification.sql:24-31.
    const guard = between(SUPPRESS_VOID, "-- Fire only on the FIRST transition", "RETURN NEW;\n  END IF;");
    expect(flat(guard)).toContain(
      "AND COALESCE(OLD.status,'') NOT IN ('Refunded','Partial Refund','Reversed')",
    );
  });

  it("then dedupes on the PAYMENT id with no time window, so it can never fire for that payment again", () => {
    // PINNING. Same migration :51-:57. dedupe_key is NEW.id — the payments row —
    // not the refund. Two partial refunds on one payment share a dedupe key.
    const dedupe = between(SUPPRESS_VOID, "IF EXISTS (", "RETURN NEW;\n  END IF;");
    expect(flat(dedupe)).toContain("type = 'refund_processed'");
    expect(flat(dedupe)).toContain("metadata->>'dedupe_key' = NEW.id::text");
    expect(dedupe).not.toContain("created_at");
    // And the row it eventually writes stamps that same key, :73.
    expect(flat(SUPPRESS_VOID)).toContain("'dedupe_key', NEW.id::text");
  });

  it("keys the webhook's own refund bell on the same payment id, in both test and live", () => {
    // PINNING. stripe-webhook-test/index.ts:1936, stripe-webhook-live:1995 —
    // inside the charge.refunded handler (type 'refund_processed' at :1926/:1985).
    for (const [name, src] of [["test", WEBHOOK_TEST], ["live", WEBHOOK_LIVE]] as const) {
      const block = between(src, 'type: "refund_processed",', "});");
      expect(flat(block), name).toContain("dedupeKey: payment.id,");
      expect(flat(block), name).toContain("stripe_charge_id: charge.id,");
    }
  });

  it("short-circuits on any existing broadcast row carrying that key, with no age bound", () => {
    // PINNING. _shared/notify-inapp.ts:75-98. The lookup is tenant + type +
    // user_id IS NULL + metadata contains dedupe_key. Nothing about time.
    const dedupe = between(NOTIFY_INAPP, "if (dedupeKey) {", "}\n    }");
    expect(flat(dedupe)).toContain('.eq("type", type)');
    expect(flat(dedupe)).toContain('.is("user_id", null)');
    expect(flat(dedupe)).toContain('.contains("metadata", { dedupe_key: dedupeKey })');
    expect(dedupe).not.toContain("created_at");
  });

  it("reaches the customer from neither webhook: neither one mentions notify-refund-processed at all", () => {
    // PINNING. So on the webhook path the renter is told nothing by anyone.
    expect((WEBHOOK_TEST.match(/notify-refund-processed/g) ?? []).length).toBe(0);
    expect((WEBHOOK_LIVE.match(/notify-refund-processed/g) ?? []).length).toBe(0);
  });

  it("takes the operator EMAIL down with the bell, because that email fires on the notification INSERT", () => {
    // 20260718050300_add_operator_email_dispatch_trigger.sql:32-39 lists
    // refund_processed as emailable, and :64 hangs the whole dispatch off
    // AFTER INSERT ON public.notifications. No bell row, no email.
    expect(flat(EMAIL_DISPATCH)).toContain("'payment_received','payment_failed','refund_processed',");
    expect(flat(EMAIL_DISPATCH)).toContain("AFTER INSERT ON public.notifications");
  });

  it("was compensated for on the process-refund path only, which says the problem out loud", () => {
    // process-refund/index.ts:444-450 — the diagnosis is in the codebase already.
    expect(flatComment(PROCESS_REFUND)).toContain(
      "On every later partial refund the status is already 'Partial Refund', the trigger's guard blocks it, and its payment_id dedupe blocks it forever after",
    );
    // and it compensates by invoking the notifier itself (:883).
    expect(PROCESS_REFUND).toContain('await supabase.functions.invoke("notify-refund-processed", {');
    // which dedupes on the REFUND, not the payment (notify-refund-processed:356).
    expect(flat(NOTIFY_REFUND)).toContain("dedupeKey: data.stripeRefundId || undefined,");
  });

  // Remove the .fails marker once supabase/functions/stripe-webhook-test/index.ts:1936
  // and supabase/functions/stripe-webhook-live/index.ts:1995 dedupe on the refund.
  it.fails("should dedupe the webhook's refund bell per refund, so a second partial refund is announced too", () => {
    expect(WEBHOOK_TEST).not.toContain("dedupeKey: payment.id");
    expect(WEBHOOK_LIVE).not.toContain("dedupeKey: payment.id");
  });

  // Remove the .fails marker once the charge.refunded handlers in
  // stripe-webhook-test/index.ts and stripe-webhook-live/index.ts notify the customer.
  it.fails("should tell the customer about a refund that arrives as a webhook, the way process-refund does", () => {
    expect(WEBHOOK_TEST).toContain("notify-refund-processed");
    expect(WEBHOOK_LIVE).toContain("notify-refund-processed");
  });
});

// ===========================================================================
// @usecase process-scheduled-refund has two paths that both return money. The nightly batch emails the customer; the immediate path returns success and tells nobody. The renter's card is credited with no message on either channel.
describe("process-scheduled-refund — the immediate branch that notifies nobody", () => {
  /** From the Stripe call (:166) to the success response (:240). */
  const immediate = between(
    SCHEDULED_REFUND,
    "const stripeRefund = await stripe.refunds.create(refundParams, stripeOptions);",
    "message: 'Refund processed successfully',",
  );

  it("refunds at Stripe and writes the refunded payment status on the immediate branch", () => {
    // :166 -> :172-:177.
    expect(flat(immediate)).toContain("refund_status: 'completed',");
    expect(flat(immediate)).toContain("status: refundAmount >= payment.amount ? 'Refunded' : 'Partial Refund',");
  });

  it("touches no notifier between the Stripe call and the success response", () => {
    // PINNING. Not one invoke, not one notify-*, in the whole immediate branch.
    expect(immediate).not.toContain("functions.invoke");
    expect(immediate).not.toMatch(/notify-[a-z-]+/);
    expect(immediate).not.toContain("notifyOperatorsInApp");
  });

  it("is the only branch that stays silent: the nightly batch beside it does email the customer", () => {
    // :399 — the asymmetry is the finding. Two paths through one file, one of
    // which tells the customer and one of which does not.
    expect(SCHEDULED_REFUND).toContain("await supabase.functions.invoke('notify-refund-processed', {");
    expect((SCHEDULED_REFUND.match(/functions\.invoke/g) ?? []).length).toBe(1);
  });

  it("also loses the operator bell whenever the payment was already partially refunded", () => {
    // Because the bell it relies on is the payments trigger, and that trigger's
    // first-transition guard (20260719130000:24-31) sees OLD.status already in
    // ('Refunded','Partial Refund','Reversed') and returns early.
    expect(flat(immediate)).toContain("status: refundAmount >= payment.amount ? 'Refunded' : 'Partial Refund',");
    expect(flat(SUPPRESS_VOID)).toContain(
      "AND COALESCE(OLD.status,'') NOT IN ('Refunded','Partial Refund','Reversed')",
    );
  });

  // Remove the .fails marker once supabase/functions/process-scheduled-refund/index.ts:166-249
  // notifies the customer on the immediate branch the way its own batch branch does.
  it.fails("should tell the customer about an immediate refund, the same as a scheduled one", () => {
    expect(immediate).toContain("notify-refund-processed");
  });
});

// ===========================================================================
// @usecase The nightly refund batch emails the renter a receipt that says "Booking Reference: undefined" and "Partial Refund" on a full refund — and quotes a GBP or AED refund in dollars, because four fields are missing from a four-line payload.
describe("process-scheduled-refund — the four-key payload behind a wrong refund receipt", () => {
  const batchInvoke = between(
    SCHEDULED_REFUND,
    "await supabase.functions.invoke('notify-refund-processed', {",
    "}\n        })",
  );

  it("sends exactly customerEmail, customerName, refundAmount and reason", () => {
    // PINNING. process-scheduled-refund/index.ts:399-405.
    expect(flat(batchInvoke)).toContain("customerEmail: refund.customer_email,");
    expect(flat(batchInvoke)).toContain("customerName: refund.customer_name,");
    expect(flat(batchInvoke)).toContain("refundAmount: refund.refund_amount,");
    expect(flat(batchInvoke)).toContain("reason: refund.refund_reason");
    for (const missing of ["tenantId", "bookingRef", "refundType", "rentalId"]) {
      expect(batchInvoke, `unexpectedly present: ${missing}`).not.toContain(missing);
    }
  });

  it("names the reason field 'reason' while the receiving interface declares refundReason", () => {
    // PINNING. notify-refund-processed/index.ts:18 declares `refundReason?`.
    // The key sent is `reason`, so the reason never renders.
    expect(batchInvoke).toContain("reason: refund.refund_reason");
    expect(NOTIFY_REFUND).toContain("refundReason?: string;");
    expect(NOTIFY_REFUND).not.toContain("data.reason");
  });

  it("interpolates the absent bookingRef straight into the email body", () => {
    // PINNING. notify-refund-processed/index.ts:99 — no guard, no fallback.
    expect(NOTIFY_REFUND).toContain("${data.bookingRef}</td>");
    // L3: what a template literal prints for the field that was never sent.
    // There is no arithmetic here, only JS semantics — asserted, not assumed.
    const bookingRef = undefined as string | undefined;
    expect(`${bookingRef}`).toBe("undefined");
  });

  it("prints 'Partial Refund' for a full refund, because the ternary has no third arm", () => {
    // PINNING. notify-refund-processed/index.ts:103.
    expect(NOTIFY_REFUND).toContain('${data.refundType === "full" ? "Full Refund" : "Partial Refund"}');
    // L3: the same expression, executed against the value this caller supplies.
    const cell = (refundType?: string) => (refundType === "full" ? "Full Refund" : "Partial Refund");
    expect(cell(undefined)).toBe("Partial Refund");
    expect(cell("full")).toBe("Full Refund");
  });

  it("skips the tenant template branch entirely and falls back to the hardcoded Drive 247 body", () => {
    // PINNING. notify-refund-processed/index.ts:222 builds the fallback and :226
    // gates the renderEmail/resolveEmailData block on data.tenantId.
    expect(flat(NOTIFY_REFUND)).toContain("let customerHtml = getEmailHtml(data, currencyCode);");
    expect(flat(NOTIFY_REFUND)).toContain(
      "// Build customer email using template service if tenantId is provided",
    );
    expect(flat(NOTIFY_REFUND)).toContain("if (data.tenantId) { try { const templateData = await resolveEmailData(");
  });

  it("quotes a GBP tenant's £120.00 refund to the customer as $120.00, because currency needs the tenantId", () => {
    // PINNING, L3 executed with hand-typed literals.
    // notify-refund-processed/index.ts:205-213: `let currencyCode = 'USD'` and the
    // tenants lookup that could change it is inside `if (data.tenantId)`. The
    // batch caller sends no tenantId, so USD is what formatCurrency receives.
    expect(flat(NOTIFY_REFUND)).toContain("let currencyCode = 'USD'; if (data.tenantId) {");
    expect(flat(NOTIFY_REFUND)).toContain(".select('currency_code')");

    const REFUND = 120.0; // the amount the batch row carries
    expect(formatCurrency(REFUND, "USD")).toBe("$120.00");   // what is sent
    expect(formatCurrency(REFUND, "GBP")).toBe("£120.00");   // what moved
    expect(formatCurrency(REFUND, "USD")).not.toBe(formatCurrency(REFUND, "GBP"));
  });

  // Remove the .fails marker once supabase/functions/process-scheduled-refund/index.ts:399-405
  // sends tenantId, bookingRef, refundType and refundReason.
  it.fails("should hand the refund notifier the tenant, booking and refund type it declares", () => {
    for (const required of ["tenantId", "bookingRef", "refundType", "refundReason"]) {
      expect(batchInvoke, `missing: ${required}`).toContain(required);
    }
  });
});

// ===========================================================================
// @usecase Money is taken out of a renter's security deposit — the single most disputed movement in the product — and 829 lines later nobody has been told. No email saying what was taken or what is still held, and after the first deduction no operator bell either.
describe("deduct-from-deposit — a deposit deduction told to nobody", () => {
  it("contains no notifier reference of any kind: no notify, no email, no sms, no invoke", () => {
    // PINNING. Case-insensitive over the whole file. Verified count is zero.
    const hits = DEDUCT_DEPOSIT.split("\n").filter((l) => /notif|email|sms|invoke/i.test(l));
    expect(hits).toEqual([]);
    // and it really is the whole function, not a stub.
    expect(DEDUCT_DEPOSIT.split("\n").length).toBeGreaterThan(800);
  });

  it("imports Stripe, cors, the refund seam and a currency formatter, and no sender", () => {
    // PINNING. deduct-from-deposit/index.ts:15-26.
    expect(DEDUCT_DEPOSIT).toContain('import { formatCurrency } from "../_shared/format-utils.ts";');
    expect(DEDUCT_DEPOSIT).toContain('import { tryProviderRefund } from "../_shared/payments/refund.ts";');
    expect(DEDUCT_DEPOSIT).not.toContain("resend-service");
    expect(DEDUCT_DEPOSIT).not.toContain("notify-inapp");
    expect(DEDUCT_DEPOSIT).not.toContain("twilio");
  });

  it("nonetheless writes a refunded payment status, so the only possible bell is the payments trigger", () => {
    // deduct-from-deposit/index.ts:708.
    expect(flat(DEDUCT_DEPOSIT)).toContain(
      'status: newTotalRefund >= payment.amount ? "Refunded" : "Partial Refund",',
    );
  });

  it("loses even that bell on a second deduction, which is exactly when the deposit is contested", () => {
    // The first deduction moves the payment to 'Partial Refund'. The trigger's
    // guard (20260719130000:24-31) then refuses every later transition, and the
    // payment-id dedupe (:51-57) refuses it permanently.
    expect(flat(SUPPRESS_VOID)).toContain(
      "AND COALESCE(OLD.status,'') NOT IN ('Refunded','Partial Refund','Reversed')",
    );
    expect(flat(SUPPRESS_VOID)).toContain("metadata->>'dedupe_key' = NEW.id::text");
  });

  it("is the gap notify-refund-processed was extended to close everywhere else", () => {
    // notify-refund-processed carries the deposit-specific copy — how much was
    // kept, how much is still held — that this path never reaches.
    expect(NOTIFY_REFUND).toContain("remainingHeld");
    expect(NOTIFY_REFUND).toContain("category?: string;");
  });

  // Remove the .fails marker once supabase/functions/deduct-from-deposit/index.ts
  // tells the renter (and the operator) what was taken from the deposit.
  it.fails("should tell the renter what was deducted from their deposit and what is still held", () => {
    expect(/notify-refund-processed|functions\.invoke|notifyOperatorsInApp/.test(DEDUCT_DEPOSIT)).toBe(true);
  });
});

// ===========================================================================
// @usecase On a white-label platform the renter has never heard of "Drive 247". The refund email is the one money email that arrives from that unrecognised sender, with the platform — not the operator who can answer — as reply-to. It is the email most likely to be reported as phishing and deleted.
describe("notify-refund-processed — the refund email that is not from the tenant", () => {
  it("calls sendEmail with three arguments, omitting the client and tenant id that set the sender", () => {
    // PINNING. notify-refund-processed/index.ts:305-309.
    const call = between(NOTIFY_REFUND, "results.customerEmail = await sendEmail(", ");");
    expect(flat(call)).toBe(
      "results.customerEmail = await sendEmail( resolvedEmail, customerSubject, customerHtml );",
    );
  });

  it("is a real omission, not a shorthand: parameters four and five are what rewrite the From header", () => {
    // _shared/resend-service.ts:405-418 forwards them; :324-336 is the branch.
    const sig = between(RESEND, "export async function sendEmail(", "): Promise<EmailResult> {");
    expect(flat(sig)).toContain("supabaseClient?: any, tenantId?: string");
    const branch = between(RESEND, "let fromEmail = options.from", "const toAddresses");
    expect(flat(branch)).toContain("let fromEmail = options.from || 'noreply@drive-247.com';");
    expect(flat(branch)).toContain("let fromName = options.fromName || 'Drive 247';");
    expect(flat(branch)).toContain("if (options.tenantId && supabaseClient) {");
    expect(flat(branch)).toContain("fromEmail = `${tenantSettings.slug}@drive-247.com`;");
    expect(flat(branch)).toContain("fromName = tenantSettings.company_name;");
  });

  it("is the odd one out — every sibling money notifier passes all five", () => {
    // send-installment-receipt:208-214, send-installment-failed:246-252,
    // notify-preauth-expiring:177-183, notify-lockbox-code:536-542,
    // notify-operator-email:106.
    for (const [name, src] of [
      ["send-installment-receipt", INSTALLMENT_RECEIPT],
      ["send-installment-failed", INSTALLMENT_FAILED],
      ["notify-preauth-expiring", PREAUTH_EXPIRING],
      ["notify-lockbox-code", fnSrc("notify-lockbox-code")],
    ] as const) {
      expect(flat(src), name).toMatch(/await sendEmail\([^)]*supabase,\s*data\.tenantId\s*\)/);
    }
    expect(flat(OPERATOR_EMAIL)).toContain(
      'await sendEmail(recipient, n.title ?? "Notification", html, supabase, n.tenant_id)',
    );
  });

  it("hardcodes DRIVE 247 into the subject line as well, so even the subject is unbranded", () => {
    // notify-refund-processed/index.ts:221.
    expect(flat(NOTIFY_REFUND)).toContain(
      "let customerSubject = `Refund Processed - ${formatCurrency(data.refundAmount, currencyCode)} | DRIVE 247`;",
    );
  });

  // Remove the .fails marker once supabase/functions/notify-refund-processed/index.ts:305-309
  // passes the supabase client and tenant id to sendEmail.
  it.fails("should send the refund email from the tenant, the way every other money notifier does", () => {
    const call = between(NOTIFY_REFUND, "results.customerEmail = await sendEmail(", ");");
    expect(flat(call)).toMatch(/supabase,\s*data\.tenantId/);
  });
});

// ===========================================================================
// @usecase process-refund fires this notifier and logs only a thrown error. A success:true that hides a Resend rejection — or no customer email at all — is indistinguishable from a delivered refund receipt, so a refund the renter never heard about looks fully handled.
describe("notify-refund-processed — success reported for an email that never left", () => {
  it("returns success:true on every non-throwing path", () => {
    // PINNING. notify-refund-processed/index.ts:362.
    expect(flat(NOTIFY_REFUND)).toContain("return new Response( JSON.stringify({ success: true, results }),");
  });

  it("warns and carries on to that same return when no email address could be resolved", () => {
    // PINNING. :304-:313.
    const block = between(NOTIFY_REFUND, "// Send customer email", "// Send customer SMS");
    expect(flat(block)).toContain("if (resolvedEmail) {");
    expect(flat(block)).toContain("console.warn('No customer email available, skipping email send');");
    expect(block).not.toContain("throw");
    expect(block).not.toContain("success: false");
  });

  it("stores the EmailResult and never inspects its success flag", () => {
    // PINNING. :305 assigns into results.customerEmail; nothing reads .success.
    expect(NOTIFY_REFUND).toContain("results.customerEmail = await sendEmail(");
    expect(NOTIFY_REFUND).not.toContain("results.customerEmail.success");
    expect(NOTIFY_REFUND).not.toContain("emailResult.success");
  });

  it("is receiving a real failure object in that case, not an exception", () => {
    // _shared/resend-service.ts:305-313 — a missing key returns, it does not throw.
    expect(flat(RESEND)).toContain(
      "error: 'Email service is not configured (RESEND_API_KEY missing) — no email was delivered',",
    );
    expect(flat(RESEND)).toContain("return { success: false,");
  });

  it("disagrees with its own sibling, which throws on exactly that flag", () => {
    // send-installment-receipt/index.ts:216-219.
    expect(flat(INSTALLMENT_RECEIPT)).toContain(
      "if (!emailResult.success) { console.error('Failed to send receipt email:', emailResult.error); throw new Error(emailResult.error); }",
    );
  });

  it("is invoked fire-and-forget by process-refund, which only logs a thrown error", () => {
    // process-refund/index.ts:883-902 — the catch is the only inspection there is.
    const call = between(PROCESS_REFUND, 'await supabase.functions.invoke("notify-refund-processed", {', "}");
    expect(call).toContain("notify-refund-processed");
    expect(flat(PROCESS_REFUND)).toContain(
      "catch (notifyErr) { console.error(\"[process-refund] notification failed (non-fatal):\", notifyErr); }",
    );
  });

  // Remove the .fails marker once supabase/functions/notify-refund-processed/index.ts:303-313,362
  // reports a failed or skipped send as something other than success.
  it.fails("should not report success when no refund email was sent", () => {
    const block = between(NOTIFY_REFUND, "// Send customer email", "// Send customer SMS");
    expect(/\.success|throw|success:\s*false/.test(block)).toBe(true);
  });
});

// ===========================================================================
// @usecase An AWS credential rotation makes every SNS text report success:true and deliver nothing — verification links and lead replies silently stop. The email service was given a guard for precisely this failure mode; the SMS service never was.
describe("aws-sns-sms — simulated success with none of the guard the email service got", () => {
  it("returns success:true and simulated:true whenever AWS credentials are absent", () => {
    // PINNING. aws-sns-sms/index.ts:27-35.
    const branch = between(SNS_SMS, "if (!isAWSConfigured()) {", "  }");
    expect(flat(branch)).toContain("console.log('AWS not configured, simulating SMS send');");
    expect(flat(branch)).toContain("success: true, simulated: true,");
  });

  it("is keyed purely on the presence of two env vars, with no idea where it is running", () => {
    // _shared/aws-config.ts:177-179.
    expect(flat(AWS_CONFIG)).toContain(
      "export function isAWSConfigured(): boolean { return !!(AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey); }",
    );
  });

  it("carries no local-dev discrimination at all, unlike the email service beside it", () => {
    // PINNING. The three tokens resend-service uses to tell dev from production
    // (:302-:306) appear nowhere in the SMS path.
    for (const token of ["localhost", "127.0.0.1", "SIMULATION_ALLOWED", "SUPABASE_URL"]) {
      expect(SNS_SMS, `unexpected in aws-sns-sms: ${token}`).not.toContain(token);
    }
    expect(flat(RESEND)).toContain(
      "const isLocalDev = supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1') || Deno.env.get('EMAIL_SIMULATION_ALLOWED') === 'true';",
    );
  });

  it("carries the reasoning for that guard in the email service's own comment", () => {
    // _shared/resend-service.ts:292-296 — written about this exact failure shape.
    expect(flatComment(RESEND)).toContain(
      "A missing key means NOTHING WAS DELIVERED. Reporting success for that is how a total outage stays invisible",
    );
  });

  it("is reached by five real callers, so the blast radius is verification links and lead messaging", () => {
    // Verified by repo sweep. Not the lockbox code — notify-lockbox-code routes
    // SMS through Twilio (sendTenantSMS), not through this function.
    for (const caller of [
      "supabase/functions/cmd-create-verification/index.ts",
      "supabase/functions/submit-application/index.ts",
      "supabase/functions/cmd-resend-link/index.ts",
      "supabase/functions/send-lead-message/index.ts",
      "apps/portal/src/lib/services/sms-service.ts",
    ]) {
      expect(repo(caller), caller).toContain("aws-sns-sms");
    }
    expect(fnSrc("notify-lockbox-code")).toContain("sendTenantSMS");
    expect(fnSrc("notify-lockbox-code")).not.toContain("aws-sns-sms");
  });

  // Remove the .fails marker once supabase/functions/aws-sns-sms/index.ts:26-35
  // refuses to report success for an undelivered SMS outside local development.
  it.fails("should report an unconfigured SMS service as a failure, the way the email service does", () => {
    expect(/localhost|SIMULATION_ALLOWED/.test(SNS_SMS)).toBe(true);
  });
});

// ===========================================================================
// @usecase A pre-authorisation hold reaches expiry with nobody told, which means an unsecured rental. And the day somebody wires this function up, every tenant's customer name, booking reference and deposit amount is texted to one shared platform phone number.
describe("notify-preauth-expiring — an orphan carrying a platform-wide phone number", () => {
  it("is invoked by no edge function in the repository", () => {
    // PINNING. Sweep of every supabase/functions/<name>/index.ts plus _shared.
    // (Scope is stated deliberately: index.ts files and _shared, not sub-modules.)
    const fnDir = root("supabase/functions");
    const callers: string[] = [];
    for (const name of readdirSync(fnDir)) {
      const idx = resolve(fnDir, name, "index.ts");
      if (!existsSync(idx)) continue;
      if (readFileSync(idx, "utf8").includes("notify-preauth-expiring")) callers.push(name);
    }
    const sharedDir = resolve(fnDir, "_shared");
    for (const f of readdirSync(sharedDir)) {
      if (!f.endsWith(".ts")) continue;
      if (readFileSync(resolve(sharedDir, f), "utf8").includes("notify-preauth-expiring")) {
        callers.push(`_shared/${f}`);
      }
    }
    expect(callers).toEqual([]);

    // Control: the same sweep finds the function that IS invoked, so a sweep
    // that silently matched nothing cannot pass this test.
    const controls: string[] = [];
    for (const name of readdirSync(fnDir)) {
      const idx = resolve(fnDir, name, "index.ts");
      if (!existsSync(idx)) continue;
      if (readFileSync(idx, "utf8").includes("notify-refund-processed")) controls.push(name);
    }
    expect(controls).toContain("process-refund");
    expect(controls).toContain("process-scheduled-refund");
  });

  it("is excluded from the operator-email dispatcher too, on the grounds that it sends its own", () => {
    // notify-operator-email/index.ts:25 and
    // 20260718050300_add_operator_email_dispatch_trigger.sql:28-31 both name it —
    // as a type that keeps its own in-function email. Which never fires.
    expect(OPERATOR_EMAIL).toContain("preauth_expiring");
    expect(flat(EMAIL_DISPATCH)).toContain(
      "-- (return_overdue, pickup_reminder, preauth_expiring, rental_reminder,",
    );
    expect(flat(EMAIL_DISPATCH)).not.toContain("'preauth_expiring'");
  });

  it("texts a single platform-wide ADMIN_PHONE env var, not a per-tenant number", () => {
    // PINNING. notify-preauth-expiring/index.ts:213-221.
    const block = between(PREAUTH_EXPIRING, "const adminPhone = Deno.env.get('ADMIN_PHONE');", "\n    }");
    expect(flat(block)).toContain("if (adminPhone) { results.adminSMS = await sendSMS( adminPhone,");
  });

  it("puts the tenant's customer name, booking reference and deposit amount in that message", () => {
    // Same block. tenantId is used only to pick the Twilio credentials, never to
    // resolve the destination.
    expect(flat(PREAUTH_EXPIRING)).toContain(
      "`${branding.companyName}: Pre-auth for ${data.bookingRef} expires in ${data.hoursRemaining}h. Amount: ${formatCurrency(data.amount, currencyCode)}. Action required.`",
    );
    const block = between(PREAUTH_EXPIRING, "const adminPhone = Deno.env.get('ADMIN_PHONE');", "\n    }");
    expect(flat(block)).toContain("supabase, data.tenantId");
    expect(block).not.toContain("getTenantNotificationRecipient");
  });

  it("does resolve a per-tenant recipient two blocks above, for the email — so the SMS half is the outlier", () => {
    // notify-preauth-expiring/index.ts:174-183.
    expect(flat(PREAUTH_EXPIRING)).toContain(
      "const operatorEmail = await getTenantNotificationRecipient(supabase, data.tenantId);",
    );
  });

  // Remove the .fails marker once supabase/functions/notify-preauth-expiring/index.ts:213-222
  // resolves the SMS destination per tenant instead of from one shared env var.
  it.fails("should send the pre-auth SMS to the tenant's own number, not one platform-wide ADMIN_PHONE", () => {
    expect(PREAUTH_EXPIRING).not.toContain("Deno.env.get('ADMIN_PHONE')");
  });
});

// ===========================================================================
// @usecase A failed installment charge is the moment the renter must act to keep the car. The installment_notifications row is the only durable record that they were warned, it is written whether or not the warning was delivered, and mark_overdue_installments then escalates off that possibly fictional trail.
describe("send-installment-failed — a warning recorded whether or not it was sent", () => {
  it("stores the customer EmailResult and never reads its success flag", () => {
    // PINNING. send-installment-failed/index.ts:246-253.
    const call = between(INSTALLMENT_FAILED, "results.customerEmail = await sendEmail(", ");");
    expect(flat(call)).toContain("data.customerEmail, subject, emailHtml, supabase, data.tenantId");
    expect(INSTALLMENT_FAILED).not.toContain("results.customerEmail.success");
    expect(INSTALLMENT_FAILED).not.toContain("emailResult.success");
  });

  it("records the notification unconditionally, outside any delivery check", () => {
    // PINNING. :277-:283 — a bare try/catch around the RPC, no guard on the send.
    const block = between(INSTALLMENT_FAILED, "// Record notification", "}");
    expect(flat(block)).toContain("await supabase.rpc('record_installment_notification', {");
    expect(flat(block)).toContain("p_notification_type: 'payment_failed',");
    expect(block).not.toContain("success");
  });

  it("writes that record as an upsert, so a re-run restamps sent_at with no delivery evidence", () => {
    // PINNING. 20260201110000_add_installment_automation.sql:48-69.
    const rpc = between(
      INSTALLMENT_SQL,
      "CREATE OR REPLACE FUNCTION public.record_installment_notification(",
      "END;",
    );
    expect(flat(rpc)).toContain("INSERT INTO installment_notifications (");
    expect(flat(rpc)).toContain(
      "ON CONFLICT (installment_id, notification_type) DO UPDATE SET sent_at = EXCLUDED.sent_at;",
    );
    // Nothing in the signature can express "it failed".
    expect(rpc).not.toContain("p_success");
    expect(rpc).not.toContain("p_error");
  });

  it("then returns success:true whatever the send returned", () => {
    // PINNING. :288-:291.
    expect(flat(INSTALLMENT_FAILED)).toContain(
      "return new Response( JSON.stringify({ success: true, results }),",
    );
  });

  it("is the half of the installment flow that does not check, while its receipt sibling throws", () => {
    // send-installment-receipt/index.ts:216-219 — same family, opposite policy.
    expect(flat(INSTALLMENT_RECEIPT)).toContain("if (!emailResult.success) {");
    expect(flat(INSTALLMENT_RECEIPT)).toContain("throw new Error(emailResult.error);");
  });

  it("feeds an escalation that assumes the warning trail is real", () => {
    // 20260201110000_add_installment_automation.sql:73-100 — three failures and
    // three days past due flips the installment to 'overdue'.
    const overdue = between(
      INSTALLMENT_SQL,
      "CREATE OR REPLACE FUNCTION public.mark_overdue_installments()",
      "END;",
    );
    expect(flat(overdue)).toContain("SET status = 'overdue',");
    expect(flat(overdue)).toContain("AND failure_count >= 3");
  });

  // Remove the .fails marker once supabase/functions/send-installment-failed/index.ts:246-283
  // records the notification only when the email actually left.
  it.fails("should record an installment warning only when it was delivered", () => {
    const block = between(INSTALLMENT_FAILED, "// Record notification", "}");
    expect(/success/.test(block)).toBe(true);
  });
});

// ===========================================================================
// @usecase This is the single funnel for EVERY operator email in the product — payment_received, payment_failed, refund_processed, fine_new and eight more types route through it. It reports sent:true whatever the email service returned, so the day anyone adds delivery logging or a retry sweep on top of this response, every undelivered operator email is marked delivered.
describe("notify-operator-email — sent:true regardless of what the send returned", () => {
  it("is careful about every reason to skip, and careless about the only reason to fail", () => {
    // PINNING. notify-operator-email/index.ts:79, :82, :86 — three explicit
    // skips; then :108 reports sent:true unconditionally.
    expect(OPERATOR_EMAIL).toContain('return json({ skipped: true, reason: "type not emailable" });');
    expect(OPERATOR_EMAIL).toContain('return json({ skipped: true, reason: "category disabled" });');
    expect(OPERATOR_EMAIL).toContain('return json({ skipped: true, reason: "no recipient" });');
    expect(OPERATOR_EMAIL).toContain("return json({ sent: true, recipient, category, result });");
  });

  it("never inspects the result it is reporting on", () => {
    // PINNING. :106-:108 — `result` is captured and echoed, never tested.
    const tail = between(OPERATOR_EMAIL, "const result = await sendEmail(", "});");
    expect(tail).not.toContain("result.success");
    expect(tail).not.toContain("if (!result");
    expect(tail).not.toContain("throw");
  });

  it("is reporting on a call that can return success:false without throwing", () => {
    // _shared/resend-service.ts:305-313 (no API key) and :393-400 (request
    // failed) both RETURN a failure object. Neither reaches the outer catch.
    expect(flat(RESEND)).toContain("return { success: false, error: 'Email service is not configured");
    expect(flat(RESEND)).toContain(
      "catch (error) { console.error('Resend API request failed'); return { success: false, error: error.message, }; }",
    );
  });

  it("does at least echo the full result object, which is why this is survivable today", () => {
    // The mitigation, stated so a future reader does not over-read the defect:
    // the lie is in the top-level flag, not in the payload. A consumer COULD
    // read result.success. The trigger that calls this reads nothing at all.
    expect(OPERATOR_EMAIL).toContain("sent: true, recipient, category, result");
    expect(flat(EMAIL_DISPATCH)).toContain("PERFORM net.http_post(");
  });

  it("is the funnel for a dozen notification types, including all three money ones", () => {
    // 20260718050300_add_operator_email_dispatch_trigger.sql:32-39.
    for (const type of ["payment_received", "payment_failed", "refund_processed", "fine_new"]) {
      expect(EMAIL_DISPATCH, type).toContain(`'${type}'`);
    }
  });

  // Remove the .fails marker once supabase/functions/notify-operator-email/index.ts:106-108
  // reports the outcome of the send rather than the fact that it was attempted.
  it.fails("should report sent:true only when the operator email was actually accepted", () => {
    const tail = between(OPERATOR_EMAIL, "const result = await sendEmail(", "});");
    expect(/result\.success|result\?\.success/.test(tail)).toBe(true);
  });
});
