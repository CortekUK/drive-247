// =============================================================================
// integrations/bonzah — bonzah-partner-review.
//
// The most privileged function in the Bonzah surface. A Bonzah PARTNER — a
// reviewer in Bonzah's own console (apps/bonzah), not a Drive247 operator and
// not a super admin — approves an operator's onboarding submission, and one
// approve does all of this to a tenant that is not the caller's:
//
//     tenants.bonzah_mode      -> 'live'
//     tenants.bonzah_username  -> what the reviewer typed
//     tenants.bonzah_password  -> what the reviewer typed
//     tenants.integration_bonzah -> true          (this is the SELL switch:
//                                   getBonzahSellability reads it)
//
// After that the operator is selling real insurance on those credentials. So
// what this file pins is, in order of what it costs to get wrong:
//
//   1. the PARTNER GATE, and that it sits above every write
//   2. the tenant being taken from the SUBMISSION, never from the request body
//   3. the deliberate flip to live mode BEFORE verification — which looks
//      backwards and is not: bonzah-verify-credentials SHORT-CIRCUITS in test
//      mode and returns `valid: true` without asking Bonzah anything, so
//      verifying first would rubber-stamp whatever was typed
//   4. the rollback paths that undo (3) when verification says no
//
// And one thing it does NOT do, tracked as a watchdog: nothing restores the
// mode if the verification call THROWS. The portal's own integrations panel
// already carries the note — "bonzah-partner-review is non-atomic between its
// two updates" — so this is a known shape, written down in a comment and
// nowhere else until now.
//
// LAYER 2: only the two refusals. Every happy path here is a write to another
// operator's tenant row, and there is no rung in this suite at which that is a
// test.
// =============================================================================

import { describe, expect, it } from "vitest";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import { assertLooseContract, fixtureOrNull, readLooseBodyShape, readRepoFile, srcOf } from "./servicing";

const FN = "bonzah-partner-review";
const src = () => srcOf(FN);

const CONSOLE_UI = "apps/bonzah/components/console/BonzahQueue.tsx";
const PORTAL_PANEL = "apps/portal/src/app/(dashboard)/integrations/_panels/bonzah.tsx";

describe("bonzah/partner-review — contract", () => {
  it("agrees with the payloads Bonzah's console builds", () => {
    // One function, two shapes: the approve dialog sends credentials, the reject
    // dialog sends a reason. Both keys stay in the contract — the console is
    // what decides per review which branch it is calling, and excusing a field
    // a caller demonstrably sends is the stale excuse tests/README.md §9 warns
    // about.
    const shape = assertLooseContract({
      fn: FN,
      builtIn: CONSOLE_UI,
      payload: {
        submissionId: "00000000-0000-0000-0000-000000000000",
        action: "approve",
        username: "operator@example.invalid",
        password: "not-a-real-password",
        message: "Welcome aboard",
        reason: "Please re-upload the W-9",
      },
    });
    expect(shape.fields).toEqual([
      "action",
      "message",
      "password",
      "reason",
      "submissionId",
      "username",
    ]);
  });

  it("takes NO tenant id off the request — the submission decides the tenant", () => {
    // The single most dangerous field this endpoint could grow. Everything it
    // writes is scoped by `submission.tenant_id`; a caller-supplied tenant id
    // would let a partner point an approval — credentials, live mode, the sell
    // switch — at any operator in the database.
    const shape = readLooseBodyShape(FN);
    for (const forbidden of ["tenant_id", "tenantId"]) {
      expect(
        shape.fields,
        `${FN} now reads \`${forbidden}\` off the request body. The tenant must come from ` +
          "the submission row that was looked up, or an approval can be aimed anywhere.",
      ).not.toContain(forbidden);
    }
    expect(
      src(),
      "The tenant is no longer derived from the submission row.",
    ).toMatch(/const tenantId = submission\.tenant_id/);
  });

  it("is invoked by the Bonzah console for both actions", () => {
    const ui = readRepoFile(CONSOLE_UI);
    expect(ui, `${CONSOLE_UI} no longer invokes ${FN}.`).toContain("bonzah-partner-review");
    expect(
      ui,
      "The approve call no longer sends action: 'approve' with a username and password. " +
        "The function 400s without them, after having already flipped the tenant to live mode.",
    ).toMatch(/action:\s*'approve'[\s\S]{0,200}username:/);
    expect(
      ui,
      "The reject call no longer sends action: 'reject' with a reason.",
    ).toMatch(/action:\s*'reject',\s*reason:/);
  });
});

