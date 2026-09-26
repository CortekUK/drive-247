/**
 * The live test runner's contract, as the `/dev` page reads it
 * (docs/PAYMENTS_ROADMAP.md Wave 4, assumption A6; spec §9).
 *
 * The runner is the `e2e-runner` edge function (supabase/functions/e2e-runner,
 * guards G0–G11 in its header), with its evidence in `dev_sim_runs` and
 * `dev_sim_run_steps` (supabase/migrations/20260926120300_dev_sim_runs.sql).
 * Neither may exist yet on the project the portal talks to, so every shape
 * below is parsed tolerantly and anything that does not parse is reported,
 * never guessed at.
 *
 * THE RUNNER'S ACTIONS (all POST JSON, camelCase, the caller's own session):
 *
 *   list                   → { ok, scenarios: catalogueSummary(), environment:
 *                              { stripeTestKey, sandboxTenant }, quiet }
 *                              No writes. A summary carries no steps, so the
 *                              expected outcome of a scenario is fetched with
 *                              `preview` when the tester opens it.
 *   preview  { scenarioId } → { ok, preview: true, writes, scenario, runnable,
 *                              assumptions, environment, quiet, wouldStart }
 *                              No writes (G7: a client whose writes throw;
 *                              `writes` lists any it refused, normally none).
 *                              It checks the guards; it does NOT list what a run
 *                              would write — this page reads that from the
 *                              scenario itself (`plannedWrites`).
 *   start    { scenarioId } → creates the run row and the fixture, runs steps
 *                              for up to ~100 s, answers a RunOutcome:
 *                              { ok, runId, status, nextStep, waitingFor,
 *                                passCount, failCount, deferredSeconds?, error? }
 *   advance  { runId }      → more steps of a `running` run. 409 when the run is
 *                              leased by another request (G11) or not running.
 *                              `deferredSeconds` = wait that long first (G8:
 *                              a real cron's window must pass).
 *   continue { runId }      → a person paid the link a `human` step showed.
 *   abort    { runId }      → stop the run; the fixture is parked.
 *   close    { runId }      → a finished run's fixture rental is Closed.
 *
 * A run is ONE scenario (one dev_sim_runs row); "Run group" / "Run all" are a
 * queue on this page, one run after another, under one confirm.
 *
 * THE TABLES, read over PostgREST under their staff-read RLS, never written
 * from the browser:
 *   dev_sim_runs       id, tenant_id, scenario_id, scenario (as it was at run
 *                      time), status (running | waiting | passed | failed |
 *                      errored | aborted), next_step, waiting_for { stepIndex,
 *                      ask, say, url }, fixture { rentalId, customerId, … },
 *                      pass_count, fail_count, error, created_by, created_at,
 *                      finished_at, fixture_closed_at
 *   dev_sim_run_steps  run_id, step_index (-1 = the fixture), kind, label,
 *                      status (ok | failed | error | refused), request,
 *                      response, observed, assertions [{ label, expected,
 *                      actual, pass, math? }], pass_count, fail_count
 *
 * "Live progress" on this page is a poll of one run row and its step rows.
 *
 * Pure: no React, no Supabase. The hooks are in `hooks/use-e2e-runs.ts`.
 */

import { DEFAULT_STATE, financesQuery } from "@/components/finances/finances-url";
import { rentalRefOf } from "@/lib/finances/lookups";
import { NORTHWIND } from "@/lib/v2";

export const E2E_RUNNER_FUNCTION = "e2e-runner";
export const E2E_RUNS_TABLE = "dev_sim_runs";
export const E2E_STEPS_TABLE = "dev_sim_run_steps";

/** Shown at the confirm (and sent with every start, for the record). */
export const CONFIRM_SENTENCE = "This writes test rows to northwind in Stripe TEST mode";

/** The only Stripe mode this page will ever offer a run in. */
export const REQUIRED_STRIPE_MODE = "test";

/* ── engines ─────────────────────────────────────────────────────────────── */

export type EngineKey =
  | "simple_booking"
  | "extension"
  | "auto_extend"
  | "payg"
  | "installments"
  | "payment_plans"
  | "cron_safety";

export interface EngineGroup {
  key: EngineKey;
  title: string;
  /** One line: what this engine's scenarios are there to prove. */
  blurb: string;
}

/**
 * The seven groups, in the order the lead asked the work to be verified
 * (spec §6: "verify simple booking first", then extension, then auto
 * extension), then the two plan engines, then the cron safety cases that cut
 * across all of them. "Run all" sends scenario ids in this order.
 */
export const ENGINE_GROUPS: readonly EngineGroup[] = [
  {
    key: "simple_booking",
    title: "Simple booking",
    blurb: "A booking is paid and every number reaches the operator correctly. Everything else is built on this.",
  },
  {
    key: "extension",
    title: "Extension",
    blurb: "An operator extends a rental: the new days, the charge for them, and how it is paid.",
  },
  {
    key: "auto_extend",
    title: "Auto-extend",
    blurb: "The rental renews itself on schedule: the period is charged, then the end date moves.",
  },
  {
    key: "payg",
    title: "Pay as you go",
    blurb: "Charges build up day by day while the car is out, and the customer is reminded to pay.",
  },
  {
    key: "installments",
    title: "Installments",
    blurb: "A booking split into scheduled payments, each charged on its date, with overdue marking.",
  },
  {
    key: "payment_plans",
    title: "Payment plans",
    blurb: "The unified plan engine: charges on due dates, retries, links, skips, moves and refunds.",
  },
  {
    key: "cron_safety",
    title: "Cron safety",
    blurb: "Two ticks at once, a crash after a charge, a webhook delivered twice: money moves once.",
  },
];

