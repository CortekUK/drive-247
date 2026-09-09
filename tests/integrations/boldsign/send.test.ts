// =============================================================================
// integrations/boldsign — SEND.  "AGREEMENT JA RAHA HAI KI NAHI JA RAHA"
//
// THE AMBIGUITY, AND HOW THIS FILE RESOLVES IT
// --------------------------------------------
// "Is the agreement going out?" is two different questions in this codebase,
// and they have different answers:
//
//   LEG A — the BoldSign DOCUMENT was created.  POST /v1/document/send returned
//           a documentId, the agreement row exists, the rental now points at it.
//
//   LEG B — the CUSTOMER WAS ACTUALLY TOLD.  An email left our system carrying
//           a link they can sign at.
//
// In this repo those two cannot be inferred from one another, because
// `DisableEmails` is set to `'true'` on EVERY send. BoldSign is explicitly
// instructed never to email the signer. Our own `send-signing-email` edge
// function is the ONLY delivery channel there is, and the portal route says so
// in its own words:
//
//     "DisableEmails is set to 'true' on the BoldSign request above, so
//      BoldSign never emails the customer. This request is the ONLY delivery
//      channel — if it fails, the customer receives nothing at all."
//
// So a test that asserts only leg A and calls it "the agreement went out" would
// pass while every customer of a tenant receives nothing. Both legs are
// asserted below, separately, and each failure message says which leg it is.
//
// THREE SEND PATHS, not one. All three are covered here:
//   1. apps/portal/src/app/api/esign/route.ts   the operator's send/resend
//   2. apps/booking/src/app/api/esign/route.ts  the customer's checkout
//   3. supabase/functions/create-boldsign-document  the automation step
//      (`automation-execute-step` → generate_doc), and the one that fails leg B.
//
// LAYERS: Layer 1 is source-derived, offline, always runs. Layer 2 is opt-in
// and inherits the production refusal from tests/helpers/live-call.ts; the one
// case that creates a real document also needs the send rung, because a send
// spends e-sign credits from a wallet an operator paid for.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunction, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import {
  annotatedBodyShape,
  boldsignSandboxGate,
  boldsignSendRequested,
  describeClientDrift,
  interfaceMembers,
  payloadKeysAfterAnchor,
  payloadKeysAtCallSite,
  positionsOf,
  readRepoSource,
  resolveSendFixture,
} from "./boldsign-source";

const PORTAL_ROUTE = "apps/portal/src/app/api/esign/route.ts";
const BOOKING_ROUTE = "apps/booking/src/app/api/esign/route.ts";

const portalSrc = () => blankComments(readRepoSource(PORTAL_ROUTE));
const bookingSrc = () => blankComments(readRepoSource(BOOKING_ROUTE));
const automationSendSrc = () => blankComments(readEdgeFunctionSource("create-boldsign-document"));

// ===========================================================================
// LEG A — the document
// ===========================================================================

/**
 * Every caller of `/api/esign`, and which request type it is answered by.
 *
 * Listed one row per call site rather than looped inside a single test, so a
 * failure names the file that drifted instead of the first one that happened to
 * be checked. Nine portal screens, one booking screen and one edge function all
 * build this payload by hand — that is exactly the shape of thing that rots
 * silently, because eight of them keep working while the ninth stops.
 */
