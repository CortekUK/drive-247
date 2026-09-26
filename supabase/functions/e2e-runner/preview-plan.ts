// e2e-runner — what a run WOULD write, for the zero-write preview.
//
// Pure: derived from the scenario's fixture and steps alone, so a preview
// needs no database write and no Stripe call to say it. The Developer tab
// shows this beside the confirm sentence (apps/portal/src/components/dev/
// e2e-runner-contract.ts, `preview.scenarios[].writes / stripe / crons`).
// Counts are given where the scenario fixes them and null where a real job
// decides (FIFO allocations, how many days accrue, …) — with a note saying so.

import type { FixtureSpec, Scenario, Step } from "./catalogue/types.ts";

export interface PlannedWrite {
  table: string;
  action: "insert" | "update";
  count: number | null;
  note: string;
}
export interface PlannedNote {
  note: string;
}
export interface ScenarioPlan {
  scenario_id: string;
  writes: PlannedWrite[];
  stripe: (PlannedNote & { object: string })[];
  crons: (PlannedNote & { job: string })[];
}

/** The real job a sandbox clone stands in for, with its production cron job id (Sep 25 2026). */
export const REAL_JOB: Record<string, string> = {
  "sandbox-accrue-payg-charges": "accrue-payg-charges (job 32)",
  "sandbox-send-payg-reminders": "send-payg-reminders (job 33)",
  "sandbox-auto-extend-rentals": "auto-extend-rentals (job 54)",
  "sandbox-process-installment-payment": "process-installment-payment (job 6)",
};

function fixtureWrites(f: FixtureSpec, stepCount: number): PlannedWrite[] {
  const w: PlannedWrite[] = [
    { table: "dev_sim_runs", action: "insert", count: 1, note: "the run's own row (status, fixture ids, pass/fail)" },
    { table: "customers", action: "insert", count: 1, note: "the E2E-FIXTURE customer: an @e2e.drive247.test address, no phone — no message can reach a person" },
    { table: "rentals", action: "insert", count: 1, note: "the fixture rental on northwind: marked creation_context.e2e_fixture, no vehicle, parked from its crons" },
    { table: "dev_sim_fixtures", action: "insert", count: 1, note: "the fixture marker (e2e_register_fixture)" },
    { table: "dev_sim_run_steps", action: "insert", count: stepCount + 1, note: "one evidence row per step, and one for the fixture" },
  ];
  if (f.card) w.push({ table: "customers", action: "update", count: 1, note: "the Stripe TEST customer id on the fixture customer" });
  if (f.charges.length) w.push({ table: "ledger_entries", action: "insert", count: f.charges.length, note: `the booking's charges: ${f.charges.map((c) => `${c.category} ${(c.amount.cents / 100).toFixed(2)}`).join(", ")}` });
  if (f.installments) {
    w.push({ table: "installment_plans", action: "insert", count: 1, note: "a parked auto-collect installment plan" });
    w.push({ table: "scheduled_installments", action: "insert", count: f.installments.count, note: `${f.installments.count} × ${(f.installments.amount.cents / 100).toFixed(2)}` });
  }
  if (f.plan) {
    w.push({ table: "payment_plans", action: "insert", count: 1, note: "created through payment-plan-manage, as the operator would" });
    w.push({ table: "payment_plan_occurrences", action: "insert", count: f.plan.count, note: f.plan.occurrenceAmounts.map((m) => (m.cents / 100).toFixed(2)).join(" + ") });
  }
  return w;
}