describe("bonzah/partner-review — the partner gate", () => {
  it("refuses an unauthenticated caller, and an unresolvable one, with 401", () => {
    const s = src();
    expect(s, "The missing-Authorization 401 is gone.").toMatch(/Missing authorization header",\s*401/);
    expect(s, "The unresolvable-user 401 is gone.").toMatch(/Unauthorized",\s*401/);
  });

  it("checks is_bonzah_partner ABOVE every write and above the body", () => {
    // The whole authorization model. Below any write, a logged-in stranger
    // activates live insurance on someone else's tenant; below the body parse it
    // is merely wrong-looking, which is how it gets moved by accident.
    const s = src();
    const gateAt = s.indexOf("appUser.is_bonzah_partner !== true");
    const forbiddenAt = s.indexOf("Forbidden — Bonzah partner access required");
    const bodyAt = s.indexOf("await req.json()");
    const firstUpdateAt = s.indexOf(".update(");
    const firstInsertAt = s.indexOf(".insert(");
    const verifyAt = s.indexOf('"bonzah-verify-credentials"');

    expect(gateAt, "The is_bonzah_partner check is gone.").toBeGreaterThan(-1);
    expect(forbiddenAt, "The 403 refusal is gone.").toBeGreaterThan(-1);
    expect(firstUpdateAt, `${FN} no longer updates anything — read what changed.`).toBeGreaterThan(-1);
    expect(
      gateAt < bodyAt && gateAt < firstUpdateAt && gateAt < firstInsertAt && gateAt < verifyAt,
      [
        "",
        "  THE PARTNER GATE MOVED BELOW SOMETHING IT GUARDS.",
        `    gate@${gateAt}  body@${bodyAt}  first update@${firstUpdateAt}  ` +
          `first insert@${firstInsertAt}  verify@${verifyAt}`,
        "",
        "  Every caller of this function is authenticated — that is all verify_jwt buys.",
        "  is_bonzah_partner is the only thing separating a signed-in stranger from writing",
        "  live Bonzah credentials and integration_bonzah = true onto another operator's",
        "  tenant. A gate that runs after the write is a log line.",
        "",
      ].join("\n"),
    ).toBe(true);
    expect(s, "The refusal is no longer a 403.").toMatch(/Bonzah partner access required",\s*403/);
  });

  it("validates the action against a closed list", () => {
    // `action` decides which of two mutating branches runs. Anything that is not
    // exactly 'reject' falls through to APPROVE, so an open-ended action is an
    // approval by typo.
    expect(
      src(),
      'The action allow-list is gone. The approve branch is the fall-through — everything ' +
        "that is not 'reject' activates the tenant — so an unvalidated action means a " +
        "misspelled one activates.",
    ).toMatch(/\["approve",\s*"reject"\]\.includes\(action\)/);
  });

  it("404s an unknown submission before it writes", () => {
    const s = src();
    const lookupAt = s.indexOf('.from("bonzah_onboarding_submissions")');
    const notFoundAt = s.indexOf('errorResponse("Submission not found", 404)');
    const updateAt = s.indexOf(".update(");
    expect(notFoundAt, "The submission-not-found 404 is gone.").toBeGreaterThan(-1);
    expect(lookupAt, "The submission lookup is gone.").toBeGreaterThan(-1);
    expect(
      notFoundAt < updateAt,
      "The 404 moved below the first write. `submission.tenant_id` would then be read off " +
        "null and every write below it would be aimed at undefined.",
    ).toBe(true);
  });
});

describe("bonzah/partner-review — reject", () => {
  it("requires a reason, before it writes the rejection", () => {
    // The reason is the whole point of a rejection: it is what the operator is
    // shown and what the "what to update" email carries. A blank one sends them
    // back to a form with no idea what was wrong.
    const s = src();
    const guardAt = s.indexOf('errorResponse("A reason is required to send back", 400)');
    const updateAt = s.indexOf('status: "rejected"');
    expect(guardAt, "The empty-reason guard is gone.").toBeGreaterThan(-1);
    expect(updateAt, "The rejection write is gone.").toBeGreaterThan(-1);
    expect(guardAt < updateAt, "The empty-reason guard moved below the rejection write.").toBe(true);
    expect(
      s,
      "The reason is no longer trimmed. A whitespace-only reason would pass the guard and " +
        "reach the operator as an empty explanation.",
    ).toMatch(/const reason = \(body\.reason \|\| ""\)\.trim\(\)/);
  });

  it("records who reviewed it, and leaves an event and a notification", () => {
    const s = src();
    const rejectAt = s.indexOf('status: "rejected"');
    // The reject branch, bounded by the first line of the approve branch below it.
    const approveAt = s.indexOf('const username = (body.username');
    expect(approveAt, "The approve branch anchor moved.").toBeGreaterThan(rejectAt);
    const tail = s.slice(rejectAt, approveAt);
    for (const field of ["reviewed_by", "reviewed_at", "reject_reason"]) {
      expect(tail, `The rejection no longer records \`${field}\`.`).toContain(field);
    }
    expect(tail, "The rejected event is gone from the audit trail.").toMatch(/event_type:\s*"rejected"/);
    expect(tail, "The operator is no longer notified of a rejection.").toMatch(
      /\.from\("notifications"\)\.insert/,
    );
  });
});

describe("bonzah/partner-review — approve, and the order that makes it real", () => {
  it("demands credentials before it touches the tenant row", () => {
    const s = src();
    const guardAt = s.indexOf('errorResponse("username and password are required to activate", 400)');
    const flipAt = s.indexOf('update({ bonzah_mode: "live" })');
    expect(guardAt, "The missing-credentials guard is gone from the approve path.").toBeGreaterThan(-1);
    expect(flipAt, "The flip to live mode is gone.").toBeGreaterThan(-1);
    expect(
      guardAt < flipAt,
      `The credentials guard moved below the mode flip (guard@${guardAt}, flip@${flipAt}). ` +
        "The tenant would be switched to live mode and then refused, leaving them live with " +
        "no credentials — every Bonzah call for that operator throws until someone notices.",
    ).toBe(true);
    expect(
      s,
      "The credentials are no longer trimmed before use. A pasted leading space is stored " +
        "verbatim and fails every live Bonzah auth afterwards, with an error that reads " +
        "like a wrong password.",
    ).toMatch(/const username = \(body\.username \|\| ""\)\.trim\(\)/);
  });

  it("flips to LIVE mode BEFORE verifying — which is the only way the check is real", () => {
    // This ordering looks like a bug and is the opposite. bonzah-verify-credentials
    // reads tenants.bonzah_mode and, in TEST mode, returns
    // `{ valid: true, platform: true }` having contacted Bonzah not at all.
    // Verify first and every approval is a rubber stamp: whatever the reviewer
    // typed is declared valid and then written as the operator's live login.
    const s = src();
    const captureAt = s.indexOf("const previousMode =");
    const flipAt = s.indexOf('update({ bonzah_mode: "live" })');
    const verifyAt = s.indexOf('"bonzah-verify-credentials"');
    const persistAt = s.indexOf("bonzah_username: username");

    expect(captureAt, "previousMode is no longer captured — nothing to roll back to.").toBeGreaterThan(-1);
    expect(verifyAt, "The credential verification call is gone from the approve path.").toBeGreaterThan(-1);
    expect(persistAt, "The credentials are no longer persisted.").toBeGreaterThan(-1);
    expect(
      captureAt < flipAt && flipAt < verifyAt,
      [
        "",
        "  THE MODE FLIP AND THE VERIFICATION SWAPPED PLACES.",
        `    capture previousMode@${captureAt}  flip to live@${flipAt}  verify@${verifyAt}`,
        "",
        "  Verification MUST happen while the tenant is in live mode.",
        "  bonzah-verify-credentials short-circuits in test mode and answers",
        "  { valid: true, platform: true } without asking Bonzah anything — so a verify",
        "  that runs before the flip approves any string a reviewer types, and that string",
        "  becomes the operator's live insurance login.",
        "",
        "  And previousMode has to be captured before the flip, or the rollback below has",
        "  nothing to roll back to.",
        "",
      ].join("\n"),
    ).toBe(true);
    expect(
      verifyAt < persistAt,
      "The credentials are now written before they are verified. A wrong password would be " +
        "stored and only discovered on the next real policy.",
    ).toBe(true);
  });

  it("does not trust the HTTP status alone — it reads `valid`", () => {
    // bonzah-verify-credentials answers HTTP 200 with { valid: false } when
    // Bonzah rejects a login. `verifyRes.ok` alone is true for that response.
    expect(
      /!verifyRes\.ok \|\| verifyJson\?\.valid !== true/.test(src()),
      "The approve path stopped checking `valid`. bonzah-verify-credentials returns HTTP " +
        "200 with { valid: false } for a rejected login, so an ok-only check activates the " +
        "tenant on a password Bonzah has already refused.",
    ).toBe(true);
  });

  it("rolls the mode back on a rejected verification and on a failed write", () => {
    const s = src();
    const rollbacks = [...s.matchAll(/update\(\{ bonzah_mode: previousMode \}\)/g)];
    expect(
      rollbacks.length,
      `Expected two rollbacks to previousMode (one when verification says no, one when the ` +
        `credential write fails); found ${rollbacks.length}. Losing either leaves the tenant ` +
        "in live mode with no working credentials, which breaks every Bonzah call they make " +
        "— including servicing policies they have already sold.",
    ).toBe(2);
    expect(
      s,
      "The rejected verification no longer answers 400 with Bonzah's own message. The " +
        "reviewer needs to know whether the login was refused or the platform failed.",
    ).toMatch(/verifyJson\?\.error \|\| "Bonzah credentials could not be verified"/);
  });

  it("turns the SELL switch on only after a successful verification", () => {
    const s = src();
    const verifyAt = s.indexOf('"bonzah-verify-credentials"');
    const sellAt = s.indexOf("integration_bonzah: true");
    expect(sellAt, "integration_bonzah is no longer set on approval — activation does nothing.").toBeGreaterThan(-1);
    expect(
      verifyAt < sellAt,
      "integration_bonzah is being set before verification. That flag is what " +
        "getBonzahSellability reads: flipping it on unverified credentials means the " +
        "operator's next customer is sold a policy that cannot be issued.",
    ).toBe(true);
  });

  it("leaves both audit events and does not let a failed email undo an activation", () => {
    const s = src();
    expect(s, "The `approved` event is gone from the audit trail.").toMatch(/event_type:\s*"approved"/);
    expect(
      s,
      "The `activated` system event is gone. It is the only record that the tenant was " +
        "switched to live mode, and by which review.",
    ).toMatch(/event_type:\s*"activated"/);
    // Fire-and-forget, deliberately: the credentials are already written by this
    // point, so an email outage must not turn a completed activation into a 500
    // that a reviewer retries.
    expect(
      s,
      "The activation email is no longer fire-and-forget. Awaiting it makes a Resend outage " +
        "look like a failed activation, and the retry re-runs the whole approve path.",
    ).toMatch(/invokeFn\("send-bonzah-active-email",[^)]*\)\.catch\(\(\) => \{\}\)/);
    expect(
      s,
      "The rejection email is no longer fire-and-forget.",
    ).toMatch(/invokeFn\("send-bonzah-update-email",[^)]*\)\.catch\(\(\) => \{\}\)/);
  });

  it("WATCHDOG: a thrown verification leaves the tenant stranded in live mode", () => {
    // KNOWN DEFECT, tracked rather than blessed.
    //
    // The two rollbacks above cover the answers that COME BACK. They do not
    // cover the call not coming back at all: `invokeFn` is a bare `fetch`, and a
    // network failure, a cold-start timeout or a 5xx that fails to parse throws
    // straight past both rollbacks into the handler's outer catch, which answers
    // 500 and restores nothing.
    //
    // The tenant is then `bonzah_mode = 'live'` with no live credentials, and
    // getTenantBonzahCredentials throws "Tenant does not have Bonzah credentials
    // configured" for every subsequent call — including SERVICING calls for
    // policies the operator has already sold: bonzah-confirm-payment,
    // bonzah-view-policy, bonzah-download-pdf.
    //
    // The portal already knows the shape; apps/portal's integrations panel says
    // in a comment that "bonzah-partner-review is non-atomic between its two
    // updates". This case is that comment, executable.
    //
    // The fix is a try/catch or try/finally around the verify that restores
    // previousMode. This case converts itself the moment one appears.
    const s = src();
    const flipAt = s.indexOf('update({ bonzah_mode: "live" })');
    const verifyAt = s.indexOf('"bonzah-verify-credentials"');

    // Is the verification wrapped in anything that could restore the mode?
    const between = s.slice(flipAt, verifyAt + 400);
    const guarded = /\btry\s*\{/.test(between) || /\bfinally\s*\{/.test(between);

    if (guarded) {
      // The fix landed. Assert it properly: the recovery path must restore the
      // previous mode, not merely catch.
      expect(
        s.slice(flipAt),
        "The verification is wrapped now — make sure the wrapper actually restores " +
          "previousMode rather than only logging.",
      ).toMatch(/(catch|finally)[\s\S]{0,400}bonzah_mode: previousMode/);
      return;
    }

    expect(
      {
        verificationIsWrapped: guarded,
        rollbacksOnAnswers: [...s.matchAll(/update\(\{ bonzah_mode: previousMode \}\)/g)].length,
        portalKnowsItIsNonAtomic: readRepoFile(PORTAL_PANEL).includes(
          "bonzah-partner-review is non-atomic",
        ),
      },
      [
        "",
        "  The approve path's failure handling changed.",
        "",
        "  If you WRAPPED the verification so the mode is restored when the call throws,",
        "  this watchdog has done its job — delete this branch and keep the assertion above.",
        "",
        "  What it was pinning (a real defect, reported and not blessed):",
        "    bonzah-partner-review sets tenants.bonzah_mode = 'live' and then invokes",
        "    bonzah-verify-credentials over plain fetch. Both rollbacks are on ANSWERS. A",
        "    thrown call — network, cold start, an unparseable 5xx — skips them, hits the",
        "    outer catch and returns 500 with the tenant left in live mode and no live",
        "    credentials. Every later Bonzah call for that operator throws, including",
        "    servicing calls for policies already sold. A try/finally restoring",
        "    previousMode closes it.",
        "",
      ].join("\n"),
    ).toEqual({
      verificationIsWrapped: false,
      rollbacksOnAnswers: 2,
      portalKnowsItIsNonAtomic: true,
    });
  });
});

describe("bonzah/partner-review — how the gateway sees it", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. An approve writes live Bonzah credentials, live mode and integration_bonzah = true onto an operator's tenant.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-partner-review]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-partner-review\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-partner-review has been given verify_jwt = false in supabase/config.toml.\n" +
        "  The is_bonzah_partner gate would still run — but it resolves the caller FROM THE JWT, so with no JWT required at the gateway the function's own 401 becomes the only thing between an anonymous request and that write path.",
    ).toBe(false);
  });
});