/** A scenario whose engine this page does not recognise still shows — here. */
export const OTHER_GROUP = { key: "other", title: "Other", blurb: "Scenarios whose engine this page does not recognise." } as const;

const ENGINE_ALIASES: Record<string, EngineKey> = {
  simple: "simple_booking",
  simple_booking: "simple_booking",
  booking: "simple_booking",
  extension: "extension",
  manual_extension: "extension",
  extend: "extension",
  auto_extend: "auto_extend",
  auto_extension: "auto_extend",
  autoextend: "auto_extend",
  payg: "payg",
  pay_as_you_go: "payg",
  installment: "installments",
  installments: "installments",
  payment_plan: "payment_plans",
  payment_plans: "payment_plans",
  plans: "payment_plans",
  cron: "cron_safety",
  cron_safety: "cron_safety",
  crons: "cron_safety",
};

export function engineKeyOf(raw: unknown): EngineKey | null {
  if (typeof raw !== "string") return null;
  const k = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ENGINE_ALIASES[k] ?? null;
}

/* ── small readers ───────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** snake_case or camelCase: the runner answers camelCase, the tables are snake_case. */
const pick = (o: Obj, snake: string, camel: string): unknown => (snake in o ? o[snake] : o[camel]);

/** A hand-derived amount from the catalogue: `{ cents, math, why? }`. */
export interface MoneyLike {
  cents: number;
  math?: string;
  why?: string;
}

export const isMoney = (v: unknown): v is MoneyLike => isObj(v) && typeof v.cents === "number" && Number.isFinite(v.cents);

/** 30000 → "$300.00", -30000 → "-$300.00", 123456 → "$1,234.56". */
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** A check's expectation in words: money with its hand derivation, lists joined. */
export function describeExpect(v: unknown): string {
  if (isMoney(v)) return v.math ? `${formatCents(v.cents)} (${v.math})` : formatCents(v.cents);
  if (Array.isArray(v)) return v.map((x) => describeExpect(x)).join(", ");
  if (typeof v === "string") return v;
  return v === undefined ? "—" : JSON.stringify(v);
}

const moneyWords = (v: unknown) => (isMoney(v) ? formatCents(v.cents) : describeExpect(v));

/**
 * One catalogue step in plain words. The step kinds are the catalogue's own
 * (tests/e2e/scenarios/types.ts `Step`); an unknown kind still shows, by name.
 */
export function describeStep(step: unknown): string {
  if (typeof step === "string") return step;
  if (!isObj(step)) return "(unreadable step)";
  const kind = str(step.kind);
  const note = str(step.note);
  const twice = step.copies === 2 ? " — twice at the same moment" : "";
  switch (kind) {
    case "charge_saved_card":
      return `Charge ${moneyWords(step.amount)} to the saved card${note ? ` (${note})` : ""}`;
    case "record_payment":
      return `Record a ${str(step.method) ?? "manual"} payment of ${moneyWords(step.amount)}${note ? ` (${note})` : ""}`;
    case "refund":
      return `Refund ${moneyWords(step.amount)} of ${str(step.category) ?? "the charge"} (${str(step.refundType) ?? "refund"})`;
    case "extend_manually":
      return `Extend the rental by ${String(step.days)} day${step.days === 1 ? "" : "s"} for ${moneyWords(step.amount)}`;
    case "pause_auto_extend":
      return "Pause automatic renewal";
    case "resume_auto_extend":
      return "Resume automatic renewal";
    case "swap_card":
      return `Swap the customer's card for the "${str(step.card) ?? "?"}" test card`;
    case "advance":
      return `Move the ${str(step.domain) ?? ""} clock forward ${String(step.days)} day${step.days === 1 ? "" : "s"}`;
    case "fire":
      return `Fire ${str(step.job) ?? "the job"} for this rental only${twice}`;
    case "tick_plan":
      return `Run the payment-plan tick for this rental${twice}${
        typeof step.ageAttemptsMinutes === "number" ? `, with in-flight attempts aged ${step.ageAttemptsMinutes} min` : ""
      }`;
    case "crash_after_charge":
      return "Crash straight after the card is charged, before anything is recorded";
    case "expire_latest_link":
      return "Expire the latest payment link";
    case "human":
      return `You: ${str(step.say) ?? "a step only a person can do"}`;
    case "replay_webhook":
      return `Deliver the ${str(step.event) ?? "webhook"} event a second time`;
    case "check":
      return `Check — ${str(step.label) ?? "values"}`;
    case "tie_out":
      return `Finances tie-out — ${str(step.label) ?? "bills"}`;
    default:
      return str(step.label) ?? str(step.title) ?? kind ?? "(unnamed step)";
  }
}

function readStepSpecs(v: unknown): ScenarioStepSpec[] {
  return arr(v).map((s, i) => ({
    id: (isObj(s) && str(s.id)) || `step-${i + 1}`,
    label: describeStep(s),
  }));
}

/**
 * The expected outcome, from the steps that state one: each `check`'s
 * `label: expect`, and each `tie_out`'s Outstanding / Collected and every
 * bill's Total − Paid − Credited = Balance. A plain `expected` field, if a
 * runner sends one, is shown too.
 */
