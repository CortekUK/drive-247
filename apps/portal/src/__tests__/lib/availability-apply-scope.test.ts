/**
 * The weekly editor's apply scope.
 *
 * The behaviour worth pinning is the DEFAULT and the blast radius: editing
 * Monday must not touch Tuesday unless the operator explicitly widened the
 * scope, and "All days" must mean all SEVEN rather than the five weekdays that
 * the separate "Set weekdays" action covers.
 */
import { describe, expect, it } from "vitest";
import { DAY_KEYS, WEEKDAY_KEYS, type DayKey, type WeeklyDefaults } from "@/components/availability-v2/availability-model";

const FULL_DAY = { open: "00:00", close: "23:59" };

/** The card's own logic, mirrored so it can be exercised without React. */
function hoursFor(state: "open" | "always" | "closed", h: { open: string; close: string }) {
  if (state === "closed") return { enabled: false, open: h.open, close: h.close };
  if (state === "always") return { enabled: true, ...FULL_DAY };
  return { enabled: true, open: h.open, close: h.close };
}

function applyDay(
  defaults: WeeklyDefaults,
  day: DayKey,
  state: "open" | "always" | "closed",
  hours: { open: string; close: string },
  scope: "day" | "all",
): WeeklyDefaults {
  const value = hoursFor(state, hours);
  const days = { ...defaults.days };
  if (scope === "all") {
    for (const d of DAY_KEYS) days[d] = { ...value };
  } else {
    days[day] = value;
  }
  return { ...defaults, days };
}

const base = (): WeeklyDefaults => ({
  alwaysOpen: false,
  timezone: "America/Chicago",
  days: Object.fromEntries(
    DAY_KEYS.map((d) => [
      d,
      d === "saturday" || d === "sunday"
        ? { enabled: false, open: "09:00", close: "17:00" }
        : { enabled: true, open: "09:00", close: "17:00" },
    ]),
  ) as WeeklyDefaults["days"],
});

describe("apply scope", () => {
  it("'this day only' touches exactly one weekday", () => {
    const out = applyDay(base(), "monday", "open", { open: "10:00", close: "18:00" }, "day");
    expect(out.days.monday).toEqual({ enabled: true, open: "10:00", close: "18:00" });
    /* Every other day must be byte-identical to where it started. */
    for (const d of DAY_KEYS.filter((k) => k !== "monday")) {
      expect(out.days[d]).toEqual(base().days[d]);
    }
  });

  it("'all days' means all SEVEN, weekend included", () => {
    /* Not the five that "Set weekdays" covers — the editor says "All days". */
    const out = applyDay(base(), "monday", "open", { open: "09:00", close: "17:00" }, "all");
    for (const d of DAY_KEYS) {
      expect(out.days[d]).toEqual({ enabled: true, open: "09:00", close: "17:00" });
    }
    expect(DAY_KEYS.length).toBe(7);
    expect(WEEKDAY_KEYS.length).toBe(5);
  });

  it("'all days' + Closed closes the whole week", () => {
    const out = applyDay(base(), "monday", "closed", { open: "09:00", close: "17:00" }, "all");
    for (const d of DAY_KEYS) expect(out.days[d].enabled).toBe(false);
  });

  it("'all days' + 24 hours writes a full day everywhere, and not the global flag", () => {
    const out = applyDay(base(), "monday", "always", { open: "09:00", close: "17:00" }, "all");
    for (const d of DAY_KEYS) {
      expect(out.days[d]).toEqual({ enabled: true, ...FULL_DAY });
    }
    /* The tenant-wide switch is a different setting and must not be touched:
       turning days into 24-hour days is not the same as declaring the account
       always open. */
    expect(out.alwaysOpen).toBe(false);
  });

  it("never mutates the object it was given", () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    applyDay(before, "monday", "closed", { open: "09:00", close: "17:00" }, "all");
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("leaves the timezone alone whatever the scope", () => {
    const out = applyDay(base(), "sunday", "open", { open: "08:00", close: "12:00" }, "all");
    expect(out.timezone).toBe("America/Chicago");
  });
});

/**
 * The toolbar summary. It replaced seven permanently-rendered rows, so it has
 * to stay a sentence — if it degenerates into a list of all seven days it has
 * not bought back the vertical space it was added for.
 */
describe("weekly summary", () => {
  it("groups a run of identical days into a range", async () => {
    const { weeklySummary } = await import("@/components/availability-v2/weekly-hours-card");
    const out = weeklySummary(base());
    expect(out).toContain("Mon–Fri");
    expect(out).toContain("Sat, Sun closed");
  });

  it("says 24/7 when the tenant-wide flag is on, and nothing else", async () => {
    const { weeklySummary } = await import("@/components/availability-v2/weekly-hours-card");
    /* That flag overrides every per-day column, so listing days would be a lie. */
    expect(weeklySummary({ ...base(), alwaysOpen: true })).toBe("Open 24/7");
  });

  it("does not spell out all seven days when they differ", async () => {
    const { weeklySummary } = await import("@/components/availability-v2/weekly-hours-card");
    const d = base();
    d.days.wednesday = { enabled: true, open: "11:00", close: "15:00" };
    const out = weeklySummary(d);
    /* Wednesday breaks the run, so the summary must still read as segments
       rather than seven comma-separated days. */
    expect(out).toContain("Wed");
    expect(out.split("·").length).toBeLessThanOrEqual(5);
  });
});
