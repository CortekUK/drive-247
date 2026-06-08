import * as React from "react";
import { cn } from "@/lib/utils";
import { Tile } from "./tile";

/**
 * Bento skeletons — shimmer blocks in --bento-tile-2 mirroring real layouts.
 * Spec: DESIGN_SYSTEM.md §7 (Skeleton) + §9. Prefer a layout-matching skeleton
 * over a spinner-on-blank.
 */
export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md [background:var(--bento-tile-2)]",
        className,
      )}
    />
  );
}

/** Row of KPI tile skeletons. */
export function KpiTileSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Tile key={i} noMotion className="flex flex-col gap-3">
          <Shimmer className="h-3 w-20" />
          <Shimmer className="h-8 w-24" />
          <Shimmer className="h-3 w-16" />
        </Tile>
      ))}
    </div>
  );
}

/** Table tile skeleton with header + rows. */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Tile noMotion pad="none" className="overflow-hidden">
      <div className="flex gap-4 border-b border-border [background:var(--bento-tile-2)] p-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Shimmer key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 p-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Shimmer key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </Tile>
  );
}