function readExpected(raw: Obj): string[] {
  const out: string[] = [];
  const explicit = raw.expected;
  if (typeof explicit === "string" && explicit.trim()) out.push(explicit);
  else for (const x of arr(explicit)) if (x != null) out.push(typeof x === "string" ? x : describeExpect(x));
  for (const step of arr(raw.steps)) {
    if (!isObj(step)) continue;
    const label = str(step.label);
    if (step.kind === "check") {
      for (const c of arr(step.checks)) {
        if (!isObj(c)) continue;
        out.push(`${label ? `${label} — ` : ""}${str(c.label) ?? str(c.observe) ?? "check"}: ${describeExpect(c.expect)}`);
      }
    } else if (step.kind === "tie_out" && isObj(step.expect)) {
      const e = step.expect;
      out.push(
        `Finances ${label ? `${label} ` : ""}— Outstanding ${moneyWords(e.outstanding)}, Collected ${moneyWords(e.collected)}`,
      );
      for (const b of arr(e.bills)) {
        if (!isObj(b)) continue;
        out.push(
          `Finances ${label ? `${label} ` : ""}— ${str(b.label) ?? "bill"}: total ${moneyWords(b.total)}, paid ${moneyWords(
            b.paid,
          )}, credited ${moneyWords(b.credited)}, balance ${moneyWords(b.balance)}`,
        );
      }
    }
  }
  return out;
}

const strings = (v: unknown): string[] =>
  arr(v)
    .map((x) => str(x))
    .filter((x): x is string => !!x);

/* ── the catalogue ───────────────────────────────────────────────────────── */

export interface ScenarioStepSpec {
  id: string;
  label: string;
}

export interface CatalogueScenario {
  id: string;
  engine: EngineKey | null;
  /** What the runner called the engine (`family`) — shown when it is not recognised. */
  engineRaw: string | null;
  title: string;
  why: string | null;
  /** The expected outcome, one line per item — read from the `check` / `tie_out` steps. */
  expected: string[];
  steps: ScenarioStepSpec[];
  /** From the steps, or the summary's `stepCount` when the runner sends no steps. */
  stepCount: number;
  /** Steps only a person can do (pay a link, then Continue). */
  humanSteps: number;
  /** Where this scenario's evidence comes from: "live", "memory", "pglite". */
  tiers: string[];
  /** Why the live runner must not run it today. Shown, and never offered a Run button. */
  liveBlockedBy: string | null;
  /** Payment-plan engine scenarios (S1…S19b) this one stands for or restates. */
  references: string[];
  /** A defect this scenario is expected to expose — evidence decides. */
  suspect: string | null;
  /** Tenant settings its expected values depend on. */
  assumes: string[];
  /** Offered a Run button: its tiers include "live", nothing blocks it, it has a fixture. */
  runnableLive: boolean;
  /** True when this is the full scenario (steps and all), not the list's summary. */
  full: boolean;
  /** The scenario exactly as sent — `plannedWrites` reads its fixture and steps. */
  raw: unknown;
}

/** Parse one catalogue entry: the list's summary, a preview's full scenario, or a run's `scenario` column. */
export function readScenario(raw: unknown): CatalogueScenario | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const engineRaw = str(raw.family) ?? str(raw.engine);
  const tiers = strings(raw.tiers);
  const liveBlockedBy = str(pick(raw, "live_blocked_by", "liveBlockedBy"));
  const full = Array.isArray(raw.steps);
  const steps = readStepSpecs(raw.steps);
  const humanSteps =
    num(pick(raw, "human_steps", "humanSteps")) ?? arr(raw.steps).filter((s) => isObj(s) && s.kind === "human").length;
  // The summary carries the catalogue's own verdict (isLiveRunnable); the full shape is judged here the same way.
  const said = pick(raw, "live_runnable", "liveRunnable");
  const fixtureOk = !("fixture" in raw) || raw.fixture !== null;
  return {
    id,
    engine: engineKeyOf(engineRaw),
    engineRaw,
    title: str(raw.title) ?? id,
    why: str(raw.why),
    expected: readExpected(raw),
    steps,
    stepCount: num(pick(raw, "step_count", "stepCount")) ?? steps.length,
    humanSteps,
    tiers,
    liveBlockedBy,
    references: strings(raw.references),
    suspect: str(raw.suspect),
    assumes: strings(raw.assumes),
    // Fail closed: offered only when it SAYS live, nothing blocks it, and (when it says so itself) it agrees.
    runnableLive: tiers.includes("live") && !liveBlockedBy && fixtureOk && said !== false,
    full,
    raw,
  };
}

/** A summary entry, completed by the full scenario once the tester opens it (the summary's verdict stands). */
export function withFullScenario(summary: CatalogueScenario, full: CatalogueScenario | null): CatalogueScenario {
  if (!full || full.id !== summary.id) return summary;
  return { ...full, runnableLive: summary.runnableLive && full.runnableLive };
}

/* ── list: the runner, its checks, its catalogue ────────────────────────── */

/** One of the runner's own checks, in its words (a guards.ts `Verdict`). */
export interface RunnerCheck {
  name: string;
  ok: boolean;
  message: string | null;
}

export interface RunnerInfo {
  version: string | null;
  /** Explicit if the runner says it; else northwind, because the runner resolves its tenant by that slug and refuses any other (G2). */
  tenantSlug: string | null;
  /** Explicit if the runner says it; else "test" only when its Stripe-key check passed (G3). */
  stripeMode: string | null;
  /** The runner's environment checks as it reported them. */
  checks: RunnerCheck[];
  /** How the page knows what it shows — said on screen. */
  basis: string[];
}

export type RunnerList =
  | { ok: true; runner: RunnerInfo; catalogue: CatalogueScenario[] }
  | { ok: false; message: string };

const CHECK_NAMES: Record<string, string> = {
  stripeTestKey: "Stripe key is a TEST key (G3)",
  sandboxTenant: "sandbox clones are locked to northwind (G3)",
};

