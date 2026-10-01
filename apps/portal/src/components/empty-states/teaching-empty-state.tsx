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

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui-v2/hover-card";
import { ExplainerChip } from "@/components/explainers/explainer";
import type { ExplainerId } from "@/lib/explainers";

export interface TeachingEmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  /** One line shown in the small card that drops down on hover. */
  hint?: string;
}

export interface TeachingEmptyStateProps {
  icon: LucideIcon;
  /**
   * A picture in place of the icon badge (components/illustrations-v2). When
   * given, the icon is not drawn.
   */
  illustration?: ReactNode;
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
  /**
   * Tour anchor. Attribute only — nothing about the layout changes.
   *
   * Rendered VERBATIM on the card and with a `-points` suffix on the payoff
   * list, because a tab tour needs the second one. The card runs the full width
   * of the content column and is around 450px tall, so a spotlight on it has
   * nowhere to stand its own card and degrades to the centred wash the Welcome
   * step uses — an even dim that points at nothing. The payoff list is compact,
   * sits in the middle of the card, and carries the same words.
   */
  "data-tour"?: string;
  className?: string;
}

/**
 * The small card that drops down under a tile on hover (or keyboard focus):
 * what the tile does, since the tile itself is only an icon.
 */
function TileHint({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <span className="inline-flex">{children}</span>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="center" sideOffset={8} className="w-60 rounded-2xl p-3.5 text-left">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        {hint && <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * One size for every tile in a row, so it reads as a set — and the size follows
 * how many there are, so the row always stays narrower than the description
 * above it (the funnel): two tiles ≈ 250px, three ≈ 336px.
 */
const TILE_BASE = "flex items-center justify-center rounded-2xl transition-colors";
const TILE_SIZE = {
  2: "h-[100px] w-[120px] [&>svg]:size-14",
  3: "h-[88px] w-[104px] [&>svg]:size-12",
} as const;

export function TeachingEmptyState({
  icon: Icon,
  illustration,
  headline,
  body,
  points,
  primaryAction,
  secondaryAction,
  explainerId,
  footnote,
  "data-tour": dataTour,
  className,
}: TeachingEmptyStateProps) {
  const PrimaryIcon = primaryAction?.icon;
  const SecondaryIcon = secondaryAction?.icon;

  return (
    <div
      data-tour={dataTour}
      className={cn(
        // No card at all (Sep 27 2026): it sits straight on the page surface.
        // Compact enough to fit under the page heading on a laptop screen
        // without scrolling — an empty page should never need a scroll.
        "px-6 py-2 sm:px-10 sm:py-4",
        className
      )}
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        {/* A funnel (Sep 27 2026): every layer a little narrower than the one
            above — picture 518 → headline ≤460 → description ≤380 → three
            tiles ≈356 → footnote ≤300 — so the eye runs straight down to the
            action. */}
        {illustration ? (
          <div className="w-full max-w-[518px]">{illustration}</div>
        ) : (
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="size-5" />
          </span>
        )}

        <h3 className="mt-5 max-w-[460px] text-[21.5px] font-semibold tracking-tight text-foreground">
          {headline}
        </h3>

        {/* Never wider than the headline: it tucks under it and wraps instead. */}
        <p className="mt-2 max-w-[380px] text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>

        {points && points.length > 0 && (
          // Plain lines, no tick marks (Sep 27 2026).
          <ul
            data-tour={dataTour ? `${dataTour}-points` : undefined}
            className="mt-3 w-full space-y-1 text-center"
          >
            {points.map((point) => (
              <li key={point} className="text-sm leading-snug text-foreground/70">
                {point}
              </li>
            ))}
          </ul>
        )}

        {(primaryAction || secondaryAction || explainerId) && (() => {
          const count = [primaryAction, secondaryAction, explainerId].filter(Boolean).length;
          const TILE = cn(TILE_BASE, TILE_SIZE[count >= 3 ? 3 : 2]);
          return (
          // Actions as equal rounded-square tiles (Sep 27 2026): same size,
          // different colours — the main action in indigo, the second in white,
          // "Watch how" in soft indigo.
          <div className="mt-6 flex flex-wrap items-stretch justify-center gap-2.5">
            {primaryAction && (
              <TileHint label={primaryAction.label} hint={primaryAction.hint}>
              <button
                type="button"
                onClick={primaryAction.onClick}
                aria-label={primaryAction.label}
                className={cn(TILE, "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                {/* Icon only (Sep 27 2026): a big plus is understood by design.
                    The label stays as the accessible name and the tooltip. */}
                {PrimaryIcon ? <PrimaryIcon strokeWidth={2} /> : primaryAction.label}
              </button>
              </TileHint>
            )}

            {secondaryAction && (
              <TileHint label={secondaryAction.label} hint={secondaryAction.hint}>
              <button
                type="button"
                onClick={secondaryAction.onClick}
                aria-label={secondaryAction.label}
                className={cn(TILE, "border border-border bg-background text-foreground hover:bg-muted")}
              >
                {SecondaryIcon ? <SecondaryIcon strokeWidth={1.75} /> : secondaryAction.label}
              </button>
              </TileHint>
            )}

            {explainerId && (
              <TileHint label="Watch how" hint="A short video that walks you through it.">
                <ExplainerChip
                  id={explainerId}
                  variant="tile"
                  label="Watch how"
                  className={TILE_SIZE[count >= 3 ? 3 : 2]}
                />
              </TileHint>
            )}
          </div>
          );
        })()}

        {footnote && (
          <p className="mt-4 max-w-[300px] text-[13px] text-muted-foreground">{footnote}</p>
        )}
      </div>
    </div>
  );
}
