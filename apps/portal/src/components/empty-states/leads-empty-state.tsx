"use client";

/**
 * Leads teaching empty state (docs/brand/illustration-guide.md §4a).
 *
 * Two real ways in: add a lead by hand (NewLeadDialog — phone-in, walk-in or
 * admin-created) or share the apply link (submit-application creates a lead
 * with source 'application'). Rendered only for lean tenants with no leads in
 * any tab (or the /dev force switch).
 */

import { Link2, Plus, Users } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { LeadsEmptyArt } from "@/components/illustrations-v2/scenes/leads";

export function LeadsTeachingEmptyState({
  onNewLead,
  onCopyApplyLink,
}: {
  onNewLead: () => void;
  /** Copies the apply link. Omitted when there is no link to copy. */
  onCopyApplyLink?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Users}
      illustration={<LeadsEmptyArt />}
      headline="Every future customer, one stage at a time"
      body="Applications and inquiries become leads here, and you move each one along until it turns into a rental."
      primaryAction={{
        label: "Add a lead",
        hint: "Log someone who called or walked in.",
        onClick: onNewLead,
        icon: Plus,
      }}
      secondaryAction={
        onCopyApplyLink
          ? {
              label: "Copy apply link",
              hint: "Share your application form. Each one arrives here as a new lead.",
              onClick: onCopyApplyLink,
              icon: Link2,
            }
          : undefined
      }
    />
  );
}
