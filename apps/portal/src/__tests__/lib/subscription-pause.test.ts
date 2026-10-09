import { describe, expect, it } from "vitest";
import {
  addMonths,
  billsAroundPause,
  checkPause,
  MSG_MAX,
  MSG_MONTHS,
  msgLastDays,
  parseYmd,
  toYmd,
} from "@/lib/subscription-pause";

// Subscribed on Oct 20: bills on the 20th of every month.
const knownBill = new Date("2026-11-20T10:00:00Z");
const now = new Date("2026-10-25T09:00:00Z");
const base = { now, knownBill, interval: "month" };

describe("checkPause", () => {
  it("accepts 1 and 2 whole months", () => {
    const two = checkPause({ ...base, startDate: "2026-10-30", endDate: "2026-12-30" });
    expect(two.ok && two.months).toBe(2);
    const one = checkPause({ ...base, startDate: "2026-10-30", endDate: "2026-11-30" });
    expect(one.ok && one.months).toBe(1);
  });

  it("rejects day-based lengths (Rule 5)", () => {
    const r = checkPause({ ...base, startDate: "2026-10-30", endDate: "2026-11-10" });
    expect(r).toMatchObject({ ok: false, message: MSG_MONTHS });
    const r2 = checkPause({ ...base, startDate: "2026-10-30", endDate: "2026-12-15" });
    expect(r2).toMatchObject({ ok: false, message: MSG_MONTHS });
  });

  it("rejects more than 2 months (Rule 2)", () => {
    const r = checkPause({ ...base, startDate: "2026-10-30", endDate: "2027-01-30" });
    expect(r).toMatchObject({ ok: false, message: MSG_MAX });
  });

  it("refuses a start in the last 10 days before a bill (Rule 3)", () => {
    const r = checkPause({ ...base, startDate: "2026-11-12", endDate: "2026-12-12" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toBe(msgLastDays(9));
    // 11 days before the bill is fine.
    expect(checkPause({ ...base, startDate: "2026-11-09", endDate: "2026-12-09" }).ok).toBe(true);
  });

  it("starts today means now", () => {
    const r = checkPause({ ...base, startDate: "2026-10-25", endDate: "2026-11-25" });
    expect(r.ok && r.startsAt.toISOString()).toBe(now.toISOString());
  });

  it("refuses the past", () => {
    expect(checkPause({ ...base, startDate: "2026-10-20", endDate: "2026-11-20" }).ok).toBe(false);
  });
});

describe("billing anchor (Rule 4)", () => {
  it("skips the bills inside the pause and keeps the 20th", () => {
    const { skipped, nextBill } = billsAroundPause(
      knownBill,
      "month",
      new Date("2026-10-30T00:00:00Z"),
      new Date("2026-12-30T00:00:00Z"),
    );
    expect(skipped.map((d) => toYmd(d))).toEqual(["2026-11-20", "2026-12-20"]);
    expect(toYmd(nextBill)).toBe("2027-01-20");
  });

  it("clamps month ends", () => {
    expect(toYmd(addMonths(parseYmd("2027-01-31")!, 1))).toBe("2027-02-28");
  });
});
