/**
 * The developer billing states, and the guards that keep them out of
 * production. The second describe block is the one that matters: this override
 * can hand back a healthy subscription, so the gates are the whole safety
 * argument and they are asserted rather than assumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_SCENARIOS,
  BILLING_SCENARIO_KEY,
  readBillingScenario,
  setBillingScenario,
} from "@/lib/dev-overrides";
import { applyBillingScenario } from "@/hooks/use-billing-scenario";
import { subscribeDevOverrides } from "@/lib/dev-overrides";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

describe("billing scenarios", () => {
  let store: Storage;
  /* vitest runs with NODE_ENV="test", which the module correctly treats as
     "not development" — so every read and write here would be inert without
     this. The same treatment the existing dev-overrides suite uses. */
  beforeEach(() => { store = fakeStorage(); vi.stubEnv("NODE_ENV", "development"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("offers every state the spec asks to be reviewable", () => {
    const ids = BILLING_SCENARIOS.map((s) => s.id);
    for (const required of [
      "payment_failed", "overdue", "grace_expiring", "grace_expired", "recovered",
    ]) {
      expect(ids).toContain(required);
    }
    expect(ids[0]).toBe("off");
  });

  it("round-trips a selection", () => {
    setBillingScenario("grace_expired", store);
    expect(readBillingScenario(store)).toBe("grace_expired");
  });

  it("clears the key entirely on off, leaving no trace", () => {
    setBillingScenario("overdue", store);
    setBillingScenario("off", store);
    expect(store.getItem(BILLING_SCENARIO_KEY)).toBeNull();
    expect(readBillingScenario(store)).toBe("off");
  });

  it("reads an unknown or stale value as off rather than throwing", () => {
    store.setItem(BILLING_SCENARIO_KEY, "state_from_an_older_build");
    expect(readBillingScenario(store)).toBe("off");
    store.setItem(BILLING_SCENARIO_KEY, "");
    expect(readBillingScenario(store)).toBe("off");
  });

  it("survives storage that throws, which is Safari private mode", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    } as unknown as Storage;
    expect(() => readBillingScenario(hostile)).not.toThrow();
    expect(readBillingScenario(hostile)).toBe("off");
    expect(() => setBillingScenario("overdue", hostile)).not.toThrow();
  });
});

describe("the production guard", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("cannot be switched on outside development, even with the key planted", () => {
    /* This is the guard the whole design leans on. A key on a live operator's
       browser must do nothing: `readBillingScenario` returns "off", so the
       override hook returns the real subscription state untouched. */
    const store = fakeStorage();
    store.setItem(BILLING_SCENARIO_KEY, "grace_expired");
    vi.stubEnv("NODE_ENV", "production");
    expect(readBillingScenario(store)).toBe("off");
  });

  it("writes nothing outside development", () => {
    const store = fakeStorage();
    vi.stubEnv("NODE_ENV", "production");
    setBillingScenario("grace_expired", store);
    expect(store.getItem(BILLING_SCENARIO_KEY)).toBeNull();
  });

  it("is inert under vitest's own NODE_ENV, with the key planted", () => {
    /* "test" is not "development" either, and the module must not special-case
       it — a test runner is not a developer at a browser. */
    const store = fakeStorage();
    store.setItem(BILLING_SCENARIO_KEY, "grace_expired");
    expect(process.env.NODE_ENV).not.toBe("development");
    expect(readBillingScenario(store)).toBe("off");
  });

  it("works once NODE_ENV really is development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const store = fakeStorage();
    setBillingScenario("payment_failed", store);
    expect(readBillingScenario(store)).toBe("payment_failed");
  });
});

/**
 * The guarantee the whole feature rests on: with previews OFF, real billing
 * behaves exactly as it did. Asserted by object IDENTITY rather than equality,
 * so a future "harmless" spread cannot slip in and start handing every consumer
 * a new object on every render.
 */
