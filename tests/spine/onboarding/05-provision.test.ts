// =============================================================================
// SPINE STEP 5 — PROVISION.
//
// The last box. Money has moved; this is what turns a paid signup into a real
// tenant — a `tenants` row, an `app_users` head admin, a Stripe subscription
// record, CMS seed content, the lot. 1,300 lines of it.
//
// This is also the single most dangerous endpoint in the flow to test naively:
// it INSERTs a tenant. On production that is a live operator appearing in ~32
// other operators' platform, in the admin list, in the billing reports. So
// Layer 2 here goes no further than "the endpoint is deployed and its auth gate
// holds", and the real work is done by the contract.
//
// The contract has an asymmetry the earlier steps do not, and it is the point
// of this file: the browser sends THREE fields, and the function reads TEN.
// That is legitimate — the business form was cut down and the function kept
// honouring the old fields so an older bundle keeps working — but "the function
// reads a field nobody sends" is exactly the drift these tests hunt. So every
// one of the seven extras is excused BY NAME, with its reason. Add an eighth
// field to the function and this test fails until someone writes down why.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  assertContract,
  diffContract,
  readEdgeFunction,
  readEdgeFunctionSource,
  type PayloadContract,
} from "../../helpers/edge-contract";
import { chain, guarded, guardedAsync, haltIfBroken } from "../../helpers/chain";
import { classifyLive, liveCall, liveStatus, liveWritesAllowed } from "../../helpers/live-call";

const STEP = "05-provision" as const;

/**
 * From `buildProvisionRequest(v)` in
 * apps/web/src/components/onboarding/onboarding-provider.tsx — three fields,
 * and that is the whole body.
 */
const CONTRACT: PayloadContract = {
  step: STEP,
  fn: "signup-provision",
  builtIn: "apps/web/src/components/onboarding/onboarding-provider.tsx (buildProvisionRequest)",
  payload: {
    companyName: "Spine Test Rentals",
    /**
     * Sent even though the function can derive one. From the builder's own
     * comment: omitting it would mean "the operator saw 'acme is available',
     * paid, and was silently given 'acme-rentals-3'".
     */
    slug: "spine-test-rentals",
    acceptedTerms: true,
  },
  serverOnlyOptional: {
    location:
      "Dropped from the cut-down business form. Still honoured server-side so a " +
      "cached browser bundle mid-deploy does not 400.",
    businessPhone: "Same — removed from the form, still accepted.",
    fleetSize:
      "Removed from the form. The plan's maxVehicles cap is enforced from the " +
      "plan, not from a number the operator types.",
    vehicleType: "Removed from the form; kept for the admin-side caller.",
    businessColours: "Branding is chosen in the portal after provisioning, not at signup.",
    logoUrl: "Uploaded from the portal after provisioning.",
    operatingSchedule:
      "Set in the portal's Settings after provisioning; the function defaults it.",
  },
};

