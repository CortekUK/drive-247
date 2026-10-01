"use client";

/**
 * Owner payouts, before the first payout (lean tenants only —
 * `app/(dashboard)/owner-payouts/page.tsx` decides when this renders).
 *
 * A payout needs an owner, so with none on file the tile goes to Vehicle
 * owners instead of opening an empty Create dialog.
 *
 * NOTE: the `owners` area is currently hidden for lean tenants
 * (`LEAN_HIDDEN_AREAS` in lib/lean-areas.ts), so the page 404s for them and
 * this cannot render until that area is un-hidden. Built ahead of that.
 */

import { Plus, Wallet } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { OwnerPayoutsEmptyArt } from "@/components/illustrations-v2/scenes/owner-payouts";

export function OwnerPayoutsTeachingEmptyState({
  hasOwners,
  onCreatePayout,
  onAddOwner,
}: {
  hasOwners: boolean;
  onCreatePayout: () => void;
  onAddOwner: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Wallet}
      illustration={<OwnerPayoutsEmptyArt />}
      headline="Pay owners their share"
      body="Each payout takes an owner's revenue for a period and keeps your commission."
      primaryAction={
        hasOwners
          ? {
              label: "Create a payout",
              onClick: onCreatePayout,
              icon: Plus,
              hint: "Pick an owner and the dates. I work out revenue, commission and what is owed.",
            }
          : {
              label: "Add an owner first",
              onClick: onAddOwner,
              icon: Plus,
              hint: "Payouts go to an owner. Add one on Vehicle owners.",
            }
      }
    />
  );
}
