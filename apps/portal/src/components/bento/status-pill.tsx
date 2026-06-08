import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status pill — tinted bg + matching text from the Bento status map.
 * Spec: DESIGN_SYSTEM.md §7 (Status pill). Map:
 *   Active/On rental/Verified/Paid  → success
 *   Upcoming/Available              → info
 *   Pending/Maintenance             → warn
 *   Overdue/Blocked/Failed          → danger
 *   Completed/Cancelled             → neutral
 */
const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        success:
          "[background:var(--bento-success-weak)] text-[color:var(--bento-success)]",
        info: "[background:var(--bento-info-weak)] text-[color:var(--bento-info)]",
        warn: "[background:var(--bento-warn-bg)] text-[color:var(--bento-warn-accent)]",
        danger:
          "[background:var(--bento-danger-weak)] text-[color:var(--bento-danger-fg)]",
        neutral:
          "[background:var(--bento-tile-2)] text-[color:var(--bento-text-2)]",
        primary:
          "[background:var(--bento-primary-weak)] text-[color:var(--bento-primary-weak-fg)]",
      },
      dot: { true: "", false: "" },
    },
    defaultVariants: { tone: "neutral", dot: false },
  },
);

export type StatusTone =
  | "success"
  | "info"
  | "warn"
  | "danger"
  | "neutral"
  | "primary";

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {}

export function StatusPill({
  className,
  tone,
  dot,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ tone, dot }), className)} {...props}>
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      )}
      {children}
    </span>
  );
}

/** Map a free-text status string to a Bento tone. */
export function statusTone(status?: string | null): StatusTone {
  const s = (status ?? "").toLowerCase().trim();
  if (/(active|on rental|on_rental|verified|paid|approved|live|success|complete\b)/.test(s))
    return "success";
  if (/(upcoming|available|scheduled|open|new|info)/.test(s)) return "info";
  if (/(pending|maintenance|processing|trial|partial|draft|review|hold)/.test(s))
    return "warn";
  if (/(overdue|blocked|failed|cancel|declined|expired|past[_ ]?due|unpaid|void)/.test(s))
    return "danger";
  if (/(completed|closed|done|returned|inactive)/.test(s)) return "neutral";
  return "neutral";
}
