"use client";

/**
 * The small parts the payment-plan sentence is built from: a lead word, a
 * row of chips, an inline number, an inline date. v2 grammar throughout —
 * rounded-full chips on the recessed ground, the brand tint on hover (never
 * grey), and the dark-mode link colour on anything that turns primary.
 */

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui-v2/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { dateToIso, formatDayLong, isIsoDate, isoToDate, type ISODate } from "@/lib/payment-plans-ui/format";

export const chipCls = (active: boolean) =>
  cn(
    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50",
    active
      ? "bg-primary text-primary-foreground"
      : "bg-muted/70 text-foreground/80 hover:bg-primary/10 hover:text-primary dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:hover:text-[hsl(var(--v2-link,var(--primary)))]",
  );

export function Chip({
  active,
  onClick,
  children,
  disabled,
  title,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  return (
    <button type="button" aria-pressed={active} disabled={disabled} title={title} onClick={onClick} className={chipCls(active)} {...rest}>
      {children}
    </button>
  );
}

/**
 * One line of the sentence: the lead word on the left, the choices after it.
 * On a phone the word sits above its choices; from `sm` it leads the row.
 */
export function SentenceLine({
  word,
  children,
  error,
  hint,
  id,
}: {
  word: string;
  children: React.ReactNode;
  /** Shown under the line, in the destructive colour, when this line is what's wrong. */
  error?: string | null;
  hint?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3" data-sentence-line={id ?? word}>
      <span className="shrink-0 pt-1.5 font-heading text-sm font-semibold text-foreground sm:w-20">{word}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        {hint && !error && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        {error && (
          <p role="alert" className="mt-1.5 text-xs font-medium leading-relaxed text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The plan form is rendered INSIDE the New Rental <form>. Enter in any of its
 * boxes must never submit that form — creating a rental is not something a
 * keystroke in "every [3] days" should do.
 */
export const swallowEnter = (e: React.KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

export const inlineInputCls =
  "h-8 rounded-3xl border border-transparent bg-input/50 px-3 text-sm tabular-nums outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-[invalid=true]:border-destructive";

/** A whole number typed inline ("every [3] days", "after [6] payments"). */
export function InlineNumber({
  value,
  onChange,
  min = 1,
  max,
  label,
  invalid,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label: string;
  invalid?: boolean;
  className?: string;
}) {
  // Held as text so the box can be emptied while typing without snapping to a number.
  const [text, setText] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      aria-invalid={invalid || undefined}
      min={min}
      max={max}
      onKeyDown={swallowEnter}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Math.floor(Number(e.target.value));
        if (e.target.value !== "" && Number.isFinite(n)) {
          setLastValue(n);
          onChange(n);
        }
      }}
      onBlur={() => {
        if (text === "" || !Number.isFinite(Number(text))) setText(String(value));
      }}
      className={cn(inlineInputCls, "w-16 text-center", className)}
    />
  );
}

/** A calendar date picked inline. Shows "Fri 9 Oct 2026", never a raw ISO string. */
export function InlineDate({
  value,
  onChange,
  label,
  placeholder = "Pick a date",
  min,
  max,
  invalid,
}: {
  value: ISODate | null;
  onChange: (d: ISODate) => void;
  label: string;
  placeholder?: string;
  min?: ISODate | null;
  max?: ISODate | null;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = value && isIsoDate(value) ? isoToDate(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-invalid={invalid || undefined}
          className={cn(
            inlineInputCls,
            "inline-flex cursor-pointer items-center gap-1.5 hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3.5 text-muted-foreground" />
          {value ? formatDayLong(value) : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (min ? isoToDate(min) : undefined)}
          weekStartsOn={1}
          disabled={(d: Date) => {
            const iso = dateToIso(d);
            return (!!min && iso < min) || (!!max && iso > max);
          }}
          onSelect={(d: Date | undefined) => {
            if (!d) return;
            onChange(dateToIso(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