function readChecks(env: unknown): RunnerCheck[] {
  if (!isObj(env)) return [];
  return Object.entries(env).map(([k, v]) => ({
    name: CHECK_NAMES[k] ?? k,
    ok: isObj(v) && v.ok === true,
    message: isObj(v) ? str(v.message) ?? str(v.error) : null,
  }));
}

export function parseRunnerList(body: unknown): RunnerList {
  if (!isObj(body)) return { ok: false, message: "The runner answered, but not with JSON this page understands." };
  if (body.ok === false) return { ok: false, message: str(body.error) ?? str(body.message) ?? "The runner answered ok: false." };
  const seen = new Set<string>();
  const catalogue: CatalogueScenario[] = [];
  for (const raw of arr(body.scenarios ?? body.catalogue)) {
    const s = readScenario(raw);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    catalogue.push(s);
  }
  if (catalogue.length === 0) return { ok: false, message: "The runner answered, but lists no scenarios." };

  const r = isObj(body.runner) ? body.runner : {};
  const checks = readChecks(body.environment);
  const keyCheck = isObj(body.environment) ? body.environment.stripeTestKey : undefined;
  const explicitMode = str(pick(r, "stripe_mode", "stripeMode"));
  const explicitSlug = str(pick(r, "tenant_slug", "tenantSlug"));
  const basis: string[] = [];
  let stripeMode = explicitMode;
  if (!stripeMode && isObj(keyCheck) && keyCheck.ok === true) {
    stripeMode = REQUIRED_STRIPE_MODE;
    basis.push("Stripe test mode: the runner's own key check passed, and it refuses any tenant whose stripe_mode is not test (G2, G3).");
  }
  let tenantSlug = explicitSlug;
  if (!tenantSlug) {
    tenantSlug = NORTHWIND;
    basis.push("Tenant northwind: the runner looks its tenant up by that slug and refuses every request otherwise (G2).");
  }
  return {
    ok: true,
    runner: { version: str(r.version), tenantSlug, stripeMode, checks, basis },
    catalogue,
  };
}

/**
 * The page's own refusal, on top of the runner's guards: it will not OFFER a
 * run unless the runner's checks all passed and it is northwind in Stripe test
 * mode. A runner that does not say is refused too — silence is not "test".
 */
export function runnerSafetyProblem(runner: RunnerInfo): string | null {
  const failed = runner.checks.find((c) => !c.ok);
  if (failed) return `The runner reports that a check failed — ${failed.name}: ${failed.message ?? "no detail"}`;
  if (runner.stripeMode !== REQUIRED_STRIPE_MODE) {
    return runner.stripeMode
      ? `The runner reports Stripe mode "${runner.stripeMode}". Live runs are offered only in Stripe test mode.`
      : "The runner did not say which Stripe mode it would use. Live runs are offered only when it says test.";
  }
  if (runner.tenantSlug !== NORTHWIND) {
    return `The runner reports tenant "${runner.tenantSlug}". Live runs are offered only on ${NORTHWIND}.`;
  }
  return null;
}

export interface CatalogueGroup {
  key: EngineKey | typeof OTHER_GROUP.key;
  title: string;
  blurb: string;
  scenarios: CatalogueScenario[];
}

/**
 * The seven groups, ALWAYS all seven — an engine the runner has no scenario
 * for shows as an empty group, because a gap in coverage is itself evidence —
 * then "Other" only if something did not match.
 */
export function groupCatalogue(catalogue: readonly CatalogueScenario[]): CatalogueGroup[] {
  const groups: CatalogueGroup[] = ENGINE_GROUPS.map((g) => ({ ...g, scenarios: [] }));
  const other: CatalogueScenario[] = [];
  for (const s of catalogue) {
    const g = s.engine ? groups.find((x) => x.key === s.engine) : null;
    if (g) g.scenarios.push(s);
    else other.push(s);
  }
  if (other.length) groups.push({ ...OTHER_GROUP, scenarios: other });
  return groups;
}

/** Every live-runnable scenario id, in group order — what "Run all" runs. */
export function allScenarioIds(catalogue: readonly CatalogueScenario[]): string[] {
  return groupCatalogue(catalogue).flatMap((g) => g.scenarios.filter((s) => s.runnableLive).map((s) => s.id));
}

/* ── preview ─────────────────────────────────────────────────────────────── */

/** One scenario's preview, as the runner answered it. */
export interface ScenarioPreview {
  scenarioId: string;
  /** The FULL scenario (steps and expectations). */
  scenario: CatalogueScenario | null;
  runnable: RunnerCheck;
  /** Tenant settings the expected values were derived under, and any that differ now. */
  assumptionsOk: boolean | null;
  assumptionsFailed: string[];
  checks: RunnerCheck[];
  /** Writes the preview's read-only client REFUSED — proof it wrote nothing; normally empty. */
  refusedWrites: string[];
  wouldStart: boolean | null;
  raw: unknown;
}

/** The preview of a whole run request: one per scenario, in run order. */
export interface RunPreview {
  items: ScenarioPreview[];
}

const verdictOf = (name: string, v: unknown): RunnerCheck => ({
  name,
  ok: isObj(v) && v.ok === true,
  message: isObj(v) ? str(v.message) ?? str(v.error) : "not reported",
});

