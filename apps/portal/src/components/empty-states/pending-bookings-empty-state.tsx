"use client";

/**
 * Pending bookings teaching empty state (ILLUSTRATION_GUIDE.md §4a).
 *
 * Records here only ever arrive from outside — a website booking whose payment
 * is held (`capture_status = 'requires_capture'`) until the operator decides —
 * so there is nothing to create. The one tile opens the booking site the
 * requests come from. Rendered only for lean tenants with no pending bookings
 * at all (or the /dev force switch); see the page for the gate.
 */

import { Clock, ExternalLink } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { PendingBookingsEmptyArt } from "@/components/illustrations-v2/scenes/pending-bookings";

export function PendingBookingsTeachingEmptyState({
  onOpenBookingSite,
}: {
  /** Opens the tenant's booking site. Omitted when the slug is not resolved. */
  onOpenBookingSite?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Clock}
      illustration={<PendingBookingsEmptyArt />}
      headline="Booking requests wait here for you"
      body="Bookings from your site that need your approval land here. Approve takes the payment; decline releases the hold."
      primaryAction={
        onOpenBookingSite
          ? {
              label: "Open your booking site",
              hint: "See the site your customers book from, in a new tab.",
              onClick: onOpenBookingSite,
              icon: ExternalLink,
            }
          : undefined
      }
    />
  );
}
