// ============================================================================
// e2e-runner — the Developer tab's LIVE end-to-end runner (Wave 4, tier 2)
// ============================================================================
// docs/E2E_TESTING.md · catalogue: tests/e2e/scenarios (mirrored into
// ./catalogue by `node tests/e2e/sync-catalogue.mjs`) · evidence tables:
// supabase/migrations/20260926120300_dev_sim_runs.sql
//
// NOT DEPLOYED, NOT RUN. Deploying it is a separate, explicit approval, and even
// deployed it does nothing until E2E_RUNNER_ENABLED=northwind is set (G0).
//
// WHAT IT DOES. For one catalogue scenario: creates a flagged fixture rental on
// northwind (a fixture customer, Stripe TEST objects minted by
// sandbox-fixture-setup, the booking's charges), then executes the scenario's
// steps — the SAME edge functions the portal calls, with the caller's own
// session (charge-saved-card, process-refund, create-extension-checkout,
// payment-plan-manage); time moved by backdating ONLY that fixture's driving
// columns (e2e_shift_fixture, sim_shift's contract); cron work done by the
// sandbox-* clones with only_rental_id = the fixture, or by the plan engine
// in-process scoped to the fixture's plan — NEVER a real cron. After each
// check it reads every row that hangs off the fixture, compares with the
// catalogue's hand-derived values, and records the step, the rows and every
// assertion in dev_sim_run_steps. A person pays checkout links in a browser
// with a Stripe test card; the run waits for them.
//
// sim-control stays exactly as it is: staging-only (403 on any other project).
// This function is its production counterpart for ONE tenant, with its own,
// stricter guard set:
//
//   G0  KILL SWITCH     E2E_RUNNER_ENABLED must equal "northwind", or 503.
//                       Prevents: a deploy (or a mis-deploy) doing anything.
//   G1  CALLER          a signed-in, active super admin, or the head_admin of
//                       the northwind tenant resolved BY SLUG. Prevents: any
//                       other operator — or any other tenant's head admin —
//                       creating rows or moving Stripe TEST money.
//   G2  TENANT          slug = 'northwind', status active, stripe_mode 'test',
//                       payment_provider stripe — re-read on every request, and
//                       again in SQL (e2e_fixture_guard) on every write.
//                       Prevents: running against a live-mode tenant, or a
//                       tenant with real customers.
//   G3  ENVIRONMENT     the Stripe key the runner would use starts sk_test_ /
//                       rk_test_ (the mode is the literal "test", never the
//                       tenant's column), and SANDBOX_TEST_TENANT_ID is
//                       northwind's id. Prevents: live Stripe keys, and sandbox
//                       clones locked to a different tenant.
//   G4  SCENARIO        the scenario is live-tier, not liveBlockedBy, starts on
//                       the visa card, uses allow-listed test cards and sandbox
//                       jobs only, amounts ≤ $1,000, advances 1–60 days; its
//                       tenant assumptions (tax off, grace 48 h, …) hold.
//                       Prevents: comparing against numbers the tenant's
//                       settings would change, and any unlisted action.
//   G5  FIXTURE         every rental write is to THE run's registered fixture:
//                       a dev_sim_fixtures row (only e2e_register_fixture can
//                       write one — brand-new, marked, money-free rentals on
//                       an 'E2E-FIXTURE' customer at @e2e.drive247.test with
//                       no phone) + creation_context.e2e_fixture = true for
//                       this run. Checked in TS (checkFixture) and in SQL.
//                       Prevents: touching any real rental, and any mail or
//                       SMS reaching a real person.
//   G6  ONLY_RENTAL_ID  every sandbox call carries only_rental_id = the fixture
//                       (checkSandboxCall), and its preview:true answer must
//                       match nothing but the fixture before the real call
//                       (checkBlastRadius). Prevents: a sandbox run widening to
//                       other rentals.
//   G7  PREVIEW         action "preview" is handed a ReadOnlyDb whose writes
//                       throw, and inserts no run row. Prevents: a dry run
//                       leaving anything behind.
//   G8  PARKED + QUIET  at rest a fixture is PARKED — auto_extend_enabled false
//                       / payg_paused true / installment plan 'pending' — so no
//                       real cron (jobs 6, 4, 32, 33, 54, 55) ever selects it;
//                       it is un-parked only for the seconds of one sandbox
//                       call, and only outside [−20 s, +90 s] of each matching
//                       real job's schedule. Plan fixtures are made due and
//                       ticked in the same request. Prevents: the real cron
//                       charging a fixture, and results that depend on timing.
//   G9  SHIFT           time moves only through e2e_shift_fixture: the run's
//                       fixture, a closed domain → column allow-list, ≤ 60
//                       days, whole days for date columns, zero rows = error.
//                       Prevents: backdating anything but the fixture.
//   G10 REPLAY          a webhook is re-delivered only if it is TEST-mode,
//                       checkout.session.completed, for the fixture's own
//                       session and rental. Prevents: replaying anyone's money.
//   G11 LEASE           one request per run at a time (e2e_lease_run).
//                       Prevents: two browser tabs interleaving steps.
//   G12 CONFIRM         a run must carry the confirm sentence the Developer
//                       tab shows ("This writes test rows to northwind in
//                       Stripe TEST mode") and the preview_id of a preview of
//                       THAT scenario, on THIS tenant, under 15 minutes old —
//                       an HMAC the runner can check without having stored
//                       anything. Prevents: a run nobody previewed and confirmed.
//
// CONTRACT: apps/portal/src/components/dev/e2e-runner-contract.ts (the page
// that drives this function). ids are accepted snake_case or camelCase.
//   GET                                       who and what it would run (no writes):
//        { ok, runner: { version, tenant_slug, stripe_mode, guards }, catalogue,
//          environment, quiet }                (POST { action: "list" } is the same)
//   POST { action: "preview", scenario_ids }  ZERO writes: guards, assumptions and,
//        per scenario, what a run would write / charge / fire; preview_id only
//        when every scenario could start
//   POST { action: "run", scenario_id, preview_id, run_id, confirm }
//        create the run (run_id may be minted by the page) + fixture, run steps
//   POST { action: "advance", run_id }        run more steps (409 = busy)
//   POST { action: "continue", run_id }       a person has paid the link; resume
//   POST { action: "abort", run_id }          stop the run; park the fixture
//   POST { action: "close", run_id }          finished run: fixture Closed, engines off
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { TENANT_STRIPE_COLUMNS, getChargePlatformAccount } from "../_shared/stripe-client.ts";
import { CRON_MANIFEST } from "../sim-control/manifests.ts";
import { CATALOGUE, findScenario } from "./catalogue/index.ts";
import {
  checkAssumptions,
  checkCaller,
  checkConfirm,
  checkKillSwitch,
  checkSandboxTenant,
  checkScenarioRunnable,
  checkStripeTestKey,
  checkTenant,
  E2E_TENANT_SLUG,
  PREVIEW_TTL_MS,
  QUIET_FOR,
  quietWindow,
  ReadOnlyDb,
  signPreview,
  UUID_RE,
  verifyPreview,
  type CallerRow,
  type TenantRow,
  type Verdict,
} from "./guards.ts";
import { planScenario } from "./preview-plan.ts";
import { closeFixture, parkFixture, runSteps, type RunEnv, type RunOutcome, type RunRow } from "./runner.ts";

