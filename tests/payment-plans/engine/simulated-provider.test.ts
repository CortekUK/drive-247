/**
 * Engine mechanics — SimulatedProvider behaves like Stripe where the engine's
 * safety depends on it. A simulation kinder than Stripe would prove nothing:
 *   - a key's FIRST request decides; every replay returns the stored answer,
 *     a stored FAILURE included;
 *   - a replay with different parameters is an idempotency_error, never a
 *     second charge;
 *   - a 5xx may arrive after the money moved;
 *   - a 409 stores nothing.
 */
import { describe, expect, it } from "vitest";
import { SimulatedProvider, type ChargeRequest } from "../../../supabase/functions/_shared/payment-plans/providers.ts";

function req(occ: string, key: string, amountCents = 12345, attemptId = `att-${key}`): ChargeRequest {
  return {
    amountCents,
    currency: "usd",
    idempotencyKey: key,
    account: "acct_test",
    customerRef: "cust-1",
    paymentMethodRef: "pm_1",
    metadata: { type: "payment_plan", occurrence_id: occ, attempt_id: attemptId, plan_id: "p", tenant_id: "t", rental_id: "r" },
  };
}

describe("SimulatedProvider — idempotency", () => {
  it("a replayed key returns the stored success and moves no more money", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    const a = await p.charge(req("o1", "k1"));
    const b = await p.charge(req("o1", "k1"));
    expect(a.kind).toBe("succeeded");
    expect(b).toEqual(a);
    expect(p.calls).toHaveLength(2);
    expect(p.chargesFor("o1")).toHaveLength(1);
  });

  it("a stored FAILURE is replayed too — a replay is not a retry", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    p.queue("o1", [{ decline: "insufficient_funds" }, "succeed"]);
    const first = await p.charge(req("o1", "k1"));
    const replay = await p.charge(req("o1", "k1"));
    expect(first.kind).toBe("declined");
    expect(replay).toEqual(first);
    // The queued success is consumed only by a NEW key.
    const fresh = await p.charge(req("o1", "k2"));
    expect(fresh.kind).toBe("succeeded");
    expect(p.chargesFor("o1")).toHaveLength(1);
  });

  it("a replay with a different amount is refused, never charged", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    await p.charge(req("o1", "k1", 5000));
    const other = await p.charge(req("o1", "k1", 5001));
    expect(other).toMatchObject({ kind: "declined", errorCode: "idempotency_error" });
    expect(p.chargesFor("o1")).toHaveLength(1);
  });

  it("indeterminate_after_charge: the caller sees a 5xx, the money moved, a replay reveals it", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    p.queue("o1", ["indeterminate_after_charge"]);
    const first = await p.charge(req("o1", "k1"));
    expect(first.kind).toBe("indeterminate");
    expect(p.chargesFor("o1")).toHaveLength(1);
    const replay = await p.charge(req("o1", "k1"));
    expect(replay.kind).toBe("succeeded");
    expect(replay.kind === "succeeded" && replay.providerRef).toBe(p.chargesFor("o1")[0].providerRef);
    expect(p.chargesFor("o1")).toHaveLength(1);
  });

  it("indeterminate_before_charge: nothing moved, nothing stored — a replay gets the next scripted outcome", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    p.queue("o1", ["indeterminate_before_charge", { decline: "expired_card" }]);
    expect((await p.charge(req("o1", "k1"))).kind).toBe("indeterminate");
    expect(p.chargesFor("o1")).toHaveLength(0);
    expect(await p.charge(req("o1", "k1"))).toMatchObject({ kind: "declined", declineCode: "expired_card" });
  });

  it("in_use stores nothing: the next request with the key is treated as the first", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    p.queue("o1", ["in_use"]);
    expect(await p.charge(req("o1", "k1"))).toEqual({ kind: "in_use" });
    expect((await p.charge(req("o1", "k1"))).kind).toBe("succeeded"); // fallback
    expect(p.chargesFor("o1")).toHaveLength(1);
  });

  it("queues are per occurrence and consumed in order; the fallback applies after", async () => {
    const p = new SimulatedProvider({ account: "acct_test", fallback: { decline: "do_not_honor" } });
    p.queue("oA", ["succeed"]);
    expect((await p.charge(req("oB", "kb1"))).kind).toBe("declined");
    expect((await p.charge(req("oA", "ka1"))).kind).toBe("succeeded");
    expect((await p.charge(req("oA", "ka2"))).kind).toBe("declined");
  });
});

describe("SimulatedProvider — refunds and lookup", () => {
  it("findByAttempt returns the charge net of refunds, null once fully refunded", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    const out = await p.charge(req("o1", "k1", 9000, "att-9"));
    const ref = out.kind === "succeeded" ? out.providerRef : "";
    expect(await p.findByAttempt("att-9")).toEqual({ providerRef: ref, amountCents: 9000 });
    expect(await p.refund(ref, 4000, "r1")).toEqual({ ok: true });
    expect(await p.findByAttempt("att-9")).toEqual({ providerRef: ref, amountCents: 5000 });
    expect(await p.refund(ref, 5000, "r2")).toEqual({ ok: true });
    expect(await p.findByAttempt("att-9")).toBeNull();
    expect(await p.findByAttempt("att-unknown")).toBeNull();
  });

  it("a refund key is idempotent and a refund can never exceed the charge", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    const out = await p.charge(req("o1", "k1", 1000));
    const ref = out.kind === "succeeded" ? out.providerRef : "";
    await p.refund(ref, 600, "same");
    await p.refund(ref, 600, "same");
    expect(p.refunds).toEqual([{ providerRef: ref, amountCents: 600 }]);
    expect((await p.refund(ref, 500, "other")).ok).toBe(false);
  });

  it("scriptRefunds('fail') makes the next refund fail, for the compensation path", async () => {
    const p = new SimulatedProvider({ account: "acct_test" });
    const out = await p.charge(req("o1", "k1", 1000));
    p.scriptRefunds(["fail"]);
    expect((await p.refund(out.kind === "succeeded" ? out.providerRef : "", 1000, "x")).ok).toBe(false);
    expect(p.refunds).toHaveLength(0);
  });
});