const ESIGN_CALLERS: {
  label: string;
  file: string;
  occurrence: number;
  routeFile: string;
  typeName: string;
}[] = [
  { label: "agreements page — Resend", file: "apps/portal/src/app/(dashboard)/agreements/page.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "AgreementTimeline — Resend", file: "apps/portal/src/components/rentals/AgreementTimeline.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "AgreementTimeline — Send (missing agreement)", file: "apps/portal/src/components/rentals/AgreementTimeline.tsx", occurrence: 2, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "rental detail v2 — Send/Send again", file: "apps/portal/src/components/rentals-v2/rental-detail/stage-agreement.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "generate-agreement dialog", file: "apps/portal/src/components/agreements/generate-agreement-dialog.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "AdminExtendRentalDialog", file: "apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "ExtensionRequestDialog", file: "apps/portal/src/components/rentals/ExtensionRequestDialog.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "rental-create v2", file: "apps/portal/src/components/rentals-v2/rental-create-v2.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "rentals/new", file: "apps/portal/src/app/(dashboard)/rentals/new/page.tsx", occurrence: 1, routeFile: PORTAL_ROUTE, typeName: "ESignRequest" },
  { label: "booking checkout", file: "apps/booking/src/components/BookingCheckoutStep.tsx", occurrence: 1, routeFile: BOOKING_ROUTE, typeName: "EnvelopeRequest" },
];

describe("boldsign/send — LEG A: the BoldSign document is created", () => {
  it.each(ESIGN_CALLERS)("$label sends a payload the route declares", ({ label, file, occurrence, routeFile, typeName }) => {
    const sent = payloadKeysAtCallSite(readRepoSource(file), "/api/esign", { occurrence, label });
    const declared = interfaceMembers(readRepoSource(routeFile), typeName);

    const known = new Set(declared.map((m) => m.name));
    const required = declared.filter((m) => !m.optional).map((m) => m.name);

    const extra = sent.filter((k) => !known.has(k)).sort();
    const missing = required.filter((k) => !sent.includes(k)).sort();

    if (extra.length || missing.length) {
      throw new Error(
        describeClientDrift({
          caseName: `boldsign/send — ${label}`,
          clientLabel: label,
          clientFile: file,
          serverLabel: `${typeName} in ${routeFile}`,
          serverFile: routeFile,
          extra,
          missing,
        }),
      );
    }

    // The parse must have found something on both sides. A zero on either makes
    // the diff above pass against nothing at all.
    expect(sent.length, `${label} parsed to zero payload keys`).toBeGreaterThan(0);
    expect(declared.length, `${typeName} parsed to zero members`).toBeGreaterThan(0);
  });

  it("the server-to-server caller (retry-credit-failed-agreements) sends the same payload", () => {
    // This one has no operator watching it: a credit top-up fires it, and a
    // cron sweep fires it hourly. If its payload drifts, agreements silently
    // stop being regenerated after a top-up and nobody sees a red screen.
    const label = "retry-credit-failed-agreements";
    const sent = payloadKeysAfterAnchor(
      readEdgeFunctionSource("retry-credit-failed-agreements"),
      "/api/esign`",
      label,
    );
    const declared = interfaceMembers(readRepoSource(PORTAL_ROUTE), "ESignRequest");
    const known = new Set(declared.map((m) => m.name));
    const required = declared.filter((m) => !m.optional).map((m) => m.name);

    const extra = sent.filter((k) => !known.has(k)).sort();
    const missing = required.filter((k) => !sent.includes(k)).sort();
    if (extra.length || missing.length) {
      throw new Error(
        describeClientDrift({
          caseName: "boldsign/send — retry-credit-failed-agreements",
          clientLabel: label,
          clientFile: "supabase/functions/retry-credit-failed-agreements/index.ts",
          serverLabel: `ESignRequest in ${PORTAL_ROUTE}`,
          serverFile: PORTAL_ROUTE,
          extra,
          missing,
        }),
      );
    }
    expect(sent).toContain("rentalId");
  });

  it("both routes still POST the document to BoldSign with the mode's key", () => {
    for (const [name, src] of [["portal", portalSrc()], ["booking", bookingSrc()]] as const) {
      expect(
        src,
        `${name} /api/esign no longer calls BoldSign's /v1/document/send. Nothing is ` +
          `being created at all — this is the whole of leg A.`,
      ).toContain("/v1/document/send");
      expect(
        src,
        `${name} /api/esign no longer authenticates to BoldSign with X-API-KEY. Every ` +
          `send would be rejected as anonymous.`,
      ).toContain("'X-API-KEY': BOLDSIGN_API_KEY");
    }
  });

  it("the document carries a signer and a signature field, or nobody can sign it", () => {
    // A document sent with no Signers[0] or no signature TextTagDefinition is
    // created successfully and is unsignable — leg A passes, the customer is
    // stuck, and the failure surfaces days later as "the link does nothing".
    for (const [name, src] of [
      ["portal", portalSrc()],
      ["booking", bookingSrc()],
      ["automation", automationSendSrc()],
    ] as const) {
      expect(src, `${name}: Signers[0][EmailAddress] is gone`).toContain("Signers[0][EmailAddress]");
      expect(src, `${name}: UseTextTags is gone — BoldSign would place no fields`).toContain("UseTextTags");
      expect(src, `${name}: the sig1 signature field definition is gone`).toContain("'sig1'");
      expect(src, `${name}: the Signature field type is gone`).toContain("'Signature'");
    }
  });

  it("credits are deducted BEFORE the send, and refunded when the send fails", () => {
    // Order, not existence. `deduct_credits` below the send would let a
    // BoldSign 429 (their documented 50/hour limit) bill nothing; `add_credits`
    // above the failure branch would refund on every send, including good ones.
    for (const [name, src] of [
      ["portal", portalSrc()],
      ["booking", bookingSrc()],
      ["automation", automationSendSrc()],
    ] as const) {
      const at = positionsOf(src, {
        deduct: "deduct_credits",
        send: name === "automation" ? "await sendBoldSignDocument(" : "/v1/document/send",
        refund: "add_credits",
      });
      expect(at.deduct, `${name}: the e-sign credit deduction is gone — sends became free`).toBeGreaterThan(-1);
      expect(at.send, `${name}: the BoldSign send call is gone`).toBeGreaterThan(-1);
      expect(at.refund, `${name}: the credit refund on send failure is gone`).toBeGreaterThan(-1);

      expect(
        at.deduct < at.send,
        `${name}: deduct_credits now runs AFTER the BoldSign send.\n` +
          `  deduct@${at.deduct} send@${at.send}\n` +
          `  A tenant with an empty wallet would get a real document sent for free, and\n` +
          `  the blocking credit check the code claims to do is no longer blocking.`,
      ).toBe(true);
      expect(
        at.refund > at.send,
        `${name}: add_credits now runs BEFORE the send it is supposed to refund.\n` +
          `  send@${at.send} refund@${at.refund}\n` +
          `  Every send would be refunded, including the successful ones.`,
      ).toBe(true);
    }
  });

  it("a failed send is recorded on the rental, not swallowed", () => {
    // The route's own history: "every failure path except insufficient-credits
    // wrote nothing at all ... an operator reporting 'I couldn't get the
    // agreement to send' could not be answered even with database access."
    const src = portalSrc();
    expect(src, "recordSendFailure() is gone from the portal send route").toContain("recordSendFailure(");
    expect(src, "the 'send_failed' status the operator sees is gone").toContain("send_failed");
    expect(src, "the insufficient-credits parking status is gone").toContain("credit_failed");
    // Also on the way out of an unexpected throw — the case that used to vanish.
    const tail = src.slice(src.lastIndexOf("} catch (error: any) {"));
    expect(
      tail,
      "The outer catch of the portal send route no longer records the failure. An " +
        "unexpected throw leaves the rental at 'pending' with no trace of an attempt.",
    ).toContain("recordSendFailure(");
  });

  it("a successful send writes the document id and the mode it was created under", () => {
    // The webhook downloads the signed PDF later using the mode recorded here.
    // If the id or the mode is not written, the agreement exists at BoldSign
    // and this platform cannot find it again.
    const src = portalSrc();
    expect(src, "rentals.docusign_envelope_id is no longer written on send").toContain("docusign_envelope_id: documentId");
    expect(src, "rentals.boldsign_mode is no longer stamped on send").toContain("boldsign_mode: boldsignMode");
    expect(src, "the rental_agreements row is no longer created on send").toContain("agreement_type: agreementType");
  });

  it("additional drivers get their own signer slot, indexed 1-based against a 0-based array", () => {
    // Pure index arithmetic, and the only arithmetic in this integration. The
    // Signers[] array is 0-based while BoldSign's SignerIndex is 1-based, so
    // driver at array position i must become SignerIndex i+2 (the customer is
    // 1) and be anchored to the {{@sig(i+2)}} tag. Getting this off by one puts
    // the second driver's signature box on the first driver's line.
    const src = automationSendSrc();
    expect(src, "additional signers no longer get a Signers[] slot").toContain("`Signers[${idx}][EmailAddress]`");
    expect(src, "the 1-based SignerIndex offset for additional drivers is gone").toContain("const signerIndex = i + 2;");
    expect(src, "the {{@sigN}} tag number no longer matches the signer index").toContain("const tagNum = i + 2;");
    expect(src, "the primary signer is no longer SignerIndex 1").toContain("[SignerIndex]`, '1'");
  });
});

// ===========================================================================
// LEG B — our own email. The half that a documentId proves nothing about.
// ===========================================================================

describe("boldsign/send — LEG B: the customer is actually emailed", () => {
  it("BoldSign is told never to email the signer, on every send path", () => {
    // This single flag is what makes leg A and leg B independent. If it ever
    // flips to false, BoldSign starts emailing as well and the customer gets
    // two links — one of them unbranded and outside our delivery record.
    for (const [name, src] of [
      ["portal", portalSrc()],
      ["booking", bookingSrc()],
      ["automation", automationSendSrc()],
    ] as const) {
      expect(
        src,
        `${name}: DisableEmails is no longer set to 'true'.\n` +
          `  Every assertion in this file about "our email is the only channel" stops\n` +
          `  being true, and the customer now receives BoldSign's own mail as well.`,
      ).toContain("'DisableEmails', 'true'");
    }
  });

  it("so send-signing-email is the only channel — and both web routes call it", () => {
    for (const [name, src] of [["portal", portalSrc()], ["booking", bookingSrc()]] as const) {
      expect(
        src,
        `${name} /api/esign no longer invokes send-signing-email.\n` +
          `  LEG B IS BROKEN: BoldSign is under DisableEmails and nothing else sends\n` +
          `  mail, so the customer is never told the agreement exists. Leg A would still\n` +
          `  pass — the document is created — which is precisely why these are two tests.`,
      ).toContain("functions/v1/send-signing-email");
    }
  });

  it("what the routes send matches what send-signing-email declares", () => {
    const shape = annotatedBodyShape("send-signing-email");
    expect(shape.typeName).toBe("SigningEmailRequest");

    for (const [name, file] of [["portal", PORTAL_ROUTE], ["booking", BOOKING_ROUTE]] as const) {
      const sent = payloadKeysAtCallSite(
        readRepoSource(file),
        "${supabaseUrl}/functions/v1/send-signing-email",
        { label: `${name} → send-signing-email` },
      );
      const known = new Set(shape.fields);
      const extra = sent.filter((k) => !known.has(k)).sort();
      const missing = shape.requiredByType.filter((k) => !sent.includes(k)).sort();
      if (extra.length || missing.length) {
        throw new Error(
          describeClientDrift({
            caseName: `boldsign/send LEG B — ${name} → send-signing-email`,
            clientLabel: `${name} /api/esign`,
            clientFile: file,
            serverLabel: "SigningEmailRequest",
            serverFile: shape.file,
            extra,
            missing,
          }),
        );
      }
    }
  });

  it("send-signing-email refuses to pretend: no recipient, no document, no tenant means 400", () => {
    const src = blankComments(readEdgeFunctionSource("send-signing-email"));
    expect(
      src,
      "send-signing-email no longer validates its three required fields. It would " +
        "then 'succeed' with an empty recipient and report a message id for mail " +
        "nobody was sent.",
    ).toContain("Missing required fields: customerEmail, documentId, tenantId");
    expect(
      src,
      "send-signing-email no longer reports a Resend failure as a failure — the " +
        "caller would record email_delivery_status='sent' for a mail that bounced " +
        "inside Resend.",
    ).toContain("Failed to send email");
  });

  it("emailSent is measured, never asserted — the regression that hid total delivery failure", () => {
    // From the route's own comment: "the previous code computed the real
    // outcome and then returned a hardcoded `true`, so a total delivery failure
    // was indistinguishable from success and the operator saw a green 'sent'
    // for an email nobody received."
    for (const [name, src] of [["portal", portalSrc()], ["booking", bookingSrc()]] as const) {
      expect(
        src,
        `${name}: emailSent is no longer derived from the send-signing-email response.`,
      ).toContain("emailSent = signingEmailResponse.ok");
      expect(
        src,
        `${name}: emailSent is hardcoded true again in the success response. That is the\n` +
          `  exact regression this line was written to close — a customer who received\n` +
          `  nothing is reported to the operator as emailed.`,
      ).not.toMatch(/emailSent:\s*true[,\s}]/);
    }
  });

  it("the portal records the delivery outcome, including the no-email-on-file case", () => {
    const src = portalSrc();
    for (const marker of ["email_delivery_status", "email_delivery_error", "email_delivered_at"]) {
      expect(
        src,
        `The portal send route no longer persists ${marker}. A failed delivery then ` +
          `exists only in a log line nobody reads.`,
      ).toContain(marker);
    }
    expect(
      src,
      "The 'customer has no email address' case no longer has its own status. It " +
        "would be reported as a delivery failure, which sends the operator hunting " +
        "for a bug in Resend instead of a missing field on the customer.",
    ).toContain("skipped_no_email");
  });

  it("leg A and leg B are reported separately to the caller", () => {
    // The whole point of this file, expressed as one assertion on the response
    // shape: a 200 carries BOTH the documentId and the email outcome, so no
    // caller can read "document created" as "customer told".
    const src = portalSrc();
    const finalReturn = src.slice(src.lastIndexOf("return NextResponse.json({ ok: true"));
    for (const key of ["envelopeId", "agreementId", "emailSent", "emailStatus", "emailError"]) {
      expect(
        finalReturn,
        `The portal send response no longer returns \`${key}\`.\n` +
          `  Leg A (envelopeId) and leg B (emailStatus) must both be visible in one\n` +
          `  answer. Collapsing them back into a bare ok:true is what let "the agreement\n` +
          `  was sent" mean two different things to two different people.`,
      ).toContain(key);
    }
  });

  // -------------------------------------------------------------------------
  // FINDING 1 — pinned, not blessed.
  //
  // The automation send path reports an email it never sends. This test passes
  // TODAY because that is what the code does; it is here so the defect is
  // executable and cannot quietly change shape. When it is fixed, THIS TEST
  // FAILS — and the correct response is to delete it, not to restore the bug.
  // -------------------------------------------------------------------------
  it("PINS FINDING 1: the automation send path returns emailSent:true and sends no email", () => {
    const src = automationSendSrc();

    expect(
      src.includes("'DisableEmails', 'true'"),
      "create-boldsign-document no longer disables BoldSign's own emails — which would " +
        "actually FIX finding 1 by giving the automation path a delivery channel again. " +
        "Re-read the finding before changing this test.",
    ).toBe(true);

    expect(
      src.includes("send-signing-email"),
      "create-boldsign-document now references send-signing-email. If it genuinely " +
        "sends our email, FINDING 1 IS FIXED: delete this test and move the automation " +
        "path into the leg B tests above with the other two send paths.",
    ).toBe(false);

    expect(
      src,
      "The hardcoded `emailSent: true` in create-boldsign-document has changed. If it " +
        "now reports a real outcome, finding 1 is fixed — delete this test.",
    ).toContain("emailSent: true");

    // And the automation caller believes it. This is the consequence, in code:
    // `automation-execute-step` logs the step as succeeded on any 2xx.
    expect(
      blankComments(readEdgeFunctionSource("automation-execute-step")),
      "automation-execute-step no longer proxies the agreement step to " +
        "create-boldsign-document. Finding 1 may no longer have a caller — re-check it.",
    ).toContain("create-boldsign-document");
  });

  // -------------------------------------------------------------------------
  // FINDING 2 — the automation step cannot work at all.
  //
  // `automation-execute-step` invokes create-boldsign-document with a LEAD
  // payload (leadId, vehicleId, startDate, ...). create-boldsign-document reads
  // `{ rentalId, customerEmail, customerName }` and hard-refuses with 400 when
  // `rentalId` is absent — which it always is on that call.
  //
  // Same treatment: pinned as the current truth, worded so that fixing it turns
  // this red.
  // -------------------------------------------------------------------------
  it("PINS FINDING 2: the automation caller sends a lead payload the function cannot read", () => {
    const shape = readEdgeFunction("create-boldsign-document");
    const sent = payloadKeysAfterAnchor(
      readEdgeFunctionSource("automation-execute-step"),
      '"create-boldsign-document"',
      "automation-execute-step",
    );

    expect(shape.fields.sort()).toEqual(["customerEmail", "customerName", "rentalId"]);
    expect(
      sent.includes("rentalId"),
      "automation-execute-step now sends `rentalId` to create-boldsign-document. That " +
        "is FINDING 2 FIXED — the generate_doc automation step can finally produce a " +
        "document. Delete this test and add the caller to the ESIGN_CALLERS table above.",
    ).toBe(false);
    expect(
      sent,
      "The automation payload changed shape. Re-derive finding 2 before editing this test.",
    ).toContain("leadId");

    expect(
      blankComments(readEdgeFunctionSource("create-boldsign-document")),
      "create-boldsign-document no longer refuses a body with no rentalId. If it now " +
        "accepts a lead, finding 2 may be fixed from the other side.",
    ).toContain("rentalId is required");
  });
});

