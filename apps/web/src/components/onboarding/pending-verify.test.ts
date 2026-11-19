// @vitest-environment jsdom

/**
 * The code screen, remembered across a reload or a closed tab.
 *
 * WHAT THESE PIN:
 *   - a record lasts exactly as long as the code does (OTP_TTL_MS, 10 minutes,
 *     in supabase/functions/_shared/signup-otp.ts) and is dropped after;
 *   - the resend countdown carries on from when the code was sent;
 *   - nothing secret is kept: no password, no code;
 *   - junk in storage is ignored, never trusted.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearPendingVerify,
  isPendingVerifyLive,
  PENDING_VERIFY_TTL_MS,
  readPendingVerify,
  resendCooldownSeconds,
  writePendingVerify,
} from "./pending-verify";

const KEY = "d247.signup.pendingVerify";
const record = (sentAt: number) => ({
  email: "jordan@harborcars.com",
  fullName: "Jordan Miller",
  planId: "starter",
  sentAt,
});

afterEach(() => window.localStorage.clear());

describe("how long the code screen is remembered", () => {
  it("matches the server's code lifetime", () => {
    const otp = readFileSync(resolve(__dirname, "../../../../../supabase/functions/_shared/signup-otp.ts"), "utf8");
    const ttl = otp.match(/export const OTP_TTL_MS = ([^;]+);/)?.[1];
    expect(ttl).toBeDefined();
    expect(Function(`return (${ttl})`)()).toBe(PENDING_VERIFY_TTL_MS);
  });

  it("is live until the code expires, then not", () => {
    const now = 1_000_000_000;
    expect(isPendingVerifyLive(record(now), now)).toBe(true);
    expect(isPendingVerifyLive(record(now), now + PENDING_VERIFY_TTL_MS - 1)).toBe(true);
    expect(isPendingVerifyLive(record(now), now + PENDING_VERIFY_TTL_MS)).toBe(false);
    expect(isPendingVerifyLive(null, now)).toBe(false);
  });

  it("drops an expired record from storage when it is read", () => {
    const now = Date.now();
    writePendingVerify(record(now - PENDING_VERIFY_TTL_MS - 1000));
    expect(readPendingVerify(now)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("reads back a live record, and forgets it on request", () => {
    const now = Date.now();
    writePendingVerify(record(now - 30_000));
    expect(readPendingVerify(now)).toEqual(record(now - 30_000));
    clearPendingVerify();
    expect(readPendingVerify(now)).toBeNull();
  });
});

describe("what is stored", () => {
  it("keeps who, which plan and when: never a password or a code", () => {
    writePendingVerify({ ...record(Date.now()), password: "Harbor12345x", code: "123456" } as never);
    const stored = JSON.parse(window.localStorage.getItem(KEY)!);
    expect(Object.keys(stored).sort()).toEqual(["email", "fullName", "planId", "sentAt"]);
  });

  it("ignores junk", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readPendingVerify()).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ email: "nope", planId: "starter", sentAt: Date.now() }));
    expect(readPendingVerify()).toBeNull();
  });
});

describe("the resend countdown", () => {
  it("carries on from when the code was sent", () => {
    const now = 5_000_000;
    expect(resendCooldownSeconds(now, now)).toBe(60);
    expect(resendCooldownSeconds(now - 45_000, now)).toBe(15);
    expect(resendCooldownSeconds(now - 120_000, now)).toBe(0);
    expect(resendCooldownSeconds(null, now)).toBe(60);
  });
});
