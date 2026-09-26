/**
 * L1 — the E2E runner's guards and the catalogue's shape, proven offline.
 *
 * No network, no database, no Stripe. Two kinds of evidence:
 *   - BEHAVIOUR: the pure guard functions the edge function runs
 *     (supabase/functions/e2e-runner/guards.ts) are called here with the rows
 *     that must be refused — non-northwind, live Stripe, non-fixture rentals,
 *     missing only_rental_id, … — and with the one shape that must pass;
 *   - SOURCE: where a guard is a property of how index.ts / runner.ts / the
 *     migration are written (the kill switch comes first; preview holds only a
 *     read-only client; the real cron is never called; the Stripe mode is the
 *     literal "test"), the source is read and pinned.
 * And the catalogue (tests/e2e/scenarios) is checked for the brief's rules:
 * every live scenario has hand-derived expectations with their arithmetic,
 * ends in a Finances tie-out, and references S1–S19b rather than copying them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ATTACHABLE_CARDS,
  checkAmount,
  checkConfirm,
  CONFIRM_SENTENCE,
  PREVIEW_TTL_MS,
  signPreview,
  verifyPreview,
  checkAssumptions,
  checkBlastRadius,
  checkCaller,
  checkFixture,
  checkKillSwitch,
  checkReplayEvent,
  checkSandboxCall,
  checkSandboxTenant,
  checkScenarioRunnable,
  checkStripeTestKey,
  checkTenant,
  cronFireTimes,
  QUIET_FOR,
  quietWindow,
  ReadOnlyDb,
  sandboxBody,
  SANDBOX_JOBS,
  type FixtureFacts,
  type TenantRow,
} from "@fn/e2e-runner/guards.ts";
import { planScenario, REAL_JOB } from "@fn/e2e-runner/preview-plan.ts";
import { CATALOGUE, findScenario, isLiveRunnable } from "./scenarios/index.ts";
import { PAYMENT_PLAN_REFERENCES } from "./scenarios/payment-plans.ts";
import type { Check, FinanceExpectation, Money, Scenario, Step } from "./scenarios/types.ts";
import { SCENARIOS as PLAN_SCENARIOS } from "@fn/_shared/payment-plans/scenarios.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const NORTHWIND = "6e5c544f-0000-4000-8000-000000000001";
const OTHER_TENANT = "11111111-2222-4333-8444-555555555555";
const RUN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RENTAL = "12345678-1234-4234-8234-123456789012";
const CUSTOMER = "87654321-4321-4321-8321-210987654321";

const northwind = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: NORTHWIND,
  slug: "northwind",
  status: "active",
  stripe_mode: "test",
  payment_provider: "stripe",
  currency_code: "USD",
  timezone: "America/New_York",
  tax_enabled: false,
  tax_percentage: 0,
  service_fee_enabled: false,
  service_fee_value: 0,
  auto_extend_grace_hours: 48,
  auto_extend_max_retries: 3,
  payg_accrual_window_seconds: 86400,
  payg_auto_reminders_enabled: true,
  ...over,
});

const goodFixture = (over: Partial<FixtureFacts> = {}): FixtureFacts => ({
  runId: RUN,
  northwindTenantId: NORTHWIND,
  registry: { rental_id: RENTAL, run_id: RUN, tenant_id: NORTHWIND, customer_id: CUSTOMER },
  rental: { id: RENTAL, tenant_id: NORTHWIND, customer_id: CUSTOMER, creation_context: { e2e_fixture: true, run_id: RUN } },
  customer: { id: CUSTOMER, name: "E2E-FIXTURE SB1 aaaaaaaa", email: "e2e-aaaaaaaa@e2e.drive247.test", phone: null },
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
// The guards, by behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("G0 — the kill switch", () => {
  it("refuses everything until E2E_RUNNER_ENABLED=northwind", () => {
    expect(checkKillSwitch(undefined)).toMatchObject({ ok: false, status: 503, code: "runner_disabled" });
    expect(checkKillSwitch("")).toMatchObject({ ok: false, status: 503 });
    expect(checkKillSwitch("true")).toMatchObject({ ok: false, status: 503 });
    expect(checkKillSwitch("squad")).toMatchObject({ ok: false, status: 503 });
    expect(checkKillSwitch("northwind")).toEqual({ ok: true });
  });
});

describe("G1 — the caller", () => {
  const caller = (over: Record<string, unknown>) => ({ id: "u1", role: "head_admin", tenant_id: NORTHWIND, is_super_admin: false, is_active: true, ...over });

  it("lets northwind's head_admin in, found by the northwind SLUG's id", () => {
    expect(checkCaller(caller({}), NORTHWIND)).toEqual({ ok: true });
  });
  it("lets a super admin in (tenant_id NULL by design)", () => {
    expect(checkCaller(caller({ role: "admin", tenant_id: null, is_super_admin: true }), NORTHWIND)).toEqual({ ok: true });
  });
  it("refuses a head_admin of any other tenant", () => {
    expect(checkCaller(caller({ tenant_id: OTHER_TENANT }), NORTHWIND)).toMatchObject({ ok: false, status: 403, code: "not_northwind" });
  });
  it.each(["admin", "manager", "ops", "viewer"])("refuses northwind's %s", (role) => {
    expect(checkCaller(caller({ role }), NORTHWIND)).toMatchObject({ ok: false, status: 403, code: "not_head_admin" });
  });
  it("refuses no session, and an inactive super admin", () => {
    expect(checkCaller(null, NORTHWIND)).toMatchObject({ ok: false, status: 401 });
    expect(checkCaller(caller({ is_super_admin: true, is_active: false }), NORTHWIND)).toMatchObject({ ok: false, status: 403, code: "inactive" });
  });
});

describe("G2 — the tenant: northwind, active, Stripe TEST, on Stripe", () => {
  it("accepts northwind in test mode", () => expect(checkTenant(northwind())).toEqual({ ok: true }));
  it("refuses any tenant that is not northwind", () => {
    expect(checkTenant(northwind({ slug: "revtek" }))).toMatchObject({ ok: false, status: 403, code: "not_northwind" });
    expect(checkTenant(northwind({ slug: "Northwind" }))).toMatchObject({ ok: false, code: "not_northwind" });
    expect(checkTenant(null)).toMatchObject({ ok: false, status: 412 });
  });
  it("refuses live Stripe mode", () => {
    expect(checkTenant(northwind({ stripe_mode: "live" }))).toMatchObject({ ok: false, status: 412, code: "stripe_live" });
    expect(checkTenant(northwind({ stripe_mode: null }))).toMatchObject({ ok: false, code: "stripe_live" });
  });
  it("refuses an inactive or Square tenant", () => {
    expect(checkTenant(northwind({ status: "suspended" }))).toMatchObject({ ok: false, code: "tenant_inactive" });
    expect(checkTenant(northwind({ payment_provider: "square" }))).toMatchObject({ ok: false, code: "not_stripe" });
  });
});

describe("G3 — the environment", () => {
  it("accepts only a Stripe TEST secret or restricted key", () => {
    expect(checkStripeTestKey("sk_test_51abc")).toEqual({ ok: true });
    expect(checkStripeTestKey("rk_test_51abc")).toEqual({ ok: true });
    for (const k of ["sk_live_51abc", "rk_live_51abc", "", undefined, "pk_test_51abc", "whsec_x"]) {
      expect(checkStripeTestKey(k)).toMatchObject({ ok: false, code: "stripe_key_not_test" });
    }
  });
  it("needs the sandbox clones locked to northwind", () => {
    expect(checkSandboxTenant(NORTHWIND, NORTHWIND)).toEqual({ ok: true });
    expect(checkSandboxTenant(undefined, NORTHWIND)).toMatchObject({ ok: false, code: "sandbox_unset" });
    expect(checkSandboxTenant(OTHER_TENANT, NORTHWIND)).toMatchObject({ ok: false, code: "sandbox_other_tenant" });
  });
});

describe("G5 — fixture rentals only", () => {
  it("accepts the run's registered, marked fixture on a fixture customer", () => {
    expect(checkFixture(goodFixture())).toEqual({ ok: true });
  });
  it("refuses a rental with no registry row (every real rental)", () => {
    expect(checkFixture(goodFixture({ registry: null }))).toMatchObject({ ok: false, code: "not_registered" });
  });
  it("refuses another run's fixture", () => {
    expect(checkFixture(goodFixture({ registry: { rental_id: RENTAL, run_id: OTHER_TENANT, tenant_id: NORTHWIND, customer_id: CUSTOMER } }))).toMatchObject({ ok: false, code: "other_run" });
  });
  it("refuses a rental that is not northwind's", () => {
    expect(checkFixture(goodFixture({ rental: { id: RENTAL, tenant_id: OTHER_TENANT, customer_id: CUSTOMER, creation_context: { e2e_fixture: true, run_id: RUN } } }))).toMatchObject({ ok: false, code: "not_northwind" });
  });
  it("refuses a rental without the E2E marker for this run", () => {
    expect(checkFixture(goodFixture({ rental: { id: RENTAL, tenant_id: NORTHWIND, customer_id: CUSTOMER, creation_context: null } }))).toMatchObject({ ok: false, code: "not_marked" });
    expect(checkFixture(goodFixture({ rental: { id: RENTAL, tenant_id: NORTHWIND, customer_id: CUSTOMER, creation_context: { e2e_fixture: "true", run_id: RUN } } }))).toMatchObject({ ok: false, code: "not_marked" });
    expect(checkFixture(goodFixture({ rental: { id: RENTAL, tenant_id: NORTHWIND, customer_id: CUSTOMER, creation_context: { e2e_fixture: true, run_id: OTHER_TENANT } } }))).toMatchObject({ ok: false, code: "not_marked" });
  });
  it("refuses a customer a message could reach", () => {
    const c = goodFixture().customer!;
    expect(checkFixture(goodFixture({ customer: { ...c, email: "real.person@gmail.com" } }))).toMatchObject({ ok: false, code: "not_fixture_customer" });
    expect(checkFixture(goodFixture({ customer: { ...c, phone: "+15555550100" } }))).toMatchObject({ ok: false, code: "not_fixture_customer" });
    expect(checkFixture(goodFixture({ customer: { ...c, name: "Abu Bakr" } }))).toMatchObject({ ok: false, code: "not_fixture_customer" });
    expect(checkFixture(goodFixture({ customer: { ...c, email: "x@e2e.drive247.test.evil.com" } }))).toMatchObject({ ok: false, code: "not_fixture_customer" });
  });
});

describe("G6 — every sandbox call carries only_rental_id = the fixture", () => {
  it("builds only a scoped body, and refuses a non-UUID", () => {
    expect(sandboxBody(RENTAL)).toEqual({ only_rental_id: RENTAL });
    expect(sandboxBody(RENTAL, true)).toEqual({ only_rental_id: RENTAL, preview: true });
    expect(() => sandboxBody("")).toThrow(/only_rental_id/);
    expect(() => sandboxBody("all")).toThrow(/only_rental_id/);
  });
  it("refuses a call with no only_rental_id", () => {
    expect(checkSandboxCall("sandbox-auto-extend-rentals", {}, RENTAL)).toMatchObject({ ok: false, code: "no_only_rental_id" });
    expect(checkSandboxCall("sandbox-auto-extend-rentals", { only_rental_id: null }, RENTAL)).toMatchObject({ ok: false, code: "no_only_rental_id" });
    expect(checkSandboxCall("sandbox-auto-extend-rentals", null, RENTAL)).toMatchObject({ ok: false, code: "no_only_rental_id" });
  });
  it("refuses a call scoped to another rental", () => {
    expect(checkSandboxCall("sandbox-accrue-payg-charges", { only_rental_id: CUSTOMER }, RENTAL)).toMatchObject({ ok: false, code: "other_rental" });
  });
  it("refuses the REAL cron jobs by name", () => {
    for (const real of ["auto-extend-rentals", "accrue-payg-charges", "send-payg-reminders", "process-installment-payment", "run-payment-plans", "mark-overdue-installments"]) {
      expect(checkSandboxCall(real, { only_rental_id: RENTAL }, RENTAL)).toMatchObject({ ok: false, code: "not_sandbox" });
    }
    for (const job of SANDBOX_JOBS) expect(checkSandboxCall(job, { only_rental_id: RENTAL }, RENTAL)).toEqual({ ok: true });
  });
  it("refuses a sandbox preview that would touch anything but the fixture", () => {
    expect(checkBlastRadius([], RENTAL)).toEqual({ ok: true });
    expect(checkBlastRadius([RENTAL], RENTAL)).toEqual({ ok: true });
    expect(checkBlastRadius([RENTAL, CUSTOMER], RENTAL)).toMatchObject({ ok: false, code: "blast_radius" });
    expect(checkBlastRadius(undefined, RENTAL)).toMatchObject({ ok: false, code: "no_preview" });
  });
});

describe("G4 — only runnable, allow-listed scenarios", () => {
  it("every scenario the catalogue marks live-runnable passes the scenario guard", () => {
    for (const s of CATALOGUE.filter(isLiveRunnable)) expect(checkScenarioRunnable(s), s.id).toEqual({ ok: true });
  });
  it("a memory/PGlite-only entry and a live-blocked one are refused, never faked", () => {
    expect(checkScenarioRunnable(findScenario("PP-REF"))).toMatchObject({ ok: false, code: "not_live" });
    expect(checkScenarioRunnable(findScenario("AE7"))).toMatchObject({ ok: false, code: "live_blocked" });
    expect(checkScenarioRunnable(null)).toMatchObject({ ok: false, status: 404 });
  });
  const base = findScenario("SB1")!;
  const withSteps = (steps: Step[]): Scenario => ({ ...base, steps });
  it("refuses a fixture that starts on a card other than visa", () => {
    expect(checkScenarioRunnable({ ...base, fixture: { ...base.fixture!, card: "declined" } })).toMatchObject({ ok: false, code: "fixture_card" });
  });
  it("refuses a real cron job, an unlisted card, a large amount, a long advance", () => {
    expect(checkScenarioRunnable(withSteps([{ kind: "fire", job: "auto-extend-rentals" as never }]))).toMatchObject({ ok: false, code: "job" });
    expect(checkScenarioRunnable(withSteps([{ kind: "swap_card", card: "pm_card_visa" as never }]))).toMatchObject({ ok: false, code: "card" });
    expect(checkScenarioRunnable(withSteps([{ kind: "charge_saved_card", amount: { cents: 500_000, math: "5000.00 = 5000.00" }, note: "x" }]))).toMatchObject({ ok: false, code: "amount" });
    expect(checkScenarioRunnable(withSteps([{ kind: "advance", domain: "payg", days: 61 }]))).toMatchObject({ ok: false, code: "advance" });
    expect(checkAmount(0)).toMatchObject({ ok: false });
    expect(checkAmount(-100)).toMatchObject({ ok: false });
    expect(checkAmount(10.5)).toMatchObject({ ok: false });
  });
  it("names exactly the three attachable Stripe TEST cards", () => {
    expect([...ATTACHABLE_CARDS]).toEqual(["visa", "declined", "auth_required"]);
  });
  it("refuses to compare against numbers the tenant's settings would change", () => {
    expect(checkAssumptions(["tax_off"], northwind({ tax_enabled: true, tax_percentage: 8.25 }))).toEqual({ ok: false, failed: [{ assumption: "tax_off", actual: { tax_enabled: true, tax_percentage: 8.25 } }] });
    expect(checkAssumptions(["tax_off"], northwind({ tax_enabled: true, tax_percentage: 0 })).ok).toBe(true);
    expect(checkAssumptions(["auto_extend_grace_48h", "auto_extend_retries_3"], northwind({ auto_extend_grace_hours: 24, auto_extend_max_retries: 5 })).failed.map((f) => f.assumption)).toEqual(["auto_extend_grace_48h", "auto_extend_retries_3"]);
    expect(checkAssumptions(["usd"], northwind({ currency_code: "GBP" })).ok).toBe(false);
    expect(checkAssumptions(["payg_window_1_day"], northwind({ payg_accrual_window_seconds: 3600 })).ok).toBe(false);
    expect(checkAssumptions(["service_fee_off"], northwind({ service_fee_enabled: true, service_fee_value: 2 })).ok).toBe(false);
    for (const s of CATALOGUE) expect(checkAssumptions(s.assumes, northwind()).ok, s.id).toBe(true);
  });
});

describe("G8 — quiet windows around the real crons", () => {
  const at = (iso: string) => new Date(iso);
  it("reads the cron shapes the manifest uses", () => {
    expect(cronFireTimes("*/15 * * * *", at("2026-09-26T12:00:00Z")).length).toBe(3 * 24 * 4);
    expect(cronFireTimes("0 8 * * *", at("2026-09-26T12:00:00Z")).map((d) => d.toISOString())).toEqual(["2026-09-25T08:00:00.000Z", "2026-09-26T08:00:00.000Z", "2026-09-27T08:00:00.000Z"]);
    expect(() => cronFireTimes("0 8 * * 1", at("2026-09-26T12:00:00Z"))).toThrow(/unsupported/);
    expect(() => cronFireTimes("0 8 *", at("2026-09-26T12:00:00Z"))).toThrow(/unsupported/);
  });
  it("waits out 20 s before to 90 s after a real run, and no longer", () => {
    // 12:00:05 is 5 s into the 12:00 run window: wait until 12:01:30 (+1 s).
    expect(quietWindow(at("2026-09-26T12:00:05Z"), ["*/15 * * * *"])).toEqual({ ok: false, waitSeconds: 86 });
    expect(quietWindow(at("2026-09-26T12:07:00Z"), ["*/15 * * * *"])).toEqual({ ok: true, waitSeconds: 0 });
    expect(quietWindow(at("2026-09-26T12:14:45Z"), ["*/15 * * * *"]).ok).toBe(false);
    expect(quietWindow(at("2026-09-26T08:00:30Z"), ["0 8 * * *"]).ok).toBe(false);
    expect(quietWindow(at("2026-09-26T09:00:00Z"), ["0 8 * * *"]).ok).toBe(true);
  });
  it("every sandbox job and the plan tick has its real jobs' schedules in sim-control's cron manifest", () => {
    const manifest = JSON.parse(read("supabase/functions/sim-control/cron-manifest.json")) as Record<string, { schedule?: string }>;
    for (const [job, names] of Object.entries(QUIET_FOR)) {
      for (const n of names) expect(manifest[n]?.schedule, `${job} → ${n}`).toMatch(/^\S+ \S+ \* \* \*$/);
    }
    expect(Object.keys(QUIET_FOR).sort()).toEqual([...SANDBOX_JOBS, "tick_plan"].sort());
  });
});

