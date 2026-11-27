// Proves spec 04 · the 72-hour rule (Worked examples) and who sees the window.
// The rule lives in one place: apps/portal/src/lib/signup-verify.ts.
import { describe, expect, it } from "vitest";
import * as rule from "../../../../apps/portal/src/lib/signup-verify";

const fn = (name: string) => {
  const f = (rule as Record<string, unknown>)[name];
  if (typeof f !== "function") throw new Error(`${name} is not in apps/portal/src/lib/signup-verify.ts yet`);
  return f as (...a: unknown[]) => unknown;
};

describe("04 the reminder and the 3-day block", () => {
  // Rows of spec 04's Worked examples, worked by hand. UTC.
  it.each([
    [1, "2026-11-26T10:00:00Z", "2026-11-29T09:59:00Z", false],
    [2, "2026-11-26T10:00:00Z", "2026-11-29T10:00:00Z", true],
    [3, "2026-11-28T23:30:00Z", "2026-12-01T23:30:00Z", true],
  ])("04.4 #%i created %s, now %s, blocked %s", (_row, created, now, expected) => {
    expect(fn("isSignupVerifyOverdue")(new Date(created as string), new Date(now as string))).toBe(expected);
  });

  it("04.4 #4 one second before the 72 hours is not blocked", () => {
    expect(fn("isSignupVerifyOverdue")(new Date("2026-11-26T10:00:00Z"), new Date("2026-11-29T09:59:59Z"))).toBe(false);
  });

  it("04.7 #1 nobody with no pending flag sees the window", () => {
    expect(fn("needsSignupVerify")({ app_metadata: {} })).toBe(false);
    expect(fn("needsSignupVerify")({ app_metadata: { provider: "google" } })).toBe(false);
  });

  it.each([
    // Worked by hand: 72h left at signup; days are counted UP while over a day is left.
    ["2026-11-26T10:00:00Z", "2026-11-26T10:00:00Z", "3 days left"],
    ["2026-11-26T10:00:00Z", "2026-11-26T10:05:00Z", "3 days left"], // 71h55m left
    ["2026-11-26T10:00:00Z", "2026-11-27T10:00:01Z", "2 days left"], // 47h59m59s left
    ["2026-11-26T10:00:00Z", "2026-11-28T09:59:59Z", "2 days left"], // 24h00m01s left
    ["2026-11-26T10:00:00Z", "2026-11-28T10:00:00Z", "24 hours left"], // exactly 24h left
    ["2026-11-26T10:00:00Z", "2026-11-28T10:00:01Z", "23 hours left"],
    ["2026-11-26T10:00:00Z", "2026-11-29T08:59:59Z", "1 hour left"],
    ["2026-11-26T10:00:00Z", "2026-11-29T09:30:00Z", "Less than an hour left"],
    ["2026-11-26T10:00:00Z", "2026-11-29T10:00:00Z", null],
  ])("04.6 #%s now %s says %s", (created, now, expected) => {
    expect(fn("timeLeftText")(created, new Date(now as string))).toBe(expected);
  });

  it("04.4 #bad a missing or broken signup date never blocks", () => {
    expect(fn("isSignupVerifyOverdue")("not a date", new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("04.7 #2 a pending flag shows the window", () => {
    expect(fn("needsSignupVerify")({ app_metadata: { d247_signup_email_pending: true } })).toBe(true);
    expect(fn("needsSignupVerify")({ app_metadata: { d247_signup_password_pending: true } })).toBe(true);
  });
});
