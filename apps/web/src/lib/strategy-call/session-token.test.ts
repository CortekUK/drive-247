import { afterEach, describe, expect, it } from "vitest";
import {
  createStrategyCallSessionToken,
  hashStrategyCallSessionToken,
  hashStrategyCallSubmissionSource,
  resolveStrategyCallPepper,
} from "./session-token";

describe("strategy-call session tokens", () => {
  const pepper = "test-only-pepper-with-more-than-sixteen-bytes";

  it("creates independent 32-byte base64url bearer tokens", () => {
    const first = createStrategyCallSessionToken();
    const second = createStrategyCallSessionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("hashes deterministically without retaining the raw token", () => {
    const token = createStrategyCallSessionToken();
    const hash = hashStrategyCallSessionToken(token, pepper);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashStrategyCallSessionToken(token, pepper));
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(
      hashStrategyCallSessionToken(token, `${pepper}-different`),
    );
  });

  it("separates submission rate keys from session-token hashes", () => {
    const value = "203.0.113.7";
    expect(hashStrategyCallSubmissionSource(value, pepper)).not.toBe(
      hashStrategyCallSessionToken(value.repeat(4), pepper),
    );
  });

  it("fails closed for undersized bearer tokens or peppers", () => {
    expect(() => hashStrategyCallSessionToken("short", pepper)).toThrow();
    expect(() =>
      hashStrategyCallSessionToken(createStrategyCallSessionToken(), "short"),
    ).toThrow();
    expect(() => hashStrategyCallSubmissionSource("", pepper)).toThrow();
  });
});

// This funnel went live needing two new server variables that the deploy did
// not have, so the lead form returned "Something went wrong" for a full
// business day. Deriving the pepper from the service-role key the feature
// already requires removes one of those two failure points.
describe("resolveStrategyCallPepper", () => {
  const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.service-role-example.signature";
  const original = {
    pepper: process.env.STRATEGY_CALL_SESSION_PEPPER,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  function setEnv(pepper?: string, key?: string) {
    if (pepper === undefined) delete process.env.STRATEGY_CALL_SESSION_PEPPER;
    else process.env.STRATEGY_CALL_SESSION_PEPPER = pepper;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }

  afterEach(() => setEnv(original.pepper, original.key));

  it("prefers an explicitly configured pepper", () => {
    const explicit = "x".repeat(48);
    setEnv(explicit, SERVICE_ROLE_KEY);
    expect(resolveStrategyCallPepper()).toBe(explicit);
  });

  it("derives a stable pepper from the service-role key when none is set", () => {
    setEnv(undefined, SERVICE_ROLE_KEY);
    const first = resolveStrategyCallPepper();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveStrategyCallPepper()).toBe(first);
  });

  it("never exposes the service-role key it derives from", () => {
    setEnv(undefined, SERVICE_ROLE_KEY);
    const derived = resolveStrategyCallPepper();
    expect(derived).not.toBe(SERVICE_ROLE_KEY);
    expect(SERVICE_ROLE_KEY).not.toContain(derived as string);
  });

  it("produces a different pepper for a different service-role key", () => {
    setEnv(undefined, SERVICE_ROLE_KEY);
    const a = resolveStrategyCallPepper();
    setEnv(undefined, `${SERVICE_ROLE_KEY}-rotated`);
    expect(resolveStrategyCallPepper()).not.toBe(a);
  });

  it("rejects a too-short configured pepper rather than using it", () => {
    // hashStrategyCallSessionToken throws below 16 chars, so accepting one here
    // would swap a clear config error for an opaque 500 on every submission.
    setEnv("tooshort", SERVICE_ROLE_KEY);
    const resolved = resolveStrategyCallPepper();
    expect(resolved).not.toBe("tooshort");
    expect(resolved).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null when neither secret is available", () => {
    setEnv(undefined, undefined);
    expect(resolveStrategyCallPepper()).toBeNull();
  });

  it("yields a pepper the token hasher actually accepts", () => {
    setEnv(undefined, SERVICE_ROLE_KEY);
    const derived = resolveStrategyCallPepper() as string;
    const token = createStrategyCallSessionToken();
    expect(hashStrategyCallSessionToken(token, derived)).toMatch(/^[0-9a-f]{64}$/);
  });
});
