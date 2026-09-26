// e2e-runner — the step engine: builds a fixture, executes a scenario's steps,
// reads what happened, compares it with the catalogue, and records every step.
//
// index.ts has already applied G0–G3 (kill switch, caller, tenant, Stripe TEST
// key, sandbox tenant) and, for an existing run, the lease and the SQL fixture
// guard. Everything here assumes northwind in Stripe TEST mode and a fixture
// that e2e_register_fixture accepted — and still checks the fixture again
// (checkFixture) before any write that names a rental.
//
// supabase-js never throws on a failed query: every `{ error }` is checked
// (memory: supabase-js-error-handling — the bug class behind most July 2026
// money bugs).

import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type PlatformAccount } from "../_shared/stripe-client.ts";
import { buildEngineDeps, loadTenantPlanContext } from "../_shared/payment-plans-deno/context.ts";
import { runTick, type TickResult } from "../_shared/payment-plans/engine.ts";
import type { ChargeOutcome, ChargeRequest, PaymentProvider } from "../_shared/payment-plans/providers.ts";
import { addDays, isoWeekday, localDateInZone } from "../_shared/payment-plans/dates.ts";
import { CRON_MANIFEST } from "../sim-control/manifests.ts";
import type { FixtureSpec, Scenario, Step } from "./catalogue/types.ts";
import { compareCheck, compareTieOut, needsStripe, toCents, type AssertionResult, type Snapshot } from "./catalogue/observe.ts";
import {
  checkBlastRadius,
  checkFixture,
  checkReplayEvent,
  checkSandboxCall,
  FIXTURE_EMAIL_DOMAIN,
  FIXTURE_NAME_PREFIX,
  QUIET_FOR,
  quietWindow,
  sandboxBody,
  stripeSignatureHeader,
  type TenantRow,
} from "./guards.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type StripeClient = any;

export interface FixtureState {
  rentalId: string;
  customerId: string;
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
  platformAccount: PlatformAccount;
  connectAccountId: string | null;
  planId: string | null;
  installmentPlanId: string | null;
  originalEndDate: string;
  endDateShiftDays: number;
  runStartedAt: string;
  lastLink: { url: string; source: string; sessionId: string | null } | null;
}

export interface RunRow {
  id: string;
  tenant_id: string;
  scenario_id: string;
  scenario: Scenario;
  status: string;
  next_step: number;
  waiting_for: Record<string, unknown> | null;
  fixture: FixtureState | Record<string, never>;
  pass_count: number;
  fail_count: number;
  lease_token: string | null;
}

export interface RunEnv {
  db: Db;
  supabaseUrl: string;
  serviceKey: string;
  callerJwt: string;
  tenant: TenantRow & Record<string, unknown>;
  leaseToken: string;
  /** Epoch ms after which no new step is started in this request. */
  deadline: number;
}

export interface RunOutcome {
  runId: string;
  status: string;
  nextStep: number;
  waitingFor: Record<string, unknown> | null;
  passCount: number;
  failCount: number;
  deferredSeconds?: number;
  error?: string;
}

class StepError extends Error {
  constructor(message: string, readonly detail: unknown = null) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dollars = (cents: number) => Math.round(cents) / 100;
const nowIso = () => new Date().toISOString();

// ─── Small, checked database helpers ─────────────────────────────────────────

async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new StepError(`${label}: ${error.message}`);
  return data;
}

/** An UPDATE that must touch exactly one row (a silent no-op is a bug, not a pass). */
async function updateOne(db: Db, table: string, patch: Record<string, unknown>, match: Record<string, string>): Promise<void> {
  let q = db.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const rows = await must<unknown[]>(`update ${table}`, q.select("id"));
  if (!Array.isArray(rows) || rows.length !== 1) throw new StepError(`update ${table}: expected 1 row, got ${Array.isArray(rows) ? rows.length : 0}`);
}

