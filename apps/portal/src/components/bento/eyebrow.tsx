import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Eyebrow — quiet uppercase label that sits above KPIs and section headers.
 * Spec: DESIGN_SYSTEM.md §4 (11px / 700 / +0.07em / --bento-text-3).
 */
export function Eyebrow({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("bento-eyebrow", className)} {...props} />;
}
