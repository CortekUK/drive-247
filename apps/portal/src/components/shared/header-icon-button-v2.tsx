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
 * `size` matches the labelled button beside it: `icon` (36px) next to a ui-v2
 * Button, `icon-lg` (40px) next to the h-10 buttons on the shared list pages.
 */
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
  const { label, children, size = "icon", className } = props;
  const classes = cn(
    buttonVariants({ variant: "outline", size }),
    "rounded-full text-muted-foreground hover:text-foreground",
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
