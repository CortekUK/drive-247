"use client";

/**
 * Agreements v2: the "Manage agreement templates" card (was "Create your
 * template"; it now opens ./templates-dialog-v2 rather than a create) (D5, D15; transcript
 * 03:05–04:11, "card name catchy, like 'Create your template'").
 *
 * One card, two places: the hero row's card slot (beside the graph, where the
 * other tabs keep their featured card) and the head of the templates section.
 * It is the featured card's own look (FeaturedCardShell + FeaturedCardFace), so
 * it reads as the same kind of object as the Rentals, Customers and Vehicles
 * cards rather than a new one.
 *
 * SIZE. The shell carries `min-h-[15rem]` for the stacked (below lg) layout.
 * In HeroRow's slot the card must not set a desktop minimum taller than the
 * graph column, so `lg:min-h-0` is the default here, exactly as
 * rentals-overview.tsx overrides the deck. The root is the shell itself, so it
 * can be passed to HeroRow directly (a wrapper would defeat its `:empty` rule).
 * The templates section passes `className="min-h-0"` so the card is as tall as
 * the template cards beside it.
 *
 * `disabled` is the permission answer (template editing keeps its grant,
 * `canEditSettings('templates')`, D19): the card stays on screen so the hero
 * row keeps its shape, says who can create one, and does nothing. `busy` is a
 * create already in flight.
 */

import { ArrowRight } from "lucide-react";
import { FeaturedCardShell } from "@/components/shared/featured-deck-view-v2";
import { cn } from "@/lib/utils";

/** Two words, so it never truncates in the hero slot. */
export const CREATE_TEMPLATE_TITLE = "Template Studio";
export const CREATE_TEMPLATE_SUBTITLE = "Write and edit your agreements with Trax.";
export const CREATE_TEMPLATE_DISABLED_SUBTITLE = "Ask an admin to create agreement templates.";
export const CREATE_TEMPLATE_BUSY_SUBTITLE = "Creating your template…";

/** The featured deck's own action surface (featured-deck-view-v2.tsx ACTION_CLASS), with no dots below it. */
const ACTION_CLASS =
  "relative flex min-h-0 flex-1 flex-col justify-between rounded-2xl p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed";

export function CreateTemplateCardV2({
  onCreate,
  disabled = false,
  busy = false,
  className,
}: {
  onCreate: () => void;
  /** No permission to create templates. */
  disabled?: boolean;
  /** A create is already running. */
  busy?: boolean;
  className?: string;
}) {
  const inert = disabled || busy;
  const subtitle = disabled
    ? CREATE_TEMPLATE_DISABLED_SUBTITLE
    : busy
      ? CREATE_TEMPLATE_BUSY_SUBTITLE
      : CREATE_TEMPLATE_SUBTITLE;

  return (
    <FeaturedCardShell
      data-tour="agreements-create-template"
      data-disabled={disabled ? "true" : undefined}
      // The shell deepens its border on hover; a card that does nothing must not.
      className={cn("lg:min-h-0", inert && "hover:border-primary/20", disabled && "opacity-70", className)}
    >
      <button
        type="button"
        aria-label={`${CREATE_TEMPLATE_TITLE}. ${subtitle}`}
        className={ACTION_CLASS}
        onClick={() => {
          if (!inert) onCreate();
        }}
        disabled={inert}
        aria-busy={busy || undefined}
      >
        {/* The featured face, the dashboard feature card's layout (Oct 2 2026):
            a heavy stacked title top-left, and the line and an accent "Create"
            cue along the foot. No illustration (Oct 2 2026). */}
        <h3 className="relative line-clamp-2 max-w-[10.5ch] pb-[0.1em] text-[26px] font-black leading-[1] tracking-[-0.04em] text-neutral-950 dark:text-white">
          {CREATE_TEMPLATE_TITLE}
        </h3>
        <div className="relative min-w-0">
          <p className="truncate text-[13px] leading-5 text-neutral-600 dark:text-neutral-300">{subtitle}</p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#5b5bd6] dark:text-[hsl(var(--v2-link,var(--primary)))]">
            Create
            <ArrowRight aria-hidden className="size-3.5 transition-transform duration-200 group-hover/deck:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </div>
      </button>
    </FeaturedCardShell>
  );
}