describe("05 — provision: the signup-provision contract (Layer 1)", () => {
  it("sends nothing signup-provision does not read, and reads nothing unexcused", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const shape = assertContract(CONTRACT);
      expect(shape.typeName).toBe("ProvisionRequest");
    });
  });

  it("names every field the function reads but the browser does not send", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      // The excuse list must be exactly right, not merely large enough. An
      // excuse for a field the function no longer reads is a stale note that
      // would hide the next real drift behind it.
      const shape = readEdgeFunction("signup-provision");
      const excused = Object.keys(CONTRACT.serverOnlyOptional ?? {});
      const stale = excused.filter((f) => !shape.fields.includes(f));

      expect(
        stale,
        "\nThese fields are excused in the contract but signup-provision no longer reads them:\n" +
          stale.map((f) => `  - ${f}`).join("\n") +
          "\n\n  FAILURE MODE (a): a developer removed a field. Delete the excuse — leaving\n" +
          "  it in place means the next genuinely-unsent field slips through unnoticed.\n",
      ).toEqual([]);

      // And the split is what we think it is: 3 sent, 7 excused, 10 read.
      const sent = Object.keys(CONTRACT.payload);
      const accounted = [...new Set([...sent, ...excused])].sort();
      expect(
        accounted,
        "\nEvery field signup-provision reads must be either SENT by the browser or " +
          "EXCUSED by name.\n" +
          `  sent    (${sent.length}): ${sent.sort().join(", ")}\n` +
          `  excused (${excused.length}): ${excused.sort().join(", ")}\n` +
          `  read    (${shape.fields.length}): ${shape.fields.join(", ")}\n\n` +
          "  FAILURE MODE (a): the two lists no longer add up to what the function reads.\n",
      ).toEqual([...shape.fields].sort());
    });
  });

  it("still refuses to provision without accepted terms", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      const shape = readEdgeFunction("signup-provision");
      // `acceptedTerms !== true` is the first thing the function checks, before
      // any validation and long before any insert. It is also the only field of
      // the three that is a legal record rather than a convenience.
      expect(
        shape.validated,
        "signup-provision no longer returns a field-level 400 for `acceptedTerms`. " +
          "A tenant provisioned without a recorded terms acceptance has no consent trail.",
      ).toContain("acceptedTerms");
      expect(shape.validated).toContain("companyName");
      expect(shape.validated).toContain("slug");
    });
  });

  it("proves the drift detector actually detects drift", (ctx) => {
    if (haltIfBroken(ctx, STEP)) return;
    guarded(STEP, () => {
      // A contract test that has never failed is a contract test nobody has
      // checked. This runs the same comparison against a deliberately wrong
      // payload — a `slug` renamed to `subdomain`, which is the exact rename
      // the team lead used as his example ("maine slug nikaal di, lekin test ka
      // payload mein slug ja raha hai").
      const broken: PayloadContract = {
        ...CONTRACT,
        payload: { companyName: "x", subdomain: "x", acceptedTerms: true },
      };
      const drift = diffContract(broken, readEdgeFunction("signup-provision"));

      expect(drift.extra).toEqual(["subdomain"]);
      expect(drift.missing).toEqual(["slug"]);

      chain.pass(STEP);
    });
  });
});

describe("05 — provision: live status (Layer 2)", () => {
  it("signup-provision is deployed and its auth gate holds", async (ctx) => {
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
      // Anon key, empty body. The 401 is returned at the top of the handler,
      // before the terms check, before validation, and a very long way before
      // the tenant insert. Nothing is created.
      const res = await liveCall("signup-provision", {}, { token: status.target.anonKey });

      expect(
        res.status,
        "Expected 401 UNAUTHENTICATED from signup-provision with no user session.\n" +
          classifyLive(res).explain,
      ).toBe(401);
      expect(res.json?.code).toBe("UNAUTHENTICATED");
    });
  });

  // ==========================================================================
  // THIS ONE WRITES, and it writes the most. A 200 here means a real tenant
  // row, a real head-admin user, real seeded CMS pages and real Stripe records
  // on the target project. There is no "undo provision" in the product.
  //
  // It is left as a documented skip rather than a flag-gated call: unlike
  // signup-begin (one auth row on a throwaway project), a provisioned tenant
  // is spread across a dozen tables, and a test that leaves that behind on
  // every run is a test nobody will keep running.
  // ==========================================================================
  it.skip(
    "signup-provision returns 200 and creates a tenant — run this by hand, never in CI",
    async () => {
      // The shape, for whoever does run it by hand:
      //   1. signup-begin           -> auth user  (D247_LIVE_ALLOW_WRITES=1, step 02)
      //   2. signInWithPassword     -> access token -> D247_LIVE_SESSION_JWT
      //   3. signup-payment-intent  -> Stripe Customer + incomplete Subscription
      //   4. confirm the PI with the test card in a browser (the Payment Element)
      //   5. signup-provision       -> the tenant
      // Steps 4 is the one that cannot be automated without the browser driver
      // the team lead ruled out, which is exactly why this stops here.
      expect(liveWritesAllowed()).toBe(true);
    },
  );
});
