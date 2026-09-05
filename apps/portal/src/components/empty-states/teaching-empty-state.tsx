"use client";

/**
 * An empty state that TEACHES.
 *
 * The bar this is written against: an operator who has never used the product
 * lands on a blank page and must leave knowing what belongs here, why it
 * matters to their business, and what the single next action is. "No vehicles
 * yet." plus a button clears none of that.
 *
 * Deliberately a SEPARATE component from
 * `components/shared/data-display/empty-state.tsx` rather than an extension of
 * it. That one is rendered by ~30 screens for all 57 tenants and its job —
 * "your filters matched nothing" — is a genuinely different job from this one.
 * The two must not converge: a filtered-to-nothing table teaching someone what
 * a vehicle is would be noise, and this surface must only ever appear when a
 * page is empty because the operator has not started yet, never because a
 * search box has three characters in it. Each call site enforces that
 * distinction itself, since only the page knows its own unfiltered count.
 *
 * Visual language follows the v2 theme (`styles/v2-theme.css`): flat, 1px
 * border, `rounded-2xl` card, `rounded-xl` controls, semantic tokens only — the
 * same treatment as `rentals-v2/booking-mode-selector.tsx`, so it reads as part
 * of v2 rather than bolted on.
 */

import type { LucideIcon } from "lucide-react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExplainerChip } from "@/components/explainers/explainer";
import type { ExplainerId } from "@/lib/explainers";

export interface TeachingEmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
}

export interface TeachingEmptyStateProps {
  icon: LucideIcon;
  /** What this page IS, in the operator's language. Not "No vehicles". */
  headline: string;
  /** Why it matters and what happens once it has something in it. */
  body: string;
  /** Two or three concrete payoffs. Keep each under about ten words. */
  points?: string[];
  primaryAction?: TeachingEmptyStateAction;
  secondaryAction?: TeachingEmptyStateAction;
  /**
   * The video slot. Renders nothing at all until the file exists — see the
   * empty-URL contract in `lib/explainers.ts` — so it is safe to name an id
   * here long before anything has been recorded.
   */
  explainerId?: ExplainerId;
  /** One quiet line of reassurance, e.g. what is reversible. */
  footnote?: string;
  className?: string;
}

export function TeachingEmptyState({
  icon: Icon,
  headline,
  body,
  points,
  primaryAction,
  secondaryAction,
  explainerId,
  footnote,
  className,
}: TeachingEmptyStateProps) {
  const PrimaryIcon = primaryAction?.icon;
  const SecondaryIcon = secondaryAction?.icon;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card px-6 py-10 sm:px-10 sm:py-12",
        className
      )}
    >
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>

        <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
          {headline}
        </h3>

        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>

        {points && points.length > 0 && (
          <ul className="mt-6 w-full space-y-2 text-left">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <span className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Check className="size-2.5 text-primary" strokeWidth={3} />
                </span>
                <span className="text-sm leading-snug text-foreground/80">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        )}

        {(primaryAction || secondaryAction || explainerId) && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {PrimaryIcon && <PrimaryIcon className="size-4" />}
                {primaryAction.label}
              </button>
            )}

            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {SecondaryIcon && <SecondaryIcon className="size-4" />}
                {secondaryAction.label}
              </button>
            )}

            {explainerId && (
              <ExplainerChip
                id={explainerId}
                variant="chip"
                label="Watch how"
                className="px-3 py-1.5 text-xs"
              />
            )}
          </div>
        )}

        {footnote && (
          <p className="mt-4 text-xs text-muted-foreground">{footnote}</p>
        )}
      </div>
    </div>
  );
}
