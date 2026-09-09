// =============================================================================
// integrations/boldsign — RESEND.  "USKE BAAD KYA WOH RESEND HOTA HAI KI NAHI"
//
// THE ONE FACT THAT SHAPES EVERY TEST BELOW
// -----------------------------------------
// There is no resend endpoint, and there is no "update the existing envelope"
// call. A resend is the SAME `POST /api/esign` as a first send, and the portal
// says so where it implements the button:
//
//     "Send, or send again. One call for both — because they ARE the same call.
//      `/api/esign` always mints a fresh document from the rental as it stands
//      right now; there is no 'update the existing envelope' path in BoldSign
//      that this platform uses."
//
// That makes "does resend work" answerable in a way it would not otherwise be:
// resend is correct exactly when (1) it builds the same payload a send builds,
// (2) the route has no branch that treats it differently, and (3) the PRIOR
// document is revoked — because minting a second document without killing the
// first leaves two live signing links for one rental, and whichever the
// customer happens to click decides which agreement is legally signed.
//
// Point (3) is the one with teeth, and it has a subtle guard inside it: the
// revoke query must exclude the row it just inserted. Without that `neq`, a
// resend revokes its own brand-new document and the link in the email the
// customer is about to receive is dead on arrival.
//
// LAYER 1 is source-derived and offline. LAYER 2 is opt-in and needs a portal
// target of its own (these are Next route handlers, not edge functions), with
// its own production refusal — see boldsign-source.ts.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { payloadKeysAtCallSite, portalCall, portalTarget, positionsOf, readRepoSource } from "./boldsign-source";

const PORTAL_ROUTE = "apps/portal/src/app/api/esign/route.ts";
const AGREEMENTS_PAGE = "apps/portal/src/app/(dashboard)/agreements/page.tsx";
const TIMELINE = "apps/portal/src/components/rentals/AgreementTimeline.tsx";
const STAGE = "apps/portal/src/components/rentals-v2/rental-detail/stage-agreement.tsx";

const portalSrc = () => blankComments(readRepoSource(PORTAL_ROUTE));

describe("boldsign/resend — a resend is the same call as a send", () => {
  it("the Resend button and the Send button build the same payload", () => {
    // v1's timeline has both, in the same component, and they are the case that
    // proves the claim: if resend ever grew a field send does not have (or lost
    // one send has), the two would silently produce different agreements from
    // the same rental.
    const timeline = readRepoSource(TIMELINE);
    const resend = payloadKeysAtCallSite(timeline, "/api/esign", { occurrence: 1, label: "AgreementTimeline resend" });
    const send = payloadKeysAtCallSite(timeline, "/api/esign", { occurrence: 2, label: "AgreementTimeline send" });

    expect(
      resend,
      "AgreementTimeline's Resend and Send now build DIFFERENT payloads:\n" +
        `  resend: ${resend.join(", ")}\n` +
        `  send:   ${send.join(", ")}\n` +
        "  They are meant to be the same request. A divergence here means one of the\n" +
        "  two buttons produces an agreement the other cannot — failure mode (a), and\n" +
        "  the fix is to make them equal again rather than to widen this test.",
    ).toEqual(send);
  });

  it("the agreements-page Resend sends everything a rental-detail Send sends", () => {
    const resend = payloadKeysAtCallSite(readRepoSource(AGREEMENTS_PAGE), "/api/esign", {
      occurrence: 1,
      label: "agreements page Resend",
    });
    const send = payloadKeysAtCallSite(readRepoSource(STAGE), "/api/esign", {
      occurrence: 1,
      label: "rental detail Send",
    });

    for (const key of send) {
      expect(
        resend,
        `The agreements page's Resend no longer sends \`${key}\`, which the rental ` +
          `detail Send does. The same route reads both; a resend that omits a field a ` +
          `send includes produces a different document from the same rental.`,
      ).toContain(key);
    }
    // Both must carry the four the route declares required.
    for (const key of ["rentalId", "customerEmail", "customerName", "tenantId"]) {
      expect(resend, `Resend is missing the required field ${key}`).toContain(key);
    }
  });

  it("the route has no resend-only branch — there is nothing for a resend to get wrong", () => {
    const src = portalSrc();
    expect(
      /\bisResend\b|\bresend\s*[:=]|body\.resend/.test(src),
      "The portal send route grew a resend-specific branch. That is a real design " +
        "change, not a test failure: resend and send have been one code path on " +
        "purpose, and splitting them means every assertion in this folder that reads " +
        "'send' now covers only half the cases. Re-read this file before widening it.",
    ).toBe(false);
  });
});

