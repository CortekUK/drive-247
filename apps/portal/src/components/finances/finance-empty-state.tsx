"use client";

/**
 * A Finances empty state with its explainer — the v2 settings empty state
 * (`SettingsEmptyState`), plus the "Watch how" chip the old canary Payments
 * and Invoices empty states carried (components/empty-states/lean-empty-states.tsx:
 * `payments.overview` on Payments, `invoices.overview` on Invoices).
 *
 * The chip is the portal's one video slot (`ExplainerChip`): it renders
 * nothing when the explainer has no video and the tenant is not the canary.
 * Its row collapses with it (`empty:hidden`), so the card is then exactly the
 * plain empty state. `SettingsEmptyState` still stamps
 * `data-settings-state="empty"` and its `h3`, which the Finances tour reads.
 */

import { ExplainerChip } from "@/components/explainers/explainer";
import { SettingsEmptyState, type SettingsEmptyStateProps } from "@/components/settings-v2/section-states";
import type { ExplainerId } from "@/lib/explainers";
import { cn } from "@/lib/utils";

/** Which explainer each Finances view's empty state carries (the old tabs' own). */
export const FINANCE_EMPTY_EXPLAINER = {
  received: "payments.overview",
  billed: "invoices.overview",
} as const satisfies Record<string, ExplainerId>;

export function FinanceEmptyState({ explainerId, className, ...props }: SettingsEmptyStateProps & { explainerId?: ExplainerId }) {
  const compact = props.variant === "compact" || props.variant === "inline";
  if (!explainerId) return <SettingsEmptyState className={className} {...props} />;
  return (
    <div className={cn(!compact && "rounded-2xl bg-card", className)} data-finance-empty="">
      <SettingsEmptyState {...props} className={cn(!compact && "bg-transparent")} />
      <div
        className={cn("flex justify-center empty:hidden", compact ? "-mt-4 pb-6" : "-mt-6 pb-10 sm:-mt-8 sm:pb-12")}
        data-finance-explainer={explainerId}
      >
        <ExplainerChip id={explainerId} variant="chip" label="Watch how" className="px-3 py-1.5 text-xs" />
      </div>
    </div>
  );
}
