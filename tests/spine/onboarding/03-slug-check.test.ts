// =============================================================================
// SPINE STEP 3 — SLUG CHECK.
//
// Not on the whiteboard as its own box — it lives inside "account", where the
// operator types the web address. It is broken out here because it is the ONE
// onboarding endpoint that is genuinely read-only, and that makes it the proof
// that the Layer 2 harness works end to end against something real.
//
// Everything else in this flow either mints an auth user (signup-begin), talks
// to Stripe (signup-payment-intent) or inserts a tenant (signup-provision).
// This one does a SELECT and returns a verdict. Nothing is created, nothing is
// charged, and re-running it a hundred times leaves the database exactly as it
// was — apart from one throttle row per call, which the function writes for
// every caller anyway.
//
// The slug matters more than its size suggests: from the function's header,
// "it becomes {slug}.drive-247.com AND {slug}.portal.drive-247.com, and nothing
// in the platform renames a tenant slug afterwards."
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  assertContract,
  readEdgeFunction,
  readEdgeFunctionSource,
  type PayloadContract,
} from "../../helpers/edge-contract";
import { chain, guarded, guardedAsync, haltIfBroken } from "../../helpers/chain";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";

const STEP = "03-slug-check" as const;

/**
 * From apps/web/src/components/onboarding/onboarding-provider.tsx:
 *   signupSlugCheck({ slug, companyName: companyName || undefined })
 */
const CONTRACT: PayloadContract = {
  step: STEP,
  fn: "signup-slug-check",
  builtIn: "apps/web/src/components/onboarding/onboarding-provider.tsx",
  payload: {
    slug: "spine-test-rentals",
    /** Only used to seed the suggestion list when the slug is taken. */
    companyName: "Spine Test Rentals",
  },
};

describe("03 — slug check: payload contract (Layer 1)", () => {
  it("sends exactly the fields signup-slug-check reads", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const shape = assertContract(CONTRACT);
      // This function annotates `body` inline rather than with a named
      // interface. Asserted so that a future refactor to a named type is a
      // visible, deliberate change rather than a silent one.
      expect(shape.typeName).toBe("(inline)");
      expect(shape.fields).toEqual(["companyName", "slug"]);
    });
  });

  it("refuses an unauthenticated caller before it touches the tenants table", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      // This is a real isolation property, not a formality. The function's own
      // comment: "Without this, any anon-key holder who can mint a session
      // could probe every tenant slug on the platform." If the auth gate or the
      // signup-in-flight gate is ever removed, the endpoint becomes a tenant
      // enumeration oracle — so the test reads the source for both.
      expect(readEdgeFunction("signup-slug-check").fields).toContain("slug");

      const body = readEdgeFunctionSource("signup-slug-check");

      expect(
        body,
        "signup-slug-check no longer 401s a caller with no Authorization header.",
      ).toContain('signupError("UNAUTHENTICATED"');
      expect(
        body,
        "signup-slug-check no longer requires a signup in flight (readSignupMeta). " +
          "Any session holder can now enumerate every tenant slug on the platform.",
      ).toContain("readSignupMeta(user)");

      chain.pass(STEP);
    });
  });
});

describe("03 — slug check: live status (Layer 2)", () => {
  it("is deployed, and its auth gate answers 401 — no session, no writes", async (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    // `liveStatus()` inside the guard: the production refusal is a throw, and a
    // refusal at step N must stop the chain like any other failure. Outside the
    // guard it would be re-raised identically at every later step instead.
    const status = guarded(STEP, liveStatus);
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (status.target.sessionJwt) {
      ctx.skip("D247_LIVE_SESSION_JWT is set — the 200 case below covers this run instead.");
      return;
    }

    await guardedAsync(STEP, async () => {
      // Deliberately bearing the anon key, not a user JWT. A 401 here is the
      // CORRECT answer and it proves three things at once: the function is
      // deployed, it is routed, and its auth gate is intact.
      const res = await liveCall("signup-slug-check", { slug: "spine-probe" }, {
        token: status.target.anonKey,
      });

      const verdict = classifyLive(res);
      expect(
        res.status,
        "Expected 401 UNAUTHENTICATED from signup-slug-check with no user session.\n" +
          verdict.explain,
      ).toBe(401);
      expect(res.json?.code).toBe("UNAUTHENTICATED");
    });
  });

  it("returns 200 for an available slug when a real signup session is supplied", async (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    // `liveStatus()` inside the guard: the production refusal is a throw, and a
    // refusal at step N must stop the chain like any other failure. Outside the
    // guard it would be re-raised identically at every later step instead.
    const status = guarded(STEP, liveStatus);
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.sessionJwt) {
      ctx.skip(
        "D247_LIVE_SESSION_JWT is not set. This is the one endpoint that can return a " +
          "literal 200 without creating anything — supply the access token of a user " +
          "with a signup in flight to exercise it.",
      );
      return;
    }

    await guardedAsync(STEP, async () => {
      // A slug nobody will ever own, so the verdict is stable across runs and
      // the test never depends on the state of the tenants table.
      const slug = `spine-probe-${Date.now().toString(36)}`;
      const res = await liveCall("signup-slug-check", { slug, companyName: "Spine Probe" });

      const verdict = classifyLive(res);
      expect(res.status, verdict.explain).toBe(200);
      expect(res.json?.available).toBe(true);
      // Normalisation is part of the contract: the field self-corrects from
      // what the user typed to what will actually become the hostname.
      expect(res.json?.slug).toBe(slug);
    });
  });
});
