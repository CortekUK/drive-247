/**
 * Engine mechanics — dates.ts / amounts.ts / schedule.ts refuse bad input and
 * keep their invariants for ANY input. Properties, not literals: the golden
 * table (design §3.1) is the evidence suite's.
 */
import { describe, expect, it } from "vitest";
import { addDays, compareDates, diffDays, dueAtUtc, fromDayNumber, isoWeekday, localDateInZone, monthlyDate, parseISODate, toDayNumber, validateChargeTime } from "../../../supabase/functions/_shared/payment-plans/dates.ts";
import { centsToDecimal, computeAmounts, decimalToCents, mulDivFloor, splitByDays, splitEvenly } from "../../../supabase/functions/_shared/payment-plans/amounts.ts";
import { buildSchedule, generateDates, PlanRuleError } from "../../../supabase/functions/_shared/payment-plans/schedule.ts";
import { MAX_OCCURRENCES, type ScheduleRule } from "../../../supabase/functions/_shared/payment-plans/types.ts";

/** Deterministic pseudo-random numbers so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ruleCode = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof PlanRuleError ? e.code : `other:${(e as Error).name}`;
  }
  return "no-error";
};

describe("dates — calendar strings, never local time", () => {
  it("rejects impossible days instead of rolling them over", () => {
    expect(() => parseISODate("2026-02-30")).toThrow(RangeError);
    expect(() => parseISODate("2026-13-01")).toThrow(RangeError);
    expect(() => parseISODate("2026-1-1")).toThrow(RangeError);
    expect(parseISODate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
  });

  it("day numbers round-trip across a wide range, and addDays/diffDays agree", () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(r() * 60000) - 10000;
      const d = fromDayNumber(n);
      expect(toDayNumber(d)).toBe(n);
      const k = Math.floor(r() * 2000) - 1000;
      expect(diffDays(d, addDays(d, k))).toBe(k);
    }
  });

  it("consecutive days step the ISO weekday 1..7 and wrap", () => {
    let d = "2031-01-05";
    let prev = isoWeekday(d);
    for (let i = 0; i < 30; i++) {
      d = addDays(d, 1);
      const w = isoWeekday(d);
      expect(w).toBe(prev === 7 ? 1 : prev + 1);
      prev = w;
    }
  });

  it("monthlyDate clamps to the month's length and never goes past it", () => {
    for (let k = 0; k < 48; k++) {
      const d = monthlyDate(2031, 1, k, 31);
      const { y, m, d: day } = parseISODate(d);
      expect(day).toBeLessThanOrEqual(31);
      // −1 is always the last day: the next day is the 1st.
      expect(parseISODate(addDays(monthlyDate(y, m, 0, -1), 1)).d).toBe(1);
    }
  });

  it("refuses charge times inside 00:00–03:59 and malformed times", () => {
    for (const t of ["00:00", "02:30", "03:59", "3:00", "24:00", "10:60", "", "10:00:30"]) {
      expect(ruleCode(() => validateChargeTime(t))).toBe("charge_time_invalid");
    }
    expect(validateChargeTime("04:00")).toEqual({ hh: 4, mm: 0 });
    expect(validateChargeTime("10:00:00")).toEqual({ hh: 10, mm: 0 }); // Postgres `time` text
  });

  it("dueAtUtc lands on the requested local wall time, in any zone, every day of a year (DST included)", () => {
    for (const zone of ["America/New_York", "Europe/London", "Asia/Dubai", "Australia/Sydney", "America/Los_Angeles"]) {
      for (let i = 0; i < 366; i += 3) {
        const date = addDays("2031-01-01", i);
        const at = dueAtUtc(date, "10:15", zone);
        expect(localDateInZone(at, zone)).toBe(date);
        const wall = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
        expect(wall).toBe("10:15");
      }
    }
  });

  it("compareDates orders dates", () => {
    expect(compareDates("2031-01-01", "2031-01-02")).toBe(-1);
    expect(compareDates("2031-01-02", "2031-01-02")).toBe(0);
  });
});

describe("amounts — whole cents, remainder on the last, always the exact total", () => {
  it("splitEvenly and splitByDays always sum to the total, round down, and put the remainder last", () => {
    const r = rng(42);
    for (let i = 0; i < 400; i++) {
      const n = 1 + Math.floor(r() * 30);
      const total = n + Math.floor(r() * 5_000_000);
      const even = splitEvenly(total, n);
      expect(even.reduce((s, x) => s + x, 0)).toBe(total);
      expect(new Set(even.slice(0, -1)).size).toBeLessThanOrEqual(1);
      expect(even[n - 1]).toBeGreaterThanOrEqual(even[0]);

      const days = Array.from({ length: n }, () => 1 + Math.floor(r() * 40));
      const byDays = splitByDays(total, days);
      expect(byDays.reduce((s, x) => s + x, 0)).toBe(total);
      const totalDays = days.reduce((s, x) => s + x, 0);
      for (let j = 0; j < n - 1; j++) expect(byDays[j]).toBe(Math.floor((total * days[j]) / totalDays));
    }
  });

  it("mulDivFloor is exact where float division would round up", () => {
    const r = rng(3);
    for (let i = 0; i < 1000; i++) {
      const a = Math.floor(r() * 1e9);
      const b = 1 + Math.floor(r() * 4000);
      const c = 1 + Math.floor(r() * 4000);
      const q = mulDivFloor(a, b, c);
      expect(q * c).toBeLessThanOrEqual(a * b);
      expect((q + 1) * c).toBeGreaterThan(a * b);
    }
  });

  it("an occurrence below one cent is amount_too_small; fractional cents are a caller bug", () => {
    expect(ruleCode(() => computeAmounts({ mode: "split_total", totalCents: 2 }, [1, 1, 1]))).toBe("amount_too_small");
    expect(ruleCode(() => computeAmounts({ mode: "fixed", amountCents: 0 }, [1]))).toBe("amount_too_small");
    expect(ruleCode(() => computeAmounts({ mode: "fixed", amountCents: 10.5 }, [1]))).toBe("other:RangeError");
  });

  it("decimal ↔ cents conversion is exact (no x * 100)", () => {
    for (const [dec, cents] of [["0.29", 29], ["123.45", 12345], ["100", 10000], ["-5.10", -510]] as const) {
      expect(decimalToCents(dec)).toBe(cents);
      expect(decimalToCents(Number(dec))).toBe(cents);
    }
    expect(centsToDecimal(12345)).toBe("123.45");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(() => decimalToCents("1.234")).toThrow(RangeError);
  });
});

describe("schedule — validation codes and invariants", () => {
  const base: ScheduleRule = { freq: "weekly", interval: 1, byWeekday: [3], anchor: "2031-04-02", firstOccurrence: "on_anchor", end: { kind: "count", count: 5 } };

  it("maps each operator mistake to its code", () => {
    expect(ruleCode(() => generateDates({ ...base, interval: 0 }))).toBe("interval_invalid");
    expect(ruleCode(() => generateDates({ ...base, byWeekday: [] }))).toBe("weekday_required");
    expect(ruleCode(() => generateDates({ ...base, byWeekday: [8 as never] }))).toBe("weekday_required");
    expect(ruleCode(() => generateDates({ ...base, freq: "monthly", byMonthDay: 0 }))).toBe("month_day_invalid");
    expect(ruleCode(() => generateDates({ ...base, freq: "monthly", byMonthDay: 32 }))).toBe("month_day_invalid");
    expect(ruleCode(() => generateDates({ ...base, freq: "dates", dates: [] }))).toBe("dates_required");
    expect(ruleCode(() => generateDates({ ...base, freq: "dates", dates: ["2031-04-01"] }))).toBe("date_before_anchor");
    expect(ruleCode(() => generateDates({ ...base, end: { kind: "count", count: 0 } }))).toBe("count_invalid");
    expect(ruleCode(() => generateDates({ ...base, end: { kind: "until", until: "2031-03-01" } }))).toBe("no_occurrences");
    expect(ruleCode(() => generateDates({ ...base, end: { kind: "count", count: MAX_OCCURRENCES + 1 } }))).toBe("too_many_occurrences");
    expect(ruleCode(() => generateDates({ ...base, freq: "daily", end: { kind: "until", until: "2040-01-01" } }))).toBe("too_many_occurrences");
  });

  it("for random rules: dates ascend, periods tile [anchor, end) with no gap, amounts sum to the split total", () => {
    const r = rng(11);
    const freqs = ["daily", "weekly", "monthly"] as const;
    for (let i = 0; i < 300; i++) {
      const freq = freqs[Math.floor(r() * 3)];
      const anchor = addDays("2031-01-01", Math.floor(r() * 400));
      const rule: ScheduleRule = {
        freq,
        interval: 1 + Math.floor(r() * 4),
        anchor,
        firstOccurrence: r() < 0.5 ? "on_anchor" : "on_rhythm",
        end: r() < 0.5 ? { kind: "count", count: 1 + Math.floor(r() * 12) } : { kind: "rental_end", rentalEnd: addDays(anchor, 20 + Math.floor(r() * 200)) },
        ...(freq === "weekly" ? { byWeekday: [1 + Math.floor(r() * 7), 1 + Math.floor(r() * 7)] as never } : {}),
        ...(freq === "monthly" ? { byMonthDay: r() < 0.2 ? -1 : 1 + Math.floor(r() * 31) } : {}),
      };
      let drafts;
      try {
        drafts = buildSchedule(rule, { mode: "split_by_days", totalCents: 1_000_000 });
      } catch (e) {
        // A rental_end before the first rhythm date is a legitimate refusal.
        expect(e).toBeInstanceOf(PlanRuleError);
        continue;
      }
      expect(drafts[0].periodStart).toBe(anchor);
      for (let j = 1; j < drafts.length; j++) {
        expect(compareDates(drafts[j - 1].dueDate, drafts[j].dueDate)).toBe(-1);
        expect(drafts[j].periodStart).toBe(drafts[j - 1].periodEnd);
      }
      for (const d of drafts) {
        expect(d.days).toBeGreaterThan(0);
        expect(compareDates(d.dueDate, anchor)).toBeGreaterThanOrEqual(0);
      }
      if (rule.end.kind === "rental_end") {
        expect(drafts[drafts.length - 1].periodEnd).toBe(rule.end.rentalEnd);
        for (const d of drafts) expect(compareDates(d.dueDate, rule.end.rentalEnd)).toBe(-1);
      }
      expect(drafts.reduce((s, d) => s + d.amountCents, 0)).toBe(1_000_000);
      expect(drafts.filter((d) => d.isStub).length).toBeLessThanOrEqual(1);
      if (rule.firstOccurrence === "on_rhythm") expect(drafts.some((d) => d.isStub)).toBe(false);
    }
  });

  it("an override moves a due date only — never the period or the amount", () => {
    const plain = buildSchedule(base, { mode: "fixed", amountCents: 777 });
    const moved = buildSchedule(base, { mode: "fixed", amountCents: 777 }, [{ seq: 3, moveTo: "2031-04-20" }]);
    expect(moved[2].dueDate).toBe("2031-04-20");
    expect({ ...moved[2], dueDate: plain[2].dueDate }).toEqual(plain[2]);
    expect(ruleCode(() => buildSchedule(base, { mode: "fixed", amountCents: 1 }, [{ seq: 1, moveTo: "2031-03-01" }]))).toBe("date_before_anchor");
  });
});