describe("G10 — a webhook is replayed only for the fixture's own TEST session", () => {
  const ev = (over: Record<string, unknown> = {}) => ({ id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_test_1", metadata: { rental_id: RENTAL } } }, ...over });
  it("accepts the fixture's own event", () => expect(checkReplayEvent(ev(), RENTAL, "cs_test_1")).toEqual({ ok: true }));
  it("refuses live, other types, other sessions, other rentals, none", () => {
    expect(checkReplayEvent(ev({ livemode: true }), RENTAL, "cs_test_1")).toMatchObject({ ok: false, code: "live_event" });
    expect(checkReplayEvent(ev({ type: "charge.refunded" }), RENTAL, "cs_test_1")).toMatchObject({ ok: false, code: "event_type" });
    expect(checkReplayEvent(ev(), RENTAL, "cs_test_2")).toMatchObject({ ok: false, code: "other_session" });
    expect(checkReplayEvent(ev({ data: { object: { id: "cs_test_1", metadata: { rental_id: CUSTOMER } } } }), RENTAL, "cs_test_1")).toMatchObject({ ok: false, code: "other_rental" });
    expect(checkReplayEvent(null, RENTAL, "cs_test_1")).toMatchObject({ ok: false, code: "no_event" });
  });
});

describe("G7 — preview writes nothing", () => {
  it("the read-only client passes selects through and throws on every write", () => {
    const calls: string[] = [];
    const fake = { from: (t: string) => ({ select: (c: string) => (calls.push(`select ${t} ${c}`), "rows"), insert: () => calls.push("REAL insert"), update: () => calls.push("REAL update"), delete: () => calls.push("REAL delete"), upsert: () => calls.push("REAL upsert") }) };
    const ro = new ReadOnlyDb(fake);
    expect(ro.from("tenants").select("id")).toBe("rows");
    const t = ro.from("rentals") as unknown as Record<string, () => unknown>;
    expect(() => t.insert()).toThrow(/read-only/);
    expect(() => t.update()).toThrow(/read-only/);
    expect(() => t.delete()).toThrow(/read-only/);
    expect(() => t.upsert()).toThrow(/read-only/);
    expect(() => ro.rpc("e2e_shift_fixture")).toThrow(/read-only/);
    expect(calls).toEqual(["select tenants id"]);
    expect(ro.writes).toEqual(["insert rentals", "update rentals", "delete rentals", "upsert rentals", "rpc e2e_shift_fixture"]);
  });

  const index = read("supabase/functions/e2e-runner/index.ts");
  const previewBlock = index.slice(index.indexOf('if (action === "preview")'), index.indexOf('if (action === "run" || action === "start")'));
  it("the preview branch holds only the read-only client and starts nothing", () => {
    expect(previewBlock).toContain("new ReadOnlyDb(db)");
    expect(previewBlock).not.toMatch(/\bdb\.(from|rpc)\(/);
    expect(previewBlock).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(previewBlock).not.toMatch(/runSteps|createFixture|callFn|fetch\(/);
    expect(previewBlock).toContain("writes: ro.writes");
    // A preview id is issued only when nothing refused.
    expect(previewBlock).toContain("const previewId = problems.length === 0 ? await signPreview(");
  });

  it("the preview says, per scenario, what a run would write, charge and fire — and never a real cron", () => {
    for (const s of CATALOGUE.filter(isLiveRunnable)) {
      const plan = planScenario(s);
      expect(plan.scenario_id).toBe(s.id);
      const tables = plan.writes.map((w) => w.table);
      for (const t of ["dev_sim_runs", "customers", "rentals", "dev_sim_fixtures", "dev_sim_run_steps"]) expect(tables, `${s.id} ${t}`).toContain(t);
      expect(plan.writes.find((w) => w.table === "dev_sim_run_steps")?.count, s.id).toBe(s.steps.length + 1);
      for (const st of s.steps) if (st.kind === "fire") expect(plan.crons.some((c) => c.job === st.job && c.note.includes(`never the real ${REAL_JOB[st.job]}`)), `${s.id} ${st.job}`).toBe(true);
      expect(plan.crons.every((c) => c.job.startsWith("sandbox-") || c.job.startsWith("payment-plan engine")), s.id).toBe(true);
    }
    // A reference-only entry would write nothing — and is refused before it gets here.
    expect(planScenario(findScenario("PP-REF")!).writes).toEqual([]);
  });
});

describe("G12 — a run needs the confirm sentence and a fresh preview of that scenario", () => {
  const SECRET = "server-only-secret";
  it("refuses a run without the exact sentence", () => {
    expect(checkConfirm(CONFIRM_SENTENCE)).toEqual({ ok: true });
    for (const c of [undefined, "", "yes", CONFIRM_SENTENCE.toLowerCase(), `${CONFIRM_SENTENCE}.`]) expect(checkConfirm(c)).toMatchObject({ ok: false, code: "confirm" });
  });
  it("the sentence is the Developer tab's own (its contract file)", () => {
    const contract = read("apps/portal/src/components/dev/e2e-runner-contract.ts");
    expect(contract).toContain(`export const CONFIRM_SENTENCE = "${CONFIRM_SENTENCE}";`);
  });
  it("accepts a fresh preview of that scenario on that tenant, and nothing else", async () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const token = await signPreview(SECRET, NORTHWIND, ["SB1", "MX1"], now + PREVIEW_TTL_MS);
    expect(await verifyPreview(SECRET, NORTHWIND, token, "SB1", now)).toEqual({ ok: true });
    expect(await verifyPreview(SECRET, NORTHWIND, token, "MX1", now + PREVIEW_TTL_MS - 1)).toEqual({ ok: true });
    expect(await verifyPreview(SECRET, NORTHWIND, token, "AE1", now)).toMatchObject({ ok: false, code: "preview_scope" });
    expect(await verifyPreview(SECRET, NORTHWIND, token, "SB1", now + PREVIEW_TTL_MS + 1)).toMatchObject({ ok: false, code: "preview_expired" });
    expect(await verifyPreview(SECRET, OTHER_TENANT, token, "SB1", now)).toMatchObject({ ok: false, code: "preview_forged" });
    expect(await verifyPreview("another-secret", NORTHWIND, token, "SB1", now)).toMatchObject({ ok: false, code: "preview_forged" });
    const widened = token.replace(".MX1,SB1.", ".AE1,MX1,SB1.");
    expect(widened).not.toBe(token);
    expect(await verifyPreview(SECRET, NORTHWIND, widened, "AE1", now)).toMatchObject({ ok: false, code: "preview_forged" });
    for (const bad of [undefined, null, "", "pv1.x", "pv0.1.SB1.abc"]) expect(await verifyPreview(SECRET, NORTHWIND, bad, "SB1", now)).toMatchObject({ ok: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guards, by source
// ─────────────────────────────────────────────────────────────────────────────

describe("source: index.ts applies the guards in order", () => {
  const index = read("supabase/functions/e2e-runner/index.ts");
  const serve = index.slice(index.indexOf("Deno.serve("));
  it("G0 is the first decision after CORS", () => {
    const g0 = serve.indexOf("checkKillSwitch(");
    expect(g0).toBeGreaterThan(0);
    for (const later of ["createClient(", "req.json()", "resolveCaller(", ".from("]) expect(serve.indexOf(later), later).toBeGreaterThan(g0);
  });
  it("northwind is found by SLUG, never by an id", () => {
    expect(index).toContain('.eq("slug", E2E_TENANT_SLUG)');
    expect(index).not.toMatch(/6e5c544f|8e6bc88f/);
  });
  it("caller (G1) and tenant (G2) are checked before any action branch", () => {
    const g1 = serve.indexOf("checkCaller(");
    const g2 = serve.indexOf("checkTenant(");
    const firstAction = serve.indexOf('if (action === "list")');
    expect(g1).toBeGreaterThan(0);
    expect(g2).toBeGreaterThan(g1);
    expect(firstAction).toBeGreaterThan(g2);
  });
  it("a run refuses on G12/G4/G3/assumptions before it writes the run row", () => {
    const start = serve.slice(serve.indexOf('if (action === "run" || action === "start")'));
    const insert = start.indexOf('.from("dev_sim_runs")');
    expect(insert).toBeGreaterThan(0);
    for (const g of ["checkConfirm(", "checkScenarioRunnable(", "verifyPreview(", "environmentReport(", "checkAssumptions("]) {
      expect(start.indexOf(g), g).toBeGreaterThan(0);
      expect(start.indexOf(g), g).toBeLessThan(insert);
    }
  });
  it("GET answers the contract: runner { version, tenant_slug, stripe_mode, guards } and the full catalogue", () => {
    expect(serve).toContain('const action = req.method === "GET" ? "list" : String(body.action ?? "");');
    expect(serve).toContain("runner: { version: RUNNER_VERSION, tenant_slug: t.slug, stripe_mode: t.stripe_mode, guards: GUARD_SUMMARY },");
    expect(serve).toContain("catalogue: CATALOGUE,");
  });
  it("an existing run is leased (G11) and passed through the SQL fixture guard before any step", () => {
    const later = serve.slice(serve.indexOf('if (action === "advance"'));
    expect(later.indexOf('rpc("e2e_lease_run"')).toBeGreaterThan(0);
    expect(later.indexOf('rpc("e2e_fixture_guard"')).toBeGreaterThan(later.indexOf('rpc("e2e_lease_run"'));
    expect(later.indexOf("runSteps(")).toBeGreaterThan(later.indexOf('rpc("e2e_fixture_guard"'));
  });
  it("documents every guard it applies in its header", () => {
    for (const g of ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]) expect(index, g).toMatch(new RegExp(`//\\s+${g}\\s+[A-Z]`));
  });
});

describe("source: runner.ts never reaches a real cron or live Stripe", () => {
  const runner = read("supabase/functions/e2e-runner/runner.ts");
  it("calls a cron's work only through a sandbox clone or the in-process plan tick", () => {
    expect(runner).not.toMatch(/functions\/v1\/(auto-extend-rentals|accrue-payg-charges|send-payg-reminders|process-installment-payment|run-payment-plans|send-auto-extension-reminder)/);
    expect(runner).not.toMatch(/callFn\(env, "(auto-extend-rentals|accrue-payg-charges|send-payg-reminders|process-installment-payment|run-payment-plans)"/);
    expect(runner).not.toMatch(/rpc\("mark_overdue_installments"/);
    // The sandbox call is always the job named by the step, with the checked, scoped body.
    expect(runner).toContain("callFn(env, st.job, body, \"service\")");
    expect(runner).toContain("const body = sandboxBody(fx.rentalId);");
    expect(runner).toContain("checkSandboxCall(st.job, body, fx.rentalId)");
    expect(runner).toContain("checkBlastRadius(");
  });
  it("the plan tick is scoped to the fixture's plan and tenant", () => {
    expect(runner).toContain("runTick(make(), { asOf, tenantId: env.tenant.id, planId: fx.planId! })");
  });
  it("Stripe is always the TEST client — the mode is a literal, never the tenant column", () => {
    expect(runner).toContain('getStripeClientForAccount(platform, "test")');
    expect(runner).not.toMatch(/getStripeClientForAccount\([^)]*live/);
    expect(runner).not.toMatch(/STRIPE_(UAE_)?LIVE/);
    expect(runner).toContain('if (ctx.mode !== "test")');
  });
  it("every sandbox fire un-parks inside try and re-parks in finally", () => {
    const fire = runner.slice(runner.indexOf('case "fire": {'), runner.indexOf('case "tick_plan":'));
    expect(fire.indexOf("setParked(env, fx, shape, false)")).toBeLessThan(fire.indexOf("try {"));
    expect(fire).toMatch(/finally \{\s*await setParked\(env, fx, shape, true\);/);
    expect(fire.indexOf("quiet(env, st.job)")).toBeLessThan(fire.indexOf("setParked(env, fx, shape, false)"));
  });
  it("time moves only through e2e_shift_fixture", () => {
    expect(runner).toMatch(/rpc\("e2e_shift_fixture"/);
    expect(runner).not.toMatch(/rpc\("sim_shift"/);
  });
  it("the fixture customer is unreachable by construction", () => {
    expect(runner).toContain("phone: null,");
    expect(runner).toContain("email: `e2e-${run8}@${FIXTURE_EMAIL_DOMAIN}`");
    expect(runner).toContain("vehicle_id: null,");
    expect(runner).toContain("creation_context: { e2e_fixture: true, run_id: run.id");
  });
});

describe("source: the migration's own guards (authoritative even if the function were wrong)", () => {
  const sql = read("supabase/migrations/20260926120300_dev_sim_runs.sql");
  it("re-reads northwind + Stripe TEST in every guarded function", () => {
    const guard = sql.slice(sql.indexOf("FUNCTION public.e2e_fixture_guard"), sql.indexOf("FUNCTION public.e2e_register_fixture"));
    expect(guard).toContain("IS DISTINCT FROM 'northwind'");
    expect(guard).toContain("stripe_mode IS DISTINCT FROM 'test'");
    const shift = sql.slice(sql.indexOf("FUNCTION public.e2e_shift_fixture"));
    expect(shift).toContain("v_rental := public.e2e_fixture_guard(p_run_id);");
  });
  it("writes are service-role only: no write policies, privileges revoked", () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]+FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE[^;]+FROM authenticated;/);
    for (const fn of ["e2e_fixture_guard(uuid)", "e2e_register_fixture(uuid, uuid)", "e2e_shift_fixture(uuid, text, integer)", "e2e_lease_run(uuid, uuid, integer)"]) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.replace(/[()]/g, "\\$&")}\\s+FROM PUBLIC, anon, authenticated;`));
    }
  });
  it("is not picked up by the payment-plans PGlite harness by accident", () => {
    expect(sql.split("\n", 1)[0].trim()).not.toBe("-- @pglite-harness");
  });
});

describe("source: sim-control is NOT weakened, and its manifests stay coherent", () => {
  const sim = read("supabase/functions/sim-control/index.ts");
  it("still refuses any non-staging project with 403", () => {
    expect(sim).toContain('const STAGING_REF = "ksmreaadhbirzakkxqrq";');
    expect(sim).toMatch(/if \(simHost !== STAGING_HOST\) \{\s*return json\(\{ ok: false, error: "sim-control is disabled outside the staging project" \}, 403\);/);
  });
  it("every shift-manifest column is in sim_shift's allow-list for its table", () => {
    const manifest = JSON.parse(read("supabase/functions/sim-control/sim-shift-manifest.json")) as Record<string, { table?: string; driveCols?: string[] }>;
    const sqlShift = read("supabase/functions/sim-control/sim_shift.sql");
    for (const [domain, d] of Object.entries(manifest)) {
      if (domain.startsWith("_")) continue;
      const m = new RegExp(`'${d.table}',\\s*jsonb_build_array\\(([^)]*)\\)`).exec(sqlShift);
      expect(m, `${domain}: ${d.table} in sim_shift`).not.toBeNull();
      const allowed = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
      for (const c of d.driveCols ?? []) expect(allowed, `${domain}.${c}`).toContain(c);
    }
    expect(manifest.payment_plan).toMatchObject({ table: "payment_plan_occurrences", driveCols: ["due_at", "due_date", "next_attempt_at"] });
  });
  it("e2e_shift_fixture moves the same rentals columns as the manifest's payg and auto_extend domains", () => {
    const manifest = JSON.parse(read("supabase/functions/sim-control/sim-shift-manifest.json")) as Record<string, { driveCols: string[] }>;
    const sql = read("supabase/migrations/20260926120300_dev_sim_runs.sql");
    const block = (d: string, next: string) => sql.slice(sql.indexOf(`IF p_domain = '${d}'`) >= 0 ? sql.indexOf(`IF p_domain = '${d}'`) : sql.indexOf(`ELSIF p_domain = '${d}'`), sql.indexOf(`ELSIF p_domain = '${next}'`));
    const payg = block("payg", "auto_extend");
    for (const c of manifest.payg.driveCols) expect(payg, `payg.${c}`).toMatch(new RegExp(`\\b${c}\\s*=\\s*${c}\\s*-`));
    const ae = block("auto_extend", "installment");
    for (const c of manifest.auto_extend.driveCols) expect(ae, `auto_extend.${c}`).toMatch(new RegExp(`\\b${c}\\s*=\\s*${c}\\s*-`));
    const pp = block("payment_plan", "plan_attempts");
    for (const c of manifest.payment_plan.driveCols) expect(pp, `payment_plan.${c}`).toMatch(new RegExp(`\\b${c}\\s*=\\s*${c}\\s*-`));
  });
});

describe("source: the sandbox clones the runner relies on are fail-closed", () => {
  it.each(["sandbox-accrue-payg-charges", "sandbox-send-payg-reminders", "sandbox-auto-extend-rentals", "sandbox-process-installment-payment"])("%s refuses without only_rental_id and is tenant-locked", (fn) => {
    const src = read(`supabase/functions/${fn}/index.ts`);
    expect(src).toMatch(/only_rental_id/);
    expect(src).toMatch(/UUID_RE\.test\(onlyRentalId\)/);
    expect(src).toMatch(/SANDBOX_TEST_TENANT_ID/);
    expect(src).toMatch(/not in the designated test tenant/);
    expect(src).toMatch(/preview/);
  });
  it("sandbox-fixture-setup only mints on the designated tenant, in TEST mode, from an allow-list", () => {
    const src = read("supabase/functions/sandbox-fixture-setup/index.ts");
    expect(src).toContain('tenant.stripe_mode !== "test"');
    expect(src).toContain('const mode: StripeMode = "test";');
    for (const card of ATTACHABLE_CARDS) expect(src).toMatch(new RegExp(`\\b${card}:\\s*"pm_card_`));
  });
});

describe("clone drift is pinned, not guessed", () => {
  // AE7 (credit-covered renewal) is live-blocked because the clone lacks the
  // real job's prepaid-credit path. The day someone ports it, this goes red
  // and says to clear the flag.
  it("AE7 is blocked exactly while the auto-extend clone lacks the credit path", () => {
    const real = read("supabase/functions/auto-extend-rentals/index.ts");
    const clone = read("supabase/functions/sandbox-auto-extend-rentals/index.ts");
    const marker = "autoext_apply_adjustment_credit";
    expect(real).toContain(marker);
    const cloneHasCredit = clone.includes(marker);
    expect(!!findScenario("AE7")!.liveBlockedBy, cloneHasCredit ? "the clone now has the credit path — clear AE7.liveBlockedBy" : "AE7 must stay blocked").toBe(!cloneHasCredit);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The catalogue's shape
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate a hand derivation's left side: numbers, + - − × * / and parentheses. */
function evalMath(expr: string): number {
  const src = expr.replace(/×/g, "*").replace(/−/g, "-").replace(/\s+/g, "");
  let i = 0;
  const peek = () => src[i];
  const num = (): number => {
    if (peek() === "(") {
      i++;
      const v = sum();
      if (src[i++] !== ")") throw new Error(`unbalanced ( in ${expr}`);
      return v;
    }
    if (peek() === "-") {
      i++;
      return -num();
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error(`not a number at '${src.slice(i)}' in ${expr}`);
    i += m[0].length;
    return Number(m[0]);
  };
  const prod = (): number => {
    let v = num();
    while (peek() === "*" || peek() === "/") v = src[i++] === "*" ? v * num() : v / num();
    return v;
  };
  const sum = (): number => {
    let v = prod();
    while (peek() === "+" || peek() === "-") v = src[i++] === "+" ? v + prod() : v - prod();
    return v;
  };
  const v = sum();
  if (i !== src.length) throw new Error(`trailing '${src.slice(i)}' in ${expr}`);
  return v;
}

function moneyOf(s: Scenario): { where: string; m: Money }[] {
  const out: { where: string; m: Money }[] = [];
  const add = (where: string, m: Money) => out.push({ where: `${s.id} ${where}`, m });
  const f = s.fixture;
  if (f) {
    add("fixture.periodRate", f.periodRate);
    f.charges.forEach((c, i) => add(`fixture.charges[${i}]`, c.amount));
    if (f.installments) add("fixture.installments.amount", f.installments.amount);
    f.plan?.occurrenceAmounts.forEach((m, i) => add(`fixture.plan[${i}]`, m));
  }
  s.steps.forEach((st, i) => {
    if ("amount" in st && st.amount) add(`step ${i} amount`, st.amount);
    if (st.kind === "check") st.checks.forEach((c) => typeof c.expect === "object" && !Array.isArray(c.expect) && c.expect && add(`step ${i} ${c.label}`, c.expect as Money));
    if (st.kind === "tie_out") {
      add(`step ${i} outstanding`, st.expect.outstanding);
      add(`step ${i} collected`, st.expect.collected);
      st.expect.bills.forEach((b) => (["total", "paid", "credited", "balance"] as const).forEach((k) => add(`step ${i} ${b.label}.${k}`, b[k])));
    }
  });
  return out;
}

describe("catalogue — shape", () => {
  const live = CATALOGUE.filter((s) => s.tiers.includes("live"));

  it("has unique ids and covers all seven families", () => {
    const ids = CATALOGUE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...new Set(CATALOGUE.map((s) => s.family))].sort()).toEqual(["auto_extend", "cron_safety", "installment", "manual_extension", "payg", "payment_plan", "simple_booking"]);
  });

  it("covers every branch the brief names", () => {
    const ids = new Set(CATALOGUE.map((s) => s.id));
    // simple booking: pay in full, full refund, partial refund
    for (const id of ["SB1", "SB2", "SB3"]) expect(ids.has(id), id).toBe(true);
    // manual extension: link paid / unpaid
    for (const id of ["MX1", "MX2"]) expect(ids.has(id), id).toBe(true);
    // auto-extend: success, insufficient funds, SCA, pay link paid, pay link expired (grace + Stripe expiry), pause/resume, credit
    for (const id of ["AE1", "AE2", "AE3", "AE4", "AE5", "AE5b", "AE6", "AE7"]) expect(ids.has(id), id).toBe(true);
    // PAYG accrual + reminder + link paid; installments; plans; cron safety
    for (const id of ["PG1", "PG2", "IN1", "IN2", "PP-REF", "PP-L1", "PP-L3", "CS1a", "CS1b", "CS1c", "CS2", "CS3"]) expect(ids.has(id), id).toBe(true);
  });

  it("references every payment-plan scenario (S1–S19b, S20–S26) exactly once, and copies none of them", () => {
    expect([...PAYMENT_PLAN_REFERENCES]).toEqual(PLAN_SCENARIOS.map((s) => s.id));
    const ref = findScenario("PP-REF")!;
    expect(ref.references).toEqual(PLAN_SCENARIOS.map((s) => s.id));
    expect(ref.steps).toEqual([]);
    expect(ref.fixture).toBeNull();
    for (const s of CATALOGUE) for (const r of s.references ?? []) expect(PLAN_SCENARIOS.map((p) => p.id), `${s.id} → ${r}`).toContain(r);
  });

  it("every live scenario has a fixture, a tie-out, and ENDS with a Finances tie-out", () => {
    for (const s of live) {
      expect(s.fixture, s.id).not.toBeNull();
      expect(s.steps.at(-1)?.kind, `${s.id} must end with tie_out`).toBe("tie_out");
      const t = s.steps.at(-1) as Extract<Step, { kind: "tie_out" }>;
      expect(t.expect.bills.length, s.id).toBeGreaterThan(0);
      expect(t.expect.bills[0].label, s.id).toBe("Booking");
    }
  });

  it("every money value is hand-derived: an integer-cents literal with its arithmetic, and the arithmetic adds up", () => {
    let n = 0;
    for (const s of CATALOGUE) {
      for (const { where, m } of moneyOf(s)) {
        n += 1;
        expect(Number.isInteger(m.cents), where).toBe(true);
        const [lhs, rhs, extra] = m.math.split("=");
        expect(extra, `${where}: one '=' only`).toBeUndefined();
        expect(rhs, `${where}: math must be "<expression> = <dollars>"`).toBeDefined();
        const stated = Number(rhs.trim());
        expect(Math.round(stated * 100), `${where}: ${m.math} states ${rhs.trim()} but cents is ${m.cents}`).toBe(m.cents);
        expect(Math.round(evalMath(lhs) * 100), `${where}: ${m.math} does not add up`).toBe(m.cents);
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it("every *_cents observation expects a Money, every other one a plain value", () => {
    for (const s of CATALOGUE) {
      for (const st of s.steps) {
        if (st.kind !== "check") continue;
        for (const c of st.checks as Check[]) {
          const isMoneyCheck = /[._]cents$/.test(c.observe);
          const isMoneyVal = !!c.expect && typeof c.expect === "object" && !Array.isArray(c.expect);
          expect(isMoneyVal, `${s.id} "${c.label}"`).toBe(isMoneyCheck);
        }
      }
    }
  });

  it("each tie-out's bills tie out on paper (Total − Paid − Credited = Balance)", () => {
    for (const s of CATALOGUE) {
      for (const st of s.steps) {
        if (st.kind !== "tie_out") continue;
        const e: FinanceExpectation = st.expect;
        for (const b of e.bills) expect(b.total.cents - b.paid.cents - b.credited.cents, `${s.id} ${st.label} ${b.label}`).toBe(b.balance.cents);
      }
    }
  });

  it("the source files carry the derivations as comments too", () => {
    for (const f of ["simple-booking", "manual-extension", "auto-extend", "payg", "installments", "payment-plans", "cron-safety", "fixtures"]) {
      const src = read(`tests/e2e/scenarios/${f}.ts`);
      const cents = (src.match(/\bcents: -?\d+/g) ?? []).length;
      const maths = (src.match(/\bmath: "/g) ?? []).length;
      expect(maths, `${f}: every cents literal sits beside a math string`).toBeGreaterThanOrEqual(cents);
      expect((src.match(/^\s*\/\/ .*[×=]/gm) ?? []).length, `${f}: arithmetic comments`).toBeGreaterThan(0);
    }
  });

  it("steps fit their fixture: the advance domain, the sandbox job, plan ticks", () => {
    const jobShape: Record<string, string> = {
      "sandbox-accrue-payg-charges": "payg",
      "sandbox-send-payg-reminders": "payg",
      "sandbox-auto-extend-rentals": "auto_extend",
      "sandbox-process-installment-payment": "installment",
    };
    for (const s of live) {
      const shape = s.fixture!.shape;
      for (const st of s.steps) {
        if (st.kind === "advance") expect(st.domain, s.id).toBe(shape);
        if (st.kind === "fire") expect(jobShape[st.job], `${s.id} ${st.job}`).toBe(shape);
        if (st.kind === "tick_plan" || st.kind === "crash_after_charge") expect(shape, s.id).toBe("payment_plan");
        if (st.kind === "pause_auto_extend" || st.kind === "resume_auto_extend") expect(shape, s.id).toBe("auto_extend");
      }
    }
  });

  it("a scenario that prices through the tenant's settings says which settings it assumes", () => {
    for (const s of live) {
      const jobs = new Set(s.steps.flatMap((st) => (st.kind === "fire" ? [st.job] : [])));
      if (jobs.has("sandbox-auto-extend-rentals")) for (const a of ["tax_off", "service_fee_off", "auto_extend_grace_48h", "auto_extend_retries_3"]) expect(s.assumes, `${s.id} ${a}`).toContain(a);
      if (jobs.has("sandbox-accrue-payg-charges")) for (const a of ["tax_off", "service_fee_off", "payg_window_1_day"]) expect(s.assumes, `${s.id} ${a}`).toContain(a);
      if (s.steps.some((st) => st.kind === "extend_manually")) for (const a of ["tax_off", "service_fee_off"]) expect(s.assumes, `${s.id} ${a}`).toContain(a);
    }
  });

  it("every human step tells the person the test card, and is followed by a check", () => {
    for (const s of live) {
      s.steps.forEach((st, i) => {
        if (st.kind !== "human") return;
        expect(st.say, s.id).toContain("4242 4242 4242 4242");
        expect(s.steps.slice(i + 1).some((x) => x.kind === "check" || x.kind === "tie_out"), s.id).toBe(true);
      });
    }
  });

  it("counts, for the record", () => {
    const byFamily: Record<string, number> = {};
    for (const s of CATALOGUE) byFamily[s.family] = (byFamily[s.family] ?? 0) + 1;
    expect(byFamily).toEqual({ simple_booking: 3, manual_extension: 2, auto_extend: 8, payg: 2, installment: 2, payment_plan: 3, cron_safety: 5 });
    expect(CATALOGUE.filter(isLiveRunnable).length).toBe(23);
  });
});
