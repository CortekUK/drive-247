"use client";

import { useCallback, useEffect, useState } from "react";

export type CalendarDensity = "comfortable" | "compact";

const STORAGE_KEY = "rentals-calendar-density";

/**
 * Row metrics per density.
 *
 * `thumb` is the load-bearing one. The vehicle photo is what actually sets the
 * row height — a `md` thumbnail is 64px, which with the row's vertical padding
 * forces every row to 80px no matter how short its content is. Shrinking the
 * bars alone changes nothing while the photo stays 64px, which is why compact
 * drops to `sm` (48px) as well.
 *
 * `minRow` is deliberately equal to (thumb + 2 × rowPadding) in each mode, so
 * the floor is exactly the height the photo already demands and never adds
 * unused space on top of it.
 */
export const DENSITY_METRICS = {
  comfortable: {
    thumb: "md" as const,
    barHeight: 28,
    barGap: 4,
    rowPadding: 8,
    minRow: 80,
  },
  compact: {
    thumb: "sm" as const,
    barHeight: 22,
    barGap: 3,
    // 2px, not 4 — on a 1366x768 laptop the difference between a 56px and a
    // 52px row is literally one more vehicle on screen, and the 48px photo
    // still sets the real floor so nothing is cramped.
    rowPadding: 2,
    minRow: 52,
  },
} satisfies Record<CalendarDensity, unknown>;

export type DensityMetrics = (typeof DENSITY_METRICS)[CalendarDensity];

/**
 * Persisted comfortable/compact preference for the rentals calendar.
 *
 * Operators with three cars want the roomy view; operators with thirty want to
 * see the whole fleet at once. The preference is per browser rather than per
 * tenant — it is a viewing preference about the size of the screen in front of
 * you, not a property of the business, and two staff on different monitors
 * should not fight over one stored value.
 *
 * Reads from localStorage in an effect rather than in the initial state so the
 * server render and the first client render agree; otherwise the row heights
 * differ between them and React discards the markup with a hydration warning.
 */
export function useCalendarDensity() {
  const [density, setDensityState] = useState<CalendarDensity>("comfortable");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "compact" || stored === "comfortable") {
        setDensityState(stored);
      }
    } catch {
      // Storage unavailable (private mode / blocked). The default stands.
    }
  }, []);

  const setDensity = useCallback((next: CalendarDensity) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply does not survive the session. Harmless.
    }
  }, []);

  return {
    density,
    setDensity,
    metrics: DENSITY_METRICS[density],
    isCompact: density === "compact",
  };
}