export const RUNNER_VERSION = "e2e-runner/1 (Wave 4, Sep 26 2026)";

/** What the runner enforces, in its own words — the page shows these. */
export const GUARD_SUMMARY = [
  "G0 does nothing until E2E_RUNNER_ENABLED=northwind is set",
  "G1 caller: a super admin, or the head_admin of northwind (by slug)",
  "G2 tenant: northwind, active, Stripe TEST mode — re-read every request and again in SQL",
  "G3 environment: a Stripe TEST key only; the sandbox clones locked to northwind",
  "G4 scenario: live tier, not blocked, allow-listed cards and jobs, bounded amounts; its tenant assumptions hold",
  "G5 fixture rentals only: registered, marked, on an unreachable E2E-FIXTURE customer — checked in TS and SQL",
  "G6 every sandbox call carries only_rental_id = the fixture; its preview must match nothing else",
  "G7 preview writes nothing (a read-only client, no run row)",
  "G8 fixtures are parked from every real cron; un-parked only for one sandbox call, outside each real job's run window",
  "G9 time moves only through e2e_shift_fixture: the fixture's columns, ≤ 60 days",
  "G10 a webhook is replayed only for the fixture's own TEST session",
  "G11 one request per run (lease)",
  "G12 a run needs the confirm sentence and a fresh preview of that scenario",
];

