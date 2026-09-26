// e2e-runner — the guards, as pure functions (no Deno, no network).
//
// Every refusal the runner can give is decided here, so tests/e2e/
// runner-guards.test.ts can prove each one offline, and index.ts only feeds
// them the rows it read. The SQL functions in
// supabase/migrations/20260926120300_dev_sim_runs.sql enforce the fixture and
// tenant guards a second time, in the database, where a bug in this file
// cannot reach them.
//
// Runtime-agnostic on purpose (Node for vitest, Deno for the function): no
// imports but relative type-only ones.

import type { Scenario, TenantAssumption, TestCard } from "./catalogue/types.ts";

export const E2E_TENANT_SLUG = "northwind";
/** What E2E_RUNNER_ENABLED must say for the function to do anything at all. */
export const KILL_SWITCH_VALUE = "northwind";
export const FIXTURE_NAME_PREFIX = "E2E-FIXTURE";
/** RFC 2606 reserves `.test`: mail to it can never reach a person. */
export const FIXTURE_EMAIL_DOMAIN = "e2e.drive247.test";
/** No single operator step in the catalogue moves more than this (fixture scale). */
export const MAX_STEP_CENTS = 100_000;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stripe TEST tokens that attach to a customer (sandbox-fixture-setup's allow-list keys). */
export const ATTACHABLE_CARDS: readonly TestCard[] = ["visa", "declined", "auth_required"];

/** The sandbox clones the runner may call — each refuses without only_rental_id. */
export const SANDBOX_JOBS = [
  "sandbox-accrue-payg-charges",
  "sandbox-send-payg-reminders",
  "sandbox-auto-extend-rentals",
  "sandbox-process-installment-payment",
] as const;

export interface Refusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}
export type Verdict = { ok: true } | Refusal;

const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });
const OK: Verdict = { ok: true };

// ─── G0 — kill switch ───────────────────────────────────────────────────────

/** Deploying the function does nothing until E2E_RUNNER_ENABLED=northwind is set. */
export function checkKillSwitch(value: string | null | undefined): Verdict {
  if ((value ?? "").trim() !== KILL_SWITCH_VALUE) {
    return refuse(503, "runner_disabled", "The E2E runner is switched off (E2E_RUNNER_ENABLED is not set to northwind).");
  }
  return OK;
}

// ─── G1 — who may run it ────────────────────────────────────────────────────

export interface CallerRow {
  id: string;
  role: string | null;
  tenant_id: string | null;
  is_super_admin: boolean | null;
  is_active: boolean | null;
}

/**
 * A super admin, or a head_admin whose tenant IS northwind — resolved by SLUG
 * (northwind is a different id on production and on the staging branch).
 */
export function checkCaller(caller: CallerRow | null, northwindTenantId: string | null): Verdict {
  if (!caller) return refuse(401, "not_signed_in", "Sign in to run end-to-end scenarios.");
  if (caller.is_active === false) return refuse(403, "inactive", "This account is not active.");
  if (caller.is_super_admin === true) return OK;
  if (!northwindTenantId) return refuse(403, "no_northwind", "The northwind tenant was not found.");
  if (caller.role !== "head_admin") return refuse(403, "not_head_admin", "Only northwind's head admin (or a super admin) can run end-to-end scenarios.");
  if (caller.tenant_id !== northwindTenantId) return refuse(403, "not_northwind", "End-to-end scenarios run on northwind only.");
  return OK;
}

// ─── G2 — which tenant ──────────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  slug: string | null;
  status: string | null;
  stripe_mode: string | null;
  payment_provider?: string | null;
  currency_code?: string | null;
  timezone?: string | null;
  tax_enabled?: boolean | null;
  tax_percentage?: number | string | null;
  service_fee_enabled?: boolean | null;
  service_fee_value?: number | string | null;
  auto_extend_grace_hours?: number | null;
  auto_extend_max_retries?: number | null;
  payg_accrual_window_seconds?: number | null;
  payg_auto_reminders_enabled?: boolean | null;
}