async function callFn(env: RunEnv, name: string, body: unknown, auth: "caller" | "service", extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth === "caller" ? env.callerJwt : env.serviceKey}`, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body: parsed };
}

function okResponse(r: { status: number; body: unknown }): boolean {
  const b = r.body as Record<string, unknown> | null;
  return r.status >= 200 && r.status < 300 && !(b && typeof b === "object" && (b.success === false || b.ok === false));
}

// ─── Stripe (TEST only: the mode is a literal, never the tenant's column) ────

export function stripeFor(tenant: TenantRow & Record<string, unknown>): { stripe: StripeClient; opts: { stripeAccount: string } | undefined; platform: PlatformAccount; connectId: string | null } {
  // deno-lint-ignore no-explicit-any
  const t = tenant as any;
  const platform = getChargePlatformAccount(t);
  const stripe = getStripeClientForAccount(platform, "test");
  const connectId = getConnectAccountId(t);
  return { stripe, opts: connectId ? { stripeAccount: connectId } : undefined, platform, connectId };
}

// ─── Fixture guard, re-applied before rental writes ──────────────────────────

async function assertFixture(env: RunEnv, runId: string, fx: FixtureState): Promise<void> {
  const [registry, rental, customer] = await Promise.all([
    must("read dev_sim_fixtures", env.db.from("dev_sim_fixtures").select("rental_id, run_id, tenant_id, customer_id").eq("run_id", runId).maybeSingle()),
    must("read rental", env.db.from("rentals").select("id, tenant_id, customer_id, creation_context").eq("id", fx.rentalId).maybeSingle()),
    must("read customer", env.db.from("customers").select("id, name, email, phone").eq("id", fx.customerId).maybeSingle()),
  ]);
  // deno-lint-ignore no-explicit-any
  const v = checkFixture({ runId, northwindTenantId: env.tenant.id, registry: registry as any, rental: rental as any, customer: customer as any });
  if (!v.ok) throw new StepError(v.message);
}

// ─── Parking: at rest a fixture is ineligible for every real cron ──────────

/**
 * Parked = the flag every real job and its sandbox clone filter on is off:
 *   auto_extend  rentals.auto_extend_enabled = false  (jobs 54/55 need true)
 *   payg         rentals.payg_paused = true           (jobs 32/33 need false)
 *   installment  installment_plans.status = 'pending' (job 6 needs 'active')
 * A plan fixture needs no parking: its due work is created and consumed in
 * the same request. A booking has no cron at all.
 */
async function setParked(env: RunEnv, fx: FixtureState, shape: FixtureSpec["shape"], parked: boolean): Promise<void> {
  if (shape === "auto_extend") {
    await updateOne(env.db, "rentals", { auto_extend_enabled: !parked, updated_at: nowIso() }, { id: fx.rentalId, tenant_id: env.tenant.id });
  } else if (shape === "payg") {
    await updateOne(env.db, "rentals", { payg_paused: parked, payg_paused_at: parked ? nowIso() : null, updated_at: nowIso() }, { id: fx.rentalId, tenant_id: env.tenant.id });
  } else if (shape === "installment" && fx.installmentPlanId) {
    await updateOne(env.db, "installment_plans", { status: parked ? "pending" : "active", updated_at: nowIso() }, { id: fx.installmentPlanId, rental_id: fx.rentalId });
  }
}

export async function parkFixture(env: RunEnv, run: RunRow): Promise<void> {
  const fx = run.fixture as FixtureState;
  if (!fx?.rentalId || !run.scenario?.fixture) return;
  await setParked(env, fx, run.scenario.fixture.shape, true);
}

/**
 * Close a finished run's fixture for good: engines off and the rental Closed
 * (the production terminal status). Money rows are left exactly as they are —
 * they are the evidence.
 */
export async function closeFixture(env: RunEnv, run: RunRow): Promise<void> {
  const fx = run.fixture as FixtureState;
  if (!fx?.rentalId) return;
  await assertFixture(env, run.id, fx);
  await updateOne(
    env.db,
    "rentals",
    { status: "Closed", auto_extend_enabled: false, payg_paused: true, payg_paused_at: nowIso(), updated_at: nowIso() },
    { id: fx.rentalId, tenant_id: env.tenant.id },
  );
  if (fx.installmentPlanId) await updateOne(env.db, "installment_plans", { status: "cancelled", updated_at: nowIso() }, { id: fx.installmentPlanId, rental_id: fx.rentalId });
  if (fx.planId) {
    const r = await callFn(env, "payment-plan-manage", { action: "cancel", planId: fx.planId, reason: "E2E fixture closed" }, "caller");
    if (!okResponse(r) && r.status !== 409) throw new StepError("cancelling the fixture's payment plan failed", r);
  }
  await updateOne(env.db, "dev_sim_runs", { fixture_closed_at: nowIso() }, { id: run.id });
}

// ─── Reading what happened ──────────────────────────────────────────────────

export async function takeSnapshot(env: RunEnv, fx: FixtureState, withStripe: boolean): Promise<Snapshot> {
  const db = env.db;
  const tz = String(env.tenant.timezone || "America/New_York");
  const takenAt = nowIso();
  const rental = await must<Record<string, unknown> | null>("read rental", db.from("rentals").select("*").eq("id", fx.rentalId).maybeSingle());
  const ledger = await must<unknown[]>("read ledger", db.from("ledger_entries").select("id, type, category, amount, remaining_amount, due_date, customer_id, extension_id").eq("rental_id", fx.rentalId));

  const PAY_COLS = "id, amount, refund_amount, status, capture_status, payment_type, stripe_checkout_session_id";
  let payments: unknown[];
  {
    const withPlan = await db.from("payments").select(`${PAY_COLS}, payment_plan_occurrence_id`).eq("rental_id", fx.rentalId);
    if (withPlan.error && String(withPlan.error.code) === "42703") {
      payments = await must("read payments", db.from("payments").select(PAY_COLS).eq("rental_id", fx.rentalId));
    } else if (withPlan.error) {
      throw new StepError(`read payments: ${withPlan.error.message}`);
    } else payments = withPlan.data;
  }

  // deno-lint-ignore no-explicit-any
  const chargeIds = (ledger as any[]).filter((l) => l.type === "Charge").map((l) => l.id);
  const applications = chargeIds.length
    ? await must<unknown[]>("read applications", db.from("payment_applications").select("payment_id, charge_entry_id, amount_applied").in("charge_entry_id", chargeIds))
    : [];
  const extensions = await must<unknown[]>("read extensions", db.from("rental_extensions").select("id, sequence_number, status, extension_days, total_amount, stripe_checkout_session_id, checkout_url").eq("rental_id", fx.rentalId));
  const accruals = await must<unknown[]>("read accruals", db.from("payg_accruals").select("accrual_day_index, invoice_status, daily_rate, tax_amount, service_fee_amount").eq("rental_id", fx.rentalId));
  const installments = fx.installmentPlanId
    ? await must<unknown[]>("read installments", db.from("scheduled_installments").select("installment_number, invoice_status, failure_count").eq("rental_id", fx.rentalId))
    : [];

  let plan: { id: string; status: string } | null = null;
  let occurrences: unknown[] = [];
  let attempts: unknown[] = [];
  if (fx.planId) {
    plan = await must("read plan", db.from("payment_plans").select("id, status").eq("id", fx.planId).maybeSingle());
    occurrences = await must("read occurrences", db.from("payment_plan_occurrences").select("id, seq, status").eq("plan_id", fx.planId));
    // deno-lint-ignore no-explicit-any
    const occIds = (occurrences as any[]).map((o) => o.id);
    attempts = occIds.length ? await must("read attempts", db.from("payment_plan_attempts").select("occurrence_id, attempt_no, method, status, checkout_session_id").in("occurrence_id", occIds)) : [];
  }

  let stripeIntents: Snapshot["stripeIntents"] = null;
  if (withStripe && fx.stripeCustomerId) {
    const { stripe, opts } = stripeFor(env.tenant);
    const list = await stripe.paymentIntents.list({ customer: fx.stripeCustomerId, limit: 100 }, opts);
    // deno-lint-ignore no-explicit-any
    stripeIntents = (list.data as any[]).map((pi) => ({ id: pi.id, status: pi.status, amount: pi.amount }));
  }

  return {
    takenAt,
    today: localDateInZone(takenAt, tz),
    originalEndDate: fx.originalEndDate,
    endDateShiftDays: fx.endDateShiftDays,
    rental,
    // deno-lint-ignore no-explicit-any
    ledger: ledger as any,
    // deno-lint-ignore no-explicit-any
    payments: payments as any,
    // deno-lint-ignore no-explicit-any
    applications: applications as any,
    // deno-lint-ignore no-explicit-any
    extensions: extensions as any,
    // deno-lint-ignore no-explicit-any
    accruals: accruals as any,
    // deno-lint-ignore no-explicit-any
    installments: installments as any,
    plan,
    // deno-lint-ignore no-explicit-any
    occurrences: occurrences as any,
    // deno-lint-ignore no-explicit-any
    attempts: attempts as any,
    stripeIntents,
  };
}

async function receivedCount(env: RunEnv, fx: FixtureState): Promise<number> {
  const rows = await must<{ status: string; capture_status: string | null }[]>(
    "read payments",
    env.db.from("payments").select("status, capture_status").eq("rental_id", fx.rentalId),
  );
  return rows.filter((p) => ["Applied", "Credit", "Partial", "Completed", "Partial Refund"].includes(p.status) && p.capture_status !== "requires_capture").length;
}

// ─── Links a person pays ────────────────────────────────────────────────────

/** After a clone ran, find the newest unpaid link it left on the fixture. */
async function refreshLinkFromDb(env: RunEnv, fx: FixtureState): Promise<void> {
  const exts = await must<{ sequence_number: number; status: string; checkout_url: string | null; stripe_checkout_session_id: string | null }[]>(
    "read extensions",
    env.db.from("rental_extensions").select("sequence_number, status, checkout_url, stripe_checkout_session_id").eq("rental_id", fx.rentalId),
  );
  const open = exts.filter((e) => e.checkout_url && !["paid", "refunded", "cancelled"].includes(e.status)).sort((a, b) => b.sequence_number - a.sequence_number)[0];
  if (open?.checkout_url) {
    fx.lastLink = { url: open.checkout_url, source: "rental_extensions.checkout_url", sessionId: open.stripe_checkout_session_id };
    return;
  }
  const pend = await must<{ stripe_checkout_session_id: string; created_at: string }[]>(
    "read pending links",
    env.db.from("payments").select("stripe_checkout_session_id, created_at").eq("rental_id", fx.rentalId).eq("status", "Pending").not("stripe_checkout_session_id", "is", null).order("created_at", { ascending: false }).limit(1),
  );
  if (pend.length) {
    const { stripe, opts } = stripeFor(env.tenant);
    const session = await stripe.checkout.sessions.retrieve(pend[0].stripe_checkout_session_id, {}, opts);
    if (session?.url) fx.lastLink = { url: session.url, source: "payments.stripe_checkout_session_id", sessionId: session.id };
  }
}

// ─── The fixture ────────────────────────────────────────────────────────────

export async function createFixture(env: RunEnv, run: RunRow): Promise<FixtureState> {
  const spec = run.scenario.fixture;
  if (!spec) throw new StepError("scenario has no fixture");
  const db = env.db;
  const tz = String(env.tenant.timezone || "America/New_York");
  const run8 = run.id.slice(0, 8);
  const startedAt = nowIso();
  const today = localDateInZone(startedAt, tz);
  const startDate = addDays(today, spec.startOffsetDays);
  const endDate = addDays(startDate, spec.lengthDays);
  const assertions: AssertionResult[] = [];
  const request: Record<string, unknown> = { spec };
  const response: Record<string, unknown> = {};

  // 1. The customer: named, on a reserved address, no phone — never reachable.
  const customer = await must<{ id: string }>(
    "create fixture customer",
    db.from("customers").insert({
      tenant_id: env.tenant.id,
      type: "Individual",
      customer_type: "Individual",
      name: `${FIXTURE_NAME_PREFIX} ${run.scenario.id} ${run8}`,
      email: `e2e-${run8}@${FIXTURE_EMAIL_DOMAIN}`,
      phone: null,
      status: "Active",
    }).select("id").single(),
  );

  // 2. Stripe TEST objects on the exact account the charge paths use.
  const { stripe, opts, platform, connectId } = stripeFor(env.tenant);
  let stripeCustomerId: string | null = null;
  let paymentMethodId: string | null = null;
  if (spec.card) {
    const minted = await callFn(env, "sandbox-fixture-setup", { card: spec.card, deposit_amount: 1 }, "service");
    response.mint = minted;
    const b = minted.body as Record<string, unknown>;
    if (!okResponse(minted) || typeof b?.customerId !== "string") throw new StepError("sandbox-fixture-setup did not mint a customer", minted);
    if (b.platformAccount !== platform) throw new StepError(`sandbox-fixture-setup minted on ${String(b.platformAccount)}, the runner resolves ${platform}`);
    stripeCustomerId = b.customerId as string;
    paymentMethodId = String(b.paymentMethodId);
    // The mint always places a deposit hold; the scenarios do not use one. Cancel it.
    if (typeof b.depositPaymentIntentId === "string") {
      await stripe.paymentIntents.cancel(b.depositPaymentIntentId, {}, opts);
      response.holdCancelled = b.depositPaymentIntentId;
    }
    await updateOne(db, "customers", { stripe_customer_id: stripeCustomerId, [`stripe_customer_id_${platform}`]: stripeCustomerId }, { id: customer.id, tenant_id: env.tenant.id });
  }

  // 3. The rental: marked, parked, no vehicle (so the overlap trigger and the fleet are untouched).
  const nowMs = Date.now();
  const rentalRow: Record<string, unknown> = {
    tenant_id: env.tenant.id,
    customer_id: customer.id,
    vehicle_id: null,
    start_date: startDate,
    end_date: endDate,
    monthly_amount: dollars(spec.periodRate.cents),
    rental_period_type: spec.periodType,
    schedule: spec.periodType,
    status: "Active",
    approval_status: "approved",
    payment_status: "pending",
    source: "portal",
    platform_account: platform,
    deposit_hold_stripe_customer_id: stripeCustomerId,
    deposit_hold_payment_method_id: paymentMethodId,
    creation_context: { e2e_fixture: true, run_id: run.id, scenario_id: run.scenario.id, marker: FIXTURE_NAME_PREFIX },
  };
  if (spec.autoExtend) {
    Object.assign(rentalRow, {
      auto_extend_enabled: false, // parked
      auto_extend_charge_mode: spec.autoExtend.chargeMode,
      auto_extend_period_unit: spec.autoExtend.unit,
      auto_extend_interval_count: spec.autoExtend.intervalCount,
      auto_extend_max_periods: spec.autoExtend.maxPeriods,
      auto_extend_next_charge_at: new Date(nowMs + spec.autoExtend.firstChargeInHours * 3_600_000).toISOString(),
      auto_extend_lead_hours: 0,
      auto_extend_status: "active",
      auto_extend_paused: false,
    });
  }
  if (spec.payg) {
    const start = new Date(nowMs + spec.payg.startInHours * 3_600_000).toISOString();
    Object.assign(rentalRow, {
      is_pay_as_you_go: true,
      payg_paused: true, // parked
      payg_paused_at: startedAt,
      payg_start_ts: start,
      payg_next_accrual_at: start,
      payg_accrual_day_count: 0,
      payg_reminder_interval_days: spec.payg.reminderEveryDays,
      payg_auto_reminders_enabled: true,
    });
  }
  const rental = await must<{ id: string }>("create fixture rental", db.from("rentals").insert(rentalRow).select("id").single());

  // 4. The marker — the only way this rental becomes something the runner may touch.
  await must("register fixture", db.rpc("e2e_register_fixture", { p_run_id: run.id, p_rental_id: rental.id }));

  const fx: FixtureState = {
    rentalId: rental.id,
    customerId: customer.id,
    stripeCustomerId,
    paymentMethodId,
    platformAccount: platform,
    connectAccountId: connectId,
    planId: null,
    installmentPlanId: null,
    originalEndDate: endDate,
    endDateShiftDays: 0,
    runStartedAt: startedAt,
    lastLink: null,
  };

  // 5. The booking's own charges.
  if (spec.charges.length) {
    await must(
      "create fixture charges",
      db.from("ledger_entries").insert(
        spec.charges.map((c) => ({
          tenant_id: env.tenant.id,
          customer_id: customer.id,
          rental_id: rental.id,
          vehicle_id: null,
          entry_date: today,
          due_date: addDays(startDate, c.dueOffsetDays),
          type: "Charge",
          category: c.category,
          amount: dollars(c.amount.cents),
          remaining_amount: dollars(c.amount.cents),
          reference: `${FIXTURE_NAME_PREFIX} ${run.scenario.id}: ${c.category}`,
        })),
      ),
    );
  }

  // 6. Installments: a parked auto-collect plan.
  if (spec.installments) {
    const ins = spec.installments;
    const total = ins.count * ins.amount.cents;
    const plan = await must<{ id: string }>(
      "create installment plan",
      db.from("installment_plans").insert({
        rental_id: rental.id,
        tenant_id: env.tenant.id,
        customer_id: customer.id,
        plan_type: "weekly",
        unit: "week",
        payments_per_unit: 1,
        collection_mode: "auto",
        total_installable_amount: dollars(total),
        number_of_installments: ins.count,
        installment_amount: dollars(ins.amount.cents),
        upfront_amount: 0,
        stripe_customer_id: stripeCustomerId,
        stripe_payment_method_id: paymentMethodId,
        status: "pending", // parked
        next_due_date: addDays(today, ins.firstDueOffsetDays),
      }).select("id").single(),
    );
    await must(
      "create installments",
      db.from("scheduled_installments").insert(
        Array.from({ length: ins.count }, (_, i) => ({
          installment_plan_id: plan.id,
          tenant_id: env.tenant.id,
          rental_id: rental.id,
          customer_id: customer.id,
          installment_number: i + 1,
          amount: dollars(ins.amount.cents),
          due_date: addDays(today, ins.firstDueOffsetDays + i * ins.everyDays),
          status: "scheduled",
          invoice_status: "open",
        })),
      ),
    );
    await updateOne(db, "rentals", { has_installment_plan: true, installment_plan_id: plan.id }, { id: rental.id, tenant_id: env.tenant.id });
    fx.installmentPlanId = plan.id;
  }

  // 7. A payment plan, created the way the operator creates one.
  if (spec.plan) {
    const anchor = addDays(today, spec.plan.anchorOffsetDays);
    const form = {
      freq: spec.plan.freq,
      interval: spec.plan.interval,
      byWeekday: [isoWeekday(anchor)],
      anchor,
      firstOccurrence: "on_anchor",
      end: { kind: "count", count: spec.plan.count },
      amountMode: "split_total",
      collectionMethod: spec.plan.collectionMethod,
      fallbackToLink: spec.plan.fallbackToLink,
      maxAttempts: 3,
      retryAfterDays: 2,
      reminderOffsets: spec.plan.reminderOffsets,
      chargeLocalTime: "10:00",
    };
    request.planForm = form;
    const created = await callFn(env, "payment-plan-manage", { action: "create", rentalId: rental.id, form }, "caller");
    response.plan = created;
    const planId = (created.body as Record<string, unknown> | null)?.planId;
    if (!okResponse(created) || typeof planId !== "string") throw new StepError("payment-plan-manage create failed", created);
    fx.planId = planId;
    const occ = await must<{ seq: number; amount: number | string }[]>("read occurrences", db.from("payment_plan_occurrences").select("seq, amount").eq("plan_id", planId).order("seq"));
    const want = spec.plan.occurrenceAmounts.map((m) => m.cents);
    const got = occ.map((o) => toCents(o.amount));
    assertions.push({ label: "fixture: the plan's occurrence amounts are the hand-derived split", expected: want, actual: got, pass: JSON.stringify(want) === JSON.stringify(got), math: spec.plan.occurrenceAmounts.map((m) => m.math).join("; ") });
  }

  const snap = await takeSnapshot(env, fx, false);
  await recordStep(env, run, -1, "fixture", `fixture for ${run.scenario.id}`, assertions.every((a) => a.pass) ? "ok" : "failed", {
    request,
    response: { ...response, rentalId: rental.id, customerId: customer.id, stripeCustomerId, startDate, endDate },
    observed: snap,
    assertions,
  });
  return fx;
}

// ─── Evidence ───────────────────────────────────────────────────────────────

async function recordStep(
  env: RunEnv,
  run: RunRow,
  index: number,
  kind: string,
  label: string,
  status: "ok" | "failed" | "error" | "refused",
  parts: { request?: unknown; response?: unknown; observed?: unknown; assertions?: AssertionResult[] },
): Promise<{ pass: number; fail: number }> {
  const assertions = parts.assertions ?? [];
  const pass = assertions.filter((a) => a.pass).length;
  const fail = assertions.length - pass;
  await must(
    "record step",
    env.db.from("dev_sim_run_steps").insert({
      run_id: run.id,
      tenant_id: run.tenant_id,
      step_index: index,
      kind,
      label,
      status,
      request: parts.request ?? null,
      response: parts.response ?? null,
      observed: parts.observed ?? null,
      assertions,
      pass_count: pass,
      fail_count: fail,
    }),
  );
  return { pass, fail };
}

function stepLabel(st: Step): string {
  switch (st.kind) {
    case "check":
    case "tie_out":
      return st.label;
    case "fire":
      return `${st.job}${st.copies === 2 ? " ×2 at once" : ""}`;
    case "advance":
      return `${st.domain} +${st.days} day(s)`;
    case "human":
      return st.say;
    default:
      return st.kind;
  }
}

// ─── Steps ──────────────────────────────────────────────────────────────────

/** A provider that lets Stripe charge, then tells the engine the call died (5xx). */
class CrashAfterChargeProvider implements PaymentProvider {
  readonly name: PaymentProvider["name"];
  readonly mode: PaymentProvider["mode"];
  readonly account: PaymentProvider["account"];
  readonly platformAccount: PaymentProvider["platformAccount"];
  constructor(private readonly inner: PaymentProvider) {
    this.name = inner.name;
    this.mode = inner.mode;
    this.account = inner.account;
    this.platformAccount = inner.platformAccount;
  }
  async charge(req: ChargeRequest): Promise<ChargeOutcome> {
    const out = await this.inner.charge(req);
    if (out.kind === "succeeded") return { kind: "indeterminate", message: "E2E: simulated crash after the provider charged (a 5xx after the money moved)" };
    return out;
  }
  refund(providerRef: string, amountCents: number, idempotencyKey: string) {
    return this.inner.refund(providerRef, amountCents, idempotencyKey);
  }
  findByAttempt(attemptId: string) {
    return this.inner.findByAttempt(attemptId);
  }
}

/** Wait (within this request's budget) for a real cron's run window to pass. */
async function quiet(env: RunEnv, key: string): Promise<{ ok: true } | { ok: false; waitSeconds: number }> {
  const schedules = (QUIET_FOR[key] ?? []).map((n) => CRON_MANIFEST[n]?.schedule).filter((s): s is string => !!s);
  const q = quietWindow(new Date(), schedules);
  if (q.ok) return { ok: true };
  if (Date.now() + q.waitSeconds * 1000 + 30_000 < env.deadline) {
    await sleep(q.waitSeconds * 1000);
    return quietWindow(new Date(), schedules).ok ? { ok: true } : { ok: false, waitSeconds: q.waitSeconds };
  }
  return { ok: false, waitSeconds: q.waitSeconds };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

type StepResult =
  | { kind: "done"; status: "ok" | "failed" | "error"; request?: unknown; response?: unknown; observed?: unknown; assertions?: AssertionResult[] }
  | { kind: "wait_human"; waitingFor: Record<string, unknown> }
  | { kind: "deferred"; waitSeconds: number };

async function executeStep(env: RunEnv, run: RunRow, fx: FixtureState, st: Step, index: number): Promise<StepResult> {
  const shape = run.scenario.fixture!.shape;
  const run8 = run.id.slice(0, 8);

  switch (st.kind) {
    case "charge_saved_card": {
      await assertFixture(env, run.id, fx);
      const req = { rentalId: fx.rentalId, amount: dollars(st.amount.cents), clientRequestId: `e2e_${run8}_${index}_${crypto.randomUUID().slice(0, 8)}`, reason: st.note, confirmDuplicate: false };
      const res = await callFn(env, "charge-saved-card", req, "caller");
      return { kind: "done", status: okResponse(res) ? "ok" : "error", request: req, response: res };
    }

    case "record_payment": {
      await assertFixture(env, run.id, fx);
      const tz = String(env.tenant.timezone || "America/New_York");
      const row = {
        tenant_id: env.tenant.id,
        rental_id: fx.rentalId,
        customer_id: fx.customerId,
        vehicle_id: null,
        amount: dollars(st.amount.cents),
        remaining_amount: dollars(st.amount.cents),
        payment_date: localDateInZone(nowIso(), tz),
        method: st.method,
        payment_type: "Payment",
        status: "Completed",
        verification_status: "approved",
        booking_source: "admin",
        platform_account: fx.platformAccount,
      };
      const pay = await must<{ id: string }>("record payment", env.db.from("payments").insert(row).select("id").single());
      const res = await callFn(env, "apply-payment", { paymentId: pay.id }, "caller");
      return { kind: "done", status: okResponse(res) ? "ok" : "error", request: row, response: res };
    }

    case "refund": {
      await assertFixture(env, run.id, fx);
      const req = { rentalId: fx.rentalId, refundType: st.refundType, refundAmount: dollars(st.amount.cents), category: st.category, reason: `E2E ${run.scenario.id}: ${st.refundType} refund`, tenantId: env.tenant.id };
      const res = await callFn(env, "process-refund", req, "caller");
      return { kind: "done", status: okResponse(res) ? "ok" : "error", request: req, response: res };
    }

    case "extend_manually": {
      // The Extend dialog's writes (AdminExtendRentalDialog), in its order.
      await assertFixture(env, run.id, fx);
      const cur = await must<{ end_date: string; previous_end_date: string | null; original_end_date: string | null }>(
        "read rental dates",
        env.db.from("rentals").select("end_date, previous_end_date, original_end_date").eq("id", fx.rentalId).single(),
      );
      const newEnd = addDays(cur.end_date, st.days);
      const first = !cur.original_end_date;
      await updateOne(env.db, "rentals", { end_date: newEnd, previous_end_date: cur.end_date, ...(first ? { original_end_date: cur.end_date } : {}), updated_at: nowIso() }, { id: fx.rentalId, tenant_id: env.tenant.id });
      const cust = await must<{ email: string; name: string }>("read customer", env.db.from("customers").select("email, name").eq("id", fx.customerId).single());
      const req = { rentalId: fx.rentalId, customerId: fx.customerId, vehicleId: null, customerEmail: cust.email, customerName: cust.name, extensionAmount: dollars(st.amount.cents), extensionDays: st.days, newEndDate: newEnd, previousEndDate: cur.end_date, tenantId: env.tenant.id };
      const res = await callFn(env, "create-extension-checkout", req, "caller");
      const b = (res.body ?? {}) as Record<string, unknown>;
      if (!okResponse(res) || typeof b.extensionId !== "string") {
        // The dialog puts the dates back when there is no extension to link to.
        await updateOne(env.db, "rentals", { end_date: cur.end_date, previous_end_date: cur.previous_end_date, ...(first ? { original_end_date: cur.original_end_date } : {}), updated_at: nowIso() }, { id: fx.rentalId, tenant_id: env.tenant.id });
        return { kind: "done", status: "error", request: req, response: res };
      }
      const seq = Number(b.sequenceNumber ?? 1);
      const tz = String(env.tenant.timezone || "America/New_York");
      await must(
        "write extension charge",
        env.db.from("ledger_entries").insert({
          rental_id: fx.rentalId,
          customer_id: fx.customerId,
          vehicle_id: null,
          tenant_id: env.tenant.id,
          type: "Charge",
          entry_date: localDateInZone(nowIso(), tz),
          due_date: newEnd,
          extension_id: b.extensionId,
          category: "Extension Rental",
          reference: `Extension #${seq}: ${st.days} day${st.days !== 1 ? "s" : ""} (${cur.end_date} → ${newEnd})`,
          amount: dollars(st.amount.cents),
          remaining_amount: dollars(st.amount.cents),
        }),
      );
      if (typeof b.checkoutUrl === "string") {
        await updateOne(env.db, "rentals", { extension_checkout_url: b.checkoutUrl, extension_amount: dollars(st.amount.cents) }, { id: fx.rentalId, tenant_id: env.tenant.id });
        fx.lastLink = { url: b.checkoutUrl, source: "create-extension-checkout", sessionId: typeof b.sessionId === "string" ? b.sessionId : null };
      }
      return { kind: "done", status: "ok", request: req, response: res };
    }

    case "pause_auto_extend":
    case "resume_auto_extend": {
      // Verbatim the portal's patch (rail-extensions.tsx / auto-extension-section.tsx).
      await assertFixture(env, run.id, fx);
      const patch = st.kind === "resume_auto_extend"
        ? { auto_extend_paused: false, auto_extend_paused_at: null, auto_extend_status: "active" }
        : { auto_extend_paused: true, auto_extend_paused_at: nowIso(), auto_extend_status: "paused" };
      await updateOne(env.db, "rentals", { ...patch, updated_at: nowIso() }, { id: fx.rentalId, tenant_id: env.tenant.id });
      return { kind: "done", status: "ok", request: patch };
    }

    case "swap_card": {
      await assertFixture(env, run.id, fx);
      if (!fx.stripeCustomerId) throw new StepError("swap_card: the fixture has no Stripe customer");
      const req = { card: st.card, swap_customer_id: fx.stripeCustomerId };
      const res = await callFn(env, "sandbox-fixture-setup", req, "service");
      const pm = (res.body as Record<string, unknown> | null)?.paymentMethodId;
      if (!okResponse(res) || typeof pm !== "string") return { kind: "done", status: "error", request: req, response: res };
      // The card on file changes everywhere the fixture stores it.
      fx.paymentMethodId = pm;
      await updateOne(env.db, "rentals", { deposit_hold_payment_method_id: pm }, { id: fx.rentalId, tenant_id: env.tenant.id });
      if (fx.installmentPlanId) await updateOne(env.db, "installment_plans", { stripe_payment_method_id: pm }, { id: fx.installmentPlanId, rental_id: fx.rentalId });
      return { kind: "done", status: "ok", request: req, response: res };
    }

    case "advance": {
      const minutes = st.days * 1440;
      const rows = await must<number>("shift", env.db.rpc("e2e_shift_fixture", { p_run_id: run.id, p_domain: st.domain, p_minutes: minutes }));
      if (st.domain === "auto_extend") fx.endDateShiftDays += st.days;
      return { kind: "done", status: "ok", request: { domain: st.domain, minutes }, response: { rowsMoved: rows } };
    }

    case "fire": {
      await assertFixture(env, run.id, fx);
      const body = sandboxBody(fx.rentalId);
      const v = checkSandboxCall(st.job, body, fx.rentalId);
      if (!v.ok) throw new StepError(v.message);
      const q = await quiet(env, st.job);
      if (!q.ok) return { kind: "deferred", waitSeconds: q.waitSeconds };
      const responses: unknown[] = [];
      await setParked(env, fx, shape, false);
      try {
        const preview = await callFn(env, st.job, sandboxBody(fx.rentalId, true), "service");
        const br = checkBlastRadius((preview.body as Record<string, unknown> | null)?.matchedRentalIds, fx.rentalId);
        if (!br.ok) throw new StepError(br.message, preview);
        const copies = st.copies ?? 1;
        responses.push(...(await Promise.all(Array.from({ length: copies }, () => callFn(env, st.job, body, "service")))));
      } finally {
        await setParked(env, fx, shape, true);
      }
      await refreshLinkFromDb(env, fx);
      const bad = responses.some((r) => (r as { status: number }).status >= 500);
      return { kind: "done", status: bad ? "error" : "ok", request: { job: st.job, body, copies: st.copies ?? 1 }, response: responses };
    }

    case "tick_plan":
    case "crash_after_charge": {
      if (!fx.planId) throw new StepError("no payment plan on this fixture");
      await assertFixture(env, run.id, fx);
      const q = await quiet(env, "tick_plan");
      if (!q.ok) return { kind: "deferred", waitSeconds: q.waitSeconds };
      const age = st.kind === "tick_plan" ? st.ageAttemptsMinutes ?? 0 : 0;
      let aged: number | null = null;
      if (age > 0) aged = await must<number>("age attempts", env.db.rpc("e2e_shift_fixture", { p_run_id: run.id, p_domain: "plan_attempts", p_minutes: age }));
      const ctx = await loadTenantPlanContext(env.db, env.tenant.id);
      if (ctx.mode !== "test") throw new StepError("refused: the plan engine resolved a live Stripe mode");
      const make = () => {
        const deps = buildEngineDeps(env.db, ctx);
        if (st.kind === "crash_after_charge") deps.provider = new CrashAfterChargeProvider(deps.provider);
        return deps;
      };
      const copies = st.kind === "tick_plan" ? st.copies ?? 1 : 1;
      const asOf = nowIso();
      const results: TickResult[] = await Promise.all(Array.from({ length: copies }, () => runTick(make(), { asOf, tenantId: env.tenant.id, planId: fx.planId! })));
      for (const r of results) {
        for (const a of r.actions) {
          const url = a.url ?? a.fallback?.url;
          if (url) fx.lastLink = { url, source: "payment-plan tick", sessionId: null };
        }
      }
      return { kind: "done", status: "ok", request: { asOf, copies, agedAttempts: aged, crash: st.kind === "crash_after_charge" }, response: results };
    }

    case "expire_latest_link": {
      await assertFixture(env, run.id, fx);
      if (!fx.lastLink?.sessionId) await refreshLinkFromDb(env, fx);
      const sessionId = fx.lastLink?.sessionId;
      if (!sessionId) throw new StepError("no checkout session to expire");
      const { stripe, opts } = stripeFor(env.tenant);
      const session = await stripe.checkout.sessions.retrieve(sessionId, {}, opts);
      const owner = session?.metadata?.rental_id ?? session?.client_reference_id ?? null;
      if (session?.livemode !== false || owner !== fx.rentalId) throw new StepError("refused: the session is not this fixture's TEST session");
      const expired = await stripe.checkout.sessions.expire(sessionId, {}, opts);
      await sleep(6000); // let checkout.session.expired reach the webhook
      return { kind: "done", status: "ok", request: { sessionId }, response: { status: expired?.status } };
    }

    case "human": {
      if (!fx.lastLink) await refreshLinkFromDb(env, fx);
      if (!fx.lastLink) throw new StepError("there is no link to pay");
      return {
        kind: "wait_human",
        waitingFor: { stepIndex: index, ask: st.ask, say: st.say, url: fx.lastLink.url, source: fx.lastLink.source, baselineReceived: await receivedCount(env, fx) },
      };
    }

    case "replay_webhook": {
      await assertFixture(env, run.id, fx);
      if (!fx.lastLink?.sessionId) throw new StepError("no checkout session to replay");
      const { stripe, opts, platform } = stripeFor(env.tenant);
      const since = Math.floor(Date.parse(fx.runStartedAt) / 1000) - 60;
      const events = await stripe.events.list({ type: st.event, created: { gte: since }, limit: 100 }, opts);
      // deno-lint-ignore no-explicit-any
      const ev = (events.data as any[]).find((e) => e?.data?.object?.id === fx.lastLink!.sessionId) ?? null;
      const v = checkReplayEvent(ev, fx.rentalId, fx.lastLink.sessionId);
      if (!v.ok) throw new StepError(v.message);
      const secret = platform === "uae"
        ? Deno.env.get("STRIPE_UAE_TEST_WEBHOOK_SECRET")
        : (ev.account ? Deno.env.get("STRIPE_TEST_CONNECT_WEBHOOK_SECRET") : null) ?? Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET");
      if (!secret) throw new StepError("no TEST webhook secret to sign the replay with");
      const payload = JSON.stringify(ev);
      const t = Math.floor(Date.now() / 1000);
      const res = await fetch(`${env.supabaseUrl}/functions/v1/stripe-webhook-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignatureHeader(t, await hmacHex(secret, `${t}.${payload}`)) },
        body: payload,
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      await sleep(4000);
      return { kind: "done", status: res.ok ? "ok" : "error", request: { eventId: ev.id, sessionId: fx.lastLink.sessionId }, response: { status: res.status, body: text.slice(0, 2000) } };
    }

    case "check": {
      const snap = await takeSnapshot(env, fx, needsStripe(st.checks));
      const assertions = st.checks.map((c) => compareCheck(c, snap));
      return { kind: "done", status: assertions.every((a) => a.pass) ? "ok" : "failed", observed: snap, assertions };
    }

    case "tie_out": {
      const snap = await takeSnapshot(env, fx, false);
      const assertions = compareTieOut(st.label, st.expect, snap);
      return { kind: "done", status: assertions.every((a) => a.pass) ? "ok" : "failed", observed: snap, assertions };
    }
  }
}

// ─── The loop ───────────────────────────────────────────────────────────────

async function saveRun(env: RunEnv, run: RunRow, patch: Record<string, unknown>): Promise<void> {
  await updateOne(env.db, "dev_sim_runs", patch, { id: run.id, lease_token: env.leaseToken });
}

async function finish(env: RunEnv, run: RunRow, fx: FixtureState | null, status: "passed" | "failed" | "errored" | "aborted", error: string | null): Promise<RunOutcome> {
  if (fx?.rentalId && run.scenario.fixture) {
    try {
      await setParked(env, fx, run.scenario.fixture.shape, true);
    } catch (e) {
      error = `${error ?? ""} (parking the fixture also failed: ${(e as Error).message})`.trim();
    }
  }
  await saveRun(env, run, { status, finished_at: nowIso(), waiting_for: null, error, fixture: fx ?? run.fixture, pass_count: run.pass_count, fail_count: run.fail_count, lease_token: null, lease_until: null });
  return { runId: run.id, status, nextStep: run.next_step, waitingFor: null, passCount: run.pass_count, failCount: run.fail_count, error: error ?? undefined };
}

/**
 * Execute from run.next_step until the scenario ends, a person is needed, a
 * quiet window must be waited out, or this request's time budget is spent.
 */
export async function runSteps(env: RunEnv, run: RunRow, opts: { humanDone?: boolean } = {}): Promise<RunOutcome> {
  let fx = (run.fixture as FixtureState)?.rentalId ? (run.fixture as FixtureState) : null;
  try {
    if (!fx) {
      fx = await createFixture(env, run);
      await saveRun(env, run, { fixture: fx });
    }

    // A person has paid (or says so): record the human step, give the webhook time to land.
    if (opts.humanDone && run.waiting_for) {
      const wf = run.waiting_for;
      const baseline = Number(wf.baselineReceived ?? 0);
      let seen = await receivedCount(env, fx);
      const until = Date.now() + 60_000;
      while (seen <= baseline && Date.now() < until) {
        await sleep(3000);
        seen = await receivedCount(env, fx);
      }
      await recordStep(env, run, Number(wf.stepIndex), "human", String(wf.say ?? "human step"), "ok", {
        request: wf,
        response: { receivedBefore: baseline, receivedAfter: seen, settled: seen > baseline },
      });
      run.next_step = Number(wf.stepIndex) + 1;
      run.waiting_for = null;
      run.status = "running";
      await saveRun(env, run, { status: "running", waiting_for: null, next_step: run.next_step, fixture: fx });
    }

    const steps = run.scenario.steps;
    while (run.next_step < steps.length) {
      if (Date.now() > env.deadline) {
        await saveRun(env, run, { fixture: fx, lease_token: null, lease_until: null });
        return { runId: run.id, status: "running", nextStep: run.next_step, waitingFor: null, passCount: run.pass_count, failCount: run.fail_count };
      }
      const index = run.next_step;
      const st = steps[index];
      let result: StepResult;
      try {
        result = await executeStep(env, run, fx, st, index);
      } catch (e) {
        const detail = e instanceof StepError ? e.detail : null;
        await recordStep(env, run, index, st.kind, stepLabel(st), "error", { request: st, response: { error: (e as Error).message, detail } });
        return await finish(env, run, fx, "errored", `step ${index} (${st.kind}): ${(e as Error).message}`);
      }

      if (result.kind === "deferred") {
        await saveRun(env, run, { fixture: fx, lease_token: null, lease_until: null });
        return { runId: run.id, status: "running", nextStep: index, waitingFor: null, passCount: run.pass_count, failCount: run.fail_count, deferredSeconds: result.waitSeconds };
      }
      if (result.kind === "wait_human") {
        run.status = "waiting";
        run.waiting_for = result.waitingFor;
        await saveRun(env, run, { status: "waiting", waiting_for: result.waitingFor, next_step: index, fixture: fx, lease_token: null, lease_until: null });
        return { runId: run.id, status: "waiting", nextStep: index, waitingFor: result.waitingFor, passCount: run.pass_count, failCount: run.fail_count };
      }

      const counts = await recordStep(env, run, index, st.kind, stepLabel(st), result.status, result);
      run.pass_count += counts.pass;
      run.fail_count += counts.fail;
      run.next_step = index + 1;
      await saveRun(env, run, { next_step: run.next_step, pass_count: run.pass_count, fail_count: run.fail_count, fixture: fx });
      if (result.status === "error") return await finish(env, run, fx, "errored", `step ${index} (${st.kind}) did not succeed — see its response`);
    }
    return await finish(env, run, fx, run.fail_count === 0 ? "passed" : "failed", null);
  } catch (e) {
    return await finish(env, run, fx, "errored", (e as Error).message);
  }
}
