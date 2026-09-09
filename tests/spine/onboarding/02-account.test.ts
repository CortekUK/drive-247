// =============================================================================
// SPINE STEP 2 — ACCOUNT.
//
//     account --- [password, work] ---> edge functionn. --- 200
//
// "hum na apna PAYLOAD define kiya hoga apni fields ke hisaab se — password
//  leta hai, workspace wala leta hai, slug leta hai. humne sirf yeh dekhna ki
//  yeh payload jaane ke baad jo peeche EDGE FUNCTION call ho raha hai, kya wo
//  call hone ke baad 200 de raha hai ya nahi."
//
// Two layers, because the honest answer to "does it give 200" costs a real auth
// user on a real database, and the cheap answer catches the common break anyway:
//
//   LAYER 1  the payload the browser builds still matches the fields
//            signup-begin reads. No network. Always runs.
//   LAYER 2  the actual status code. Off unless explicitly enabled, and it
//            refuses to point at production.
//
// IRREVERSIBLE (from the function's own header): "once this returns 200 the
// auth user exists and nothing in the UI can delete it." That one sentence is
// why Layer 2's happy path needs a second env flag of its own.
// =============================================================================

import { describe, expect, it } from "vitest";
import { assertContract, readEdgeFunction, type PayloadContract } from "../../helpers/edge-contract";
import { chain, guarded, guardedAsync, haltIfBroken } from "../../helpers/chain";
import { classifyLive, liveCall, liveStatus, liveWritesAllowed } from "../../helpers/live-call";

const STEP = "02-account" as const;

/**
 * The payload, copied from where the browser actually builds it —
 * apps/web/src/components/onboarding/onboarding-provider.tsx (`signupBegin({...})`,
 * typed as `SignupBeginRequest` in onboarding-api.ts).
 *
 * This is the ONE side of the contract written by hand. The other side is read
 * out of the function's source, so the two cannot quietly agree to be wrong
 * together.
 */
const CONTRACT: PayloadContract = {
  step: STEP,
  fn: "signup-begin",
  builtIn: "apps/web/src/components/onboarding/onboarding-provider.tsx",
  payload: {
    fullName: "Spine Test Operator",
    email: "spine-test@drive-247-tests.example",
    password: "spine-test-9900",
    planId: "starter",
    /** The honeypot. Sent EMPTY by a real browser; a bot fills it. */
    companyWebsite: "",
    /** Captured when the account step mounts; signup-begin measures dwell from it. */
    formStartedAt: 0,
  },
};

describe("02 — account: the signup-begin payload contract (Layer 1)", () => {
  it("sends exactly the fields signup-begin reads", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const shape = assertContract({
        ...CONTRACT,
        payload: { ...CONTRACT.payload, planId: chain.seeded<{ id: string }>("plan").id },
      });

      // The parse must have actually found something. An empty field set would
      // make the assertion above pass against a function that reads nothing.
      expect(shape.fields.length, `Parsed no request fields out of ${shape.file}`).toBeGreaterThan(0);
      expect(shape.typeName).toBe("BeginRequest");
    });
  });

  it("carries the plan seeded in step 01, not one of its own", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const plan = chain.seeded<{ id: string; amountCents: number }>("plan");
      // The account step is where the chosen plan first crosses the wire. If
      // this ever stops being the seeded plan, step 04's "the 99 reached
      // Stripe" check is measuring something else.
      expect(plan.amountCents).toBe(9900);
      expect(CONTRACT.payload.planId).toBe(plan.id);
    });
  });

  it("hard-validates the three fields the account form collects", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      // Derived from the function: every `signupError(..., { field: "x" })` it
      // can return. If a developer drops the server-side check on `password`
      // while the client keeps showing a strength meter, the trust boundary has
      // moved and this is where it shows up.
      const { validated } = readEdgeFunction("signup-begin");
      for (const field of ["fullName", "email", "password"]) {
        expect(
          validated,
          `signup-begin no longer returns a field-level 400 for \`${field}\`.\n` +
            `The client is not a trust boundary — the function's own comment says so.`,
        ).toContain(field);
      }

      chain.pass(STEP);
    });
  });
});

describe("02 — account: live status (Layer 2)", () => {
  it("signup-begin is deployed and rejects a body it cannot price", async (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    // `liveStatus()` inside the guard: the production refusal is a throw, and a
    // refusal at step N must stop the chain like any other failure. Outside the
    // guard it would be re-raised identically at every later step instead.
    const status = guarded(STEP, liveStatus);
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }

    await guardedAsync(STEP, async () => {
      // READ-ONLY, deliberately.
      //
      // An empty body fails `getSignupPlan(undefined)` -> PLAN_UNKNOWN, and that
      // check sits ABOVE the honeypot record, the throttle write and the
      // createUser call. So this proves the endpoint is deployed, routed and
      // running its validation, and it creates nothing at all.
      const res = await liveCall("signup-begin", {});

      expect(
        res.status,
        `signup-begin should answer 400 PLAN_UNKNOWN to an empty body.\n` + classifyLive(res).explain,
      ).toBe(400);
      expect(res.json?.code).toBe("PLAN_UNKNOWN");
    });
  });

  // ==========================================================================
  // THIS ONE WRITES. It calls `auth.admin.createUser`, and the user it makes
  // cannot be removed from the UI — it sits in auth.users on the target project
  // for ever.
  //
  // Hence the second flag, D247_LIVE_ALLOW_WRITES=1, on top of
  // D247_LIVE_TESTS=1 — and hence live-call.ts refusing the production ref
  // outright. Run it against a throwaway project when you want the literal 200
  // from the whiteboard; leave it skipped in CI.
  // ==========================================================================
  it.skipIf(!liveWritesAllowed())(
    "signup-begin returns 200 for a complete payload — CREATES A REAL AUTH USER",
    async (ctx) => {
      if (haltIfBroken(ctx, STEP)) return;
      const status = guarded(STEP, liveStatus);
      if (!status.enabled) {
        ctx.skip(status.reason);
        return;
      }

      await guardedAsync(STEP, async () => {
        const stamp = Date.now();
        const res = await liveCall("signup-begin", {
          ...CONTRACT.payload,
          email: `spine+${stamp}@drive-247-spine-tests.example`,
          // A real form is on screen for longer than the 1500ms dwell floor.
          formStartedAt: stamp - 5_000,
        });

        expect(res.status, classifyLive(res).explain).toBe(200);
        expect(res.json?.stage).toBe("account_created");
      });
    },
  );
});