export function parseScenarioPreview(body: unknown, requestedId: string): ScenarioPreview | null {
  if (!isObj(body) || body.ok === false) return null;
  const scenario = readScenario(body.scenario);
  const assumptions = isObj(body.assumptions) ? body.assumptions : null;
  return {
    scenarioId: scenario?.id ?? requestedId,
    scenario,
    runnable: verdictOf("the scenario may run live (G4)", body.runnable),
    assumptionsOk: assumptions ? assumptions.ok === true : null,
    assumptionsFailed: assumptions
      ? arr(assumptions.failed).map((f) => (typeof f === "string" ? f : isObj(f) ? str(f.message) ?? str(f.assumption) ?? JSON.stringify(f) : String(f)))
      : [],
    checks: readChecks(body.environment),
    refusedWrites: strings(body.writes),
    wouldStart: typeof body.wouldStart === "boolean" ? body.wouldStart : null,
    raw: body,
  };
}

/**
 * Why this preview may NOT be confirmed, or an empty list. The confirm button
 * is disabled while anything is listed.
 */
export function previewProblems(preview: RunPreview, requested: readonly string[]): string[] {
  const out: string[] = [];
  const byId = new Map(preview.items.map((p) => [p.scenarioId, p] as const));
  for (const id of requested) {
    const p = byId.get(id);
    if (!p) {
      out.push(`The runner gave no preview for ${id}.`);
      continue;
    }
    if (!p.scenario) out.push(`${id}: the preview did not include the scenario, so what it would write cannot be shown.`);
    if (!p.runnable.ok) out.push(`${id}: the runner will not run it — ${p.runnable.message ?? "no reason given"}.`);
    if (p.assumptionsOk === false) {
      out.push(`${id}: northwind's settings differ from the ones its expected values assume${p.assumptionsFailed.length ? ` (${p.assumptionsFailed.join("; ")})` : ""}.`);
    }
    if (p.assumptionsOk === null) out.push(`${id}: the preview did not check the tenant's settings.`);
    for (const c of p.checks) if (!c.ok) out.push(`${id}: ${c.name} — ${c.message ?? "failed"}.`);
    if (p.refusedWrites.length) out.push(`${id}: the preview tried to write (${p.refusedWrites.join(", ")}) and was stopped — that is a runner fault.`);
    if (p.wouldStart === false && p.runnable.ok && p.assumptionsOk !== false && p.checks.every((c) => c.ok)) {
      out.push(`${id}: the runner says it would not start.`);
    }
  }
  const extra = preview.items.map((p) => p.scenarioId).filter((id) => !requested.includes(id));
  if (extra.length) out.push(`The preview includes scenarios that were not asked for: ${extra.join(", ")}.`);
  return out;
}

export interface PlannedWrite {
  /** Where it lands: a table, "Stripe TEST", or an edge function that writes. */
  where: string;
  what: string;
}

const CARD_WORDS: Record<string, string> = {
  visa: "Visa test card (always succeeds)",
  declined: "test card that attaches, then declines every off-session charge",
  auth_required: "test card that asks for authentication",
};

/**
 * What a run of this scenario writes, read from the scenario itself — its
 * fixture and its steps — following what e2e-runner's runner.ts does for each.
 * The runner's own preview checks the guards but does not list writes, so the
 * page says where this list comes from.
 */
export function plannedWrites(scenario: CatalogueScenario): PlannedWrite[] {
  const raw = isObj(scenario.raw) ? scenario.raw : {};
  const fx = isObj(raw.fixture) ? raw.fixture : null;
  const out: PlannedWrite[] = [
    { where: "dev_sim_runs", what: "1 row for this run (the evidence)" },
    { where: "dev_sim_run_steps", what: `${scenario.stepCount + 1} rows — the fixture and each step, with every check` },
  ];
  if (!fx) return out;
  out.push({ where: "customers", what: "1 fixture customer named E2E-FIXTURE…, at an @e2e.drive247.test address, no phone" });
  const card = str(fx.card);
  if (card) {
    out.push({
      where: "Stripe TEST",
      what: `a customer with the ${CARD_WORDS[card] ?? `"${card}" test card`} (sandbox-fixture-setup), and a $1.00 hold it places, cancelled at once`,
    });
  }
  out.push({ where: "rentals", what: "1 fixture rental, no vehicle, marked as this run's fixture and registered in dev_sim_fixtures" });
  const charges = arr(fx.charges).filter(isObj);
  if (charges.length) {
    out.push({
      where: "ledger_entries",
      what: `${charges.length} booking charge${charges.length === 1 ? "" : "s"}: ${charges
        .map((c) => `${str(c.category) ?? "Charge"} ${isMoney(c.amount) ? formatCents(c.amount.cents) : "?"}`)
        .join(", ")}`,
    });
  }
  if (isObj(fx.installments)) {
    const n = num(fx.installments.count) ?? 0;
    out.push({
      where: "installment_plans, scheduled_installments",
      what: `1 parked plan and ${n} installment${n === 1 ? "" : "s"} of ${isMoney(fx.installments.amount) ? formatCents(fx.installments.amount.cents) : "?"}`,
    });
  }
  if (isObj(fx.plan)) {
    const n = num(fx.plan.count) ?? 0;
    out.push({ where: "payment-plan-manage", what: `a payment plan of ${n} occurrence${n === 1 ? "" : "s"}, created the way the operator creates one` });
  }
  for (const st of arr(raw.steps)) {
    if (!isObj(st)) continue;
    const m = isMoney(st.amount) ? formatCents(st.amount.cents) : "?";
    switch (st.kind) {
      case "charge_saved_card":
        out.push({ where: "charge-saved-card", what: `a Stripe TEST charge of ${m} on the saved card, its payment row and allocation` });
        break;
      case "record_payment":
        out.push({ where: "payments", what: `a ${str(st.method) ?? "manual"} payment of ${m}, applied by apply-payment` });
        break;
      case "refund":
        out.push({ where: "process-refund", what: `a Stripe TEST refund of ${m} of ${str(st.category) ?? "the charge"}, and its Refund ledger row` });
        break;
      case "extend_manually":
        out.push({ where: "create-extension-checkout", what: `an extension of ${String(st.days)} day(s) for ${m}: its charge and a Stripe TEST payment link` });
        break;
      case "pause_auto_extend":
      case "resume_auto_extend":
        out.push({ where: "rentals", what: `automatic renewal ${st.kind === "pause_auto_extend" ? "paused" : "resumed"} on the fixture` });
        break;
      case "swap_card":
        out.push({ where: "Stripe TEST", what: `the fixture customer's card changed to the ${CARD_WORDS[str(st.card) ?? ""] ?? "other test card"}` });
        break;
      case "advance":
        out.push({ where: "e2e_shift_fixture", what: `the fixture's ${str(st.domain) ?? ""} dates moved ${String(st.days)} day(s) into the past — nothing else's` });
        break;
      case "fire":
        out.push({
          where: str(st.job) ?? "a sandbox job",
          what: `run for the fixture only (only_rental_id)${st.copies === 2 ? ", twice at once" : ""} — whatever it writes for that rental`,
        });
        break;
      case "tick_plan":
      case "crash_after_charge":
        out.push({ where: "payment-plan engine", what: `a tick for the fixture's plan only${st.kind === "crash_after_charge" ? ", with a crash after the charge" : ""}` });
        break;
      case "expire_latest_link":
        out.push({ where: "Stripe TEST", what: "the latest checkout session expired" });
        break;
      case "replay_webhook":
        out.push({ where: "stripe-webhook-test", what: "the fixture's own checkout.session.completed delivered a second time" });
        break;
      default:
        break; // check, tie_out, human: the runner reads; a person pays a TEST link.
    }
  }
  return out;
}

