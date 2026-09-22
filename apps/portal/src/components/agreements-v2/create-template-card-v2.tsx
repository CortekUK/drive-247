"use client";

/**
 * Agreements v2: the "Create your template" card (D5, D15; transcript
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

import { FeaturedCardFace, FeaturedCardShell } from "@/components/shared/featured-deck-view-v2";
import { cn } from "@/lib/utils";

export const CREATE_TEMPLATE_TITLE = "Create your template";
export const CREATE_TEMPLATE_SUBTITLE = "Your own wording, with signature fields, ready to send.";
export const CREATE_TEMPLATE_DISABLED_SUBTITLE = "Ask an admin to create agreement templates.";
export const CREATE_TEMPLATE_BUSY_SUBTITLE = "Creating your template…";

/** The featured deck's own action surface (featured-deck-view-v2.tsx ACTION_CLASS), with no dots below it. */
const ACTION_CLASS =
  "relative flex min-h-0 flex-1 flex-col justify-between rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed";

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
        className={ACTION_CLASS}
        onClick={() => {
          if (!inert) onCreate();
        }}
        disabled={inert}
        aria-busy={busy || undefined}
      >
        <FeaturedCardFace title={CREATE_TEMPLATE_TITLE} subtitle={subtitle} />
      </button>
    </FeaturedCardShell>
  );
}