// ===========================================================================
// LAYER 2 — live.
//
//   "live: create-boldsign-document refuses a body with no rentalId"
//       POSTs `{}` with the anon key. Answered by the required-field check on
//       the first line of the handler, above every database read and every
//       BoldSign call, so it creates nothing and spends nothing. Needs only
//       D247_LIVE_TESTS=1. This is this folder's equivalent of the spine's
//       signup-slug-check: the case that proves the harness reaches a real
//       deployed function.
//
//   "live: send-signing-email refuses a body with no recipient"
//       Same idea on leg B. Answered by the required-field check before Resend
//       is touched, so no mail is sent to anybody.
//
//   "live: a real agreement is created"
//       CREATES A REAL DOCUMENT and SPENDS REAL E-SIGN CREDITS from the
//       tenant's wallet. Needs the full ladder — D247_LIVE_TESTS=1 +
//       D247_LIVE_ALLOW_WRITES=1 + D247_LIVE_ALLOW_MONEY_MOVEMENT=1 +
//       D247_LIVE_BOLDSIGN_MODE=test — plus a named fixture rental. See the
//       README for why sending sits on the money rung.
// ===========================================================================
describe("boldsign/send — live (Layer 2)", () => {
  it("live: create-boldsign-document refuses a body with no rentalId", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no " +
          "apikey header before the function is ever invoked, so this probe would " +
          "measure the gateway rather than create-boldsign-document.",
      );
      return;
    }

    const res = await liveCall("create-boldsign-document", {}, { token: status.target.anonKey });

    expect(
      res.status,
      "Expected 400 from create-boldsign-document's rentalId check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 200 here would be far worse than a failure: it would mean the function " +
        "went on to create a document with no rental behind it.\n" +
        classifyLive(res).explain,
    ).toBe(400);

    expect(
      String(res.json?.error ?? res.text),
      "create-boldsign-document answered 400 but not with the rentalId guard. The " +
        "wording may have changed (failure mode (a)), or a different validation fires " +
        "first now.",
    ).toMatch(/rentalId is required/i);
  });

  it("live: send-signing-email refuses a body with no recipient", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — this would measure the gateway, not the function.");
      return;
    }

    // Deliberately incomplete: the guard answers before Resend is reached, so
    // this sends no mail to anyone.
    const res = await liveCall("send-signing-email", { companyName: "drive247 spine suite" }, {
      token: status.target.anonKey,
    });

    expect(
      res.status,
      "Expected 400 from send-signing-email's required-field check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/Missing required fields/i);
  });

  it.skipIf(!boldsignSendRequested())(
    "live: a real agreement is created for the fixture rental",
    async (ctx) => {
      const gate = boldsignSandboxGate();
      if (!gate.allowed) {
        ctx.skip(gate.reason);
        return;
      }
      const fixture = resolveSendFixture();

      const res = await liveCall("create-boldsign-document", { rentalId: fixture.rentalId });

      if (res.status === 402) {
        ctx.skip(
          `The fixture tenant has no e-sign credits left (402 insufficient_credits). ` +
            `That is a wallet state, not a code failure — top up or point ` +
            `D247_LIVE_BOLDSIGN_RENTAL_ID at a rental on a funded tenant.`,
        );
        return;
      }

      expect(
        res.status,
        `create-boldsign-document did not accept the fixture rental.\n` + classifyLive(res).explain,
      ).toBe(200);
      expect(res.json?.ok, "The function returned 200 without ok:true").toBe(true);

      // LEG A only, and the test says so. `documentId` is the whole of what a
      // 200 here proves; `emailSent` in this response is the hardcoded literal
      // finding 1 describes, so it is deliberately NOT asserted as evidence of
      // anything.
      expect(
        typeof res.json?.documentId === "string" && res.json.documentId.length > 0,
        "200 with no documentId. Leg A did not actually happen — the response says " +
          "success while nothing exists at BoldSign to sign.",
      ).toBe(true);

      if (res.json?.deduped === true) {
        // The dedup guard answered instead: this rental already had a live
        // agreement. Still a valid leg-A pass, and it spent no credits.
        expect(res.json?.emailSent).toBe(false);
      }
    },
  );
});