function stepWrites(st: Step, f: FixtureSpec): { writes: PlannedWrite[]; stripe: ScenarioPlan["stripe"]; crons: ScenarioPlan["crons"] } {
  const writes: PlannedWrite[] = [];
  const stripe: ScenarioPlan["stripe"] = [];
  const crons: ScenarioPlan["crons"] = [];
  switch (st.kind) {
    case "charge_saved_card":
      writes.push({ table: "payments", action: "insert", count: 1, note: `charge-saved-card: ${(st.amount.cents / 100).toFixed(2)}; FIFO then writes payment_applications and pnl_entries` });
      stripe.push({ object: "PaymentIntent", note: `off-session charge of ${(st.amount.cents / 100).toFixed(2)} on the TEST card` });
      break;
    case "record_payment":
      writes.push({ table: "payments", action: "insert", count: 1, note: `a ${st.method} payment of ${(st.amount.cents / 100).toFixed(2)} (the Add Payment dialog's row), then apply-payment` });
      break;
    case "refund":
      writes.push({ table: "ledger_entries", action: "insert", count: 1, note: `process-refund's Refund row (${st.category}, -${(st.amount.cents / 100).toFixed(2)})` });
      writes.push({ table: "payments", action: "update", count: null, note: "refund_amount and status on the payment(s) refunded" });
      stripe.push({ object: "Refund", note: `${(st.amount.cents / 100).toFixed(2)} back to the TEST card` });
      break;
    case "extend_manually":
      writes.push({ table: "rentals", action: "update", count: 1, note: `the Extend dialog's date patch: +${st.days} day(s), before any payment` });
      writes.push({ table: "rental_extensions", action: "insert", count: 1, note: "create-extension-checkout's extension row" });
      writes.push({ table: "ledger_entries", action: "insert", count: 1, note: `Extension Rental ${(st.amount.cents / 100).toFixed(2)} on the extension` });
      stripe.push({ object: "Checkout Session", note: "the extension's payment link (TEST)" });
      break;
    case "pause_auto_extend":
    case "resume_auto_extend":
      writes.push({ table: "rentals", action: "update", count: 1, note: `the portal's ${st.kind === "pause_auto_extend" ? "pause" : "resume"} patch` });
      break;
    case "swap_card":
      writes.push({ table: "rentals", action: "update", count: 1, note: `the card on file becomes the "${st.card}" TEST card` });
      if (f.installments) writes.push({ table: "installment_plans", action: "update", count: 1, note: "the plan's stored card too" });
      stripe.push({ object: "PaymentMethod", note: `a "${st.card}" TEST card attached and made default` });
      break;
    case "advance":
      writes.push({ table: st.domain === "payment_plan" ? "payment_plan_occurrences" : st.domain === "installment" ? "scheduled_installments" : "rentals", action: "update", count: null, note: `e2e_shift_fixture: the fixture's ${st.domain} clock moved ${st.days} day(s) into the past` });
      break;
    case "fire": {
      const n = st.copies ?? 1;
      writes.push({ table: f.shape === "installment" ? "installment_plans" : "rentals", action: "update", count: 2, note: "un-park for the call, re-park after it" });
      if (st.job === "sandbox-accrue-payg-charges") writes.push({ table: "payg_accruals", action: "insert", count: null, note: "one per day due, with its ledger_entries" });
      if (st.job === "sandbox-send-payg-reminders") writes.push({ table: "payments", action: "insert", count: 1, note: "the reminder's Pending link row, and a payg_reminder_log row" });
      if (st.job === "sandbox-auto-extend-rentals") writes.push({ table: "rental_extensions", action: "insert", count: null, note: "a renewal (and its Extension charges and payment) when one is due; a decline rolls it back" });
      if (st.job === "sandbox-process-installment-payment") writes.push({ table: "payments", action: "insert", count: null, note: "an installment payment when one is due, and installment_notifications" });
      if (st.job !== "sandbox-accrue-payg-charges") stripe.push({ object: st.job === "sandbox-send-payg-reminders" ? "Checkout Session" : "PaymentIntent or Checkout Session", note: "what the job does for a due item, in TEST mode" });
      crons.push({ job: st.job, note: `${n === 2 ? "twice at once, " : ""}only_rental_id = the fixture — never the real ${REAL_JOB[st.job] ?? "job"}` });
      break;
    }
    case "tick_plan":
    case "crash_after_charge":
      writes.push({ table: "payment_plan_attempts", action: "insert", count: null, note: "the engine's attempts (and events, payments, occurrence updates) for the fixture's plan only" });
      stripe.push({ object: "PaymentIntent", note: st.kind === "crash_after_charge" ? "one real TEST charge, then the engine is told it failed" : "idempotency key pp:{account}:{occurrence}:{n}" });
      crons.push({ job: "payment-plan engine (in-process)", note: `runTick scoped to the fixture's plan${st.kind === "tick_plan" && st.copies === 2 ? ", twice at once" : ""} — never run-payment-plans` });
      break;
    case "expire_latest_link":
      stripe.push({ object: "Checkout Session", note: "the fixture's own TEST session expired early" });
      break;
    case "replay_webhook":
      stripe.push({ object: "Event", note: "the real checkout.session.completed event READ, then re-delivered, signed, to stripe-webhook-test" });
      break;
    default:
      break;
  }
  return { writes, stripe, crons };
}

export function planScenario(s: Scenario): ScenarioPlan {
  const plan: ScenarioPlan = { scenario_id: s.id, writes: [], stripe: [], crons: [] };
  if (!s.fixture) return plan;
  plan.writes.push(...fixtureWrites(s.fixture, s.steps.length));
  if (s.fixture.card) plan.stripe.push({ object: "Customer + PaymentMethod", note: `a TEST customer with the "${s.fixture.card}" test card, minted by sandbox-fixture-setup; its $1.00 deposit hold is cancelled at once` });
  for (const st of s.steps) {
    const p = stepWrites(st, s.fixture);
    plan.writes.push(...p.writes);
    plan.stripe.push(...p.stripe);
    plan.crons.push(...p.crons);
  }
  return plan;
}
