"use client";

/**
 * Blocked customers, before anything is on the blocklist (lean tenants only —
 * `app/(dashboard)/blocked-customers/page.tsx` decides when this renders: no
 * blocked customers AND no blocked identities).
 *
 * The action opens the page's own Add to Blocklist dialog. The body only
 * claims what that dialog says: new customers or identity verifications with
 * a listed identity are blocked.
 */

import { Ban, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { BlockedCustomersEmptyArt } from "@/components/illustrations-v2/scenes/blocked-customers";

export function BlockedCustomersTeachingEmptyState({
  onAddToBlocklist,
}: {
  /** Omitted when the signed-in user has view-only access. */
  onAddToBlocklist?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Ban}
      illustration={<BlockedCustomersEmptyArt />}
      headline="Your blocklist is clear"
      body="Add a licence, ID or passport number and I block any new customer or verification that uses it."
      primaryAction={
        onAddToBlocklist
          ? {
              label: "Add to blocklist",
              onClick: onAddToBlocklist,
              icon: Plus,
              hint: "Block an identity number, with the reason you are blocking it.",
            }
          : undefined
      }
    />
  );
}
