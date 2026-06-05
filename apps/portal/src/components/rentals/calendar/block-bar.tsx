"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Ban, CalendarOff, Loader2, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { CalendarBlock, BarPosition } from "@/lib/calendar-utils";
import { cn } from "@/lib/utils";

interface BlockBarProps {
  block: CalendarBlock;
  position: BarPosition;
  topOffset: number;
  barHeight: number;
  /** Remove handler (Phase 2 inline editing). When omitted, the bar is read-only. */
  onRemove?: (block: CalendarBlock) => void;
  isRemoving?: boolean;
}

function formatDate(dateStr: string) {
  return format(parseISO(dateStr), "MMM dd, yyyy");
}

export function BlockBar({
  block,
  position,
  topOffset,
  barHeight,
  onRemove,
  isRemoving,
}: BlockBarProps) {
  const reason = block.reason?.trim() || "Blocked";
  const isExternal = block.source === "external";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "group absolute rounded-md border border-dashed flex items-center gap-1 px-2 overflow-hidden text-[11px] font-semibold whitespace-nowrap",
            "bg-[repeating-linear-gradient(45deg,theme(colors.slate.200/.7),theme(colors.slate.200/.7)_6px,transparent_6px,transparent_12px)]",
            "dark:bg-[repeating-linear-gradient(45deg,theme(colors.slate.700/.5),theme(colors.slate.700/.5)_6px,transparent_6px,transparent_12px)]",
            "border-slate-400/70 dark:border-slate-500/60 text-slate-600 dark:text-slate-300",
            position.isClipped ? "rounded-none" : "rounded-md"
          )}
          style={{
            left: position.left,
            width: position.width,
            top: `${topOffset}px`,
            height: `${barHeight}px`,
            minWidth: "8px",
          }}
        >
          {isExternal ? (
            <CalendarOff className="h-3 w-3 shrink-0 opacity-70" />
          ) : (
            <Ban className="h-3 w-3 shrink-0 opacity-70" />
          )}
          <span className="truncate line-through decoration-slate-500/50">
            {reason}
          </span>

          {onRemove && (
            <button
              type="button"
              aria-label="Remove block"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(block);
              }}
              disabled={isRemoving}
              className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm hover:bg-slate-500/20 p-0.5"
            >
              {isRemoving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="space-y-0.5">
          <p className="font-semibold flex items-center gap-1.5">
            <Ban className="h-3 w-3" />
            {isExternal ? "External booking" : "Blocked"} — {reason}
          </p>
          <p className="text-muted-foreground">
            {formatDate(block.start_date)}
            <span className="mx-1">&rarr;</span>
            {formatDate(block.end_date)}
          </p>
          {onRemove && (
            <p className="text-muted-foreground/70 pt-0.5">Hover the bar and click ✕ to unblock</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