describe("real billing is untouched", () => {
  const real = {
    isSubscribed: true,
    hasExpiredSubscription: false,
    isPastDue: false,
    isInGracePeriod: false,
    isGraceExpired: false,
    graceDaysRemaining: 0,
    graceSeverity: "none" as const,
    graceEndsAt: null,
    owesOutstandingInvoice: false,
    isResolved: true,
    subscription: { id: "sub_real" },
  };

  it("returns the caller's own object when no state is selected", () => {
    expect(applyBillingScenario(real, "off", "northwind")).toBe(real);
  });

  it("returns the caller's own object on any tenant but the canary", () => {
    /* The gate is on the SLUG, and every other tenant on the platform must be
       unreachable by this even with a state selected. */
    expect(applyBillingScenario(real, "grace_expired", "jangramrentals")).toBe(real);
    expect(applyBillingScenario(real, "grace_expired", null)).toBe(real);
    expect(applyBillingScenario(real, "grace_expired", "")).toBe(real);
  });

  it("blocks on the canary when the expired state is selected", () => {
    const out = applyBillingScenario(real, "grace_expired", "northwind");
    expect(out).not.toBe(real);
    expect(out.isGraceExpired).toBe(true);
    expect(out.hasExpiredSubscription).toBe(true);
    expect(out.isSubscribed).toBe(false);
  });

  it("warns without blocking for a failed or overdue payment", () => {
    for (const s of ["payment_failed", "overdue"] as const) {
      const out = applyBillingScenario(real, s, "northwind");
      expect(out.isPastDue).toBe(true);
      expect(out.isInGracePeriod).toBe(true);
      /* Still has access — the window is the whole point. */
      expect(out.isSubscribed).toBe(true);
      expect(out.isGraceExpired).toBe(false);
    }
  });

  it("treats a failed payment and an overdue one as the same state", () => {
    /* The spec calls them one user problem: the payment was missed. Two
       warnings saying one thing is how a UI stops being read. */
    const failed = applyBillingScenario(real, "payment_failed", "northwind");
    const overdue = applyBillingScenario(real, "overdue", "northwind");
    expect(failed.isPastDue).toBe(overdue.isPastDue);
    expect(failed.isInGracePeriod).toBe(overdue.isInGracePeriod);
    expect(failed.graceSeverity).toBe(overdue.graceSeverity);
  });

  it("restores access when payment is recovered", () => {
    const blocked = applyBillingScenario(real, "grace_expired", "northwind");
    expect(blocked.isSubscribed).toBe(false);
    const back = applyBillingScenario(blocked, "recovered", "northwind");
    expect(back.isSubscribed).toBe(true);
    expect(back.isGraceExpired).toBe(false);
    expect(back.owesOutstandingInvoice).toBe(false);
  });

  it("never drops a key the caller supplied", () => {
    /* The patch is a merge, not a replacement: everything the hook returns —
       invoices, mutations, refetch — has to survive it. */
    const out = applyBillingScenario(real, "grace_expired", "northwind");
    for (const k of Object.keys(real)) expect(out).toHaveProperty(k);
    expect(out.subscription).toEqual({ id: "sub_real" });
  });
});

describe("cross-tab propagation", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("notifies when the billing key changes in ANOTHER tab", () => {
    /* /dev in one tab and the screen under review in another is the obvious
       way to use this, and the listener originally knew only about the empty
       state and messages keys — so selecting a billing state did nothing in
       the other tab until it was reloaded. `storage` fires only in OTHER tabs,
       so the same-tab custom event cannot cover this. */
    vi.stubEnv("NODE_ENV", "development");
    const onChange = vi.fn();
    const unsubscribe = subscribeDevOverrides(onChange);

    window.dispatchEvent(
      new StorageEvent("storage", { key: BILLING_SCENARIO_KEY, newValue: "grace_expired" }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);

    /* And a clear() — key null — wipes ours too, so it must also notify. */
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);

    /* Somebody else's key must not wake every consumer of this store. */
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated.app.key" }));
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: BILLING_SCENARIO_KEY }));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