/** Northwind, by slug, active, in Stripe TEST mode, on Stripe. Nothing else, ever. */
export function checkTenant(t: TenantRow | null): Verdict {
  if (!t) return refuse(412, "no_tenant", "The northwind tenant was not found.");
  if (t.slug !== E2E_TENANT_SLUG) return refuse(403, "not_northwind", `Refused: tenant '${t.slug}' is not northwind.`);
  if (t.status !== "active") return refuse(412, "tenant_inactive", "Refused: northwind is not active.");
  if (t.stripe_mode !== "test") return refuse(412, "stripe_live", "Refused: northwind is not in Stripe TEST mode. The runner never runs against live Stripe.");
  if ((t.payment_provider ?? "stripe") !== "stripe") return refuse(412, "not_stripe", "Refused: northwind is not on Stripe.");
  return OK;
}

// ─── G3 — the environment ───────────────────────────────────────────────────

/** A Stripe TEST secret or restricted key, never anything else. */
export function checkStripeTestKey(key: string | null | undefined): Verdict {
  const k = (key ?? "").trim();
  if (!/^(sk|rk)_test_[A-Za-z0-9]/.test(k)) {
    return refuse(412, "stripe_key_not_test", "Refused: the Stripe key the runner would use is not a TEST key.");
  }
  return OK;
}

/** The sandbox clones are tenant-locked to SANDBOX_TEST_TENANT_ID; it must be northwind. */
export function checkSandboxTenant(sandboxTenantId: string | null | undefined, northwindTenantId: string): Verdict {
  const v = (sandboxTenantId ?? "").trim();
  if (!v) return refuse(412, "sandbox_unset", "Refused: SANDBOX_TEST_TENANT_ID is not set, so the sandbox clones would refuse every call.");
  if (v !== northwindTenantId) return refuse(412, "sandbox_other_tenant", "Refused: SANDBOX_TEST_TENANT_ID names a tenant other than northwind.");
  return OK;
}

// ─── The scenario ───────────────────────────────────────────────────────────

export function checkScenarioRunnable(s: Scenario | null): Verdict {
  if (!s) return refuse(404, "no_scenario", "No such scenario in the catalogue.");
  if (!s.tiers.includes("live")) return refuse(422, "not_live", `${s.id} is not a live scenario — it runs in the ${s.tiers.join(" / ")} tier.`);
  if (s.liveBlockedBy) return refuse(422, "live_blocked", `${s.id} cannot run live yet: ${s.liveBlockedBy}`);
  if (!s.fixture) return refuse(422, "no_fixture", `${s.id} has no fixture.`);
  if (s.fixture.card !== null && s.fixture.card !== "visa") {
    return refuse(422, "fixture_card", `${s.id}: a fixture starts on the visa card (the hold would fail on any other); swap cards with a step.`);
  }
  for (const st of s.steps) {
    const v = checkStep(st);
    if (!v.ok) return v;
  }
  return OK;
}

/** Per-step limits: an allow-listed card, a sandbox clone, a bounded amount. */
export function checkStep(st: Scenario["steps"][number]): Verdict {
  if (st.kind === "swap_card" && !ATTACHABLE_CARDS.includes(st.card)) return refuse(422, "card", `Card '${st.card}' is not an allow-listed Stripe TEST token.`);
  if (st.kind === "fire" && !(SANDBOX_JOBS as readonly string[]).includes(st.job)) return refuse(422, "job", `'${st.job}' is not a sandbox clone.`);
  if ((st.kind === "charge_saved_card" || st.kind === "record_payment" || st.kind === "refund" || st.kind === "extend_manually") && !checkAmount(st.amount.cents).ok) {
    return refuse(422, "amount", `Step amount ${st.amount.cents} cents is outside the fixture range.`);
  }
  if (st.kind === "advance" && (!Number.isInteger(st.days) || st.days < 1 || st.days > 60)) return refuse(422, "advance", "An advance is 1–60 whole days.");
  return OK;
}

export function checkAmount(cents: number): Verdict {
  if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_STEP_CENTS) return refuse(422, "amount", `Amount ${cents} cents is outside 1…${MAX_STEP_CENTS}.`);
  return OK;
}

export interface AssumptionResult {
  ok: boolean;
  failed: { assumption: TenantAssumption; actual: unknown }[];
}

