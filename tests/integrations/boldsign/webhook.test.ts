// =============================================================================
// integrations/boldsign — THE WEBHOOK. The direction where BoldSign calls US.
//
// `boldsign-webhook` is the only part of this integration that is not initiated
// by us, and it is the part that decides what a rental's `document_status`
// says, when the signed PDF is stored, and whether the customer is told their
// agreement is signed. It runs with the SERVICE ROLE key, so it bypasses RLS
// entirely.
//
// It is also declared `verify_jwt = false` in supabase/config.toml, which means
// Supabase's gateway lets anyone through to it. A function in that position has
// to authenticate the caller ITSELF — the way `stripe-webhook-live` verifies a
// Stripe signature before it believes a word of the payload.
//
// THIS ONE DOES NOT VERIFY ANYTHING. That is FINDING 4, reported rather than
// tested-around: there is no signature check, no shared secret, no header
// inspection of any kind in the file. So the case the brief asks for — "a
// bad/unsigned payload is REJECTED" — cannot be written honestly today, and
// writing a green test that asserted the current behaviour would bless it.
//
// What is here instead:
//
//   - a WATCHDOG that skips with the finding while no verification exists, and
//     starts asserting the moment any appears (including that it runs before
//     the first write, because a check below the write is not a check);
//   - the CONTAINMENT that limits what a forged payload can currently do,
//     asserted properly, because right now it is the only thing there is;
//   - the status mapping and the two defects found while reading it.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import { positionsOf, readRepoSource } from "./boldsign-source";

const webhookSrc = () => blankComments(readEdgeFunctionSource("boldsign-webhook"));

/** Anything that would count as the caller being authenticated. */
const VERIFICATION_MARKERS = [
  "X-BoldSign-Signature",
  "x-boldsign-signature",
  "BOLDSIGN_WEBHOOK_SECRET",
  "crypto.subtle",
  "createHmac",
  "timingSafeEqual",
  "verifySignature",
  "constructEvent",
];

function verificationMarkersPresent(src: string): string[] {
  const lower = src.toLowerCase();
  return VERIFICATION_MARKERS.filter((m) => lower.includes(m.toLowerCase()));
}

