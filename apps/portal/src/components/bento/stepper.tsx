"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stepper — −/value/+ in a bordered pill, value in Sora 800. Spec:
 * DESIGN_SYSTEM.md §7 (Stepper). For quantities (extras, days).
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  step = 1,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  const btn =
    "flex h-9 w-9 items-center justify-center text-[color:var(--bento-text-2)] transition-colors hover:text-foreground active:scale-95 disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-card",
        className,
      )}
    >
      <button type="button" onClick={dec} disabled={value <= min} className={btn} aria-label="Decrease">
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-9 text-center text-base font-extrabold tabular-nums">
        {value}
      </span>
      <button type="button" onClick={inc} disabled={value >= max} className={btn} aria-label="Increase">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