/** The tenant settings the expected values were derived under. Checked before any write. */
export function checkAssumptions(assumes: readonly TenantAssumption[], t: TenantRow): AssumptionResult {
  const num = (v: unknown) => Number(v ?? 0);
  const failed: AssumptionResult["failed"] = [];
  for (const a of assumes) {
    let holds = true;
    let actual: unknown = null;
    switch (a) {
      case "tax_off":
        actual = { tax_enabled: t.tax_enabled ?? null, tax_percentage: t.tax_percentage ?? null };
        holds = t.tax_enabled !== true || num(t.tax_percentage) === 0;
        break;
      case "service_fee_off":
        actual = { service_fee_enabled: t.service_fee_enabled ?? null, service_fee_value: t.service_fee_value ?? null };
        holds = t.service_fee_enabled !== true || num(t.service_fee_value) === 0;
        break;
      case "usd":
        actual = t.currency_code ?? null;
        holds = String(t.currency_code ?? "USD").toUpperCase() === "USD";
        break;
      case "auto_extend_grace_48h":
        actual = t.auto_extend_grace_hours ?? null;
        holds = num(t.auto_extend_grace_hours ?? 48) === 48;
        break;
      case "auto_extend_retries_3":
        actual = t.auto_extend_max_retries ?? null;
        holds = num(t.auto_extend_max_retries ?? 3) === 3;
        break;
      case "payg_window_1_day":
        actual = t.payg_accrual_window_seconds ?? null;
        holds = num(t.payg_accrual_window_seconds ?? 86400) === 86400;
        break;
      case "payg_reminders_on":
        actual = t.payg_auto_reminders_enabled ?? null;
        holds = t.payg_auto_reminders_enabled !== false;
        break;
    }
    if (!holds) failed.push({ assumption: a, actual });
  }
  return { ok: failed.length === 0, failed };
}

// ─── G5 — the fixture ───────────────────────────────────────────────────────

export interface FixtureFacts {
  runId: string;
  northwindTenantId: string;
  registry: { rental_id: string; run_id: string; tenant_id: string; customer_id: string } | null;
  rental: { id: string; tenant_id: string | null; customer_id: string | null; creation_context: unknown } | null;
  customer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
}

/** The runner touches a rental only when every one of these is true (and SQL checks them again). */
export function checkFixture(f: FixtureFacts): Verdict {
  if (!f.registry) return refuse(403, "not_registered", "Refused: the rental is not registered as this run's fixture.");
  if (f.registry.run_id !== f.runId) return refuse(403, "other_run", "Refused: the fixture belongs to another run.");
  if (!f.rental || f.rental.id !== f.registry.rental_id) return refuse(403, "no_rental", "Refused: the fixture rental is missing.");
  if (f.rental.tenant_id !== f.northwindTenantId || f.registry.tenant_id !== f.northwindTenantId) return refuse(403, "not_northwind", "Refused: the fixture is not northwind's.");
  const cc = (f.rental.creation_context ?? {}) as Record<string, unknown>;
  if (cc.e2e_fixture !== true || cc.run_id !== f.runId) return refuse(403, "not_marked", "Refused: the rental is not marked as this run's E2E fixture.");
  if (!f.customer || f.customer.id !== f.rental.customer_id || f.customer.id !== f.registry.customer_id) return refuse(403, "no_customer", "Refused: the fixture customer is missing.");
  if (!isFixtureCustomer(f.customer)) return refuse(403, "not_fixture_customer", "Refused: the customer is not an E2E fixture customer.");
  return OK;
}

export function isFixtureCustomer(c: { name: string | null; email: string | null; phone: string | null }): boolean {
  return (c.name ?? "").startsWith(FIXTURE_NAME_PREFIX) && (c.email ?? "").toLowerCase().endsWith(`@${FIXTURE_EMAIL_DOMAIN}`) && c.phone == null;
}

// ─── G6 — every sandbox call is scoped to the fixture ─────────────────────

/** The ONLY body the runner ever sends a sandbox clone. */
export function sandboxBody(fixtureRentalId: string, preview = false): { only_rental_id: string; preview?: true } {
  if (!UUID_RE.test(fixtureRentalId)) throw new Error("sandbox call refused: only_rental_id is not a UUID");
  return preview ? { only_rental_id: fixtureRentalId, preview: true } : { only_rental_id: fixtureRentalId };
}

export function checkSandboxCall(job: string, body: unknown, fixtureRentalId: string): Verdict {
  if (!(SANDBOX_JOBS as readonly string[]).includes(job)) return refuse(422, "not_sandbox", `'${job}' is not a sandbox clone; the real cron is never called.`);
  const id = (body as { only_rental_id?: unknown } | null)?.only_rental_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return refuse(422, "no_only_rental_id", "Refused: a sandbox call without only_rental_id.");
  if (id !== fixtureRentalId) return refuse(403, "other_rental", "Refused: only_rental_id is not this run's fixture.");
  return OK;
}

