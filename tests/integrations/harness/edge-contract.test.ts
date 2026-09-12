/**
 * THE CONTRACT PARSER ITSELF — tests/helpers/edge-contract.ts. Layer 3, executed.
 *
 * This helper is the foundation every L1 contract test stands on, so a fault in
 * it is not one wrong test but a whole class of tests passing for the wrong
 * reason. It had two, both fixed here and both locked down below.
 *
 * WHAT WAS WRONG
 * --------------
 * 1. It understood only three body shapes, all of which required the local to be
 *    literally named `body` AND to carry a type annotation. It threw on 135 of
 *    the 271 body-reading edge functions — essentially the entire notify-* and
 *    send-* family, plus apply-payment, mark-invoice-paid and aws-ses-email. No
 *    L1 contract test could be written for any of them.
 *
 * 2. Worse, and quieter: the destructure pattern used a lazy `[\s\S]*?`, which
 *    spans statement boundaries. In create-credit-checkout it began at an
 *    earlier `const { data: { user } } = await supabaseUser.auth.getUser()` and
 *    ran to the real destructure's brace, INVENTING a field `data` and DROPPING
 *    the real first field `credits`. That is the exact "passes for the wrong
 *    reason" outcome the file's own header claims to prevent.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * A loud throw is acceptable. A silently wrong or silently empty field list is
 * not — every assertion built on one would pass regardless of the truth. So the
 * sweep below asserts zero empty field sets outright, and holds the throw count
 * to a ceiling that can only come down.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readEdgeFunction, FUNCTIONS_DIR } from "../../helpers/edge-contract";

/** Every edge function that reads a request body at all. */
const bodyReadingFunctions = (): string[] =>
  readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => existsSync(join(FUNCTIONS_DIR, n, "index.ts")))
    .filter((n) => readFileSync(join(FUNCTIONS_DIR, n, "index.ts"), "utf8").includes("req.json()"))
    .sort();

const sweep = () => {
  const parsed: Record<string, string[]> = {};
  const threw: string[] = [];
  for (const fn of bodyReadingFunctions()) {
    try { parsed[fn] = readEdgeFunction(fn).fields; } catch { threw.push(fn); }
  }
  return {
    parsed,
    threw,
    empty: Object.entries(parsed).filter(([, f]) => f.length === 0).map(([n]) => n),
  };
};

// @usecase A wrong field list is invisible: every contract assertion built on it
// passes regardless of what the function really reads. This block is the reason
// the whole L1 layer can be trusted.
describe("the parser reports the fields a function actually reads", () => {
  it("reads a plain destructure without picking up an adjacent statement's fields", () => {
    /**
     * create-credit-checkout is the regression case. Two destructures sit near
     * each other:
     *     const { data: { user } } = await supabaseUser.auth.getUser();   (:30)
     *     const { credits, tenantId, successUrl, cancelUrl, acceptedTos }
     *       = await req.json();                                          (:35)
     * The old lazy pattern spanned both, reporting `data` (which never crosses
     * the wire) and losing `credits` (which does, and which the function 400s on).
     */
    const fields = readEdgeFunction("create-credit-checkout").fields;
    expect(fields).toEqual(["acceptedTos", "cancelUrl", "credits", "successUrl", "tenantId"]);
    expect(fields, "`data` comes from an auth.getUser() destructure, not the wire").not.toContain("data");
  });

  it("follows a body assigned to a hoisted variable and destructured afterwards", () => {
    // apply-payment: `let body;` then `body = await req.json();` then
    // `const { paymentId, targetCategories, holdAsCredit } = body;`
    expect(readEdgeFunction("apply-payment").fields).toEqual(
      ["holdAsCredit", "paymentId", "targetCategories"],
    );
  });

  it("follows a body held in a differently-named, type-annotated local", () => {
    // aws-ses-email: `const request: EmailRequest = await req.json();`
    const fields = readEdgeFunction("aws-ses-email").fields;
    expect(fields).toContain("to");
    expect(fields).toContain("subject");
    expect(fields).toContain("template");
  });

  it("still reads the annotated `body` shapes it always understood", () => {
    // The three original shapes must keep working unchanged — 136 functions and
    // every existing contract test depend on them.
    const provision = readEdgeFunction("signup-provision").fields;
    expect(provision.length).toBeGreaterThan(0);
    expect(readEdgeFunction("process-refund").fields.length).toBeGreaterThan(0);
  });
});

// @usecase The ceiling is the point. A new edge function using an unknown body
// shape pushes this over and fails the build, which forces the parser to be
// taught rather than the function to be silently uncoverable.
describe("the parser sweep across every body-reading edge function", () => {
  it("never returns an empty field set for a function it claims to have parsed", () => {
    /**
     * The load-bearing assertion of this file. An empty list is worse than a
     * throw: a contract test asserting "the function reads exactly these fields"
     * would pass against nothing at all. The parser now refuses rather than
     * answering empty.
     */
    expect(sweep().empty).toEqual([]);
  });

  it("parses the large majority of body-reading functions", () => {
    const { parsed, threw } = sweep();
    const total = parsed ? Object.keys(parsed).length + threw.length : 0;
    expect(total).toBeGreaterThan(250);
    expect(Object.keys(parsed).length / total).toBeGreaterThan(0.85);
  });

  it("holds the unparseable count to a ceiling that can only come down", () => {
    /**
     * 26 at the time of writing, down from 135. The remainder are genuinely
     * different shapes — several sandbox-* twins, the push-notification pair, and
     * a few that read the body through a helper rather than directly.
     *
     * This assertion is deliberately a CEILING, not an equality: fixing more is
     * always welcome and must not fail the build, but a NEW function with an
     * unknown shape pushing it to 27 should fail, because the alternative is a
     * function nobody can write a contract test for and nobody notices.
     */
    const { threw } = sweep();
    expect(
      threw.length,
      `Unparseable body shapes rose to ${threw.length}. Teach the parser the new ` +
        `shape (tests/README.md section 9) rather than raising this ceiling.\n` +
        `  currently unparseable: ${threw.join(", ")}`,
    ).toBeLessThanOrEqual(26);
  });

  it("throws with a message naming the function and what to do about it", () => {
    // A parser that throws is only acceptable if the throw is actionable.
    let message = "";
    try { readEdgeFunction("save-push-subscription"); } catch (e) { message = String((e as Error).message); }
    expect(message).toContain("save-push-subscription");
    expect(message.toLowerCase()).toMatch(/parser|shape|body/);
  });

  it("caches a parsed shape rather than re-reading the file each time", () => {
    // Every contract test calls this repeatedly; the sweep above alone would be
    // 275 file reads without it.
    expect(readEdgeFunction("create-credit-checkout")).toBe(readEdgeFunction("create-credit-checkout"));
  });
});
