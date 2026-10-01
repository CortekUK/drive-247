"use client";

/**
 * Support, before the tenant has opened a single ticket (lean tenants only —
 * `components/support/portal-support.tsx` decides when this renders).
 *
 * The action is the inbox's own `beginNew`, the same one the rail's New ticket
 * button calls: it opens the composer and creates nothing until Send.
 */

import { LifeBuoy, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { SupportEmptyArt } from "@/components/illustrations-v2/scenes/support";

export function SupportTeachingEmptyState({
  onNewTicket,
  disabled,
}: {
  onNewTicket: () => void;
  /** The inbox is mid-request; the tile ignores clicks until it settles. */
  disabled?: boolean;
}) {
  return (
    <TeachingEmptyState
      icon={LifeBuoy}
      illustration={<SupportEmptyArt />}
      headline="Help from the Drive247 team"
      body="Tell us what is not working. A person from support replies here, in the same ticket."
      primaryAction={{
        label: "New ticket",
        onClick: () => {
          if (!disabled) onNewTicket();
        },
        icon: Plus,
        hint: "Describe the problem and send it to the support team.",
      }}
    />
  );
}
