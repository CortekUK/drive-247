"use client";

/**
 * Enquiries teaching empty state (ILLUSTRATION_GUIDE.md §4a).
 *
 * Enquiries only arrive from the booking site (the `submit-enquiry` edge
 * function writes here when lead management is off), and this page is
 * read-only — so the one tile opens the site they come from. Rendered only for
 * lean tenants with no enquiries at all (or the /dev force switch).
 */

import { ExternalLink, Inbox } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { EnquiriesEmptyArt } from "@/components/illustrations-v2/scenes/enquiries";

export function EnquiriesTeachingEmptyState({
  onOpenBookingSite,
}: {
  /** Opens the tenant's booking site. Omitted when the slug is not resolved. */
  onOpenBookingSite?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Inbox}
      illustration={<EnquiriesEmptyArt />}
      headline="Questions from your site land here"
      body="When a customer sends an inquiry from your booking site, it arrives here with their dates and message."
      primaryAction={
        onOpenBookingSite
          ? {
              label: "Open your booking site",
              hint: "See where customers send their questions from, in a new tab.",
              onClick: onOpenBookingSite,
              icon: ExternalLink,
            }
          : undefined
      }
    />
  );
}