describe("boldsign/webhook — who is allowed to call it", () => {
  it("is declared verify_jwt = false, so the gateway does not authenticate it", () => {
    const toml = readRepoSource("supabase/config.toml");
    const section = toml.slice(toml.indexOf("[functions.boldsign-webhook]"));
    expect(
      toml,
      "supabase/config.toml no longer has a [functions.boldsign-webhook] section. If " +
        "the function now requires a JWT, BoldSign cannot call it at all and every " +
        "agreement will sit at 'sent' forever — check what changed before editing " +
        "this test.",
    ).toContain("[functions.boldsign-webhook]");
    expect(
      section.slice(0, 200),
      "boldsign-webhook is no longer verify_jwt = false. That is either a genuine " +
        "fix (with a signature check to replace it — see the watchdog below) or an " +
        "accident that silently stops BoldSign from reaching us.",
    ).toContain("verify_jwt = false");
  });

  it("WATCHDOG: verifies the caller before it writes anything", (ctx) => {
    const src = webhookSrc();
    const found = verificationMarkersPresent(src);

    if (found.length === 0) {
      // Deliberately a SKIP with the finding in it, not a green assertion.
      //
      // There is nothing to test: the function reads the body and acts on it.
      // A passing test here would have to assert "an unsigned payload is
      // accepted", which is a defect written down as a requirement — the one
      // thing this suite must not do. The skip is loud, it is in the run
      // summary, and it turns into a real assertion by itself the moment
      // somebody adds a check.
      ctx.skip(
        "FINDING 4 — boldsign-webhook performs NO caller verification. verify_jwt is " +
          "false, so Supabase's gateway lets anyone through, and the function checks no " +
          "signature, no shared secret and no header before acting on the payload with " +
          "the service-role key. Anyone who learns a BoldSign documentId can flip that " +
          "agreement's document_status (to completed, declined or voided), cause a PDF " +
          "download and a customer_documents insert, and push a 'Rental Agreement " +
          "Signed' notification to the customer. Compare stripe-webhook-live, which " +
          "verifies its signature before believing anything. This test asserts nothing " +
          "until a check exists; it is a skip, not a pass, ON PURPOSE.",
      );
      return;
    }

    // A check exists — now it has to be in the right place.
    const at = positionsOf(src, {
      handler: "Deno.serve(",
      firstWrite: ".update(",
      firstInsert: ".insert(",
    });
    const verifyAt = Math.min(
      ...found.map((m) => {
        const i = src.toLowerCase().indexOf(m.toLowerCase());
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      }),
    );
    const firstMutation = Math.min(
      ...[at.firstWrite, at.firstInsert].filter((n) => n > -1).concat([Number.MAX_SAFE_INTEGER]),
    );

    expect(
      verifyAt < firstMutation,
      `boldsign-webhook now has a verification marker (${found.join(", ")}) but it sits ` +
        `BELOW the first write.\n` +
        `  verify@${verifyAt} firstWrite@${firstMutation}\n` +
        `  A signature checked after the row has been updated is a log line, not a guard.`,
    ).toBe(true);
  });

  it("CONTAINMENT: a payload it cannot tie to a real document does nothing at all", () => {
    // With no authentication, these three are the entire blast-radius limit on
    // a forged call, so they are asserted as if they were the security control
    // they have been left standing in for.
    const src = webhookSrc();

    expect(
      src,
      "The webhook no longer refuses a payload with no documentId. It would run on " +
        "into a lookup with `undefined` and, depending on how PostgREST answers, act " +
        "on whatever came back.",
    ).toContain("No document ID in payload");
    expect(src, "the invalid-JSON guard is gone").toContain("Invalid JSON payload");
    expect(
      src,
      "The webhook no longer stops when no rental matches the document id. That match " +
        "is the ONLY thing tying an anonymous payload to a real row.",
    ).toContain("Rental not found");

    // Positions are compared against the CALL, not the definition: the handler
    // sits at the bottom of the file and everything it calls is defined above
    // it, so raw source order says nothing about execution order.
    const at = positionsOf(src, {
      docIdGuard: "No document ID in payload",
      dispatch: "await handleBoldSignWebhook(",
      lookup: "eq('document_id', documentId)",
      firstUpdate: ".update(",
    });
    expect(at.dispatch, "the handler no longer dispatches to handleBoldSignWebhook").toBeGreaterThan(-1);
    expect(
      at.docIdGuard < at.dispatch,
      "The documentId guard now runs AFTER the payload is dispatched for processing.\n" +
        `  guard@${at.docIdGuard} dispatch@${at.dispatch}\n` +
        "  With no caller verification in front of it, that guard is the first thing a\n" +
        "  forged payload meets. Below the dispatch it meets nothing.",
    ).toBe(true);
    expect(
      at.lookup > -1 && at.lookup < at.firstUpdate,
      "The document lookup no longer precedes the first update. A forged payload could " +
        "reach a write without ever being matched to a document this platform issued.\n" +
        `  lookup@${at.lookup} update@${at.firstUpdate}`,
    ).toBe(true);
  });
});