/** A sandbox preview may match the fixture, or nothing — never anything else. */
export function checkBlastRadius(matchedRentalIds: unknown, fixtureRentalId: string): Verdict {
  if (!Array.isArray(matchedRentalIds)) return refuse(502, "no_preview", "The sandbox preview did not report what it would touch.");
  const others = matchedRentalIds.filter((x) => x !== fixtureRentalId);
  if (others.length) return refuse(500, "blast_radius", `Refused: the sandbox would touch ${others.length} rental(s) besides the fixture.`);
  return OK;
}

// ─── G8 — quiet windows around the real crons ─────────────────────────────

/**
 * The real jobs that must NOT be near their fire time while a fixture is
 * un-parked for the matching sandbox clone (names are sim-control cron-manifest
 * keys). The fixture is parked at rest — ineligible for every real cron — and
 * is only un-parked for the few seconds of one sandbox call, inside a window
 * where none of these is due.
 */
export const QUIET_FOR: Record<string, readonly string[]> = {
  "sandbox-accrue-payg-charges": ["accrue-payg-charges", "send-payg-reminders"],
  "sandbox-send-payg-reminders": ["accrue-payg-charges", "send-payg-reminders"],
  "sandbox-auto-extend-rentals": ["auto-extend-rentals", "send-auto-extension-reminder"],
  "sandbox-process-installment-payment": ["process-installment-payment", "mark-overdue-installments"],
  tick_plan: ["run-payment-plans"],
};

export const QUIET_BEFORE_SECONDS = 20;
export const QUIET_AFTER_SECONDS = 90;

/** Fire instants (UTC, whole minutes) of a 5-field cron within ±1 day of `now`. Supports `*`, `*\/N`, and plain numbers. */
export function cronFireTimes(schedule: string, now: Date): Date[] {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`unsupported cron schedule: ${schedule}`);
  const [minF, hourF, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") throw new Error(`unsupported cron schedule (day fields): ${schedule}`);
  const matches = (field: string, v: number) => {
    if (field === "*") return true;
    const step = /^\*\/(\d+)$/.exec(field);
    if (step) return v % Number(step[1]) === 0;
    if (/^\d+$/.test(field)) return v === Number(field);
    throw new Error(`unsupported cron field '${field}' in ${schedule}`);
  };
  const out: Date[] = [];
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1);
  for (let t = start; t < start + 3 * 86_400_000; t += 60_000) {
    const d = new Date(t);
    if (matches(minF, d.getUTCMinutes()) && matches(hourF, d.getUTCHours())) out.push(d);
  }
  return out;
}

/** ok = no listed schedule fires within [−before, +after] of now; else how long to wait. */
export function quietWindow(now: Date, schedules: readonly string[], before = QUIET_BEFORE_SECONDS, after = QUIET_AFTER_SECONDS): { ok: boolean; waitSeconds: number } {
  let wait = 0;
  const nowMs = now.getTime();
  for (const s of schedules) {
    for (const fire of cronFireTimes(s, now)) {
      const lo = fire.getTime() - before * 1000;
      const hi = fire.getTime() + after * 1000;
      if (nowMs >= lo && nowMs <= hi) wait = Math.max(wait, Math.ceil((hi - nowMs) / 1000) + 1);
    }
  }
  return { ok: wait === 0, waitSeconds: wait };
}

// ─── G10 — webhook replay ───────────────────────────────────────────────────

export interface ReplayEvent {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: { object?: { id?: string; metadata?: Record<string, string> | null; client_reference_id?: string | null } };
}

/** Only a TEST-mode checkout.session.completed for the fixture's own session is ever re-delivered. */
export function checkReplayEvent(ev: ReplayEvent | null, fixtureRentalId: string, sessionId: string): Verdict {
  if (!ev) return refuse(404, "no_event", "Stripe has no checkout.session.completed event for the fixture's session yet.");
  if (ev.livemode !== false) return refuse(403, "live_event", "Refused: the event is not a TEST-mode event.");
  if (ev.type !== "checkout.session.completed") return refuse(422, "event_type", "Refused: only checkout.session.completed is replayed.");
  const obj = ev.data?.object;
  if (!obj || obj.id !== sessionId) return refuse(403, "other_session", "Refused: the event is for another checkout session.");
  const rental = obj.metadata?.rental_id ?? obj.client_reference_id ?? null;
  if (rental !== fixtureRentalId) return refuse(403, "other_rental", "Refused: the event is not for this run's fixture.");
  return OK;
}

