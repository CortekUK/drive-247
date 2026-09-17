"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { cn } from "@/lib/utils";

/**
 * A round, icon-only control for a v2 page header, with its name in a tooltip.
 *
 * The team lead's rule for headers (Sep 15 2026): ONE labelled button, the
 * page's main action (New Rental, Add Customer, Add Vehicle), and everything
 * else as an icon. The label still reaches assistive tech as `aria-label` and
 * sighted users on hover and keyboard focus, so nothing loses its name.
 *
 * Every header control is 32px now, on every page (team lead, Sep 16 2026:
 * smaller icons and button, lined up with the line under the heading). `size`
 * is still accepted so existing call sites compile, but no longer changes it.
 *
 * Purple at rest, exactly like the tour button: a tinted purple outline, a faint
 * purple ground and a purple glyph, a shade deeper on hover or while its
 * menu/panel is open — never the outline variant's grey.
 */

/**
 * The header's control cluster, centred on the SUBTITLE line rather than the
 * heading. The box is exactly the subtitle's line box (text-base = 24px) and
 * sits at the bottom of the header row, so 32px controls overflow it by 4px
 * above and below and their centre lands on the subtitle's centre. Below `sm`
 * the header stacks and the cluster keeps its natural height.
 *
 * v2 only — on a shared v1 page apply it behind the page's v2 flag.
 */
export const HEADER_ACTIONS_V2 = "sm:self-end sm:h-6 sm:items-center";

/**
 * The header's one labelled button (New Rental, Add Customer, …) at the smaller
 * size: a 32px pill, 13px text, 14px icon. `!mr-0` drops the `mr-2` the v1
 * buttons put on their icon, since `gap-1.5` now spaces it.
 */
export const HEADER_PRIMARY_V2 =
  "h-8 gap-1.5 rounded-full px-3.5 text-[13px] [&_svg]:!size-3.5 [&_svg]:!mr-0";
type Common = {
  label: string;
  /** The icon. */
  children: ReactNode;
  size?: "icon" | "icon-lg";
  className?: string;
  "data-tour"?: string;
};

type AsButton = Common & { href?: undefined; onClick: () => void; disabled?: boolean };
type AsLink = Common & { href: string; onClick?: undefined; disabled?: undefined };

export function HeaderIconButton(props: AsButton | AsLink) {
  const { label, children, className } = props;
  const classes = cn(
    buttonVariants({ variant: "outline", size: "icon-sm" }),
    // Purple at rest, the tour icon's look (team lead, Sep 16 2026): tinted
    // outline, faint purple ground, purple glyph; a shade deeper on hover/open.
    // Dark: dark --primary is ~1.9:1 as a glyph on the dark header and
    // primary/15 is a 1.02:1 hover step, so the glyph and ring read --v2-link
    // (the light brand text, indigo by default) and hover/open use the v2 tint.
    "rounded-full border-primary/30 bg-primary/5 text-primary [&_svg]:!size-3.5 dark:bg-primary/10 dark:border-[hsl(var(--v2-link,var(--primary))_/_0.3)] dark:text-[hsl(var(--v2-link,var(--primary)))]",
    "hover:border-primary/50 hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.5)] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]",
    "aria-expanded:border-primary/50 aria-expanded:bg-primary/10 aria-expanded:text-primary dark:aria-expanded:border-[hsl(var(--v2-link,var(--primary))_/_0.5)] dark:aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] dark:aria-expanded:text-[hsl(var(--v2-link,var(--primary)))]",
    className,
  );
  const trigger =
    props.href !== undefined ? (
      <Link href={props.href} aria-label={label} data-tour={props["data-tour"]} className={classes}>
        {/* A JSX literal, not the prop itself: next/link types its children
            with a second copy of @types/react, and only an element written
            here satisfies both copies. */}
        <>{children}</>
      </Link>
    ) : (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={label}
        data-tour={props["data-tour"]}
        className={classes}
      >
        {children}
      </button>
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
