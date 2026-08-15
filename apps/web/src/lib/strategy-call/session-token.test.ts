import { describe, expect, it } from "vitest";
import {
  createStrategyCallSessionToken,
  hashStrategyCallSessionToken,
  hashStrategyCallSubmissionSource,
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