describe("boldsign/resend — the prior document is killed so only one link is live", () => {
  it("prior non-terminal agreements are revoked at BoldSign", () => {
    const src = portalSrc();
    expect(
      src,
      "The portal send route no longer revokes prior agreements.\n" +
        "  A resend then leaves the OLD signing link live alongside the new one. Both\n" +
        "  are valid at BoldSign, the customer signs whichever is in the older email,\n" +
        "  and the signed document no longer matches the agreement this platform\n" +
        "  believes is current.",
    ).toContain("/v1/document/revoke");
    expect(src, "the superseded-agreement revoke message is gone").toContain("Superseded by a newer agreement");
    expect(
      src,
      "Revoked priors are no longer marked 'voided' in rental_agreements. The row " +
        "would stay 'sent' forever and the next resend would try to revoke it again.",
    ).toContain("document_status: 'voided'");
  });

  it("the revoke NEVER touches the document it has just created", () => {
    // The single most dangerous line in the resend path. `priorQuery` selects
    // every non-terminal agreement for this rental and type — which includes
    // the row inserted three lines earlier. Without the exclusion, a resend
    // revokes its own new document and emails the customer a dead link.
    const src = portalSrc();
    expect(
      src,
      "The `.neq('id', agreementId)` exclusion is gone from the prior-agreement " +
        "revoke query.\n" +
        "  A resend now revokes THE DOCUMENT IT JUST CREATED: the row is inserted with\n" +
        "  document_status='sent', the query selects 'sent' rows for this rental, and\n" +
        "  nothing excludes it. The customer receives an email whose link is already\n" +
        "  void. This is not a stale test — no field name is involved.",
    ).toContain("neq('id', agreementId)");

    const at = positionsOf(src, {
      insert: "document_status: 'sent',",
      exclusion: "neq('id', agreementId)",
      revoke: "/v1/document/revoke",
    });
    expect(at.insert, "the new agreement row insert is gone").toBeGreaterThan(-1);
    expect(
      at.exclusion < at.revoke,
      "The self-exclusion now sits BELOW the revoke call, so it cannot protect it.\n" +
        `  exclusion@${at.exclusion} revoke@${at.revoke}`,
    ).toBe(true);
  });

  it("only non-terminal agreements are revoked — a signed one is never touched", () => {
    const src = portalSrc();
    expect(
      src,
      "The revoke query no longer restricts itself to sent/delivered/pending.\n" +
        "  Revoking a SIGNED agreement destroys a completed, legally executed document\n" +
        "  at BoldSign — and this platform keeps the signed PDF by reference, so the\n" +
        "  copy it shows the operator can stop resolving too.",
    ).toContain("in('document_status', ['sent', 'delivered', 'pending'])");
  });

  it("each prior document is revoked with the key it was created under", () => {
    // A tenant that flipped test → live has old sandbox documents and new live
    // ones. Revoking a sandbox document with the live key is a 404 at BoldSign,
    // the old link stays live, and the warning is only a console line.
    const src = portalSrc();
    expect(
      src,
      "The revoke no longer reads the prior agreement's own boldsign_mode.\n" +
        "  It would use the CURRENT mode for a document created under the other one —\n" +
        "  the revoke 404s, the stale signing link survives the resend, and two live\n" +
        "  links exist for one rental.",
    ).toContain("(prior.boldsign_mode as 'test' | 'live') || boldsignMode");
    expect(src, "the prior document's key is no longer resolved per prior row").toContain("getBoldSignApiKey(priorMode)");
  });

  it("a failed revoke never fails the send it belongs to", () => {
    // Deliberate, and worth pinning: the new document already exists and the
    // credits are already spent by this point. Throwing here would report a
    // failure for a send that in fact happened, and the operator would send
    // again — a third document.
    const src = portalSrc();
    const block = src.slice(src.indexOf("let priorQuery"), src.indexOf("For original agreements"));
    expect(
      block,
      "The prior-agreement revocation is no longer wrapped in its own try/catch. A " +
        "BoldSign hiccup while revoking would now fail a send that already succeeded, " +
        "and the operator would resend on top of it.",
    ).toContain("catch");
  });
});

