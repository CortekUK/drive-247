import { describe, expect, it } from "vitest";
import { lockboxCodeDigits } from "@/components/vehicles-v2/tab-pickup";

/* Sheet 8.8: Generate makes a code of the length set in Settings → Lockbox (1–20). */
describe("lockboxCodeDigits", () => {
  it("uses the length from Settings", () => {
    expect(lockboxCodeDigits(4)).toBe(4);
    expect(lockboxCodeDigits(6)).toBe(6);
    expect(lockboxCodeDigits(10)).toBe(10);
    expect(lockboxCodeDigits(1)).toBe(1);
    expect(lockboxCodeDigits(20)).toBe(20);
  });

  it("falls back to 4 when Settings says any length", () => {
    expect(lockboxCodeDigits(null)).toBe(4);
    expect(lockboxCodeDigits(undefined)).toBe(4);
    expect(lockboxCodeDigits(0)).toBe(4);
  });

  it("never goes past 20", () => {
    expect(lockboxCodeDigits(50)).toBe(20);
  });
});
