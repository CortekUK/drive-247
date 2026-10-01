"use client";

/**
 * Availability, as a teaching state (illustration guide §4a).
 *
 * Rendered by `components/availability-v2/availability-v2.tsx` ONLY when the
 * /dev "force empty" switch is on for `blocked-dates`. The week calendar is
 * never genuinely empty — every tenant has weekly hours (the columns default
 * to 9 to 5) and the calendar is where they are edited — and having no blocked
 * dates is the normal state of a business that is open, so there is no real
 * trigger for this. Both actions step into the calendar.
 */
import { CalendarX, Clock } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { BlockedDatesEmptyArt } from "@/components/illustrations-v2/scenes/blocked-dates";

export function BlockedDatesEmptyState({
  onBlockDate,
  onSetHours,
}: {
  /** Omitted with view-only access. */
  onBlockDate?: () => void;
  /** Omitted with view-only access. */
  onSetHours?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={CalendarX}
      illustration={<BlockedDatesEmptyArt />}
      headline="Choose when customers can book"
      body="Set your weekly hours, then close any day you can't take bookings. Your booking site stops offering it."
      primaryAction={
        onBlockDate
          ? {
              label: "Block a date",
              hint: "Open the week and pick the day you want to close.",
              onClick: onBlockDate,
              icon: CalendarX,
            }
          : undefined
      }
      secondaryAction={
        onSetHours
          ? {
              label: "Set weekly hours",
              hint: "Choose the hours you're open on each day of the week.",
              onClick: onSetHours,
              icon: Clock,
            }
          : undefined
      }
    />
  );
}
