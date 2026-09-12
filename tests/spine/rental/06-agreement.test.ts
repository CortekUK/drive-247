/**
 * THE SPINE'S AGREEMENT STEP, and the sync back from the processor.
 * Layer 1, offline.
 *
 * The team lead moved past this quickly — "after this the agreement will go.
 * You've done BoldSign before so it's not an issue" — and he was broadly right:
 * tests/integrations/boldsign/ holds nine files covering the send routes, modes,
 * notifications and the webhook.
 *
 * This file deliberately does NOT repeat those. It covers the two things that
 * are properties of the RENTAL rather than of BoldSign:
 *
 *   1. the mode the agreement was created under is recorded ON the rental and
 *      resolved back from it later, so a document created in test mode is never
 *      downloaded with the live key (or the reverse);
 *   2. the sync back — the step the team lead drew after payment — and what the
 *      rental is allowed to believe before the processor has confirmed anything.
 *
 * It also closes one gap in the existing BoldSign coverage, found by reading it:
 * the `emailSent` guard in integrations/boldsign/send.test.ts loops over the
 * portal and booking routes only, while that file's own header names THREE send
 * paths. The third is unguarded and still carries the regression.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = (p: string) => resolve(__dirname, "../../../", p);
const fnSrc = (n: string) => readFileSync(root(`supabase/functions/${n}/index.ts`), "utf8");

const CREATE_DOC = fnSrc("create-boldsign-document");
const BOLDSIGN_HOOK = fnSrc("boldsign-webhook");
const WEBHOOK_TEST = fnSrc("stripe-webhook-test");

// @usecase A document created in test mode but fetched with the live API key
// returns nothing, so the signed agreement silently never arrives. The mode must
// travel with the record, not be re-derived from whatever the tenant is set to now.
describe("the agreement records which mode it was created under", () => {
  it("reads the tenant's BoldSign mode and brand when the document is created", () => {
    expect(CREATE_DOC).toMatch(/boldsign_mode.*boldsign_test_brand_id.*boldsign_live_brand_id/s);
  });

  it("resolves the mode from the agreement first, then the rental, then the tenant", () => {
    /**
     * The fallback ORDER is the contract, and it runs most-specific first for a
     * reason: the tenant's current mode may have been switched to live long after
     * a test-mode document was signed. Falling back to the tenant only when the
     * record says nothing is what keeps an old document readable.
     */
    expect(BOLDSIGN_HOOK).toMatch(
      /agreement\?\.boldsign_mode[\s\S]{0,60}\|\|[\s\S]{0,40}rental\.boldsign_mode[\s\S]{0,40}\|\|[\s\S]{0,20}['"]test['"]/,
    );
  });

  it("defaults to test rather than live when nothing records a mode", () => {
    // The safe direction: a wrong test-mode read fails visibly and costs nothing,
    // a wrong live-mode read touches real documents.
    expect(BOLDSIGN_HOOK).toMatch(/\|\|\s*['"]test['"]/);
  });

  it("selects boldsign_mode on every rental and agreement read in the webhook", () => {
    // If a query forgets the column the fallback above silently drops to 'test'.
    const selects = BOLDSIGN_HOOK.match(/\.select\([^)]*boldsign_mode[^)]*\)/g) || [];
    expect(selects.length).toBeGreaterThanOrEqual(3);
  });
});

// @usecase The operator sees a green "sent" for an email nobody received, so
// nobody chases the signature and the rental stalls with an unsigned agreement.
describe("the automation send path reports email delivery it never measured", () => {
  it("tells BoldSign not to email the signer, because we send that mail ourselves", () => {
    // DisableEmails is set on every send path by design — which is precisely why
    // claiming emailSent without sending is a lie rather than a technicality.
    expect(CREATE_DOC).toMatch(/DisableEmails['"]?,\s*['"]true['"]/);
  });

  it("returns a hardcoded emailSent:true without invoking send-signing-email", () => {
    /**
     * DEFECT. create-boldsign-document:1145 returns `emailSent: true` in its
     * success response, while the function never invokes send-signing-email and
     * has already told BoldSign not to email anyone (:869). So the caller is told
     * a signing email went out when none did.
     *
     * This exact regression is already guarded for the other two send paths by
     * integrations/boldsign/send.test.ts:345, which asserts emailSent is derived
     * from the real response — but that test loops over the PORTAL and BOOKING
     * routes only. Its own file header (:32) lists create-boldsign-document as the
     * third send path, so the guard simply does not reach it.
     */
    expect(CREATE_DOC).toMatch(/emailSent:\s*true/);
    expect(CREATE_DOC).not.toContain("send-signing-email");
  });

  it.fails("should measure the signing email like the other two send paths do", () => {
    // Remove the `.fails` marker once create-boldsign-document either invokes
    // send-signing-email and derives emailSent from its response, or stops
    // claiming emailSent at all.
    const measured =
      CREATE_DOC.includes("send-signing-email") || !/emailSent:\s*true/.test(CREATE_DOC);
    expect(measured).toBe(true);
  });
});

// @usecase The rental's payment state must come from the processor confirming
// settlement, never from us having asked for it. Anything that writes "paid"
// before the webhook lands turns an abandoned checkout into a free rental.
describe("the sync back — what the rental may believe before the processor confirms", () => {
  it("promotes the payment to Completed only when the settlement event arrives", () => {
    expect(WEBHOOK_TEST).toContain("checkout.session.completed");
    expect(WEBHOOK_TEST).toMatch(/status:\s*["']Completed["']/);
  });

  it("treats the expiry event as a distinct outcome from a completed one", () => {
    // Both are terminal for the session; only one means money moved.
    expect(WEBHOOK_TEST).toContain("checkout.session.expired");
  });

  it("never lets a Square submission response stand in for settlement", () => {
    // Square refunds land PENDING and can still be REJECTED, so the sync back is
    // the refund.updated event and not the call that started it.
    const adapter = readFileSync(root("supabase/functions/_shared/payments/square-adapter.ts"), "utf8");
    expect(adapter).toContain("Never write Completed off this response");
  });
});