describe("boldsign/webhook — what a completed signing actually does", () => {
  it("downloads and stores the signed PDF only when the document is complete", () => {
    const src = webhookSrc();
    const at = positionsOf(src, {
      completedCheck: "mappedStatus === 'completed'",
      download: "downloadAndStore(",
      bucket: "customer-documents",
    });
    expect(at.completedCheck, "the completed-only condition is gone").toBeGreaterThan(-1);
    expect(at.download, "the signed-PDF download is gone from the webhook").toBeGreaterThan(-1);
    expect(
      at.completedCheck < at.download,
      "The signed-PDF download is no longer gated on completion. Every intermediate " +
        "event (Sent, Viewed) would try to download an unsigned document and store it " +
        "as the signed agreement.",
    ).toBe(true);
    expect(src, "the signed PDF no longer lands in the customer-documents bucket").toContain("customer-documents");
    expect(
      src,
      "The webhook no longer records the signed PDF as a customer_documents row, so " +
        "the view path's 'stored' short-circuit has nothing to find and every view " +
        "goes back to BoldSign.",
    ).toContain("from('customer_documents')");
  });

  it("signing does NOT hand over the keys — the rental stays pending", () => {
    // Load-bearing, and documented in the function itself: "Activating on
    // signed-only caused PAYG rentals to start accruing daily charges before
    // the customer had the car — billing the customer for days they didn't
    // possess the vehicle."
    const src = webhookSrc();
    // Asserted on the rental update object by name, not on the string 'Active'
    // anywhere in the file: `customer_documents.status` is legitimately 'Active'
    // for the stored PDF, and a blanket search would collide with it.
    expect(
      /rentalUpdate\s*(?:\.|\[['"])status/.test(src),
      "The webhook now sets a rental `status` on signing. If that is 'Active', it bills " +
        "PAYG rentals for days the customer does not have the car — the rental must stay " +
        "pending until an operator marks the key handover.",
    ).toBe(false);
    expect(
      src,
      "The webhook now writes to the `vehicles` table. Signing must not take a vehicle " +
        "out of availability: nobody has collected it yet.",
    ).not.toContain("from('vehicles')");
  });

  it("both the agreement row and the rental row are kept in step", () => {
    const src = webhookSrc();
    expect(src, "the rental_agreements status update is gone").toContain("from('rental_agreements')");
    expect(src, "the rentals status update is gone").toContain("from('rentals')");
    expect(
      src,
      "The webhook no longer copies signed_document_id from the agreement onto the " +
        "rental. The agreements screen would show the signed PDF and the rental detail " +
        "screen would not.",
    ).toContain("rentalUpdate.signed_document_id");
    expect(
      src,
      "Extension agreements no longer stay out of the rental's own document_status. An " +
        "extension completing would overwrite the original agreement's status on the " +
        "rental row.",
    ).toContain("agreementType === 'original'");
  });

  it("the customer is told, once, when the agreement is signed", () => {
    const src = webhookSrc();
    expect(src, "the customer notification on signing is gone").toContain("Rental Agreement Signed");
    expect(
      src,
      "The signed notification is no longer restricted to signed/completed events — " +
        "the customer would be notified on Viewed, or on an unmapped event.",
    ).toContain("mappedStatus === 'signed' || mappedStatus === 'completed'");
  });

  it("every BoldSign event type this platform relies on is still mapped", () => {
    const src = webhookSrc();
    for (const [event, mapped] of [
      ["Sent", "sent"],
      ["Viewed", "delivered"],
      ["Signed", "signed"],
      ["Completed", "completed"],
      ["Declined", "declined"],
      ["Revoked", "voided"],
      ["Expired", "expired"],
      ["Reassigned", "sent"],
    ] as const) {
      expect(
        src,
        `The webhook no longer maps BoldSign's '${event}' event to '${mapped}'.\n` +
          `  Unmapped events fall through to 'pending', and /api/esign/status treats\n` +
          `  ${["completed", "signed", "declined", "voided", "expired"].join("/")} as terminal —\n` +
          `  so a dropped mapping does not just lose information, it un-finishes a\n` +
          `  finished agreement.`,
      ).toContain(`'${event}': '${mapped}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// The two defects found while reading this function. Both are PINNED: the
// assertions describe what the code does today, and are worded so that fixing
// the defect turns the test red and the correct response is to delete it.
// ---------------------------------------------------------------------------
describe("boldsign/webhook — known defects, pinned", () => {
  it("WATCHDOG (finding 5): an unrecognised event downgrades the agreement to 'pending'", () => {
    // `mapBoldSignStatus` returns 'pending' for any event it does not know, and
    // the result is written to document_status unconditionally. BoldSign adds
    // event types over time (reminders, downloads, deletions); the first one
    // that arrives for a COMPLETED agreement rewrites it to 'pending', which is
    // not terminal — so the agreements screen shows a signed contract as
    // outstanding and offers to resend it.
    //
    // Self-converting, like the PDF watchdog in the bonzah folder: there are two
    // legitimate repairs — stop defaulting unknown events to 'pending', or guard
    // the write — and this case accepts EITHER and then holds it. It must never
    // go red for a fix, or the cheapest way back to green is to restore the bug.
    const src = webhookSrc();

    const defaultsToPending = src.includes("return statusMap[eventType] || 'pending';");
    const guarded = /if\s*\(\s*mappedStatus\s*(?:!==|===)\s*['"]pending['"]/.test(src);

    if (!defaultsToPending || guarded) {
      // THE FIX LANDED. Assert the property that makes it a fix: an event the
      // map does not know can no longer overwrite a status that is already
      // terminal — either because it never becomes 'pending', or because the
      // write is now conditional.
      expect(
        !defaultsToPending || guarded,
        "Finding 5 looked fixed but is not: unknown events still map to 'pending' and " +
          "the write is still unconditional.",
      ).toBe(true);
      expect(
        src,
        "The mapped status is no longer written to document_status at all. That is a " +
          "bigger change than finding 5's fix — re-read this handler.",
      ).toMatch(/document_status:/);
      return;
    }

    // STILL BROKEN. Pin it, with the cost named.
    expect(
      { defaultsToPending, guarded, writesMappedDirectly: /document_status:\s*mappedStatus/.test(src) },
      [
        "",
        "  Finding 5 changed shape without being fixed.",
        "",
        "  What it pins: mapBoldSignStatus defaults every unknown event to 'pending' and",
        "  the result is written straight to document_status. The first new BoldSign",
        "  event type to arrive for a COMPLETED agreement rewrites it to 'pending' —",
        "  non-terminal — so a signed contract shows as outstanding and the screen",
        "  offers to resend it.",
        "",
        "  Either repair converts this case and keeps it green: stop defaulting to",
        "  'pending', or guard the write. Reaching this assertion means neither landed.",
        "",
      ].join("\n"),
    ).toEqual({ defaultsToPending: true, guarded: false, writesMappedDirectly: true });
  });

  it("WATCHDOG (finding 6): the additional-driver signing sync is dead code", () => {
    // `handleBoldSignWebhook(supabaseClient, event)` reads
    // `(payload as any)?.document?.signerDetails` — and `payload` does not
    // exist in that scope, or anywhere in the file. Every webhook therefore
    // throws a ReferenceError into the surrounding try/catch, which warns and
    // continues. The visible effect: rental_additional_drivers.signing_status
    // never advances past the 'sent' the send path stamps, so an additional
    // driver who HAS signed still shows as pending on the rental detail page.
    const src = webhookSrc();

    // The send path stamps 'sent', which is the half that works — and is why the
    // symptom is "stuck on sent" rather than "never appears". True either way.
    expect(
      blankComments(readEdgeFunctionSource("create-boldsign-document")),
      "The send path no longer stamps additional drivers as signing_status='sent'. " +
        "Finding 6's symptom would change shape.",
    ).toContain("signing_status: 'sent'");

    // Which identifier does the sync actually read signerDetails off?
    const read = /\(\s*([A-Za-z_$][\w$]*)\s+as\s+any\s*\)\s*\?\.document\?\.signerDetails/.exec(src);
    expect(
      read,
      "The additional-driver sync no longer reads `<name>?.document?.signerDetails` at " +
        "all. Re-read finding 6: either the sync was removed, or it was rewritten in a " +
        "shape this case cannot see.",
    ).not.toBeNull();
    const name = read![1];

    // Declared, or accepted as a parameter — the two ways the name can resolve.
    const resolves =
      new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(src) ||
      new RegExp(`function\\s+[A-Za-z_$][\\w$]*\\s*\\([^)]*\\b${name}\\s*[:,)]`).test(src);

    if (resolves) {
      // THE FIX LANDED: the sync reads a name that is actually in scope, so it
      // can run. Assert the property that makes it a fix, and keep asserting it.
      expect(
        resolves,
        `The additional-driver sync reads \`${name}\`, which is now in scope — finding 6 ` +
          "is fixed and this case has converted itself.",
      ).toBe(true);
      expect(
        src,
        "The signer-sync error handling is gone. With the sync now LIVE, an unexpected " +
          "signerDetails shape would fail the whole webhook and 500 back to BoldSign, " +
          "which retries — keep the guard.",
      ).toContain("Additional driver signing status sync failed");
      return;
    }

    // STILL BROKEN: the name resolves to nothing, so every webhook throws a
    // ReferenceError here and the catch below swallows it.
    expect(
      { readsIdentifier: name, resolvesInScope: resolves },
      [
        "",
        "  Finding 6 changed shape without being fixed.",
        "",
        `  What it pins: the sync reads \`(${name} as any)?.document?.signerDetails\`, and`,
        `  \`${name}\` is declared nowhere in the file and is not a parameter. Every webhook`,
        "  throws a ReferenceError here, which the surrounding try/catch turns into a",
        "  warning. rental_additional_drivers.signing_status therefore never advances",
        "  past the 'sent' the send path stamps: an additional driver who HAS signed",
        "  still shows as pending on the rental detail page.",
        "",
        "  Declaring the name — or passing the event in — converts this case and keeps",
        "  it green.",
        "",
      ].join("\n"),
    ).toEqual({ readsIdentifier: "payload", resolvesInScope: false });

    // The catch that turns the ReferenceError into a warning — which is why
    // nothing ever surfaced.
    expect(
      src,
      "The signer-sync try/catch is gone, so the ReferenceError would now fail the " +
        "whole webhook instead of being swallowed. That is a bigger change than it " +
        "looks: every signing event would 500 back to BoldSign.",
    ).toContain("Additional driver signing status sync failed");
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// One case, and it is worth being precise about what it demonstrates.
//
// It POSTs an unsigned, unauthenticated payload with no documentId. The
// function answers it. That answer IS finding 4 in observable form: nothing
// about the request was verified, and only the missing document id stopped it.
// Nothing is created, updated or downloaded — the guard replies before the
// first database call.
//
// It is not an assertion that the current behaviour is correct. The assertion
// is narrow on purpose: the endpoint is reachable and it stops at the missing
// id. The watchdog above is what will assert real verification once it exists.
// ===========================================================================
describe("boldsign/webhook — live (Layer 2)", () => {
  it("live: an unsigned payload reaches the function and is stopped only by the missing document id", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }

    // No documentId, so `handleBoldSignWebhook` is never reached: the guard in
    // the handler answers first, above every read and every write.
    const res = await liveCall("boldsign-webhook", {
      event: { eventType: "Completed", eventUtcTimestamp: new Date().toISOString() },
      document: {},
    });

    expect(
      res.status,
      "The webhook did not answer at all.\n" + classifyLive(res).explain,
    ).toBeLessThan(500);

    expect(
      res.json?.ok,
      "boldsign-webhook accepted a payload with no document id (ok !== false).\n" +
        `  ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  That guard is currently the FIRST thing standing between an anonymous POST\n" +
        "  and a service-role write — see FINDING 4 in this file's header.",
    ).toBe(false);

    expect(
      String(res.json?.error ?? res.text),
      "The refusal did not name the missing document id. Failure mode (a) if the " +
        "wording changed; failure mode (b) if this is the gateway answering rather " +
        "than the function — which would mean verify_jwt is no longer false and " +
        "BoldSign can no longer call us at all.",
    ).toMatch(/No document ID in payload/i);
  });
});
