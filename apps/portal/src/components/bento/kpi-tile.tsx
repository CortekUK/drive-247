"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Tile, type TileProps } from "./tile";
import { Eyebrow } from "./eyebrow";
import { useCountUp } from "./use-count-up";

/**
 * KPI tile — eyebrow label, oversized Sora numeral (count-up), delta/sub line.
 * Spec: DESIGN_SYSTEM.md §7 (KPI tile / Feature tile / Hero tile).
 * Use `variant="feature"` for the single lead stat, `variant="hero"` for the
 * one most-important number (gradient).
 */
export interface KpiTileProps extends Omit<TileProps, "children" | "value"> {
  label: string;
  /** Numeric value — animated via count-up. */
  value: number;
  /** Render the animated number (e.g. prefix currency, format). */
  format?: (v: number) => React.ReactNode;
  /** Small line under the numeral (delta / context). */
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  /** Disable count-up (for non-numeric or already-formatted displays). */
  noCountUp?: boolean;
}

export function KpiTile({
  label,
  value,
  format,
  sub,
  icon,
  noCountUp,
  variant = "default",
  className,
  ...props
}: KpiTileProps) {
  const live = useCountUp(noCountUp ? value : value);
  const shown = noCountUp ? value : Math.round(live);
  const isOnColor = variant === "feature" || variant === "hero";

  return (
    <Tile variant={variant} className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="flex items-start justify-between">
        <Eyebrow
          className={cn(
            isOnColor && "text-[color:var(--bento-feature-sub)]",
            variant === "hero" && "text-white/70",
          )}
        >
          {label}
        </Eyebrow>
        {icon && (
          <span className={cn("shrink-0", isOnColor ? "text-current/80" : "text-primary")}>
            {icon}
          </span>
        )}
      </div>
      <div
        className={cn(
          "font-extrabold tracking-tight tabular-nums leading-none",
          "text-[clamp(1.9rem,2.6vw,2.6rem)]",
        )}
      >
        {format ? format(shown) : shown.toLocaleString()}
      </div>
      {sub && (
        <div
          className={cn(
            "text-xs",
            isOnColor ? "text-current/70" : "text-muted-foreground",
          )}
        >
          {sub}
        </div>
      )}
    </Tile>
  );
}
