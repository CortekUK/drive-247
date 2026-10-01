"use client";

/**
 * Vehicle owners, before the first owner (lean tenants only —
 * `app/(dashboard)/vehicle-owners/page.tsx` decides when this renders).
 *
 * NOTE: the `owners` area is currently hidden for lean tenants
 * (`LEAN_HIDDEN_AREAS` in lib/lean-areas.ts), so the page 404s for them and
 * this cannot render until that area is un-hidden. Built ahead of that.
 */

import { Plus, Users } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { VehicleOwnersEmptyArt } from "@/components/illustrations-v2/scenes/vehicle-owners";

export function VehicleOwnersTeachingEmptyState({ onAddOwner }: { onAddOwner: () => void }) {
  return (
    <TeachingEmptyState
      icon={Users}
      illustration={<VehicleOwnersEmptyArt />}
      headline="Cars you run for someone else"
      body="Add each owner with their commission and payout schedule, then assign their cars."
      primaryAction={{
        label: "Add an owner",
        onClick: onAddOwner,
        icon: Plus,
        hint: "Their contact details, your commission and how often you pay them.",
      }}
    />
  );
}