const TENANT_COLUMNS =
  `id, slug, status, stripe_mode, payment_provider, currency_code, timezone, tax_enabled, tax_percentage, service_fee_enabled, service_fee_value, ` +
  `auto_extend_grace_hours, auto_extend_max_retries, payg_accrual_window_seconds, payg_auto_reminders_enabled, ${TENANT_STRIPE_COLUMNS}`;

/** Steps start only while this much of the request remains (Supabase stops a function at ~150–400 s). */
const BUDGET_MS = 100_000;
const LEASE_SECONDS = 180;

// deno-lint-ignore no-explicit-any
type Db = any;

const refusal = (v: Verdict) => (v.ok ? null : jsonResponse({ ok: false, code: v.code, error: v.message }, v.status));

/** snake_case or camelCase, as the contract allows. */
const field = (body: Record<string, unknown>, snake: string, camel: string): unknown => (snake in body ? body[snake] : body[camel]);

async function resolveCaller(req: Request, db: Db): Promise<{ caller: CallerRow | null; token: string }> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!token || !url || !anon) return { caller: null, token };
  let userId: string | null = null;
  try {
    // An anon or service key carries no `sub`, so it never resolves to a user.
    const { data, error } = await createClient(url, anon).auth.getUser(token);
    if (!error) userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return { caller: null, token };
  const { data, error } = await db.from("app_users").select("id, role, tenant_id, is_super_admin, is_active").eq("auth_user_id", userId).maybeSingle();
  if (error) throw new Error(`app_users lookup failed: ${error.message}`);
  return { caller: (data as CallerRow | null) ?? null, token };
}

/** G3, as a report: what would refuse a run. */
function environmentReport(tenant: TenantRow & Record<string, unknown>): { stripeTestKey: Verdict; sandboxTenant: Verdict } {
  // deno-lint-ignore no-explicit-any
  const platform = getChargePlatformAccount(tenant as any);
  return {
    stripeTestKey: checkStripeTestKey(Deno.env.get(platform === "uae" ? "STRIPE_UAE_TEST_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY")),
    sandboxTenant: checkSandboxTenant(Deno.env.get("SANDBOX_TEST_TENANT_ID"), tenant.id),
  };
}

/** When each sandbox job could fire right now without waiting (G8), for the page. */
function quietReport(): Record<string, { ok: boolean; waitSeconds: number }> {
  const out: Record<string, { ok: boolean; waitSeconds: number }> = {};
  for (const [job, names] of Object.entries(QUIET_FOR)) {
    const schedules = names.map((n) => CRON_MANIFEST[n]?.schedule).filter((s): s is string => !!s);
    out[job] = quietWindow(new Date(), schedules);
  }
  return out;
}

async function loadRun(db: Db, runId: string, tenantId: string): Promise<RunRow | null> {
  const { data, error } = await db.from("dev_sim_runs").select("*").eq("id", runId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`dev_sim_runs read failed: ${error.message}`);
  return (data as RunRow | null) ?? null;
}

