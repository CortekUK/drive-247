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
