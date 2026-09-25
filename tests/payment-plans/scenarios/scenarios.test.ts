/**
 * §10.1 scenarios S1–S18 — the identical list the /dev simulator runs — on
 * BOTH stores:
 *   memory — MemoryPlanStore (the engine agent's; what the browser runs)
 *   pglite — PglitePlanStore: the pp_* SQL functions on real Postgres, with the
 *            live FIFO trigger allocating every payment to real ledger rows
 * then a PARITY check: the two runs, with ids normalised away, must agree on
 * every assertion's actual value, every occurrence, attempt, idempotency key,
 * event, payment, provider call and engine decision. The memory store is only
 * trusted because this passes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryContext, runScenario, SCENARIOS, type ScenarioEvidence, type ScenarioRun } from "@fn/_shared/payment-plans/scenarios.ts";
import { closeOpenDatabases, createPgliteContext } from "../harness/pglite-context";

afterAll(async () => closeOpenDatabases());

const failedOf = (run: ScenarioRun) => run.assertions.filter((a) => !a.pass).map((a) => ({ label: a.label, expected: a.expected, actual: a.actual }));

/** Replace every store-specific id with a stable label (occ{seq}, occ{seq}#{attempt}, plan, rental). */
export function normalize(run: ScenarioRun) {
  const ev = run.evidence as ScenarioEvidence;
  const labels = new Map<string, string>();
  for (const o of ev.occurrences) labels.set(o.id, `occ${o.seq}`);
  for (const a of ev.attempts) labels.set(a.id, `${labels.get(a.occurrenceId)}#${a.attemptNo}`);
  if (ev.plan) {
    labels.set(ev.plan.id, "plan");
    labels.set(ev.plan.rentalId, "rental");
    labels.set(ev.plan.tenantId, "tenant");
    labels.set(ev.plan.customerId, "customer");
  }
  ev.payments.forEach((p) => labels.set(p.id, `pay(${p.occurrenceId ? labels.get(p.occurrenceId) : "external"},${p.amountCents})`));
  const ids = [...labels.keys()].sort((a, b) => b.length - a.length);
  const swap = (v: unknown): unknown => {
    if (v === null || v === undefined) return v ?? null;
    let s = JSON.stringify(v);
    for (const id of ids) s = s.split(id).join(labels.get(id)!);
    return JSON.parse(s);
  };
  const byJson = <T,>(xs: T[]) => [...xs].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return {
    pass: run.pass,
    assertions: run.assertions.map((a) => ({ label: a.label, pass: a.pass, actual: swap(a.actual) })),
    plan: ev.plan ? { status: ev.plan.status, version: ev.plan.version } : null,
    occurrences: ev.occurrences.map((o) => ({
      seq: o.seq, status: o.status, dueDate: o.dueDate, dueAt: o.dueAt, periodStart: o.periodStart, periodEnd: o.periodEnd,
      amountCents: o.amountCents, amountPaidCents: o.amountPaidCents, attemptNo: o.attemptNo, nextAttemptAt: o.nextAttemptAt,
      planVersion: o.planVersion, collectionMethod: o.collectionMethod, movedFrom: o.movedFrom ?? null,
    })),
    attempts: byJson(ev.attempts.map((a) => swap({
      id: a.id, attemptNo: a.attemptNo, method: a.method, status: a.status, amountCents: a.amountCents, key: a.idempotencyKey,
      provider: a.provider, providerAccount: a.providerAccount, providerMode: a.providerMode, providerRef: a.providerRef,
      declineCode: a.declineCode, errorCode: a.errorCode, createdAt: a.createdAt ?? null, finishedAt: a.finishedAt ?? null,
    }))),
    events: byJson(ev.events.map((e) => swap({ kind: e.kind, occurrence: e.occurrenceId ?? null, dedupeKey: e.dedupeKey ?? null, amountCents: e.amountCents ?? null, channel: e.channel ?? null, createdAt: e.createdAt }))),
    payments: byJson(ev.payments.map((p) => swap({ occurrence: p.occurrenceId, amountCents: p.amountCents, refundCents: p.refundCents, method: p.method, providerRef: p.providerRef }))),
    providerCalls: swap(ev.providerCalls),
    charges: swap(ev.charges),
    refunds: ev.refunds,
    notifications: swap(ev.notifications),
    decisions: ev.ticks.map((t) => swap({
      asOf: t.asOf,
      recovered: t.recovered.map((x) => ({ attempt: x.attemptId, path: x.path, outcome: x.outcome })),
      reminders: t.reminders,
      actions: t.actions.map((a) => ({ occurrence: a.occurrenceId, action: a.action, amountCents: a.amountCents ?? null, key: a.idempotencyKey ?? null, next: a.nextAttemptAt ?? null, fallback: a.fallback?.action ?? null })),
      errors: t.errors,
    })),
  };
}

for (const s of SCENARIOS) {
  describe(`${s.id} — ${s.title}`, () => {
    let mem: ScenarioRun;
    let pg: ScenarioRun;
    beforeAll(async () => {
      mem = await runScenario(s, createMemoryContext);
      pg = await runScenario(s, createPgliteContext);
      await closeOpenDatabases();
    }, 120_000);

    it("memory store: every §10.1 assertion holds", () => {
      expect(failedOf(mem)).toEqual([]);
      expect(mem.assertions.length).toBeGreaterThanOrEqual(3);
    });

    it("PGlite store (real SQL + live FIFO): every §10.1 assertion holds", () => {
      expect(failedOf(pg)).toEqual([]);
      expect(pg.assertions.length).toBe(mem.assertions.length);
    });

    it("parity: memory and PGlite agree on every state, key, event, payment and decision", () => {
      expect(normalize(pg)).toEqual(normalize(mem));
    });
  });
}

describe("the scenario list itself", () => {
  it("is S1…S18, in order, each with a why", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(Array.from({ length: 18 }, (_, i) => `S${i + 1}`));
    expect(SCENARIOS.every((s) => s.why.length > 20)).toBe(true);
  });
});
