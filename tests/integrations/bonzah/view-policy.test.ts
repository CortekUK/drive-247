// =============================================================================
// integrations/bonzah — bonzah-view-policy.
//
// WHAT IT IS (read, not assumed): a read-through to Insillion.
//
//   1. 400 unless tenant_id and policy_id are both present
//   2. resolve the TENANT's Bonzah credentials with the SERVICE ROLE client
//   3. GET {apiUrl}/Bonzah/policy?policy_id=…  with the in-auth-token header
//   4. 500 if the body will not parse, 500 if Insillion answers status !== 0
//   5. 200 `{ policy: responseData.data }`
//
// It writes NOTHING — no table, no storage, no third-party state — which is
// what puts it on the reads rung of Layer 2. That is asserted below rather than
// asserted-by-comment, because it is the entire basis of the classification.
//
// TWO THINGS THIS FILE PINS THAT ARE NOT OBVIOUS FROM THE NAME:
//
//   * Insillion answers HTTP 200 with `status: -1` for a refusal. A caller that
//     trusts the HTTP status alone reports an error-shaped body as a policy.
//   * Its ONLY caller uses it as a "Refresh" button and then invalidates the
//     React Query cache — but the function persists nothing, so there is
//     nothing new for those queries to read. Tracked as a watchdog, not blessed.
// =============================================================================

import { describe, expect, it } from "vitest";
import { assertContract, readEdgeFunction, type PayloadContract } from "../../helpers/edge-contract";
import { classifyLive, liveCall } from "../../helpers/live-call";
import { BONZAH_LIVE_HOST } from "./sandbox";
import { bonzahServicingGate, fixtureOrNull, readRepoFile, srcOf } from "./servicing";

const FN = "bonzah-view-policy";
const src = () => srcOf(FN);
const AT = "integrations/bonzah";

const CALLER = "apps/portal/src/components/rentals/InsuranceTimeline.tsx";

const CONTRACT: PayloadContract = {
  step: AT,
  fn: FN,
  builtIn: CALLER,
  payload: {
    tenant_id: "00000000-0000-0000-0000-000000000000",
    policy_id: "POL-SPINE-SUITE",
  },
};

describe("bonzah/view-policy — contract", () => {
  it("agrees with the portal's refresh payload", () => {
    const shape = assertContract(CONTRACT);
    expect(shape.typeName).toBe("ViewPolicyRequest");
    expect(
      shape.fields.length,
      `Parsed no request fields out of ${shape.file} — the contract would pass vacuously.`,
    ).toBeGreaterThan(0);
    expect(
      shape.requiredByType,
      "tenant_id or policy_id became optional in the request type while the guard still " +
        "rejects a missing one. A type that says optional and a runtime that says 400 is " +
        "the mismatch every caller trips over.",
    ).toEqual(["policy_id", "tenant_id"]);
  });

  it("still snake_cases both ids, because the caller does", () => {
    // bonzah-verify-credentials takes `tenantId`; this one takes `tenant_id`.
    // The inconsistency is real and is the sort of thing a refactor "tidies"
    // into a 400 that only shows up in production.
    const shape = readEdgeFunction(FN);
    expect(shape.fields, "tenant_id was renamed — the caller still sends snake_case.").toContain("tenant_id");
    expect(shape.fields).not.toContain("tenantId");
  });

  it("is the caller's payload, checked from the caller's side too", () => {
    const caller = readRepoFile(CALLER);
    expect(
      caller,
      `${CALLER} no longer invokes ${FN}. If the refresh button was removed, delete this ` +
        "file's cases; if it moved, point them at the new caller.",
    ).toContain("bonzah-view-policy");
    expect(
      caller,
      "The refresh call no longer sends both ids. bonzah-view-policy 400s without either.",
    ).toMatch(/body:\s*\{\s*tenant_id:[^}]*policy_id:[^}]*\}/);
  });
});

