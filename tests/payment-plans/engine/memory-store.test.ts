/**
 * Engine mechanics — MemoryPlanStore enforces the same refusals the SQL
 * raises: the state machines, one attempt in flight per occurrence, the
 * idempotency-key shape, the owed cap, D12, the version check, skip on the
 * last. Values here are arbitrary (UTC zone, round numbers); the §10.1
 * scenario expectations are the evidence suite's, not this file's.
 */
import { describe, expect, it } from "vitest";
import { MemoryPlanStore, TRANSITIONS, canTransition } from "../../../supabase/functions/_shared/payment-plans/memory-store.ts";
import { PlanStoreError } from "../../../supabase/functions/_shared/payment-plans/errors.ts";
import type { OccurrenceDraft, PlanRow } from "../../../supabase/functions/_shared/payment-plans/types.ts";

const drafts = (dates: string[], cents: number): OccurrenceDraft[] =>
  dates.map((dueDate, i) => ({ seq: i + 1, dueDate, periodStart: dueDate, periodEnd: dueDate, days: 1, amountCents: cents, isStub: false }));

function planInput(over: Partial<Omit<PlanRow, "id" | "version" | "status">> = {}): Omit<PlanRow, "id" | "version" | "status"> {
  return {
    tenantId: "t1",
    rentalId: "r1",
    customerId: "c1",
    rule: { freq: "daily", interval: 1, anchor: "2030-01-01", firstOccurrence: "on_anchor", end: { kind: "count", count: 3 } },
    amount: { mode: "split_total", totalCents: 30000 },
    currency: "usd",
    timezone: "UTC",
    chargeLocalTime: "10:00",
    collectionMethod: "auto_charge",
    fallbackToLink: true,
    maxAttempts: 3,
    retryAfterDays: 2,
    reminderOffsets: [],
    paymentProvider: "stripe",
    stripePaymentMethodId: null,
    extendsRental: false,
    ...over,
  };
}

async function setup(owed = 30000, over: Partial<Omit<PlanRow, "id" | "version" | "status">> = {}) {
  const store = new MemoryPlanStore({ rentals: [{ id: "r1", tenantId: "t1", customerId: "c1", owedCents: owed }], now: "2029-12-01T00:00:00.000Z" });
  const planId = await store.createPlan({ plan: planInput(over), occurrences: drafts(["2030-01-01", "2030-01-02", "2030-01-03"], 10000) });
  const occs = await store.listOccurrences(planId);
  return { store, planId, occs };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof PlanStoreError ? e.code : `other:${(e as Error).message}`;
  }
  return "no-error";
};

describe("MemoryPlanStore — claims", () => {
  it("builds the idempotency key pp:{account or 'platform'}:{occurrence}:{attempt_no}", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", "acct_x");
    expect(a.ok && a.claim.idempotencyKey).toBe(`pp:acct_x:${occs[0].id}:1`);
    await store.markInFlight(a.ok ? a.claim.attemptId : "");
    await store.recordFailure({ attemptId: a.ok ? a.claim.attemptId : "", status: "failed", nextAttemptAt: null });
    const b = await store.claim(occs[0].id, "auto_charge", null);
    expect(b.ok && b.claim.idempotencyKey).toBe(`pp:platform:${occs[0].id}:2`);
  });

  it("one attempt in flight per occurrence: a second claim is held_elsewhere", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    expect((await store.claim(occs[0].id, "checkout_link", null)).ok).toBe(true);
    expect(await store.claim(occs[0].id, "auto_charge", null)).toEqual({ ok: false, reason: "held_elsewhere" });
    expect(await store.claim(occs[0].id, "manual", null)).toEqual({ ok: false, reason: "held_elsewhere" });
  });

  it("only an auto_charge claim moves the occurrence to processing", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-02T10:00:00.000Z");
    await store.claim(occs[0].id, "checkout_link", null);
    await store.claim(occs[1].id, "auto_charge", null);
    expect((await store.getOccurrence(occs[0].id))!.status).toBe("due");
    expect((await store.getOccurrence(occs[1].id))!.status).toBe("processing");
  });

  it("a scheduled occurrence is claimable by a manual record only", async () => {
    const { store, occs } = await setup();
    expect(await store.claim(occs[2].id, "auto_charge", null)).toEqual({ ok: false, reason: "not_claimable" });
    expect(await store.claim(occs[2].id, "checkout_link", null)).toEqual({ ok: false, reason: "not_claimable" });
    expect((await store.claim(occs[2].id, "manual", null)).ok).toBe(true);
  });

  it("caps the claim at what the rental owes, and turns 'owes nothing' into skipped + covered_by_balance", async () => {
    const { store, planId, occs } = await setup(4321);
    await store.collectDue("2030-01-02T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", null);
    expect(a.ok && a.claim.amountCents).toBe(4321);
    store.adjustRentalOwed("r1", -4321);
    expect(await store.claim(occs[1].id, "auto_charge", null)).toEqual({ ok: false, reason: "nothing_owed" });
    expect((await store.getOccurrence(occs[1].id))!.status).toBe("skipped");
    expect((await store.listEvents(planId)).map((e) => e.kind)).toContain("covered_by_balance");
  });

  it("D12: an occurrence carrying a refunded payment is never auto-claimed again", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", "acct_x");
    const attemptId = a.ok ? a.claim.attemptId : "";
    await store.markInFlight(attemptId);
    const { paymentId } = await store.recordSuccess({ attemptId, amountCents: 10000, providerRef: "pi_1", providerAccount: "acct_x", providerMode: "test", paymentProvider: "stripe", platformAccount: "uk", paymentDate: "2030-01-01", method: "Card" });
    await store.refundPayment(paymentId, 10000);
    const occ = (await store.getOccurrence(occs[0].id))!;
    expect(occ.status).toBe("due");
    expect(occ.attemptNo).toBe(1);
    expect(await store.claim(occs[0].id, "auto_charge", "acct_x")).toEqual({ ok: false, reason: "not_claimable" });
    // An operator may still record the money by hand.
    expect((await store.claim(occs[0].id, "manual", null)).ok).toBe(true);
  });

  it("a paused plan is never collected, but may still take a manual record; a cancelled one takes nothing", async () => {
    const { store, planId, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    await store.pausePlan(planId);
    expect(await store.claim(occs[0].id, "auto_charge", null)).toEqual({ ok: false, reason: "not_claimable" });
    expect((await store.claim(occs[0].id, "manual", null)).ok).toBe(true);
  });
});