/* ── an answer from start / advance / continue ───────────────────────────── */

export interface RunOutcome {
  runId: string | null;
  status: RunStatus | null;
  /** Wait this long before the next advance (a real cron's window, G8). */
  deferredSeconds: number | null;
  error: string | null;
}

export function parseOutcome(body: unknown): RunOutcome {
  const o = isObj(body) ? body : {};
  const run = normalizeRun({ id: "x", status: o.status });
  return {
    runId: str(pick(o, "run_id", "runId")),
    status: run && run.status !== "unknown" ? run.status : null,
    deferredSeconds: num(pick(o, "deferred_seconds", "deferredSeconds")),
    error: str(o.error),
  };
}

/* ── the run: one dev_sim_runs row per scenario run ──────────────────────── */

/**
 * `dev_sim_runs.status`, read tolerantly. `waiting` = a `human` step is
 * waiting for the tester (pay the link, then Continue); not terminal.
 * The migration spells the error state `errored`.
 */
export type RunStatus = "running" | "waiting" | "passed" | "failed" | "error" | "aborted" | "unknown";
/**
 * A step on the timeline. `dev_sim_run_steps.status` is ok | failed | error |
 * refused for a step that ran; the others are this page's reading of where
 * the run is (`runTimeline`).
 */
export type StepStatus = "pending" | "running" | "waiting" | "passed" | "failed" | "error" | "refused" | "skipped";
/** A run's verdict as THIS page reads the evidence (see `runVerdict`). */
export type Verdict = "pending" | "running" | "waiting" | "passed" | "failed" | "error" | "aborted" | "unproven" | "unknown";

export const TERMINAL_RUN: readonly RunStatus[] = ["passed", "failed", "error", "aborted"];
export const isTerminal = (s: RunStatus) => TERMINAL_RUN.includes(s);

export interface RunAssertion {
  label: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  /** The hand derivation of the expected value, when the runner carries it. */
  math: string | null;
}

export interface RunFixture {
  rentalId: string | null;
  rentalNumber: string | null;
  customerId: string | null;
}

/** `dev_sim_runs.waiting_for`: `{ stepIndex, ask, say, url }`. */
export interface WaitingFor {
  stepIndex: number | null;
  ask: string | null;
  say: string | null;
  url: string | null;
}

export interface E2eRun {
  id: string;
  scenarioId: string;
  /** `dev_sim_runs.scenario` — the scenario exactly as the catalogue said it when the run began. */
  scenario: CatalogueScenario | null;
  status: RunStatus;
  nextStep: number | null;
  waitingFor: WaitingFor | null;
  fixture: RunFixture | null;
  passCount: number | null;
  failCount: number | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  /** Set by the runner's `close`: the fixture rental is Closed. */
  fixtureClosedAt: string | null;
  /** The row exactly as it was read — the evidence file carries it untouched. */
  raw: unknown;
}

/** One `dev_sim_run_steps` row: a step that RAN (step_index -1 is the fixture). */
export interface ExecutedStep {
  stepIndex: number;
  kind: string | null;
  label: string | null;
  status: StepStatus;
  assertions: RunAssertion[];
  /** What the step's edge-function call answered, when it failed or was refused. */
  detail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  raw: unknown;
}

const RUN_STATUS_ALIASES: Record<string, RunStatus> = {
  running: "running",
  in_progress: "running",
  queued: "running",
  waiting: "waiting",
  waiting_for_human: "waiting",
  passed: "passed",
  failed: "failed",
  error: "error",
  errored: "error",
  aborted: "aborted",
  cancelled: "aborted",
  canceled: "aborted",
};

const EXECUTED_STATUS_ALIASES: Record<string, StepStatus> = {
  ok: "passed",
  passed: "passed",
  failed: "failed",
  error: "error",
  errored: "error",
  refused: "refused",
};

