import type { BookingRules } from "./booking-rules";
import { addDaysIso, hoursBetween, isClockTime, todayIso, zonedWallClockToInstant } from "./time-utils";

/**
 * The earliest trip a customer may legally book, as the booking page seeds it.
 *
 * Lifted out of `use-vehicle-booking.ts` so the booking page and the v2 quick
 * book dialog open on the SAME first dates. The reasoning that sat beside it:
 *
 * The seeded pickup must satisfy the lead time as an INSTANT, not as a day
 * count. Seeding `today + ceil(leadHours/24)` at a fixed 10:00 looks right but
 * is illegal for most of the day: with a 24h lead time, tomorrow 10:00 is only
 * 15 hours away if the customer arrives at 19:00, so the page loaded showing its
 * own red "must be made at least 1 day in advance". Walk real (date, slot) pairs
 * and take the first that clears the bar the validator actually applies — the
 * same zonedWallClockToInstant comparison, judged in the operator's zone.
 */
export function firstLegalPickup(rules: BookingRules): {
  date: string;
  slot: string;
  /** 10:00, or the first slot after it — what the return time defaults to. */
  preferredSlot: string;
} {
  const preferredSlot =
    rules.timeSlots.find((slot) => slot >= "10:00") ?? rules.timeSlots[0] ?? "10:00";
  const slots = rules.timeSlots.length > 0 ? rules.timeSlots : [preferredSlot];

  const earliestLegal = Date.now() + rules.leadTimeHours * 60 * 60 * 1000;
  const clearsLeadTime = (isoDate: string, slot: string) => {
    const instant = zonedWallClockToInstant(isoDate, slot, rules.operatorTimezone);
    // A null instant means malformed input, not an early one — do not seed it.
    return instant !== null && instant.getTime() >= earliestLegal;
  };

  const leadDays = Math.max(0, Math.ceil(rules.leadTimeHours / 24));
  let firstPickup = addDaysIso(todayIso(), Math.max(1, leadDays));
  let firstSlot = preferredSlot;
  // Bounded: leadDays+1 candidate days is always enough, since a whole day
  // beyond the lead time clears it at every slot. The cap only guards against
  // a pathological tenant zone.
  outer: for (let dayOffset = 0; dayOffset <= leadDays + 2; dayOffset += 1) {
    const candidateDate = addDaysIso(firstPickup, dayOffset);
    // Prefer the usual slot on a legal day; otherwise the first legal slot.
    const ordered = [preferredSlot, ...slots.filter((s) => s !== preferredSlot)];
    for (const slot of ordered) {
      if (clearsLeadTime(candidateDate, slot)) {
        firstPickup = candidateDate;
        firstSlot = slot;
        break outer;
      }
    }
  }

  return { date: firstPickup, slot: firstSlot, preferredSlot };
}

/**
 * The first return date the tenant's minimum rental allows after `pickupDate`,
 * counted in whole days. Prefer `firstLegalReturnDay` when the pickup time is
 * known: a 1 day 2 hours minimum is two whole days here, but only "tomorrow
 * from 12:00" on the clock.
 */
export function firstLegalReturn(pickupDate: string, rules: BookingRules): string {
  const minSpanDays = Math.max(1, Math.ceil(rules.minRentalHours / 24));
  return addDaysIso(pickupDate, minSpanDays);
}

/** Whole hours from a pickup to a return, both read on the operator's clock; null when either is malformed. */
export function tripHours(
  pickupDate: string,
  pickupTime: string,
  returnDate: string,
  returnTime: string,
  rules: BookingRules,
): number | null {
  const start = zonedWallClockToInstant(pickupDate, pickupTime, rules.operatorTimezone);
  const end = zonedWallClockToInstant(returnDate, returnTime, rules.operatorTimezone);
  return start && end ? hoursBetween(start, end) : null;
}

/**
 * Can the car come back at `slot` on `returnDate`? Only when that is at least
 * the shortest rental after the pickup — the same whole-hour comparison the
 * checkout's validator makes, so the flow never offers a return the next page
 * would refuse.
 */
export function isReturnSlotLegal(
  pickupDate: string,
  pickupTime: string,
  returnDate: string,
  slot: string,
  rules: BookingRules,
): boolean {
  const hours = tripHours(pickupDate, pickupTime, returnDate, slot, rules);
  return hours !== null && hours >= rules.minRentalHours;
}

/**
 * The earliest return DAY after this pickup with at least one slot that clears
 * the shortest rental. Looks at the latest slot of each day in turn, so a
 * 10:00 pickup under a 1 day 2 hours minimum may come back tomorrow (from
 * 12:00), while a 16:45 pickup under the same rule must wait a day more when
 * the operator closes at 17:00.
 */
export function firstLegalReturnDay(pickupDate: string, pickupTime: string, rules: BookingRules): string {
  if (!isClockTime(pickupTime)) return firstLegalReturn(pickupDate, rules);
  const slots = rules.timeSlots.length > 0 ? rules.timeSlots : ["23:45"];
  const latest = slots[slots.length - 1];
  for (let dayOffset = 1; dayOffset <= 366; dayOffset += 1) {
    const candidate = addDaysIso(pickupDate, dayOffset);
    if (isReturnSlotLegal(pickupDate, pickupTime, candidate, latest, rules)) return candidate;
  }
  return firstLegalReturn(pickupDate, rules);
}

/**
 * The return slot to offer on `returnDate`: `preferred` when it clears the
 * shortest rental, else the first slot of the day that does, else null (no
 * slot that day is far enough from the pickup — move the day).
 */
export function firstLegalReturnSlot(
  pickupDate: string,
  pickupTime: string,
  returnDate: string,
  rules: BookingRules,
  preferred?: string,
): string | null {
  if (preferred && isReturnSlotLegal(pickupDate, pickupTime, returnDate, preferred, rules)) return preferred;
  const slots = rules.timeSlots.length > 0 ? rules.timeSlots : preferred ? [preferred] : [];
  return slots.find((slot) => isReturnSlotLegal(pickupDate, pickupTime, returnDate, slot, rules)) ?? null;
}