describe("boldsign/resend — resending does not lie, loop or duplicate", () => {
  it("every resend re-records its own delivery outcome", () => {
    // email_delivery_status is written keyed on the NEW agreement id, so a
    // resend that failed to email cannot inherit the previous attempt's green.
    const src = portalSrc();
    const at = positionsOf(src, {
      email: "functions/v1/send-signing-email",
      record: "email_delivery_status: emailStatus",
      byId: "eq('id', agreementId)",
    });
    expect(at.record, "the per-attempt delivery record is gone").toBeGreaterThan(-1);
    expect(
      at.email < at.record,
      "The delivery status is now written BEFORE the email is attempted, so it " +
        "records an intention rather than an outcome.",
    ).toBe(true);
  });

  it("a rate-limited send is retried rather than lost", () => {
    // BoldSign allows 50 sends an hour. An operator resending a few times in a
    // row is the normal way to hit that, so the retry is part of resend working
    // rather than an optimisation.
    const src = portalSrc();
    expect(src, "the BoldSign 429 retry is gone from the send path").toContain("=== 429");
    expect(src, "the retry no longer backs off between attempts").toMatch(/sendAttempt \* 15/);
  });

  it("the automation path refuses to create a second live document for one rental", () => {
    // Its dedup guard: an existing non-terminal document short-circuits with
    // `deduped: true` rather than minting another. Without it, a retried
    // automation run burns credits and leaves two live links — the same failure
    // the portal's revoke exists to prevent, avoided a different way.
    const src = blankComments(readEdgeFunctionSource("create-boldsign-document"));
    expect(src, "the duplicate-document guard is gone from create-boldsign-document").toContain("deduped: true");
    expect(
      src,
      "The dedup guard no longer treats declined/voided/expired as re-sendable. It " +
        "would refuse to re-issue an agreement after the customer declined one, which " +
        "leaves the rental permanently unable to produce a signable document.",
    ).toContain("['declined', 'voided', 'expired']");
  });

  it("the hourly credit-failed sweep cannot resend the same agreement forever", () => {
    // `retry-credit-failed-agreements` runs on cron with no operator watching.
    // Its idempotency check is the only thing between a top-up and a customer
    // being emailed a fresh agreement every hour.
    const src = blankComments(readEdgeFunctionSource("retry-credit-failed-agreements"));
    expect(
      src,
      "The 'already covered' idempotency check is gone from the credit-failed sweep.\n" +
        "  It runs hourly on cron: without it, every rental with a stale credit_failed\n" +
        "  row gets a NEW agreement and a NEW email every single hour, and each one\n" +
        "  spends credits.",
    ).toContain("already_covered");
    expect(
      src,
      "The sweep no longer pre-checks the wallet balance in live mode, so it would " +
        "manufacture a fresh credit_failed row on every pass.",
    ).toContain("insufficient_credits");
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// The send/resend route is a NEXT ROUTE HANDLER, not an edge function, so
// `liveCall()` cannot reach it: it speaks to <project>.supabase.co/functions/v1.
// It gets its own target, `D247_LIVE_PORTAL_URL`, with its own refusal — any
// host under drive-247.com is production and is refused outright, as is any URL
// mentioning the production Supabase ref.
//
// The one case here POSTs an EMPTY body. It is answered by the route's first
// validation, above the tenant read, above BoldSign and above deduct_credits,
// so it creates nothing, emails nobody and spends no credits. It exists to
// prove the route is deployed and still validating — the resend equivalent of
// the spine's signup-slug-check.
// ===========================================================================
describe("boldsign/resend — live (Layer 2)", () => {
  it("live: /api/esign refuses a resend with no rental and no customer", async (ctx) => {
    const target = portalTarget();
    if (!target.enabled) {
      ctx.skip(target.reason);
      return;
    }

    const res = await portalCall("/api/esign", {});

    expect(
      res.status,
      "Expected 400 from /api/esign's required-field check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 200 would be the serious outcome: it would mean the route went on past a\n" +
        "  body with no rentalId, no customerEmail and no customerName.\n" +
        "  A 404 means the route is not deployed at this target — check\n" +
        "  D247_LIVE_PORTAL_URL rather than the code.",
    ).toBe(400);

    expect(
      String(res.json?.error ?? res.text),
      "The route answered 400 but not with its own missing-fields message. Failure " +
        "mode (a) if someone reworded it; failure mode (b) if this is a framework or " +
        "proxy error rather than the route's.",
    ).toMatch(/Missing required fields/i);
  });
});
