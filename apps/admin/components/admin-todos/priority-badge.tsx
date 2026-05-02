"use client";

import { cn } from "@/lib/utils";
import type { TodoPriority } from "@/hooks/use-admin-todos";

const STYLE: Record<TodoPriority, { dot: string; pill: string; label: string }> = {
  low:    { dot: "bg-slate-400",  pill: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", label: "Low" },
  medium: { dot: "bg-amber-500",  pill: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400", label: "Medium" },
  high:   { dot: "bg-red-500",    pill: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",         label: "High" },
};

export function PriorityDot({ priority, className }: { priority: TodoPriority; className?: string }) {
  return (
    <span
      aria-label={`${STYLE[priority].label} priority`}
      title={`${STYLE[priority].label} priority`}
      className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", STYLE[priority].dot, className)}
    />
  );
}

export function PriorityPill({ priority, className }: { priority: TodoPriority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        STYLE[priority].pill,
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", STYLE[priority].dot)} />
      {STYLE[priority].label}
    </span>
  );
}