describe("bonzah/view-policy — guard order and error handling", () => {
  it("refuses a missing id before it fetches credentials or calls Bonzah", () => {
    const s = src();
    const guardAt = s.indexOf("if (!body.tenant_id || !body.policy_id)");
    const credsAt = s.indexOf("getTenantBonzahCredentials(supabase");
    const fetchAt = s.indexOf("await fetch(policyUrl");
    expect(guardAt, "The missing-id guard is gone.").toBeGreaterThan(-1);
    expect(credsAt, `${FN} no longer resolves tenant credentials.`).toBeGreaterThan(-1);
    expect(fetchAt, `${FN} no longer calls Bonzah.`).toBeGreaterThan(-1);
    expect(
      guardAt < credsAt && guardAt < fetchAt,
      `The id guard moved below the work it guards (guard@${guardAt}, credentials@${credsAt}, ` +
        `fetch@${fetchAt}). A guard that runs after the call it guards is a log line: an ` +
        "undefined policy_id would authenticate against Bonzah and then request " +
        "?policy_id=undefined.",
    ).toBe(true);
  });

  it("url-encodes the policy id into the query string", () => {
    // The id is caller-supplied and goes into a URL. Unencoded, a `&` in it
    // appends a parameter to a request made with the operator's own token.
    expect(
      src(),
      "The policy id is no longer encodeURIComponent'd into the Bonzah URL. It is " +
        "caller-supplied and lands in a query string on an authenticated request.",
    ).toMatch(/policy_id=\$\{encodeURIComponent\(body\.policy_id\)\}/);
  });

  it("treats Insillion's `status !== 0` as a failure, not as a policy", () => {
    // Insillion answers HTTP 200 with `status: -1` and a `txt` for a refusal.
    // Without this check the 200 path returns `{ policy: undefined }` and the
    // caller reports a successful refresh of nothing.
    const s = src();
    const statusAt = s.indexOf("responseData.status !== 0");
    const successAt = s.indexOf("policy: responseData.data");
    expect(statusAt, "The Bonzah status check is gone. HTTP 200 is not success here.").toBeGreaterThan(-1);
    expect(successAt, "The success response is gone.").toBeGreaterThan(-1);
    expect(
      statusAt < successAt,
      "The Bonzah status check moved below the success return, so an error body would be " +
        "returned as a policy.",
    ).toBe(true);
    expect(
      s,
      "The Bonzah error text is no longer surfaced. `txt` is the only thing distinguishing " +
        "'no such policy' from 'your login is stale', and both arrive as HTTP 200.",
    ).toMatch(/Bonzah API error: \$\{responseData\.txt/);
  });

  it("says which side failed when the body will not parse", () => {
    const s = src();
    expect(
      s,
      "The non-JSON guard is gone. An Insillion HTML error page would throw inside " +
        "JSON.parse and surface as a bare 500 with a parser message — unreadable in a log " +
        "and indistinguishable from our own bug.",
    ).toMatch(/Failed to parse Bonzah API response/);
  });
});

describe("bonzah/view-policy — read-only, and what that is worth", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. It takes tenant_id off the request and reads that tenant's Bonzah credentials with the service-role client.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-view-policy]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-view-policy\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-view-policy has been given verify_jwt = false in supabase/config.toml.\n" +
        "  The watchdog below already records that any AUTHENTICATED caller can name any tenant_id. verify_jwt = false removes the word 'authenticated' from that sentence.",
    ).toBe(false);
  });

  it("writes nothing, which is why it sits on the reads rung", () => {
    // The classification the Layer 2 gate is built on. If this ever gains a
    // write, its live case needs D247_LIVE_ALLOW_WRITES and this test is the
    // thing that will say so.
    const s = src();
    for (const write of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(
        s.includes(write),
        `${FN} now calls \`${write}\` — it is no longer read-only.\n` +
          "  Two consequences, both real:\n" +
          "    1. its Layer 2 case below is gated as a READ and must be re-gated behind\n" +
          "       D247_LIVE_ALLOW_WRITES;\n" +
          "    2. it takes tenant_id straight off the request with a service-role client,\n" +
          "       so a write here is a write to any tenant a caller cares to name.",
      ).toBe(false);
    }
  });

  it("never applies the SELL gate — servicing must work in every mode", () => {
    expect(
      /assertBonzahSellable|getBonzahSellability/.test(src()),
      `${FN} has started calling the Bonzah sell gate. Viewing a policy the customer has ` +
        "already paid for is servicing, not selling; gating it leaves a paid customer " +
        "unable to see their own cover.",
    ).toBe(false);
  });

  it("WATCHDOG: the portal's Refresh button cannot refresh anything", () => {
    // KNOWN DEFECT, tracked rather than blessed.
    //
    // `handleRefreshPolicy` in InsuranceTimeline.tsx invokes this function,
    // DISCARDS the returned policy (`const { error } = ...`), invalidates
    // ['rental-insurance-policies'] and ['rental-bonzah-policy'], and toasts
    // "Latest policy data has been fetched from Bonzah."
    //
    // bonzah-view-policy persists nothing, so those invalidated queries re-read
    // exactly the rows they had. The operator is told the data was refreshed;
    // the only thing that happened is a round trip to Insillion.
    //
    // The fix is on either side — persist the fetched policy here, or use the
    // returned `policy` there — and this case converts itself the moment either
    // one lands.
    const s = src();
    const caller = readRepoFile(CALLER);

    const functionPersists = /\.(insert|update|upsert)\(/.test(s);
    const callerUsesTheAnswer = /const\s*\{\s*data[^}]*\}\s*=\s*await\s+supabase\.functions\.invoke\('bonzah-view-policy'/.test(
      caller,
    );

    if (functionPersists || callerUsesTheAnswer) {
      // The fix landed on one side or the other. Assert the join for real.
      expect(
        functionPersists || callerUsesTheAnswer,
        "One side now carries the refreshed policy — keep it that way.",
      ).toBe(true);
      return;
    }

    expect(
      {
        functionWritesToTheDatabase: functionPersists,
        callerReadsTheReturnedPolicy: callerUsesTheAnswer,
        callerInvalidatesQueriesAnyway: /invalidateQueries/.test(
          caller.slice(caller.indexOf("handleRefreshPolicy"), caller.indexOf("handleRefreshPolicy") + 900),
        ),
      },
      [
        "",
        "  The Refresh-policy round trip changed shape.",
        "",
        "  If you FIXED it — by persisting the policy in bonzah-view-policy, or by reading",
        "  the returned `policy` in InsuranceTimeline.tsx — this watchdog has done its job:",
        "  delete this branch and keep the positive assertion above.",
        "",
        "  What it was pinning (a real defect, reported and not blessed):",
        "    bonzah-view-policy returns { policy } and writes nothing. Its only caller",
        `    (${CALLER}, handleRefreshPolicy) throws that answer away, invalidates two`,
        '    React Query keys and reports "Latest policy data has been fetched from',
        '    Bonzah." Nothing in the database changed, so the refetch returns the same',
        "    rows. The button costs one authenticated Insillion call and tells the",
        "    operator something that is not true.",
        "",
      ].join("\n"),
    ).toEqual({
      functionWritesToTheDatabase: false,
      callerReadsTheReturnedPolicy: false,
      callerInvalidatesQueriesAnyway: true,
    });
  });

  it("WATCHDOG: any authenticated caller can name any tenant_id", () => {
    // KNOWN DEFECT, tracked rather than blessed.
    //
    // bonzah-view-policy is not in supabase/config.toml, so it runs with the
    // default verify_jwt = true: the gateway checks that SOME valid JWT is
    // present and nothing more. The function then takes `tenant_id` off the
    // request and reads that tenant's Bonzah credentials with the SERVICE ROLE
    // client, which bypasses RLS by design.
    //
    // Booking's customer portal calls its sibling bonzah-download-pdf with a
    // customer's own session, so "any valid JWT" includes every renter who has
    // ever signed up. Nothing here ties the caller to the tenant.
    //
    // Converts itself: the day an authorization check appears, the first branch
    // becomes the real assertion.
    const s = src();
    const checksCaller = /auth\.getUser\(|app_users|get_user_tenant_id|is_super_admin/.test(s);
    if (checksCaller) {
      expect(
        s,
        "An authorization check appeared — pin it: the caller must be tied to the " +
          "tenant_id in the request, not merely be authenticated.",
      ).toMatch(/auth\.getUser\(|app_users|get_user_tenant_id/);
      return;
    }
    expect(
      {
        resolvesCallerIdentity: checksCaller,
        usesServiceRole: /SUPABASE_SERVICE_ROLE_KEY/.test(s),
        tenantFromRequestBody: /getTenantBonzahCredentials\(supabase,\s*body\.tenant_id\)/.test(s),
      },
      [
        "",
        "  The caller-identity story for bonzah-view-policy changed.",
        "",
        "  If you added an authorization check, this watchdog has done its job — delete",
        "  this branch and keep the assertion above.",
        "",
        "  What it was pinning (a real defect, reported and not blessed):",
        "    the function is JWT-gated only (it is absent from supabase/config.toml, so",
        "    verify_jwt defaults to true), takes tenant_id from the request body, and then",
        "    uses the SERVICE ROLE client — which bypasses RLS — to read that tenant's",
        "    Bonzah credentials and query their policy. Any authenticated user of any",
        "    tenant, including a booking-side customer, can name someone else's tenant_id.",
        "",
      ].join("\n"),
    ).toEqual({
      resolvesCallerIdentity: false,
      usesServiceRole: true,
      tenantFromRequestBody: true,
    });
  });
});

// ===========================================================================
// LAYER 2 — live. Read-only, and gated anyway.
//
// The gate is not about writes here: bonzah-view-policy picks its Bonzah host
// from `tenants.bonzah_mode`, a per-tenant column this process cannot read, so
// a live-mode fixture tenant sends this at production insurance. Only a human
// declaration can narrow that, which is what D247_LIVE_BONZAH_MODE=test is.
// ===========================================================================
describe("bonzah/view-policy — live (Layer 2)", () => {
  it("live: reads the fixture policy back from Bonzah", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const tenantId = fixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    const policyId = fixtureOrNull("D247_LIVE_BONZAH_POLICY_ID");
    if (!tenantId || !policyId) {
      ctx.skip(
        "D247_LIVE_BONZAH_TENANT_ID / D247_LIVE_BONZAH_POLICY_ID are not both set. The " +
          "policy id is Bonzah's own (bonzah_insurance_policies.policy_id), not our row id. " +
          "Fixtures are never inferred.",
      );
      return;
    }

    const res = await liveCall(FN, { tenant_id: tenantId, policy_id: policyId });
    expect(
      res.status,
      `${FN} did not return 200.\n` +
        "  A 500 whose message starts 'Bonzah API error:' is FAILURE MODE (b) AT THE\n" +
        "  INTEGRATION, not in this repo: Insillion refused the policy id or the stored\n" +
        "  credentials. A 500 with any other message is ours.\n" +
        classifyLive(res).explain,
    ).toBe(200);
    expect(
      res.json?.policy,
      `A 200 with no \`policy\` key: ${res.text.slice(0, 300)}\n` +
        "  That is the shape Insillion returns when status is 0 but data is empty, and it " +
        "means the status check let an empty answer through.",
    ).toBeTruthy();
  });

  it("live: a missing policy_id is refused before Bonzah is contacted", async (ctx) => {
    const gate = bonzahServicingGate();
    if (!gate.allowed) {
      ctx.skip(gate.reason);
      return;
    }
    const tenantId = fixtureOrNull("D247_LIVE_BONZAH_TENANT_ID");
    if (!tenantId) {
      ctx.skip("D247_LIVE_BONZAH_TENANT_ID is not set. Fixtures are never inferred.");
      return;
    }
    const res = await liveCall(FN, { tenant_id: tenantId });
    expect(
      res.status,
      "Expected 400 from the missing-id guard.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  Anything else means the guard ran after the Bonzah call, or not at all — and " +
        `the call would have gone to ${BONZAH_LIVE_HOST} for a live-mode tenant.\n` +
        classifyLive(res).explain,
    ).toBe(400);
    expect(String(res.json?.error ?? res.text)).toMatch(/Missing tenant_id or policy_id/);
  });
});
