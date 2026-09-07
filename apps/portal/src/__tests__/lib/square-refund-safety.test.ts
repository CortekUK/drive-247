import { describe, it, expect } from "vitest";
import { readEdgeSource, codeOnly } from "../helpers/edge-source";

/**
 * THE SKIP-IS-NOT-SUCCESS SUITE.
 *
 * `skip()` returns `{ handled: true, skipped: true }` and — this is the trap —
 * NO `error` flag. Four of the five refund call sites tested only `.error`,
 * found it falsy, and took the success branch. The observable result was a
 * customer told they had been refunded while nothing had left Square.
 *
 * It is reachable two ways, neither exotic:
 *   * square_get_tokens filters `status = 'active'`, so any deactivated or
 *     cleared connection yields skip("square_not_connected");
 *   * a payment whose webhook was missed has no square_payment_id, yielding
 *     skip("square_payment_id_missing") — and "the webhook was missed" is
 *     exactly the state someone is trying to clean up when they issue a refund.
 *
 * The same shape bit the checkout side: send-excess-mileage-payment-link read a
 * skip as a Square success, set paymentUrl to "", and still emailed the customer
 * a branded Pay Now button pointing at nothing.
 *
 * These are cross-file contract tests on purpose. Every one of these functions
 * type-checked, built, and passed 951 tests while carrying the bug, because
 * nothing local to a file is wrong — the mistake is only visible when you read
 * the constructor's contract and the call site together.
 */

const fn = (name: string) => codeOnly(readEdgeSource(`${name}/index.ts`));

/**
 * Index of a CALL to `name`, not of the import that also mentions it.
 *
 * An earlier version of this file used indexOf(name) and matched the import
 * statement at the top of every file, so each assertion silently examined the
 * wrong 2KB of source. The call is always `await name(` or `name(`.
 */
const callAt = (src: string, name: string): number => {
  const m = new RegExp(`(?:await\\s+)?\\b${name}\\s*\\(`).exec(
    src.slice(src.indexOf("\n", src.lastIndexOf("import"))),
  );
  const offset = src.indexOf("\n", src.lastIndexOf("import"));
  return m ? offset + m.index : -1;
};
const shared = (name: string) => codeOnly(readEdgeSource(`_shared/payments/${name}.ts`));

// Every function that dispatches a refund through the seam.
const REFUND_CALLERS = [
  "process-refund",
  "cancel-rental-refund",
  "reject-rental",
  "process-scheduled-refund",
  "deduct-from-deposit",
] as const;

describe("skip() is defined as success-shaped, which is why call sites must test it", () => {
  const types = shared("types");

  it("carries handled:true and no error flag", () => {
    const decl = types.slice(types.indexOf("export function skip("));
    expect(decl).toMatch(/handled:\s*true/);
    expect(decl).toMatch(/skipped:\s*true/);
    // The absence of `error` is the whole hazard. If a future change adds it,
    // these call-site tests become belt-and-braces rather than load-bearing —
    // but until then, `.error` alone is not a sufficient check anywhere.
    const body = decl.slice(0, decl.indexOf("}"));
    expect(body).not.toMatch(/\berror:\s*true/);
  });
});

