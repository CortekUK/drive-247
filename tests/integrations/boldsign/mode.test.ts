// =============================================================================
// integrations/boldsign — PER-TENANT TEST/LIVE MODE.
//
// Every BoldSign call in this repo has to answer one question first: WHICH KEY?
// `tenants.boldsign_mode` ('test' | 'live') decides it, `rentals.boldsign_mode`
// and `rental_agreements.boldsign_mode` record which one an agreement was
// actually created under, and the webhook resolves from the recorded value so
// the signed PDF is downloaded with the key that minted the document.
//
// The invariant is stated in the repo's own source, in
// `supabase/functions/_shared/lean-tenants.ts`:
//
//     "that history is NOT rewritten: a document created in the BoldSign
//      sandbox must keep being read with the sandbox key or it 404s."
//
// and the cost of breaking it, from the same file:
//
//     "signing would start live in the app while the `boldsign-webhook`
//      downloaded the signed PDF with the test key, and the document 404s —
//      leaving a signed agreement no one can retrieve."
//
// So this file asserts three things, in order of how much they cost when wrong:
//
//   1. the key MAPPING itself, in all ten places it is duplicated — an inverted
//      ternary in any one of them signs live documents with a sandbox key;
//   2. that the create path RECORDS the mode it used;
//   3. that every reader PREFERS the recorded mode, and only falls back to the
//      tenant when there is nothing recorded.
//
// NOT DUPLICATED HERE: the lean-tenant gate (`isLeanTenant` /
// `resolveBoldSignMode` semantics, the three-runtime mirror, and "every
// resolution point imports the gate") is already covered, thoroughly, by
// apps/portal/src/__tests__/lib/lean-boldsign.test.ts. That suite runs with
// `cd apps/portal && npm run test`. Re-asserting it here would be two tests
// that fail together and tell you the same thing twice.
// =============================================================================

import { describe, expect, it } from "vitest";
import { blankComments, readEdgeFunctionSource } from "../../helpers/edge-contract";
import { balanced, positionsOf, readRepoSource } from "./boldsign-source";

/** Every file that decides which BoldSign API key to use. Ten copies. */
const KEY_MAPPING_FILES = [
  "supabase/functions/_shared/boldsign-client.ts",
  "apps/portal/src/app/api/esign/route.ts",
  "apps/portal/src/app/api/esign/sign/route.ts",
  "apps/portal/src/app/api/esign/view/route.ts",
  "apps/portal/src/app/api/esign/status/route.ts",
  "apps/portal/src/app/api/esign/void/route.ts",
  "apps/portal/src/app/api/esign/signing-redirect/route.ts",
  "apps/booking/src/app/api/esign/route.ts",
  "apps/booking/src/app/api/esign/sign/route.ts",
  "apps/booking/src/app/api/esign/view/route.ts",
];

/** The body of that file's `getBoldSignApiKey`, comments removed. */
function keyMappingBody(file: string): string {
  const src = blankComments(readRepoSource(file));
  const at = src.indexOf("function getBoldSignApiKey");
  if (at === -1) {
    throw new Error(
      `${file} no longer defines getBoldSignApiKey.\n` +
        `  Either the copies were consolidated — good, and this list should shrink —\n` +
        `  or this route resolves its key some other way and needs re-reading.`,
    );
  }
  const paramsEnd = src.indexOf(")", at);
  const bodyStart = src.indexOf("{", paramsEnd);
  return balanced(src, bodyStart);
}

