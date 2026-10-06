"use client";

/**
 * The v2 form-dialog kit — one field shape for every "add" dialog
 * (Ghulam, Oct 2 2026: the vehicle dialog first, then customers).
 *
 *   CONTROL     one 44px control shape: softly rounded, a firm hairline,
 *               accent on hover and focus, red on error
 *   Cell        label → control → one RESERVED line for a hint or error, so
 *               an error never pushes a row out of line
 *   ToggleTile  a yes/no field drawn in the same 44px shape as an input
 *   StepFooter  the only chrome these dialogs have: Cancel/Back on the left,
 *               the steps in the middle, Next/finish on the right
 *
 * The screens themselves are a fixed 3-column × 4-row grid in each dialog.
 */

import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Switch } from "@/components/ui-v2/switch";

/** One shape for every control: 44px, softly rounded, a firm hairline. */
export const CONTROL =
  "h-11 w-full rounded-xl border border-foreground/15 bg-background px-3.5 text-sm text-foreground " +
  "shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] outline-none transition-[border-color,box-shadow] duration-200 " +
  "placeholder:text-muted-foreground/70 hover:border-primary/40 focus-visible:border-primary/60 " +
  "focus-visible:ring-3 focus-visible:ring-primary/15 aria-invalid:border-destructive/60 " +
  "disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/** The grid a screen is laid out on: three columns, rows as tall as their fields, centred. */
export const SCREEN_GRID = "grid grid-cols-3 content-center gap-x-6 gap-y-3";

export function Cell({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="truncate px-0.5 text-[13px] font-medium text-foreground/80">
        {label}
        {required && <span className="ml-0.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">*</span>}
      </span>
      {children}
      {/* Reserved: an error or a hint never moves the row. */}
      <span className={cn("min-h-[18px] truncate px-0.5 text-[11px] leading-[18px]", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? hint}
      </span>
    </div>
  );
}

/** A yes/no field drawn as a 44px tile with a switch — same shape as an input. */
export function ToggleTile({
  label,
  checked,
  onChange,
  on = "Yes",
  off = "No",
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  on?: string;
  off?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 text-sm transition-colors duration-200 motion-reduce:transition-none",
        checked ? "border-primary/40 bg-primary/[0.06] text-foreground" : "border-foreground/15 bg-background text-foreground/80 hover:border-primary/30",
      )}
    >
      <span className="truncate">{checked ? on : off}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/** Two choices in one 44px control — Bought / Financed, Person / Company. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="grid h-11 gap-1 rounded-xl border border-foreground/15 bg-muted/40 p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-lg text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none",
            value === o.value
              ? "bg-background font-medium text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.08)] ring-1 ring-foreground/10"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The foot: Cancel/Back, where you are, Next/finish. Nothing else. */
export function StepFooter({
  steps,
  step,
  loading,
  onBack,
  onCancel,
  finishLabel,
  busyLabel,
  compact,
}: {
  steps: readonly string[];
  step: number;
  loading?: boolean;
  onBack: () => void;
  onCancel: () => void;
  finishLabel: string;
  busyLabel: string;
  /** Dots only, no titles — for a narrow dialog with many short screens. */
  compact?: boolean;
}) {
  const last = step === steps.length - 1;
  return (
    <div className={cn("flex items-center justify-between gap-4 border-t", compact ? "px-8 py-4" : "mt-6 px-10 py-5")}>
      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-full px-5"
        onClick={() => (step === 0 ? onCancel() : onBack())}
        disabled={loading}
      >
        {step === 0 ? (
          "Cancel"
        ) : (
          <>
            <ArrowLeft className="size-4" /> Back
          </>
        )}
      </Button>

      {compact ? (
        <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>
          {steps.map((title, i) => (
            <li
              key={title}
              title={title}
              className={cn(
                "size-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none",
                i === step ? "bg-primary dark:bg-[hsl(var(--v2-link,var(--primary)))]" : i < step ? "bg-primary/40" : "bg-foreground/15",
              )}
            />
          ))}
        </ol>
      ) : (
      <ol className="flex items-center gap-2" aria-label="Steps">
        {steps.map((title, i) => (
          <li key={title} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-200",
                i < step
                  ? "bg-primary text-primary-foreground"
                  : i === step
                    ? "bg-primary/15 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn("hidden text-xs sm:inline", i === step ? "font-medium text-foreground" : "text-muted-foreground")}>{title}</span>
            {i < steps.length - 1 && <span className="hidden h-px w-6 bg-border sm:block" />}
          </li>
        ))}
      </ol>
      )}

      <Button type="submit" className="h-10 rounded-full px-5" variant={last ? "default" : "outline"} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {busyLabel}
          </>
        ) : last ? (
          <>
            <Check className="size-4" /> {finishLabel}
          </>
        ) : (
          <>
            Next <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </div>
  );
}
