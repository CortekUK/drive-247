"use client";

/**
 * The operator's empty state (apps/portal/src/components/empty-states/
 * teaching-empty-state.tsx), in the shared `v2-*` colours, for the customer
 * portal. Same funnel: the picture (≤518px), the headline (≤460px), one line
 * of body (≤380px), then the actions as square icon tiles whose label and hint
 * drop down in a small card on hover, then an optional footnote.
 *
 * The pictures beside this file are VERBATIM copies of the operator's
 * illustrations (illustrations-v2/scene-kit.tsx, car-art.ts, empty-scenes.tsx,
 * scenes/documents.tsx, scenes/add-customer.tsx) with only their import lines
 * changed; shared-v2-copies.test.ts fails when either side drifts. They draw
 * with `--primary`, `--card`, `--background` and `--v2-link`, which the
 * customer portal points at its v2 tokens (`.pv2` in site.css), so a tenant's
 * theme colour reaches them the same way.
 *
 * Left out against the operator's: the "Watch how" explainer tile (no customer
 * explainers exist) and `data-tour` (no customer tours).
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";

import { cn } from "../cn";
import { MOTION_FLOATING } from "../menu";

export interface TeachingEmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  /** One line shown in the small card that drops down on hover. */
  hint?: string;
  disabled?: boolean;
}

export interface TeachingEmptyStateProps {
  icon?: LucideIcon;
  illustration?: ReactNode;
  headline: string;
  body: ReactNode;
  points?: string[];
  primaryAction?: TeachingEmptyStateAction;
  secondaryAction?: TeachingEmptyStateAction;
  footnote?: ReactNode;
  className?: string;
}

function TileHint({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <HoverCardPrimitive.Root openDelay={120} closeDelay={60}>
      <HoverCardPrimitive.Trigger asChild>
        <span className="inline-flex">{children}</span>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="bottom"
          align="center"
          sideOffset={8}
          className={cn(
            "z-50 w-60 origin-[var(--radix-hover-card-content-transform-origin)] rounded-2xl bg-v2-popover p-3.5 text-left text-sm text-v2-popover-fg shadow-lg ring-1 ring-v2-fg/5 outline-none dark:ring-v2-fg/10",
            MOTION_FLOATING,
          )}
        >
          <p className="text-[13px] font-semibold text-v2-fg">{label}</p>
          {hint && <p className="mt-1 text-[12.5px] leading-snug text-v2-muted-fg">{hint}</p>}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

const TILE =
  "flex h-[100px] w-[120px] items-center justify-center rounded-2xl transition-colors [&>svg]:size-14 disabled:cursor-not-allowed disabled:opacity-50";

export function TeachingEmptyState({
  icon: Icon,
  illustration,
  headline,
  body,
  points,
  primaryAction,
  secondaryAction,
  footnote,
  className,
}: TeachingEmptyStateProps) {
  const PrimaryIcon = primaryAction?.icon;
  const SecondaryIcon = secondaryAction?.icon;
  return (
    <div className={cn("px-6 py-2 sm:px-10 sm:py-4", className)}>
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        {illustration ? (
          <div className="w-full max-w-[518px]">{illustration}</div>
        ) : Icon ? (
          <span className="flex size-11 items-center justify-center rounded-2xl bg-v2-primary/10 text-v2-primary">
            <Icon className="size-5" />
          </span>
        ) : null}
        <h3 className="mt-5 max-w-[460px] text-[21.5px] font-semibold tracking-tight text-v2-fg">{headline}</h3>
        <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-v2-muted-fg">{body}</p>
        {points && points.length > 0 && (
          <ul className="mt-3 w-full space-y-1 text-center">
            {points.map((point) => (
              <li key={point} className="text-sm leading-snug text-v2-fg/70">
                {point}
              </li>
            ))}
          </ul>
        )}
        {(primaryAction || secondaryAction) && (
          <div className="mt-6 flex flex-wrap items-stretch justify-center gap-2.5">
            {primaryAction && (
              <TileHint label={primaryAction.label} hint={primaryAction.hint}>
                <button
                  type="button"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  aria-label={primaryAction.label}
                  className={cn(TILE, "bg-v2-primary text-v2-primary-fg hover:bg-v2-primary/90")}
                >
                  {PrimaryIcon ? <PrimaryIcon strokeWidth={2} /> : primaryAction.label}
                </button>
              </TileHint>
            )}
            {secondaryAction && (
              <TileHint label={secondaryAction.label} hint={secondaryAction.hint}>
                <button
                  type="button"
                  onClick={secondaryAction.onClick}
                  disabled={secondaryAction.disabled}
                  aria-label={secondaryAction.label}
                  className={cn(TILE, "border border-v2-border bg-v2-bg text-v2-fg hover:bg-v2-muted")}
                >
                  {SecondaryIcon ? <SecondaryIcon strokeWidth={1.75} /> : secondaryAction.label}
                </button>
              </TileHint>
            )}
          </div>
        )}
        {footnote && <p className="mt-4 max-w-[300px] text-[13px] text-v2-muted-fg">{footnote}</p>}
      </div>
    </div>
  );
}
