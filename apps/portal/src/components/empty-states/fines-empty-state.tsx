"use client";

/**
 * Fines, before the first ticket is logged (illustration guide §4a).
 * Rendered by `(dashboard)/fines/page.tsx` only for a lean tenant whose
 * unfiltered fines list is empty (or the /dev "force empty" switch).
 */
import { Plus, AlertTriangle } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { FinesEmptyArt } from "@/components/illustrations-v2/scenes/fines";

export function FinesEmptyState({
  onAddFine,
}: {
  /** Omitted with view-only access. */
  onAddFine?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={AlertTriangle}
      illustration={<FinesEmptyArt />}
      headline="Tickets, matched to the driver"
      body="Log a fine against the customer and rental it happened on. It joins their balance, ready to charge or waive."
      primaryAction={
        onAddFine
          ? {
              label: "Add a fine",
              hint: "Pick the customer and rental, then enter the amount and due date.",
              onClick: onAddFine,
              icon: Plus,
            }
          : undefined
      }
    />
  );
}