describe("boldsign/mode — the key mapping, in all ten copies", () => {
  it.each(KEY_MAPPING_FILES)("%s maps live→LIVE and test→TEST", (file) => {
    const body = keyMappingBody(file);

    // The shape is a ternary on `mode === 'live'`. Asserting the ORDER of the
    // three tokens is what catches an inverted ternary — the failure that signs
    // a real customer's agreement with the sandbox key (invisible until the
    // document turns out to be watermarked and auto-deleted after 14 days), or
    // worse, mints a sandbox agreement against the live account and bills it.
    expect(
      body,
      `${file}: the live/test key ternary no longer reads as\n` +
        `    mode === 'live' ? <LIVE key> : <TEST key>\n` +
        `  An inverted or reshaped mapping here is not a style change: it decides\n` +
        `  whether a legally binding agreement is created in the sandbox, or a test\n` +
        `  agreement against the live account.`,
    ).toMatch(/mode\s*===\s*'live'[\s\S]*\?[\s\S]*BOLDSIGN_LIVE_API_KEY[\s\S]*:[\s\S]*BOLDSIGN_TEST_API_KEY/);

    // The legacy single-key variable is the fallback in BOTH branches. A tenant
    // configured before the split still signs, in whichever mode is asked for.
    const fallbacks = body.match(/BOLDSIGN_API_KEY/g) ?? [];
    expect(
      fallbacks.length,
      `${file}: the legacy BOLDSIGN_API_KEY fallback is no longer present in both ` +
        `branches (found ${fallbacks.length}). A deployment that only ever set the ` +
        `single-key variable would lose signing in one mode with no error until an ` +
        `operator pressed Send.`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("the shared edge client refuses to guess when a key is missing", () => {
    // It throws rather than returning '' — and every caller catches that throw
    // and answers "BoldSign not configured" instead of calling BoldSign with an
    // empty X-API-KEY header, which BoldSign answers with a 401 the operator
    // cannot interpret.
    // Read by path, not through `readEdgeFunctionSource`: that helper resolves
    // `supabase/functions/<fn>/index.ts`, and this is a shared module.
    const shared = blankComments(readRepoSource("supabase/functions/_shared/boldsign-client.ts"));
    expect(
      shared,
      "getBoldSignApiKey no longer throws on a missing key. Callers would send an " +
        "empty X-API-KEY to BoldSign and surface its 401 as an unexplained failure.",
    ).toContain("Missing BoldSign API key for");
    expect(
      shared,
      "getTenantBoldSignMode no longer defaults to 'test' when the tenant row cannot " +
        "be read. Failing open to 'live' would mint real documents for a tenant this " +
        "code could not even look up.",
    ).toContain("defaulting to test");
  });
});

describe("boldsign/mode — the create path records the mode it used", () => {
  it("both web send paths stamp the mode on the agreement and the rental", () => {
    for (const [name, file] of [
      ["portal", "apps/portal/src/app/api/esign/route.ts"],
      ["booking", "apps/booking/src/app/api/esign/route.ts"],
    ] as const) {
      const src = blankComments(readRepoSource(file));
      const stamps = src.match(/boldsign_mode:\s*boldsignMode/g) ?? [];
      expect(
        stamps.length,
        `${name} /api/esign stamps boldsign_mode on ${stamps.length} row(s); it needs both ` +
          `the rental_agreements row and the rentals row.\n` +
          `  An unrecorded mode sends every later reader — view, status, void and the\n` +
          `  webhook — back to the tenant's CURRENT mode, and a tenant that has since\n` +
          `  gone live can no longer download its own sandbox-era signed PDFs.`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("the mode is resolved once, at create time, from the tenant", () => {
    for (const [name, file] of [
      ["portal", "apps/portal/src/app/api/esign/route.ts"],
      ["booking", "apps/booking/src/app/api/esign/route.ts"],
    ] as const) {
      const src = blankComments(readRepoSource(file));
      const at = positionsOf(src, {
        resolve: "resolveBoldSignMode(",
        key: "getBoldSignApiKey(boldsignMode)",
        send: "/v1/document/send",
      });
      expect(at.resolve, `${name}: the mode is no longer resolved through the shared gate`).toBeGreaterThan(-1);
      expect(
        at.resolve < at.key && at.key < at.send,
        `${name}: mode resolution, key selection and the send are out of order.\n` +
          `  resolve@${at.resolve} key@${at.key} send@${at.send}\n` +
          `  The key must be chosen from the resolved mode, before the document is sent.`,
      ).toBe(true);
    }
  });

  it("a test-mode document tells the customer it is not binding", () => {
    // The email carries a "Test Mode — this is a test document and is not
    // legally binding" banner, gated on the mode. Without the gate, either
    // every customer sees a test banner on a real contract, or nobody sees it
    // on a sandbox one — and a sandbox document is watermarked and deleted
    // after 14 days, so the second is the expensive direction.
    const src = blankComments(readEdgeFunctionSource("send-signing-email"));
    expect(src, "the test-mode banner is gone from the signing email").toContain("not legally binding");
    expect(
      src,
      "The test banner is no longer gated on boldsignMode === 'test'. Either every " +
        "customer sees it on a real agreement, or nobody sees it on a sandbox one.",
    ).toContain("boldsignMode === 'test'");
    expect(
      src,
      "send-signing-email no longer defaults boldsignMode to 'test'. An omitted mode " +
        "would silently present a sandbox document as binding.",
    ).toContain("boldsignMode = 'test'");
  });
});

describe("boldsign/mode — every reader prefers the mode recorded on the row", () => {
  it("the webhook reads the agreement's mode, then the rental's, then the tenant's", () => {
    const src = blankComments(readEdgeFunctionSource("boldsign-webhook"));
    const at = positionsOf(src, {
      agreement: "(agreement?.boldsign_mode as BoldSignMode)",
      rental: "(rental.boldsign_mode as BoldSignMode)",
      tenant: "getTenantBoldSignMode(",
    });
    expect(at.agreement, "the webhook no longer prefers the agreement's recorded mode").toBeGreaterThan(-1);
    expect(at.rental, "the webhook no longer falls back to the rental's recorded mode").toBeGreaterThan(-1);
    expect(at.tenant, "the webhook no longer has a tenant-level fallback at all").toBeGreaterThan(-1);
    expect(
      at.agreement < at.rental && at.rental < at.tenant,
      "The webhook's mode precedence has been reordered.\n" +
        `  agreement@${at.agreement} rental@${at.rental} tenant@${at.tenant}\n` +
        "  The recorded value must win: the tenant's CURRENT mode says nothing about\n" +
        "  which key minted a document that was created months ago.",
    ).toBe(true);
  });

  it("a recorded LIVE mode is never downgraded to test by a later read", () => {
    // A signed LIVE document fetched with a sandbox key is a 404 on a legally
    // binding agreement, so this is the half of `resolveMode`'s fallback that is
    // unambiguously right.
    //
    // It is asserted by LIFTING the shipped condition and RUNNING it, not by
    // matching its text. Matching the text would pin one spelling — and the
    // repair for finding 3 below (`if (!mode)`) is a DIFFERENT spelling that
    // satisfies this property perfectly. A test that goes red when the code is
    // fixed is worse than no test, so this one asks the condition what it does
    // rather than what it looks like.
    const src = blankComments(readEdgeFunctionSource("boldsign-webhook"));
    const fn = src.slice(src.indexOf("async function resolveMode"));
    const guard = fn.slice(0, fn.indexOf("return mode"));

    const at = guard.indexOf("if (");
    expect(at, "resolveMode no longer guards its tenant re-read with an `if`.").toBeGreaterThan(-1);
    const cond = balanced(guard, at + 3).trim();

    let fallsBackFor: (mode: string | null | undefined) => boolean;
    try {
      // Strip TS-only `as X` casts; the condition is otherwise plain JS.
      fallsBackFor = new Function(
        "mode",
        `return !!(${cond.replace(/\s+as\s+[A-Za-z_$][\w$]*/g, "")});`,
      ) as typeof fallsBackFor;
    } catch (e) {
      throw new Error(
        `resolveMode's fallback condition could not be executed: ${(e as Error).message}\n` +
          `  condition: ${cond}\n` +
          "  It reads something other than the recorded `mode`. Re-read it by hand: the\n" +
          "  property that must hold is that a recorded 'live' is NEVER replaced by a\n" +
          "  tenant read.",
      );
    }

    expect(
      fallsBackFor("live"),
      "resolveMode now re-reads the tenant for a document recorded as LIVE.\n" +
        `  condition: ${cond}\n` +
        "  FAILURE MODE (b) — a live document downloaded with the sandbox key 404s, and\n" +
        "  the signed PDF for a real contract is never stored.",
    ).toBe(false);

    // And the fail-safe direction: nothing recorded MUST fall back, or the
    // 'test' seed on the line above becomes the answer for every document.
    for (const nothing of [null, undefined, ""] as const) {
      expect(
        fallsBackFor(nothing),
        `resolveMode no longer falls back to the tenant when the recorded mode is ` +
          `${JSON.stringify(nothing)}.\n  condition: ${cond}\n` +
          "  An unrecorded agreement would be pinned to the seeded 'test' forever.",
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // FINDING 3 — pinned, not blessed.
  //
  // `resolveMode` treats a recorded mode of 'test' as if nothing were recorded,
  // and re-reads the tenant. For a tenant that has since switched to live, a
  // sandbox-era agreement is then downloaded with the LIVE key — which is
  // exactly the failure `_shared/lean-tenants.ts` describes and says must not
  // happen. The other five readers (view, sign, status, void, signing-redirect)
  // have the same shape, so it is a pattern, not a typo.
  //
  // This test passes today because that is what the code does. It is written to
  // CONVERT ITSELF: as each reader is repaired the case narrows to the ones
  // still affected, and when the last one lands it becomes the ordinary
  // assertion that no reader re-resolves a mode that was recorded. Nobody who
  // fixes this is handed a red build for having fixed it.
  // -------------------------------------------------------------------------
  it("WATCHDOG (finding 3): a recorded 'test' mode is treated as unset and re-resolved", () => {
    // The counter-example first, because it is the fix target and it holds
    // whichever branch we take below: /api/esign/void resolves the SAME question
    // correctly, falling back only when nothing is recorded. That is what makes
    // finding 3 a defect rather than a design decision — the right shape already
    // exists next door.
    const voidSrc = blankComments(readRepoSource("apps/portal/src/app/api/esign/void/route.ts"));
    expect(
      /(boldsignMode|mode) === 'test' &&/.test(voidSrc),
      "/api/esign/void has grown the same 'treat test as unset' fallback as the other " +
        "readers. It was the correct counter-example; the pattern is spreading rather " +
        "than being fixed.",
    ).toBe(false);
    expect(
      voidSrc,
      "/api/esign/void no longer prefers the recorded mode with a plain presence check. " +
        "That is the shape every other reader should be fixed TO.",
    ).toContain("if (rental.boldsign_mode) {");

    const readers = [
      "apps/portal/src/app/api/esign/view/route.ts",
      "apps/portal/src/app/api/esign/sign/route.ts",
      "apps/portal/src/app/api/esign/status/route.ts",
      "apps/portal/src/app/api/esign/signing-redirect/route.ts",
    ];
    const stillAffected = readers.filter((f) =>
      /(boldsignMode|mode) === 'test' &&/.test(blankComments(readRepoSource(f))),
    );
    const webhook = blankComments(readEdgeFunctionSource("boldsign-webhook"));
    const webhookAffected = /if\s*\(!mode\s*\|\|\s*mode\s*===\s*\('test' as any\)\)/.test(webhook);

    // A fix must only ever REMOVE readers from this set. Going up is a new
    // reader copying the pattern, and that is a fresh bug either way.
    expect(
      stillAffected.length,
      `A reader started re-resolving a recorded 'test' mode from the tenant.\n` +
        `  now affected: ${stillAffected.join(", ")}\n` +
        "  Finding 3 is spreading. Copy /api/esign/void's plain presence check instead.",
    ).toBeLessThanOrEqual(readers.length);

    if (!webhookAffected && stillAffected.length === 0) {
      // FULLY FIXED. The case converts into the real invariant it was guarding:
      // a recorded mode — 'test' included — is never discarded, anywhere.
      expect(
        webhook,
        "boldsign-webhook must fall back to the tenant only when NOTHING is recorded. " +
          "Finding 3 was fixed; keep it fixed.",
      ).not.toMatch(/mode\s*===\s*\('test' as any\)/);
      for (const f of readers) {
        expect(
          blankComments(readRepoSource(f)),
          `${f} must prefer the recorded mode with a presence check, the way ` +
            "/api/esign/void does. Finding 3 was fixed; keep it fixed.",
        ).not.toMatch(/(boldsignMode|mode) === 'test' &&/);
      }
      return;
    }

    // STILL BROKEN, in whole or in part. The assertion here has to be MONOTONE:
    // repairing one of the five sites must not turn this red, or the first
    // person to start the fix is punished for starting it. So the only thing
    // asserted is that the damage has not spread — every site still carrying
    // the pattern is one of the five already known to carry it. When the last
    // one is repaired, the branch above takes over and asserts the invariant
    // permanently.
    expect(
      stillAffected.filter((f) => !readers.includes(f)),
      [
        "",
        "  A NEW site re-resolves a recorded boldsign_mode of 'test' from the tenant.",
        "",
        "  What this watchdog guards: a recorded mode of 'test' is discarded and re-read",
        "  from the tenant. For a tenant that has since switched to live, a sandbox-era",
        "  agreement is then downloaded with the LIVE key and 404s — the exact failure",
        "  _shared/lean-tenants.ts says must not happen, leaving a signed agreement no",
        "  one can retrieve.",
        "",
        `  Known sites, being worked off: ${[...stillAffected, ...(webhookAffected ? ["boldsign-webhook"] : [])].join(", ")}`,
        "",
        "  Copy /api/esign/void's plain presence check instead of this pattern.",
        "",
      ].join("\n"),
    ).toEqual([]);
  });

  it("every reader starts at 'test' when nothing at all is known", () => {
    // Fail-safe direction. An unresolvable mode must never default to live: a
    // sandbox document is recoverable, a live one issued by accident is a real
    // contract sent to a real customer.
    for (const file of [
      "apps/portal/src/app/api/esign/view/route.ts",
      "apps/portal/src/app/api/esign/sign/route.ts",
      "apps/portal/src/app/api/esign/status/route.ts",
      "apps/portal/src/app/api/esign/void/route.ts",
      // signing-redirect seeds from the agreement's own column and falls back
      // to 'test' in the same expression, hence the `[^;]*` before the literal.
      "apps/portal/src/app/api/esign/signing-redirect/route.ts",
    ]) {
      expect(
        blankComments(readRepoSource(file)),
        `${file} no longer defaults its BoldSign mode to 'test'. An unresolved tenant ` +
          `would be treated as live.`,
      ).toMatch(/(boldsignMode|mode)\s*:\s*'test'\s*\|\s*'live'\s*=\s*[^;]*'test'/);
    }
    expect(
      blankComments(readEdgeFunctionSource("get-boldsign-document")),
      "get-boldsign-document no longer defaults to test mode.",
    ).toContain("boldsignMode: BoldSignMode = 'test'");
  });
});
