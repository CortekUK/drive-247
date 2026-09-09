/**
 * Detects a rental that is running past the end of its Bonzah cover.
 *
 * WHY THIS EXISTS
 * Moore Luxe asked "when I extend out the rental, the collision damage waiver
 * doesn't get extended with it". Checking production, the same thing had already
 * happened to three other operators, silently: 13 rentals carry Bonzah policies
 * that stop before the rental does, four of them still Active with the car out.
 * The worst is 53 days of a live hire with no cover behind it. Nothing anywhere
 * in the product said so — the policy list showed each policy as green "active",
 * because each one IS active for its own dates. Nobody was adding the dates up.
 *
 * WHY IT MATTERS MORE THAN AN ORDINARY WARNING
 * Bonzah's own terms, which we print verbatim in the operator's rental agreement,
 * say cover "must be continuous for the entire duration of the rental", that
 * "All extensions must be purchased prior to the lapse of an existing policy",
 * and that "Coverage cannot be reinstated, and a gap in coverage cannot be
 * filled, after a lapse has occurred."
 *
 * So a gap is not a to-do item. Once cover lapses that rental can never be made
 * continuous again — the only useful moment to tell the operator is BEFORE it
 * happens, which is why this also warns while cover is merely about to run out.
 *
 * DATE CONVENTION
 * `trip_end_date` is compared directly against `rentals.end_date`: a policy
 * ending on the rental's end date is complete cover. Verified against production
 * (R-2effd1: rental 2026-05-14..05-21, cover 2026-05-15..05-21, no gap), and it
 * matches how consecutive extension policies abut — one ends on the date the
 * next begins.
 */

import { getPacificToday, getPacificTomorrow } from "@/lib/bonzah-dates";

/** Only the fields this needs, so callers can pass their own richer rows. */
export interface CoverageGapPolicy {
  status: string | null;
  trip_end_date: string | null;
}

export interface CoverageGapRental {
  end_date: string | null;
  status: string | null;
  /** PAYG rentals are open-ended and are deliberately excluded — see below. */
  is_pay_as_you_go?: boolean | null;
}

export interface CoverageGap {
  /** `lapsed` — cover has already run out. `ending` — it is about to. */
  kind: "lapsed" | "ending";
  /**
   * `critical` once the car is out and uncovered, or cover ends today/tomorrow
   * with the rental running on. `warning` while there is still room to act.
   */
  severity: "critical" | "warning";
  /** Last date covered (YYYY-MM-DD). */
  coverEndsOn: string;
  /** Date the rental is due back (YYYY-MM-DD). */
  rentalEndsOn: string;
  /** Whole days of the hire with no cover behind them. Always >= 1 for `lapsed`. */
  daysUninsured: number;
  /**
   * False once the gap has already opened. Bonzah cannot backfill it, so the
   * UI must not offer "buy cover" as if it would repair the past.
   */
  canStillBeMadeContinuous: boolean;
}

/** Whole days between two YYYY-MM-DD dates. Calendar arithmetic, DST-safe. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return 0;
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toIso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return ISO_DATE.test(s) ? s : null;
};

/**
 * The coverage gap on this rental, or null when there is nothing to say.
 *
 * Returns null — deliberately — when the rental has no Bonzah cover at all.
 * "This rental was never insured with us" is a different statement from "cover
 * stopped early", the operator may have the customer's own policy on file, and
 * shouting about it on every uninsured rental is the fastest way to train the
 * warning into invisibility.
 */
export function resolveCoverageGap(
  policies: CoverageGapPolicy[] | null | undefined,
  rental: CoverageGapRental | null | undefined,
  /** Injectable for tests; defaults to the real Pacific clock Bonzah runs on. */
  clock?: { today: string; tomorrow: string }
): CoverageGap | null {
  if (!rental) return null;

  // An open-ended PAYG rental has no end date to measure a gap against, and
  // Bonzah is not sold for them at all.
  if (rental.is_pay_as_you_go) return null;

  // A rental that never started or is already finished cannot be extended, and
  // a closed one's gap is history the operator can no longer act on.
  const status = (rental.status || "").toLowerCase();
  if (status !== "active") return null;

  const rentalEndsOn = toIso(rental.end_date);
  if (!rentalEndsOn) return null;

  const active = (Array.isArray(policies) ? policies : []).filter(
    (p) => (p?.status || "").toLowerCase() === "active" && toIso(p?.trip_end_date)
  );
  if (active.length === 0) return null;

  // The furthest date any live policy reaches. Cover is bought in consecutive
  // chunks, so the latest end is where cover actually stops.
  const coverEndsOn = active
    .map((p) => toIso(p.trip_end_date) as string)
    .reduce((max, d) => (d > max ? d : max));

  const today = clock?.today ?? getPacificToday();
  const tomorrow = clock?.tomorrow ?? getPacificTomorrow();

  const daysUninsured = daysBetween(coverEndsOn, rentalEndsOn);
  if (daysUninsured <= 0) {
    // Cover reaches the end of the hire. Nothing to say.
    return null;
  }

  // Has the gap already opened? Cover ending today still covers today.
  const alreadyLapsed = coverEndsOn < today;

  if (alreadyLapsed) {
    return {
      kind: "lapsed",
      severity: "critical",
      coverEndsOn,
      rentalEndsOn,
      daysUninsured,
      // Bonzah will not fill a gap after a lapse. Saying otherwise would send
      // the operator to buy a policy that cannot cover the days already run.
      canStillBeMadeContinuous: false,
    };
  }

  return {
    kind: "ending",
    // Bonzah cannot start a policy before tomorrow (Pacific), so once cover ends
    // today or tomorrow this is the last moment to buy contiguous cover.
    severity: coverEndsOn <= tomorrow ? "critical" : "warning",
    coverEndsOn,
    rentalEndsOn,
    daysUninsured,
    canStillBeMadeContinuous: true,
  };
}

/** One sentence for the operator. Kept here so UI and tests cannot drift. */
export function describeCoverageGap(gap: CoverageGap): string {
  const days = `${gap.daysUninsured} day${gap.daysUninsured === 1 ? "" : "s"}`;
  if (gap.kind === "lapsed") {
    return (
      `Insurance cover ended on ${gap.coverEndsOn} but this rental runs to ${gap.rentalEndsOn}. ` +
      `The vehicle has been out for ${days} with no Bonzah cover behind it. ` +
      `Bonzah cannot backfill a gap once cover has lapsed, so these days cannot be insured retrospectively.`
    );
  }
  return (
    `Insurance cover ends on ${gap.coverEndsOn}, but this rental runs to ${gap.rentalEndsOn} — ` +
    `${days} would be uninsured. Buy the extension's cover before ${gap.coverEndsOn}: ` +
    `Bonzah cannot start a policy before tomorrow, and cover cannot be reinstated once it lapses.`
  );
}