describe("MemoryPlanStore — attempts", () => {
  it("markInFlight only from claimed; recordFailure refuses a succeeded attempt", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", null);
    const id = a.ok ? a.claim.attemptId : "";
    await store.markInFlight(id);
    expect(await code(store.markInFlight(id))).toBe("illegal_transition");
    await store.recordSuccess({ attemptId: id, amountCents: 10000, providerRef: "pi_1", providerAccount: null, providerMode: "test", paymentProvider: "stripe", platformAccount: "uk", paymentDate: "2030-01-01", method: "Card" });
    expect(await code(store.recordFailure({ attemptId: id, status: "failed" }))).toBe("illegal_transition");
  });

  it("recordSuccess is idempotent on the attempt, and a card success must equal the claim", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", null);
    const id = a.ok ? a.claim.attemptId : "";
    await store.markInFlight(id);
    const base = { attemptId: id, providerRef: "pi_1", providerAccount: null, providerMode: "test" as const, paymentProvider: "stripe" as const, platformAccount: "uk" as const, paymentDate: "2030-01-01", method: "Card" };
    expect(await code(store.recordSuccess({ ...base, amountCents: 9999 }))).toBe("invalid_input");
    const first = await store.recordSuccess({ ...base, amountCents: 10000 });
    const second = await store.recordSuccess({ ...base, amountCents: 10000 });
    expect(second).toEqual(first);
    expect(store.listPayments({ occurrenceId: occs[0].id })).toHaveLength(1);
  });

  it("a released link (abandoned) can still record money that arrives late", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "checkout_link", null);
    const id = a.ok ? a.claim.attemptId : "";
    await store.markInFlight(id);
    await store.recordFailure({ attemptId: id, status: "abandoned" });
    expect((await store.getOccurrence(occs[0].id))!.status).toBe("due"); // a link never moved it
    await store.recordSuccess({ attemptId: id, amountCents: 10000, providerRef: "pi_late", providerAccount: null, providerMode: "test", paymentProvider: "stripe", platformAccount: "uk", paymentDate: "2030-01-01", method: "Card" });
    expect((await store.getOccurrence(occs[0].id))!.status).toBe("paid");
  });

  it("staleAttempts: claimed/in_flight/indeterminate card attempts past the lease, never links", async () => {
    const { store, occs } = await setup();
    store.setNow("2030-01-02T10:00:00.000Z");
    await store.collectDue("2030-01-02T10:00:00.000Z");
    const card = await store.claim(occs[0].id, "auto_charge", null);
    await store.claim(occs[1].id, "checkout_link", null);
    expect(await store.staleAttempts(600, "2030-01-02T10:09:59.000Z")).toHaveLength(0);
    const stale = await store.staleAttempts(600, "2030-01-02T10:10:00.000Z");
    expect(stale.map((s) => s.id)).toEqual([card.ok ? card.claim.attemptId : ""]);
  });
});

