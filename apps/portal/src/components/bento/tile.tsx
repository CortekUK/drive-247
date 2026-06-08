"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { fadeUpChild } from "@/lib/motion";

/**
 * Bento Tile — the rounded surface every Bento page is composed from.
 * Spec: DESIGN_SYSTEM.md §7 (Tile / Card, Feature, Hero, Warn).
 * Built as a token-only CVA; animates fade-up on mount, lifts on hover.
 */
export const tileVariants = cva(
  "rounded-tile border transition-shadow",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border shadow-bento",
        feature:
          "border-transparent text-[color:var(--bento-feature-fg)] shadow-bento [background:var(--bento-feature-bg)]",
        hero:
          "border-transparent text-white shadow-bento-hero [background:var(--bento-hero-grad)]",
        warn:
          "text-[color:var(--bento-warn-fg)] [background:var(--bento-warn-bg)] [border-color:var(--bento-warn-border)]",
        inset:
          "border-border [background:var(--bento-tile-2)] text-foreground shadow-none",
        glass:
          "glass glass-rim text-card-foreground border-[color:var(--glass-border)]",
      },
      pad: {
        compact: "p-4",
        default: "p-[18px]",
        roomy: "p-5",
        none: "p-0",
      },
      interactive: {
        true: "cursor-pointer",
        false: "",
      },
    },
    defaultVariants: { variant: "default", pad: "default", interactive: false },
  },
);

export interface TileProps
  extends Omit<HTMLMotionProps<"div">, "ref">,
    VariantProps<typeof tileVariants> {
  /** Disable the mount fade-up (e.g. when the parent already staggers). */
  noMotion?: boolean;
}

export const Tile = React.forwardRef<HTMLDivElement, TileProps>(
  ({ className, variant, pad, interactive, noMotion, ...props }, ref) => {
    const reduce = useReducedMotion();
    const motionProps =
      noMotion || reduce
        ? {}
        : {
            variants: fadeUpChild,
            initial: "hidden" as const,
            animate: "show" as const,
            whileHover: interactive ? { y: -2 } : undefined,
          };
    return (
      <motion.div
        ref={ref}
        className={cn(tileVariants({ variant, pad, interactive }), className)}
        {...motionProps}
        {...props}
      />
    );
  },
);
Tile.displayName = "Tile";
