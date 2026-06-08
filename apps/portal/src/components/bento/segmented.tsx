"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

/**
 * Segmented control — pill track with a sliding white indicator behind the
 * active label. Spec: DESIGN_SYSTEM.md §7 (Segmented control). Replaces shadcn
 * Tabs for short option sets (filters, plan, light/dark, handover method).
 *
 * Controlled: pass `value` + `onValueChange`.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  className,
  size = "default",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  size?: "sm" | "default";
}) {
  const reduce = useReducedMotion();
  const id = React.useId();
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-full p-1 [background:var(--bento-tile-2)]",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "relative rounded-full font-semibold transition-colors",
              size === "sm" ? "px-3 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]",
              active ? "text-foreground" : "text-[color:var(--bento-text-2)] hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${id}`}
                transition={reduce ? { duration: 0 } : springs.snappy}
                className="absolute inset-0 -z-0 rounded-full bg-card shadow-sm"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {opt.label}
              {typeof opt.count === "number" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                    active
                      ? "[background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]"
                      : "bg-background text-[color:var(--bento-text-3)]",
                  )}
                >
                  {opt.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
