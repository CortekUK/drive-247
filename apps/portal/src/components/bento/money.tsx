import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Money / figure cell — IBM Plex Mono, tabular nums, right-alignable.
 * Spec: DESIGN_SYSTEM.md §4 + §7 (Table). Use for any monetary value,
 * plate, reg, code, or timestamp so figures never reflow.
 */
export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** ISO currency code (default GBP). Ignored when `children` is provided. */
  currency?: string;
  /** Numeric amount; formatted with Intl when provided. */
  value?: number;
  locale?: string;
}

export function Money({
  className,
  currency = "GBP",
  value,
  locale = "en-GB",
  children,
  ...props
}: MoneyProps) {
  const text =
    children ??
    (typeof value === "number"
      ? new Intl.NumberFormat(locale, { style: "currency", currency }).format(value)
      : null);
  return (
    <span className={cn("font-mono tabular-nums", className)} {...props}>
      {text}
    </span>
  );
}