const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function readAssertions(v: unknown): RunAssertion[] {
  return arr(v)
    .map((a, i) => {
      if (!isObj(a)) return null;
      return {
        label: str(a.label) ?? str(a.check) ?? str(a.observe) ?? `check ${i + 1}`,
        expected: "expected" in a ? a.expected : a.expect,
        actual: "actual" in a ? a.actual : a.observed,
        // Only a literal true passes. A missing or odd value is a fail, never a pass.
        pass: a.pass === true,
        math: str(a.math),
      };
    })
    .filter((a): a is RunAssertion => !!a);
}

function readFixture(v: unknown): RunFixture | null {
  if (!isObj(v)) return null;
  const f = {
    rentalId: str(pick(v, "rental_id", "rentalId")),
    rentalNumber: str(pick(v, "rental_number", "rentalNumber")),
    customerId: str(pick(v, "customer_id", "customerId")),
  };
  return f.rentalId || f.customerId ? f : null;
}

function readWaiting(v: unknown): WaitingFor | null {
  if (!isObj(v)) return null;
  return {
    stepIndex: int(pick(v, "step_index", "stepIndex")),
    ask: str(v.ask),
    say: str(v.say),
    url: str(v.url) ?? str(v.link),
  };
}

export function normalizeRun(row: unknown): E2eRun | null {
  if (!isObj(row)) return null;
  const id = str(row.id);
  if (!id) return null;
  const scenario = readScenario(row.scenario);
  return {
    id,
    scenarioId: str(pick(row, "scenario_id", "scenarioId")) ?? scenario?.id ?? "?",
    scenario,
    status: RUN_STATUS_ALIASES[lower(row.status)] ?? "unknown",
    nextStep: int(pick(row, "next_step", "nextStep")),
    waitingFor: readWaiting(pick(row, "waiting_for", "waitingFor")),
    fixture: readFixture(row.fixture),
    passCount: int(pick(row, "pass_count", "passCount")),
    failCount: int(pick(row, "fail_count", "failCount")),
    error: str(row.error),
    createdBy: str(pick(row, "created_by", "createdBy")),
    createdAt: str(pick(row, "created_at", "createdAt")),
    updatedAt: str(pick(row, "updated_at", "updatedAt")),
    finishedAt: str(pick(row, "finished_at", "finishedAt")),
    fixtureClosedAt: str(pick(row, "fixture_closed_at", "fixtureClosedAt")),
    raw: row,
  };
}

export function normalizeStep(row: unknown): ExecutedStep | null {
  if (!isObj(row)) return null;
  const stepIndex = int(pick(row, "step_index", "stepIndex"));
  if (stepIndex === null) return null;
  const response = isObj(row.response) ? row.response : null;
  const status = EXECUTED_STATUS_ALIASES[lower(row.status)] ?? "error";
  return {
    stepIndex,
    kind: str(row.kind),
    label: str(row.label),
    status,
    assertions: readAssertions(row.assertions),
    detail:
      status === "passed"
        ? null
        : str(row.error) ?? (response ? str(response.error) ?? str(response.message) ?? str(response.reason) : null),
    startedAt: str(pick(row, "started_at", "startedAt")),
    finishedAt: str(pick(row, "finished_at", "finishedAt")),
    raw: row,
  };
}

/** A step as the report draws it: every step of the scenario, ran or not. */
export interface TimelineStep {
  index: number;
  label: string;
  status: StepStatus;
  assertions: RunAssertion[];
  detail: string | null;
  /** Only on the step the run is waiting on. */
  waiting: WaitingFor | null;
  at: string | null;
}

/**
 * Every step of the scenario in order — the fixture first (step_index -1) —
 * each with what happened to it: the executed row's status and checks where
 * one exists; `waiting` on the step `waiting_for` names; `running` on
 * `next_step` while the run goes; `skipped` for a step a finished run never
 * reached; `pending` otherwise. A step row the scenario does not list (a
 * runner newer than its scenario) is still shown, never dropped.
 */
export function runTimeline(run: E2eRun, executed: readonly ExecutedStep[], spec: CatalogueScenario | null): TimelineStep[] {
  const specs = (run.scenario ?? spec)?.steps ?? [];
  const byIndex = new Map(executed.map((s) => [s.stepIndex, s] as const));
  const indices = [-1, ...specs.map((_, i) => i)];
  for (const s of executed) if (!indices.includes(s.stepIndex)) indices.push(s.stepIndex);
  indices.sort((a, b) => a - b);
  const done = isTerminal(run.status);
  return indices.map((index) => {
    const ran = byIndex.get(index);
    const label =
      index === -1 ? (ran?.label ?? "Create the fixture rental") : (specs[index]?.label ?? ran?.label ?? ran?.kind ?? `step ${index + 1}`);
    if (ran) {
      return { index, label, status: ran.status, assertions: ran.assertions, detail: ran.detail, waiting: null, at: ran.finishedAt };
    }
    let status: StepStatus = "pending";
    let waiting: WaitingFor | null = null;
    if (run.status === "waiting" && run.waitingFor && run.waitingFor.stepIndex === index) {
      status = "waiting";
      waiting = run.waitingFor;
    } else if (run.status === "running" && (run.nextStep ?? 0) === index) status = "running";
    else if (run.status === "running" && index === -1 && run.nextStep === null) status = "running";
    else if (done) status = "skipped";
    return { index, label, status, assertions: [], detail: null, waiting, at: null };
  });
}

export interface RunCounts {
  /** Checks that passed / failed, counted from the step rows. */
  passed: number;
  failed: number;
  /** Steps that failed, errored or were refused. */
  badSteps: number;
}

