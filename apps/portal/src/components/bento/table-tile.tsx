"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Tile } from "./tile";

/**
 * Table tile — wraps a data table in a Bento Tile with an optional toolbar
 * (title / segmented filter / search / primary action) above it.
 * Spec: DESIGN_SYSTEM.md §7 (Table) + §8 (list pattern). Compose the actual
 * rows with shadcn `Table` using the classes below.
 */
export function TableTile({
  toolbar,
  children,
  className,
}: {
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tile pad="none" className={cn("overflow-hidden", className)}>
      {toolbar && (
        <div className="flex flex-wrap items-center gap-3 p-4">{toolbar}</div>
      )}
      <div className="overflow-x-auto scrollbar-thin">{children}</div>
    </Tile>
  );
}

/** Class helpers so plain shadcn <Table> rows wear the Bento look. */
export const bentoTable = {
  /** <TableHeader> row */
  header:
    "[&_tr]:border-border [&_th]:bg-[color:var(--bento-tile-2)] [&_th]:text-[10.5px] [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:text-[color:var(--bento-text-3)] [&_th]:h-10",
  /** <TableRow> */
  row: "border-border transition-colors hover:bg-[color:var(--bento-tile-2)] cursor-pointer",
  /** money / figure cell */
  figure: "text-right font-mono tabular-nums",
};