describe("MemoryPlanStore — state machine and operator refusals", () => {
  it("the transition table is the design's §6 table", () => {
    expect(canTransition("paid", "due")).toBe(true);
    expect(canTransition("paid", "failed")).toBe(false);
    expect(canTransition("skipped", "due")).toBe(true);
    expect(canTransition("skipped", "paid")).toBe(false);
    expect(canTransition("scheduled", "processing")).toBe(false);
    for (const terminal of ["superseded", "cancelled", "waived"] as const) expect(TRANSITIONS[terminal]).toEqual([]);
  });

  it("skip rolls the remainder into the next open occurrence and refuses the last", async () => {
    const { store, occs } = await setup();
    await store.skipOccurrence(occs[1].id);
    expect((await store.getOccurrence(occs[2].id))!.amountCents).toBe(20000);
    expect(await code(store.skipOccurrence(occs[2].id))).toBe("refused");
  });

  it("skip refuses while an attempt is open on the occurrence", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    await store.claim(occs[0].id, "checkout_link", null);
    expect(await code(store.skipOccurrence(occs[0].id))).toBe("attempt_in_flight");
  });

  it("move refuses a paid occurrence; moving a failed one schedules its retry on the new date", async () => {
    const { store, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const a = await store.claim(occs[0].id, "auto_charge", null);
    await store.markInFlight(a.ok ? a.claim.attemptId : "");
    await store.recordFailure({ attemptId: a.ok ? a.claim.attemptId : "", status: "failed", nextAttemptAt: null });
    await store.moveOccurrence(occs[0].id, "2030-01-10");
    const moved = (await store.getOccurrence(occs[0].id))!;
    expect(moved.nextAttemptAt).toBe(moved.dueAt);
    expect(moved.movedFrom).toBe("2030-01-01");

    const b = await store.claim(occs[1].id, "manual", null);
    await store.recordSuccess({ attemptId: b.ok ? b.claim.attemptId : "", amountCents: 10000, providerRef: null, providerAccount: null, providerMode: null, paymentProvider: "stripe", platformAccount: "uk", paymentDate: "2030-01-01", method: "Cash" });
    expect(await code(store.moveOccurrence(occs[1].id, "2030-01-20"))).toBe("refused");
  });

  it("replaceFuture: version checked, a reason required, refused while a card charge is in flight", async () => {
    const { store, planId, occs } = await setup();
    const next = drafts(["2030-02-01"], 30000);
    expect(await code(store.replaceFuture({ planId, expectedVersion: 7, planPatch: {}, occurrences: next, reason: "x" }))).toBe("version_conflict");
    expect(await code(store.replaceFuture({ planId, expectedVersion: 1, planPatch: {}, occurrences: next, reason: " " }))).toBe("invalid_input");
    await store.collectDue("2030-01-01T10:00:00.000Z");
    await store.claim(occs[0].id, "auto_charge", null);
    expect(await code(store.replaceFuture({ planId, expectedVersion: 1, planPatch: {}, occurrences: next, reason: "x" }))).toBe("attempt_in_flight");
    expect(await code(store.cancelPlan(planId))).toBe("attempt_in_flight");
  });

  it("replaceFuture supersedes the open ones, appends seqs after the max, releases open links", async () => {
    const { store, planId, occs } = await setup();
    await store.collectDue("2030-01-01T10:00:00.000Z");
    const link = await store.claim(occs[0].id, "checkout_link", null);
    const v = await store.replaceFuture({ planId, expectedVersion: 1, planPatch: { collectionMethod: "manual" }, occurrences: drafts(["2030-03-01", "2030-03-02"], 15000), reason: "operator change" });
    expect(v).toBe(2);
    const all = await store.listOccurrences(planId);
    expect(all.map((o) => [o.seq, o.status])).toEqual([
      [1, "superseded"],
      [2, "superseded"],
      [3, "superseded"],
      [4, "scheduled"],
      [5, "scheduled"],
    ]);
    expect(all[3].collectionMethod).toBe("manual");
    expect((await store.getAttempt(link.ok ? link.claim.attemptId : ""))!.status).toBe("abandoned");
    expect(store.snapshot().revisions).toHaveLength(1);
  });

  it("one live plan per rental", async () => {
    const { store } = await setup();
    expect(await code(store.createPlan({ plan: planInput(), occurrences: drafts(["2030-05-01"], 100) }))).toBe("plan_exists");
  });

  it("the plan completes once every occurrence is paid, skipped or closed", async () => {
    const { store, planId, occs } = await setup(30000, { collectionMethod: "manual" });
    for (const o of occs) {
      const c = await store.claim(o.id, "manual", null);
      await store.recordSuccess({ attemptId: c.ok ? c.claim.attemptId : "", amountCents: 10000, providerRef: null, providerAccount: null, providerMode: null, paymentProvider: "stripe", platformAccount: "uk", paymentDate: "2030-01-01", method: "Cash" });
    }
    expect((await store.getPlan(planId))!.status).toBe("completed");
  });
});