/** A run's outcome in the contract's words. A run that ERRORED is still ok:true — the call worked. */
function outcomeReply(o: RunOutcome) {
  return {
    ok: true,
    run_id: o.runId,
    status: o.status,
    next_step: o.nextStep,
    waiting_for: o.waitingFor,
    pass_count: o.passCount,
    fail_count: o.failCount,
    ...(o.deferredSeconds ? { deferred_seconds: o.deferredSeconds } : {}),
    ...(o.error ? { run_error: o.error } : {}),
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // G0 — nothing happens until someone deliberately switches it on.
  const off = refusal(checkKillSwitch(Deno.env.get("E2E_RUNNER_ENABLED")));
  if (off) return off;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Untyped on purpose: the column lists are built strings, which the typed
  // client cannot parse (the same reason every other function here uses `any`).
  const db: Db = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }
  } else if (req.method !== "GET") {
    return jsonResponse({ ok: false, code: "method", error: "GET or POST only" }, 405);
  }
  const action = req.method === "GET" ? "list" : String(body.action ?? "");

  try {
    // G1 — who. G2 — which tenant (by slug, re-read every request).
    const { caller, token } = await resolveCaller(req, db);
    const { data: tenant, error: tErr } = await db.from("tenants").select(TENANT_COLUMNS).eq("slug", E2E_TENANT_SLUG).maybeSingle();
    if (tErr) throw new Error(`tenant lookup failed: ${tErr.message}`);
    const who = refusal(checkCaller(caller, tenant?.id ?? null));
    if (who) return who;
    const where = refusal(checkTenant(tenant as TenantRow | null));
    if (where) return where;
    const t = tenant as TenantRow & Record<string, unknown>;

    if (action === "list") {
      return jsonResponse({
        ok: true,
        runner: { version: RUNNER_VERSION, tenant_slug: t.slug, stripe_mode: t.stripe_mode, guards: GUARD_SUMMARY },
        catalogue: CATALOGUE,
        environment: environmentReport(t),
        quiet: quietReport(),
      });
    }

    if (action === "preview") {
      // G7 — the preview path only ever holds a client whose writes throw.
      const ro = new ReadOnlyDb(db);
      const rawIds = field(body, "scenario_ids", "scenarioIds");
      const ids = (Array.isArray(rawIds) ? rawIds : [field(body, "scenario_id", "scenarioId")]).map((x) => String(x ?? "")).filter(Boolean);
      if (ids.length === 0) return jsonResponse({ ok: false, code: "scenario_ids", error: "scenario_ids is required" }, 400);
      const { data: fresh, error } = await ro.from("tenants").select(TENANT_COLUMNS).eq("id", t.id).maybeSingle();
      if (error) throw new Error(`tenant re-read failed: ${error.message}`);
      const env = environmentReport(t);
      const problems: string[] = [];
      if (!env.stripeTestKey.ok) problems.push(env.stripeTestKey.message);
      if (!env.sandboxTenant.ok) problems.push(env.sandboxTenant.message);
      const scenarios = ids.map((id) => {
        const scenario = findScenario(id);
        const runnable = checkScenarioRunnable(scenario);
        const assumptions = scenario ? checkAssumptions(scenario.assumes, fresh as TenantRow) : null;
        if (!runnable.ok) problems.push(`${id}: ${runnable.message}`);
        else if (assumptions && !assumptions.ok) problems.push(`${id}: northwind's settings differ from the ones its expected values assume (${assumptions.failed.map((f) => f.assumption).join(", ")})`);
        const plan = scenario && runnable.ok ? planScenario(scenario) : { scenario_id: id, writes: [], stripe: [], crons: [] };
        return { ...plan, runnable, assumptions };
      });
      const expiresAt = Date.now() + PREVIEW_TTL_MS;
      const previewId = problems.length === 0 ? await signPreview(serviceKey, t.id, ids, expiresAt) : null;
      return jsonResponse({
        ok: true,
        preview: {
          preview_id: previewId,
          tenant_slug: t.slug,
          stripe_mode: t.stripe_mode,
          expires_at: previewId ? new Date(expiresAt).toISOString() : null,
          scenarios,
        },
        problems,
        writes: ro.writes,
        environment: env,
        quiet: quietReport(),
      });
    }

    if (action === "run" || action === "start") {
      // G12 — the confirm sentence and a fresh preview of THIS scenario.
      const confirm = refusal(checkConfirm(body.confirm));
      if (confirm) return confirm;
      const scenarioId = String(field(body, "scenario_id", "scenarioId") ?? "");
      const scenario = findScenario(scenarioId);
      const runnable = refusal(checkScenarioRunnable(scenario));
      if (runnable) return runnable;
      const previewed = refusal(await verifyPreview(serviceKey, t.id, field(body, "preview_id", "previewId"), scenarioId, Date.now()));
      if (previewed) return previewed;
      const env3 = environmentReport(t);
      const k = refusal(env3.stripeTestKey) ?? refusal(env3.sandboxTenant);
      if (k) return k;
      const assumptions = checkAssumptions(scenario!.assumes, t);
      if (!assumptions.ok) {
        return jsonResponse({ ok: false, code: "assumptions", error: "northwind's settings differ from the ones the expected values were derived under; nothing was written.", failed: assumptions.failed }, 412);
      }
      const askedId = field(body, "run_id", "runId");
      if (askedId != null && (typeof askedId !== "string" || !UUID_RE.test(askedId))) return jsonResponse({ ok: false, code: "run_id", error: "run_id must be a UUID" }, 400);
      const leaseToken = crypto.randomUUID();
      const { data: created, error: cErr } = await db
        .from("dev_sim_runs")
        .insert({
          ...(askedId ? { id: askedId } : {}),
          tenant_id: t.id,
          scenario_id: scenario!.id,
          scenario,
          status: "running",
          created_by: caller!.id,
          lease_token: leaseToken,
          lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
        })
        .select("*")
        .single();
      if (cErr && String(cErr.code) === "23505") return jsonResponse({ ok: false, code: "run_exists", error: "A run with that id already exists." }, 409);
      if (cErr || !created) throw new Error(`could not create the run: ${cErr?.message ?? "no row"}`);
      const env: RunEnv = { db, supabaseUrl, serviceKey, callerJwt: token, tenant: t, leaseToken, deadline: Date.now() + BUDGET_MS };
      return jsonResponse(outcomeReply(await runSteps(env, created as RunRow)));
    }

    if (action === "advance" || action === "continue" || action === "abort" || action === "close") {
      const runId = String(field(body, "run_id", "runId") ?? "");
      if (!UUID_RE.test(runId)) return jsonResponse({ ok: false, code: "run_id", error: "run_id is required" }, 400);
      const run = await loadRun(db, runId, t.id);
      if (!run) return jsonResponse({ ok: false, code: "no_run", error: "No such run on northwind." }, 404);

      if (action === "close") {
        if (!["passed", "failed", "errored", "aborted"].includes(run.status)) return jsonResponse({ ok: false, code: "not_finished", error: "Finish or abort the run first." }, 409);
        const env: RunEnv = { db, supabaseUrl, serviceKey, callerJwt: token, tenant: t, leaseToken: "", deadline: Date.now() + BUDGET_MS };
        await closeFixture(env, run);
        return jsonResponse({ ok: true, run_id: runId, status: run.status, closed: true });
      }
      if (action === "continue" && run.status !== "waiting") return jsonResponse({ ok: false, code: "not_waiting", error: "This run is not waiting for a person." }, 409);
      if (action === "advance" && run.status !== "running") return jsonResponse({ ok: false, code: "not_running", error: `This run is ${run.status}.` }, 409);

      // G11 — one request per run.
      const leaseToken = crypto.randomUUID();
      const { data: leased, error: lErr } = await db.rpc("e2e_lease_run", { p_run_id: runId, p_token: leaseToken, p_seconds: LEASE_SECONDS });
      if (lErr) throw new Error(`lease failed: ${lErr.message}`);
      if (leased !== true) return jsonResponse({ ok: false, code: "busy", error: "This run is busy in another request, or already finished." }, 409);

      // G2 + G5 in SQL, before anything else happens on this run.
      const { error: gErr } = await db.rpc("e2e_fixture_guard", { p_run_id: runId });
      const fixtureExists = !!(run.fixture as { rentalId?: string })?.rentalId;
      if (gErr && fixtureExists) {
        await db.from("dev_sim_runs").update({ lease_token: null, lease_until: null }).eq("id", runId).eq("lease_token", leaseToken);
        return jsonResponse({ ok: false, code: "fixture_guard", error: gErr.message }, 403);
      }

      const env: RunEnv = { db, supabaseUrl, serviceKey, callerJwt: token, tenant: t, leaseToken, deadline: Date.now() + BUDGET_MS };
      if (action === "abort") {
        await parkFixture(env, run);
        const { error } = await db
          .from("dev_sim_runs")
          .update({ status: "aborted", finished_at: new Date().toISOString(), waiting_for: null, lease_token: null, lease_until: null })
          .eq("id", runId)
          .eq("lease_token", leaseToken);
        if (error) throw new Error(`abort failed: ${error.message}`);
        return jsonResponse({ ok: true, run_id: runId, status: "aborted" });
      }
      return jsonResponse(outcomeReply(await runSteps(env, run, { humanDone: action === "continue" })));
    }

    return jsonResponse({ ok: false, code: "action", error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[e2e-runner]", e);
    return jsonResponse({ ok: false, code: "error", error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