describe("no refund caller reports an unissued refund as done", () => {
  it.each(REFUND_CALLERS)("%s treats a skip as a failure", (name) => {
    const src = fn(name);
    expect(src).toContain("tryProviderRefund");

    // The refund outcome must be examined for `.skipped`, not only `.error`.
    expect(
      /\.skipped/.test(src),
      `${name} dispatches a refund but never inspects .skipped — a skip is ` +
        `handled:true with no error flag, so it would reach the success branch ` +
        `and report a refund that never left Square.`,
    ).toBe(true);
  });

  it.each(REFUND_CALLERS)("%s BRANCHES on the skip, not merely mentions it", (name) => {
    const src = fn(name);
    const at = callAt(src, "tryProviderRefund");
    expect(at, `${name}: no call to tryProviderRefund found`).toBeGreaterThan(-1);
    const after = src.slice(at);
    const bodyAt = after.indexOf(".body");
    const region = after.slice(0, bodyAt === -1 ? after.length : bodyAt);

    // Look ONLY inside if-conditions.
    //
    // An earlier version of this test searched the whole region for the string
    // ".skipped", and mutation testing showed it was worthless: reverting the
    // guard to `if (routed.error)` left the word behind in the error MESSAGE
    // ternary, so the test stayed green while the bug was fully restored. A
    // test that matches prose next to the code instead of the code is not a
    // test. Only the branch condition decides control flow, so only the branch
    // condition counts.
    const conditions = [...region.matchAll(/(?:else\s+)?if\s*\(([^{]*?)\)\s*\{/g)].map((m) => m[1]);
    expect(conditions.length, `${name}: no guard found after the dispatch`).toBeGreaterThan(0);

    // Two legitimate shapes, and the test must not force a house style:
    //   (a) one combined guard — `if (routed.error || routed.skipped)`
    //   (b) separate branches  — process-refund routes a skip to a MANUAL refund
    //       fallback, which is arguably better than failing: the operator still
    //       gets a ledger row and an instruction to settle it by hand.
    expect(
      conditions.some((c) => /\.skipped/.test(c)),
      `${name}: no branch CONDITION tests .skipped before the outcome body is read — ` +
        `a skip would fall through to the success path and report a refund that ` +
        `never left Square. Conditions found: ${JSON.stringify(conditions)}`,
    ).toBe(true);
  });
});

describe("the money-writing side effects sit behind that guard", () => {
  it("deduct-from-deposit cannot stamp refund_processed_at on a skip", () => {
    const src = fn("deduct-from-deposit");
    const at = callAt(src, "tryProviderRefund");
    const region = src.slice(at, src.indexOf("refund_processed_at", at));
    // The guard must appear between the dispatch and the ledger write.
    expect(region).toMatch(/\.skipped/);
    expect(region).toMatch(/return errorResponse/);
  });

  it("process-scheduled-refund cannot return success:true on a skip", () => {
    const src = fn("process-scheduled-refund");
    const at = callAt(src, "tryProviderRefund");
    const region = src.slice(at, src.indexOf("refund_processed_at", at));
    expect(region).toMatch(/\.skipped/);
    expect(region).toMatch(/throw new Error/);
  });
});

describe("a skip never produces a customer-facing payment link", () => {
  it("send-excess-mileage-payment-link refuses instead of emailing an empty href", () => {
    const src = fn("send-excess-mileage-payment-link");
    const at = callAt(src, "tryProviderCheckout");
    const emailAt = callAt(src, "sendResendEmail");

    const skipAt = src.indexOf(".skipped", at);
    expect(skipAt).toBeGreaterThan(-1);
    // Must be checked BEFORE the email is sent, not merely somewhere in the file.
    expect(skipAt).toBeLessThan(emailAt);
  });

  it("and guards the URL itself, whichever rail produced it", () => {
    const src = fn("send-excess-mileage-payment-link");
    const guardAt = src.indexOf("if (!paymentUrl)");
    const emailAt = callAt(src, "sendResendEmail");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(emailAt);
  });
});

describe("two equal partial refunds cannot collapse into one at Square", () => {
  it("the seam mints a per-attempt identity", () => {
    const src = shared("refund");
    // Square's idempotency key is (payment, identity, amount). Without a
    // per-attempt identity it fell back to the payments row id — constant — so
    // the second £50 refund reused the first's key and Square returned the FIRST
    // refund object while the adapter reported success.
    expect(src).toMatch(/refund_row_id/);
    expect(src).toMatch(/crypto\.randomUUID\(\)/);
  });

  it("the identity reaches the adapter's key, not just the spec", () => {
    const adapter = shared("square-adapter");
    const seed = adapter.slice(adapter.indexOf("const refundIdentity"));
    expect(seed).toMatch(/refund_row_id/);
    expect(seed.slice(0, seed.indexOf("squareIdempotencyKey") + 200)).toMatch(/rfnd-/);
  });
});
