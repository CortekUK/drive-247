import { describe, it, expect } from "vitest";
import { readEdgeSource, liftDeclaration, compile } from "../helpers/edge-source";

/**
 * R-23 · Refund and checkout idempotency keys.
 *
 * WHY THIS NEEDS EXECUTING RATHER THAN READING
 *
 * This repo passes NO idempotency key on any of its eight Stripe `refunds.create`
 * call sites — retry safety comes from ledger-derived `availableForRefund`
 * instead. Square makes the key a required body field with a 45-character cap,
 * which is shorter than Stripe's 255 and shorter than the composite keys this
 * codebase already builds elsewhere (`charge-saved-card-<uuid>-<uuid>` is 91).
 *
 * So the two failure modes are opposite and both silent:
 *   * too long  -> Square rejects the write, or truncates it into a collision
 *   * not stable -> a retry after a timeout takes the customer's money twice
 *
 * Neither is visible in the source. Both are visible the moment you run it.
 */

const clientSrc = () => readEdgeSource("_shared/payments/square-client.ts");

const SQUARE_CAP = 45;

const makeKey = compile<(raw: string) => Promise<string>>(
  [
    `const SQUARE_IDEMPOTENCY_MAX = ${SQUARE_CAP};`,
    liftDeclaration(clientSrc(), "squareIdempotencyKey"),
  ],
  "squareIdempotencyKey",
);

const acceptsKey = compile<(path: string) => boolean>(
  [
    "const IDEMPOTENCY_INCAPABLE_PATH = /^\\/oauth2(\\/|$)/;",
    liftDeclaration(clientSrc(), "pathAcceptsIdempotencyKey"),
  ],
  "pathAcceptsIdempotencyKey",
);

describe("the cap is Square's, not Stripe's", () => {
  it("is 45, and is stated as a Square limit", () => {
    const s = clientSrc();
    expect(s).toContain("SQUARE_IDEMPOTENCY_MAX = 45");
    expect(s).toContain("45");
  });
});

describe("keys never exceed Square's 45-character cap", () => {
  it("passes a short key through untouched", async () => {
    const k = await makeKey("refund-abc-123");
    expect(k).toBe("refund-abc-123");
  });

  it("clamps the composite key shape this repo already builds", async () => {
    // The real one from charge-saved-card is 91 characters. Unclamped it is a
    // Square 400 on a money path.
    const raw = `charge-saved-card-${"a".repeat(36)}-${"b".repeat(36)}`;
    expect(raw.length).toBeGreaterThan(SQUARE_CAP);

    const k = await makeKey(raw);
    expect(k.length).toBeLessThanOrEqual(SQUARE_CAP);
  });

  it("stays within the cap for every length either side of the boundary", async () => {
    for (const len of [1, 44, 45, 46, 60, 91, 200, 1000]) {
      const k = await makeKey("x".repeat(len));
      expect(k.length, `input ${len} produced ${k.length}`).toBeLessThanOrEqual(SQUARE_CAP);
    }
  });

  it("does not clamp a key that is exactly at the cap", async () => {
    const raw = "y".repeat(SQUARE_CAP);
    expect(await makeKey(raw)).toBe(raw);
  });
});

describe("keys are deterministic — a retry must not double-charge", () => {
  it("the same seed always produces the same key", async () => {
    const seed = `refund-${"c".repeat(60)}`;
    const a = await makeKey(seed);
    const b = await makeKey(seed);
    expect(a).toBe(b);
  });

  it("is stable across many repetitions, not merely twice", async () => {
    const seed = `checkout-${"d".repeat(80)}`;
    const first = await makeKey(seed);
    for (let i = 0; i < 25; i++) {
      expect(await makeKey(seed)).toBe(first);
    }
  });
});

describe("clamping must not manufacture collisions", () => {
  it("two long seeds sharing a 45-char prefix still differ", async () => {
    // This is the whole reason the implementation appends a hash instead of a
    // plain slice. A naive truncate would make these identical — and an
    // identical idempotency key means Square treats the SECOND refund as a
    // replay of the first and silently returns the original. One customer gets
    // their money; the other does not.
    const shared = "refund-".padEnd(SQUARE_CAP + 10, "z");
    const a = await makeKey(`${shared}-rental-AAAA`);
    const b = await makeKey(`${shared}-rental-BBBB`);

    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(SQUARE_CAP);
    expect(b.length).toBeLessThanOrEqual(SQUARE_CAP);
  });

  it("differs on a single-character change deep past the cap", async () => {
    const base = "p".repeat(120);
    const a = await makeKey(base + "1");
    const b = await makeKey(base + "2");
    expect(a).not.toBe(b);
  });

  it("stays collision-free across a spread of realistic seeds", async () => {
    const seeds = Array.from({ length: 200 }, (_, i) =>
      `square-refund-${"u".repeat(40)}-payment-${i}`,
    );
    const keys = await Promise.all(seeds.map(makeKey));
    expect(new Set(keys).size).toBe(seeds.length);
  });
});

describe("the OAuth namespace must never receive a key", () => {
  it("rejects /oauth2 paths", () => {
    // ObtainToken and the refresh grant take a fixed parameter set. An injected
    // key is at best ignored and at worst turns a credential exchange into a
    // 400 — and a failed refresh strands a live merchant 30 days later, far
    // from the change that caused it.
    expect(acceptsKey("/oauth2/token")).toBe(false);
    expect(acceptsKey("/oauth2/token/status")).toBe(false);
    expect(acceptsKey("/oauth2/revoke")).toBe(false);
    expect(acceptsKey("/oauth2")).toBe(false);
  });

  it("allows the money paths", () => {
    expect(acceptsKey("/v2/payments")).toBe(true);
    expect(acceptsKey("/v2/refunds")).toBe(true);
    expect(acceptsKey("/v2/online-checkout/payment-links")).toBe(true);
    expect(acceptsKey("/v2/orders")).toBe(true);
  });

  it("does not match a path that merely contains oauth2 later on", () => {
    // The guard is anchored. A path like /v2/oauth2-ish must not be swept up.
    expect(acceptsKey("/v2/oauth2/token")).toBe(true);
  });
});
