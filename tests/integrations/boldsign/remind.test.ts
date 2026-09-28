// =============================================================================
// boldsign/remind — nudging a signer without destroying their link.
//
//   apps/portal/src/app/api/esign/remind/route.ts
//
// WHY THIS ROUTE EXISTS
// ---------------------
// "Resend" meant POST /api/esign, which builds a NEW BoldSign document and
// REVOKES the previous one first ("Superseded by a newer agreement"). A revoked
// document cannot be signed. So resending for a customer who had just said they
// could not sign destroyed the link they were holding — the email open in front
// of them went dead, they complained again, the operator resent again.
//
// Moore Luxe reported it on 29 Sep 2026: customers receiving an email and not
// being allowed to sign, "which is why I have to continuously send multiple
// emails which slowly eat my credits". Their account held 61 documents for 18
// rentals: 14 of those rentals had more than one, three had six, 20 were voided
// and 15 of those were replaced within two hours. At 7 credits a document that
// is ~300 credits on envelopes nobody could sign, and they hit zero — two
// agreements then failed `credit_failed` and those customers got no email.
//
// WHAT IS PINNED HERE, and each one is a way to put the bug back:
//
//   - the route NEVER revokes and NEVER creates: if it could do either, the
//     cheap button would be able to spend 7 credits or kill a live link;
//   - it only reminds a document a signer can still act on;
//   - "nothing to remind" is a DISTINCT, machine-readable answer, because both
//     callers branch on it to decide whether to spend a credit;
//   - both agreements screens try the reminder BEFORE /api/esign, and fall
//     through only on that one code.
// =============================================================================

import { describe, it, expect } from "vitest";
import { readRoute, exportedHttpMethods } from "./route-source";

const REL = "apps/portal/src/app/api/esign/remind/route.ts";

/* `readRoute` already blanks comments — these files explain the revoke bug at
   length, and an assertion that reads a comment proves nothing. */
const body = () => readRoute(REL);

describe("the remind route", () => {
  it("answers POST, and nothing else", () => {
    expect(exportedHttpMethods(REL)).toEqual(["POST"]);
  });

  it("calls BoldSign's reminder endpoint", () => {
    expect(body()).toMatch(/\/v1\/document\/remind\?documentId=/);
  });

  it("NEVER revokes — that is the whole point of it existing", () => {
    const src = body();
    expect(src).not.toMatch(/\/v1\/document\/revoke/);
    expect(src).not.toMatch(/revokeMessage/);
    // Nor may it write a document dead in our own tables.
    expect(src).not.toMatch(/document_status:\s*['"]voided['"]/);
  });

  it("NEVER creates a document, so it can never cost a credit", () => {
    const src = body();
    expect(src).not.toMatch(/\/v1\/document\/send/);
    expect(src).not.toMatch(/\/api\/esign['"]/);
    expect(src).not.toMatch(/create-boldsign-document/);
    expect(src).not.toMatch(/credit_transactions/);
  });

  it("only reminds a document a signer can still act on", () => {
    const src = body();
    expect(src).toMatch(/REMINDABLE\s*=\s*\[[^\]]*['"]sent['"]/);
    expect(src).toMatch(/REMINDABLE\s*=\s*\[[^\]]*['"]delivered['"]/);
    // A signed, voided or expired document must never be nudged.
    expect(src).not.toMatch(/REMINDABLE\s*=\s*\[[^\]]*['"](completed|signed|voided|expired)['"]/);
  });

  it("reports 'nothing live to remind' as a code the caller can branch on", () => {
    const src = body();
    expect(src).toMatch(/code:\s*['"]no_live_document['"]/);
    // 409, not 404: the agreement exists, it just cannot be reminded.
    expect(src).toMatch(/status:\s*409/);
  });

  it("picks the API key by the document's own mode", () => {
    const src = body();
    expect(src).toMatch(/BOLDSIGN_LIVE_API_KEY/);
    expect(src).toMatch(/BOLDSIGN_TEST_API_KEY/);
    expect(src).toMatch(/boldsign_mode/);
  });

  it("chases whoever has not signed, rather than an address we hold", () => {
    // Naming receiverEmails would trust our copy of the address over the one
    // the envelope was actually addressed to.
    expect(body()).not.toMatch(/receiverEmails/);
  });
});

describe("both agreements screens remind before they re-issue", () => {
  const screens = [
    "apps/portal/src/app/(dashboard)/agreements/page.tsx",
    "apps/portal/src/components/agreements-v2/agreements-page-v2.tsx",
  ];

  it("each one calls the remind route", () => {
    for (const rel of screens) {
      const src = readRoute(rel);
      expect(src, rel).toMatch(/["']\/api\/esign\/remind["']/);
    }
  });

  it("each one falls through to a new document ONLY on no_live_document", () => {
    for (const rel of screens) {
      const src = readRoute(rel);
      expect(src, rel).toMatch(/code\s*!==\s*["']no_live_document["']/);
    }
  });

  it("the reminder is attempted before /api/esign, not after", () => {
    for (const rel of screens) {
      const src = readRoute(rel);
      const remind = src.indexOf("/api/esign/remind");
      const issue = src.indexOf('"/api/esign"');
      expect(remind, rel).toBeGreaterThan(-1);
      if (issue > -1) expect(remind, rel).toBeLessThan(issue);
    }
  });
});