// ===========================================================================
// LAYER 2 — the two refusals only.
//
// Every happy path in this function writes to a tenant that is not ours:
// credentials, live mode, the sell switch, two events, a notification and an
// email to the operator. There is no D247_LIVE_* rung at which running that is
// a test, so neither branch is exercised live and neither ever should be. The
// 401 and the 403/400 below stop before the first write, which is exactly what
// makes them safe to run.
// ===========================================================================
describe("bonzah/partner-review — live (Layer 2)", () => {
  it("live: refuses the anon key, which is not a user", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — there would be nothing to present.");
      return;
    }
    const res = await liveCall(FN, { action: "approve" }, { token: status.target.anonKey });
    expect(
      res.status,
      "Expected 401 for a key that resolves to no user.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  Anything 2xx here means an anonymous caller reached the review logic, which " +
        "writes live insurance credentials onto an operator's tenant.\n" +
        classifyLive(res).explain,
    ).toBe(401);
  });

  it("live: refuses a signed-in non-partner before anything is written", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    const jwt = fixtureOrNull("D247_LIVE_PORTAL_JWT") ?? fixtureOrNull("D247_LIVE_SESSION_JWT");
    if (!jwt) {
      ctx.skip(
        "Neither D247_LIVE_PORTAL_JWT nor D247_LIVE_SESSION_JWT is set. A real user is " +
          "needed to reach the partner gate; the anon key only reaches the 401 above.",
      );
      return;
    }

    // No submissionId, deliberately: whichever guard answers first, nothing is
    // written. A partner gets 400 from the body check, everybody else gets 403.
    const res = await liveCall(FN, { action: "approve" }, { token: jwt });

    expect(
      [400, 403].includes(res.status),
      [
        `Expected 403 (not a Bonzah partner) or 400 (a partner, but no submissionId).`,
        `  got ${res.status}: ${res.text.slice(0, 300)}`,
        "",
        "  A 200 here is the serious one: it would mean an approval ran without a",
        "  submissionId. A 500 means the gate itself is broken.",
        classifyLive(res).explain,
      ].join("\n"),
    ).toBe(true);

    if (res.status === 403) {
      expect(String(res.json?.error ?? res.text)).toMatch(/Bonzah partner access required/);
    } else {
      expect(
        String(res.json?.error ?? res.text),
        "This JWT belongs to a Bonzah partner, so the body guard answered instead — that is " +
          "still a refusal before any write, but point D247_LIVE_PORTAL_JWT at a " +
          "non-partner user to exercise the 403 itself.",
      ).toMatch(/submissionId and a valid action/);
    }
  });
});