/** Counted from the step rows — never copied from pass_count / fail_count. */
export function runCounts(executed: readonly ExecutedStep[]): RunCounts {
  const c: RunCounts = { passed: 0, failed: 0, badSteps: 0 };
  for (const s of executed) {
    for (const a of s.assertions) {
      if (a.pass) c.passed += 1;
      else c.failed += 1;
    }
    if (s.status === "failed" || s.status === "error" || s.status === "refused") c.badSteps += 1;
  }
  return c;
}

/**
 * A run's verdict, from the EVIDENCE rather than the runner's word:
 *
 *   - any failed check, or any step that failed / errored / was refused,
 *     fails the run, whatever status the row carries — even mid-run;
 *   - a run the row calls passed with NO checks is "unproven": it proved
 *     nothing, and is never shown as a pass;
 *   - a row whose own fail_count is above zero is failed, too (the runner's
 *     own count is a second witness, never the only one);
 *   - otherwise the row's status stands.
 */
export function runVerdict(run: E2eRun, executed: readonly ExecutedStep[]): Verdict {
  const c = runCounts(executed);
  if (c.failed > 0 || c.badSteps > 0 || (run.failCount ?? 0) > 0) return "failed";
  if (run.status === "passed") return c.passed > 0 ? "passed" : "unproven";
  return run.status;
}

/**
 * The verdict from the row alone — the history table, before a run's steps
 * are read. Never greener than `runVerdict`: a passed row with no passing
 * checks recorded is unproven.
 */
export function rowVerdict(run: E2eRun): Verdict {
  if ((run.failCount ?? 0) > 0) return "failed";
  if (run.status === "passed") return (run.passCount ?? 0) > 0 ? "passed" : "unproven";
  return run.status;
}

/* ── links to the real screens ──────────────────────────────────────────── */

export function rentalHref(f: RunFixture): string | null {
  return f.rentalId ? `/rentals/${f.rentalId}` : null;
}

/**
 * Finances narrowed to this rental: the search matches the rental's reference
 * (`rentalRefOf`, the same rule the Finances rows use — its `rental_number`,
 * which every rental gets from a trigger), over ALL time so a fixture dated
 * outside this month still shows. Without the number there is no link: the
 * id-prefix fallback would never match a numbered rental.
 */
export function financesHref(f: RunFixture, view: "billed" | "received" | "upcoming"): string | null {
  if (!f.rentalId || !f.rentalNumber) return null;
  const ref = rentalRefOf({ id: f.rentalId, rental_number: f.rentalNumber }, f.rentalId);
  if (!ref) return null;
  return `/finances?${financesQuery({ ...DEFAULT_STATE, view, q: ref, period: "all" })}`;
}

/* ── evidence ────────────────────────────────────────────────────────────── */

export function evidenceFileName(runIds: readonly string[], now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "");
  const tag = runIds.length === 1 ? runIds[0].slice(0, 8) : `${runIds.length}-runs`;
  return `e2e-live-run-${tag}-${stamp}.json`;
}

/**
 * The evidence file: every row exactly as read (the run and each step), this
 * page's reading of it (the verdict and every check), what each scenario was
 * supposed to prove, and the preview that was confirmed. Everything a
 * reviewer needs to disagree with the verdict.
 */
export function buildEvidence(args: {
  runs: readonly { run: E2eRun; steps: readonly ExecutedStep[] }[];
  runner: RunnerInfo | null;
  catalogue: readonly CatalogueScenario[];
  confirmedPreview: RunPreview | null;
  now?: Date;
}) {
  const { runs, runner, catalogue, confirmedPreview } = args;
  const byId = new Map(catalogue.map((s) => [s.id, s] as const));
  return {
    kind: "e2e-live-run",
    generatedAt: (args.now ?? new Date()).toISOString(),
    writesToDatabase: true,
    tenant: NORTHWIND,
    stripeMode: runner?.stripeMode ?? null,
    runner,
    confirmedPreview: confirmedPreview ? confirmedPreview.items.map((p) => p.raw) : null,
    runs: runs.map(({ run, steps }) => {
      const spec = run.scenario ?? byId.get(run.scenarioId) ?? null;
      const counts = runCounts(steps);
      return {
        id: run.id,
        scenarioId: run.scenarioId,
        title: spec?.title ?? null,
        why: spec?.why ?? null,
        expectedOutcome: spec?.expected ?? [],
        status: run.status,
        verdict: runVerdict(run, steps),
        counts,
        runnerCounts: { pass: run.passCount, fail: run.failCount },
        fixture: run.fixture,
        startedAt: run.createdAt,
        finishedAt: run.finishedAt,
        error: run.error,
        timeline: runTimeline(run, steps, spec).map((t) => ({
          index: t.index,
          label: t.label,
          status: t.status,
          detail: t.detail,
          checks: t.assertions,
        })),
        row: run.raw,
        stepRows: steps.map((s) => s.raw),
      };
    }),
  };
}

/* ── display ─────────────────────────────────────────────────────────────── */

/** A check's expected or actual value: money with its derivation, strings as-is, the rest as JSON. */
export const showValue = (v: unknown): string =>
  v === undefined ? "—" : isMoney(v) ? describeExpect(v) : typeof v === "string" ? v : JSON.stringify(v);

/**
 * An actual value beside a money expectation: a bare number there is cents
 * (every `*_cents` observable), so it reads as money too — "$300.00", not
 * "30000". The evidence file keeps the raw value.
 */
export const showActual = (expected: unknown, actual: unknown): string =>
  isMoney(expected) && typeof actual === "number" && Number.isFinite(actual)
    ? formatCents(actual)
    : isMoney(actual)
      ? formatCents(actual.cents)
      : showValue(actual);
