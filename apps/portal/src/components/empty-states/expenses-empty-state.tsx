"use client";

/**
 * Expenses, before the first cost is logged (illustration guide §4a).
 * Rendered by `(dashboard)/expenses/page.tsx` only for a lean tenant whose
 * unfiltered expense list is empty (or the /dev "force empty" switch).
 */
import { Plus, Tags, Receipt } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { ExpensesEmptyArt } from "@/components/illustrations-v2/scenes/expenses";

export function ExpensesEmptyState({
  onAddExpense,
  onManageCategories,
}: {
  /** Omitted with view-only access. */
  onAddExpense?: () => void;
  /** Omitted with view-only access. */
  onManageCategories?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Receipt}
      illustration={<ExpensesEmptyArt />}
      headline="What your cars really cost you"
      body="Log each cost with its receipt, against a car or the whole business. It feeds your profit and loss."
      primaryAction={
        onAddExpense
          ? {
              label: "Add an expense",
              hint: "Record a cost, attach the receipt and pick the car it belongs to.",
              onClick: onAddExpense,
              icon: Plus,
            }
          : undefined
      }
      secondaryAction={
        onManageCategories
          ? {
              label: "Categories",
              hint: "Set up the categories your costs are sorted into.",
              onClick: onManageCategories,
              icon: Tags,
            }
          : undefined
      }
    />
  );
}