/** Stripe's signature scheme: `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<payload>")>`. */
export function stripeSignatureHeader(timestamp: number, hexSignature: string): string {
  return `t=${timestamp},v1=${hexSignature}`;
}

// ─── G12 — a run needs the confirm sentence and a fresh preview ───────────

/**
 * The sentence the Developer tab shows at its confirm and sends verbatim with
 * every run (apps/portal/src/components/dev/e2e-runner-contract.ts
 * CONFIRM_SENTENCE). A run without it is refused.
 */
export const CONFIRM_SENTENCE = "This writes test rows to northwind in Stripe TEST mode";

export function checkConfirm(confirm: unknown): Verdict {
  if (confirm !== CONFIRM_SENTENCE) return refuse(412, "confirm", `Refused: a run must be confirmed with the sentence "${CONFIRM_SENTENCE}".`);
  return OK;
}

/** How long a preview stays good for a run. */
export const PREVIEW_TTL_MS = 15 * 60_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A preview id the runner can check WITHOUT having stored anything (the
 * preview writes nothing): `pv1.<expires ms>.<ids>.<HMAC over tenant, ids,
 * expiry>`, keyed with a server-only secret. It names the scenarios it covers,
 * so a run can only start a scenario that was previewed, on this tenant,
 * within PREVIEW_TTL_MS.
 */
export async function signPreview(secret: string, tenantId: string, scenarioIds: readonly string[], expiresAtMs: number): Promise<string> {
  const ids = [...scenarioIds].sort().join(",");
  return `pv1.${expiresAtMs}.${ids}.${await hmacHex(secret, `${tenantId}|${ids}|${expiresAtMs}`)}`;
}

export async function verifyPreview(secret: string, tenantId: string, token: unknown, scenarioId: string, nowMs: number): Promise<Verdict> {
  if (typeof token !== "string" || !token.startsWith("pv1.")) return refuse(412, "preview", "Refused: preview first — a run needs the preview it was confirmed on.");
  const parts = token.split(".");
  if (parts.length !== 4) return refuse(412, "preview", "Refused: the preview id is malformed.");
  const [, exp, ids, mac] = parts;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || nowMs > expires) return refuse(412, "preview_expired", "Refused: the preview has expired. Preview again.");
  if (!ids.split(",").includes(scenarioId)) return refuse(412, "preview_scope", `Refused: ${scenarioId} was not in the confirmed preview.`);
  const want = await hmacHex(secret, `${tenantId}|${ids}|${expires}`);
  if (want.length !== mac.length || want !== mac) return refuse(412, "preview_forged", "Refused: the preview id was not issued by this runner for this tenant.");
  return OK;
}

// ─── Preview writes nothing ─────────────────────────────────────────────────

/**
 * A client that can only READ. The preview path is handed this and nothing
 * else, so "preview writes nothing" is a property of the type, not a promise:
 * every write method throws before a request is built.
 */
// deno-lint-ignore no-explicit-any
type AnyClient = { from(table: string): any; rpc?: unknown; functions?: unknown };

export class ReadOnlyDb {
  readonly writes: string[] = [];
  constructor(private readonly db: AnyClient) {}
  // deno-lint-ignore no-explicit-any
  from(table: string): { select: (...args: any[]) => any } {
    // deno-lint-ignore no-explicit-any
    const real = this.db.from(table) as any;
    const deny = (op: string) => () => {
      this.writes.push(`${op} ${table}`);
      throw new Error(`preview is read-only: ${op} on ${table} refused`);
    };
    return {
      // deno-lint-ignore no-explicit-any
      select: (...args: any[]) => real.select(...args),
      insert: deny("insert"),
      update: deny("update"),
      upsert: deny("upsert"),
      delete: deny("delete"),
    } as { select: (...args: unknown[]) => unknown };
  }
  rpc(name: string): never {
    this.writes.push(`rpc ${name}`);
    throw new Error(`preview is read-only: rpc ${name} refused`);
  }
}
