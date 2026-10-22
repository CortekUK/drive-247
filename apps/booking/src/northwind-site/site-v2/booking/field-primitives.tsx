"use client";

import { CalendarDays, Minus, Plus } from "lucide-react-nw";
import * as React from "react";
import type { DayButton } from "react-day-picker-nw";

import { Button } from "@nw/components/ui/button";
import { Calendar } from "@nw/components/ui/calendar";
import { Checkbox } from "@nw/components/ui/checkbox";
import { Input } from "@nw/components/ui/input";
import { Label } from "@nw/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nw/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nw/components/ui/select";
import {
  formatClockLabel,
  formatIsoDateLabel,
  localDateToIso,
  resolveDatePickerState,
} from "@nw/components/booking/time-utils";
import { cn } from "@nw/lib/utils";
import { CARD, FIELD, FIELD_LABEL } from "@nw/site-v2/kit";

/**
 * The booking form's furniture, v2.
 *
 * The same exports and props as v1's `components/booking/field-primitives.tsx`
 * (other v2 screens import them by that contract), redrawn in the kit's
 * language: the 44px / 10px-radius `FIELD`, the muted `FIELD_LABEL`, flat 1px
 * borders, a tinted accent for anything selected, errors in `pv-danger`.
 *
 * Everything that is not markup — the local-date ISO conversion, which month a
 * picker opens on, the clock labels — comes from v1's `time-utils`, so the two
 * forms cannot disagree about what a date means.
 *
 * LAYOUT CONTRACT, kept from v1: every control is a self-contained block whose
 * first child is the label and whose last child is the error, so `FieldGrid`
 * can pair two of them top-aligned and an error under one never nudges its
 * partner off the shared baseline.
 *
 * Popovers and select menus portal to <body>, which the v2 shell gives the
 * `pv2-tokens` class — so the `pv-*` utilities below resolve there too.
 */

const MOTION = "transition-colors duration-200 ease-out motion-reduce:transition-none";

/** The kit field, plus the invalid state and the primitives' own shadow removed. */
export const FIELD_INPUT_CLASS =
  `${FIELD} shadow-none selection:bg-pv-primary selection:text-pv-primary-fg ` +
  "aria-[invalid=true]:border-pv-danger aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-pv-danger/10";

/*
  `data-[size=default]:h-11` out-specifies the shadcn trigger's own
  `data-[size=default]:h-9` (see v1 for the long version of why).
*/
export const FIELD_TRIGGER_CLASS =
  `${FIELD_INPUT_CLASS} justify-between data-[size=default]:h-11 data-[placeholder]:text-pv-muted-fg/80 ` +
  "[&_svg:not([class*='text-'])]:text-pv-muted-fg";

export const SELECT_ITEM_CLASS =
  "min-h-10 rounded-lg text-sm text-pv-fg focus:bg-pv-hover focus:text-pv-fg";

/** The menu a select opens: the same 16px card language as the page. */
const SELECT_CONTENT_CLASS = "rounded-2xl border-pv-border bg-pv-card p-1 text-pv-fg";

/*
  18px box with a 44px invisible hit area (`before:` inset 14px — the padding
  box is 16px, so 16 + 2x14 = 44; see v1 for the measurement).
*/
export const CHECKBOX_CLASS =
  "relative size-[18px] rounded-[6px] border-pv-border bg-pv-bg shadow-none " +
  "before:absolute before:-inset-[14px] before:content-[''] " +
  "data-[state=checked]:border-pv-primary data-[state=checked]:bg-pv-primary data-[state=checked]:text-pv-primary-fg " +
  "focus-visible:border-pv-primary focus-visible:ring-3 focus-visible:ring-pv-primary/20";

/** Make a field occupy the whole `FieldGrid` row. */
export const FIELD_FULL_WIDTH = "sm:col-span-2";

/* ────────────────────────────── layout ───────────────────────────────── */

/**
 * One titled block of the form — a calm card of its own.
 *
 * v1 stacked six of these inside one bordered box with hairlines between them;
 * v2 gives each its own card and more air, because the brief is "a bit less
 * dense". The heading is a real `<h2>`; the vehicle name is the page's `<h1>`.
 */
export function FormSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(CARD, "p-5 sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-pv-fg">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** The two-up field grid. `items-start` keeps paired inputs on one baseline. */
export function FieldGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs leading-snug text-pv-danger">
      {message}
    </p>
  );
}

/* ────────────────────── required / optional markers ──────────────────── */

/**
 * The asterisk on a required field's label. Decorative (`aria-hidden`); the
 * requirement itself rides on the control as `aria-required`.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="font-normal text-pv-danger">
      *
    </span>
  );
}

/** The key for the asterisk. Rendered ONCE, above the first section. */
export function RequiredLegend({ className }: { className?: string }) {
  return (
    <p className={cn("px-1 text-xs leading-relaxed text-pv-muted-fg", className)}>
      <span className="text-pv-danger">*</span> marks a required field.
      Everything else is optional.
    </p>
  );
}

/** "Optional" beside a section heading, for a whole block nothing depends on. */
export function OptionalTag() {
  return (
    <span className="mt-0.5 shrink-0 rounded-full bg-pv-muted px-2 py-0.5 text-[11px] font-medium leading-4 text-pv-muted-fg">
      Optional
    </span>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  required,
  optional,
}: {
  htmlFor: string;
  children: React.ReactNode;
  /** Draws the asterisk. The CALLER must also put `aria-required` on the control. */
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <Label htmlFor={htmlFor} className={cn(FIELD_LABEL, "gap-1")}>
      {children}
      {required ? <RequiredMark /> : null}
      {optional ? (
        <span className="font-normal text-pv-muted-fg/80">(optional)</span>
      ) : null}
    </Label>
  );
}

/** A quiet one-liner under a field — the age rule, a fee caveat, a duration. */
export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-pv-muted-fg">{children}</p>;
}

/* ────────────────────────────── controls ─────────────────────────────── */

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
  required,
  optional,
  hint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel";
  required?: boolean;
  optional?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={id} required={required} optional={optional}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_INPUT_CLASS}
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <FieldError message={error} />
    </div>
  );
}

/** A native `<input type="date">` — a date of birth is typed, not browsed. */
export function NativeDateField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  required,
  hint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="date"
        value={value}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_INPUT_CLASS, "block")}
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <FieldError message={error} />
    </div>
  );
}

/**
 * The calendar's day button on the v2 tokens: the chosen day is a solid accent
 * square, today is tinted, unavailable days are struck through and faded.
 */
function PvDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      className={cn(
        "flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-[10px] font-normal leading-none text-pv-fg shadow-none",
        MOTION,
        "hover:bg-pv-hover hover:text-pv-fg focus-visible:ring-2 focus-visible:ring-pv-primary/30",
        modifiers.today && !modifiers.selected && "bg-pv-tint font-semibold text-pv-primary",
        modifiers.selected &&
          "bg-pv-primary font-semibold text-pv-primary-fg hover:bg-pv-primary-hover hover:text-pv-primary-fg",
        modifiers.disabled && "text-pv-muted-fg line-through opacity-40",
        modifiers.outside && !modifiers.selected && "text-pv-muted-fg/70",
        className,
      )}
      {...props}
    />
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  isDisabledDate,
  error,
  placeholder = "Select a date",
  defaultMonthIso,
  disabled,
  required,
  className,
}: {
  id: string;
  label: string;
  /** 'YYYY-MM-DD', or empty. */
  value: string;
  onChange: (iso: string) => void;
  /** Which days cannot be chosen — lead time, occupancy, ordering. */
  isDisabledDate: (date: Date) => boolean;
  error?: string;
  placeholder?: string;
  /** Which month to open on when nothing is selected yet. */
  defaultMonthIso?: string;
  disabled?: boolean;
  /** Draws the asterisk and sets `aria-required` on the trigger. */
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const { selected, defaultMonth } = resolveDatePickerState(value, defaultMonthIso);

  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            className={cn(
              FIELD_INPUT_CLASS,
              "flex items-center justify-between gap-2 text-left",
              open && "border-pv-primary ring-3 ring-pv-primary/15",
              selected ? "text-pv-fg" : "text-pv-muted-fg/80",
            )}
          >
            <span className="truncate">
              {selected ? formatIsoDateLabel(value) : placeholder}
            </span>
            <CalendarDays
              aria-hidden
              className="size-4 shrink-0 text-pv-muted-fg"
              strokeWidth={1.75}
            />
          </button>
        </PopoverTrigger>
        {/* Never wider than the viewport: the page must not scroll sideways. */}
        <PopoverContent
          align="start"
          collisionPadding={12}
          // Capped at the room Radix measures on its side, scrolling inside
          // rather than running off the screen: in a dialog the calendar
          // could open upward past the top edge and lose its month heading.
          className="max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border-pv-border bg-pv-card p-2 text-pv-fg shadow-lg"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={defaultMonth}
            disabled={isDisabledDate}
            buttonVariant="brand-ghost"
            className="bg-transparent [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(9)]"
            classNames={{
              today: "rounded-[10px]",
              weekday: "flex-1 text-[0.75rem] font-medium text-pv-muted-fg",
              caption_label: "text-sm font-semibold text-pv-fg",
            }}
            components={{ DayButton: PvDayButton }}
            onSelect={(date) => {
              if (!date) return;
              // Local Y/M/D, never `toISOString()` — see `localDateToIso`.
              onChange(localDateToIso(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <FieldError message={error} />
    </div>
  );
}

export function TimeField({
  id,
  label,
  value,
  onChange,
  slots,
  error,
  required,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (time: string) => void;
  slots: readonly string[];
  error?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Select value={value === "" ? undefined : value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          className={FIELD_TRIGGER_CLASS}
        >
          <SelectValue placeholder="Select a time" />
        </SelectTrigger>
        <SelectContent className={cn(SELECT_CONTENT_CLASS, "max-h-72")}>
          {slots.map((slot) => (
            <SelectItem key={slot} value={slot} className={SELECT_ITEM_CLASS}>
              {formatClockLabel(slot)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={error} />
    </div>
  );
}

/** The menu class for any v2 select in the booking flow (the location picker uses it). */
export const SELECT_CONTENT = SELECT_CONTENT_CLASS;

export function CheckboxRow({
  id,
  checked,
  onChange,
  children,
  error,
  required,
  optional,
  className,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  error?: string;
  /** Draws the asterisk after the sentence and sets `aria-required`. */
  required?: boolean;
  optional?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="-my-1 flex items-start gap-3 py-1">
        <Checkbox
          id={id}
          checked={checked}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          onCheckedChange={(state) => onChange(state === true)}
          className={cn("mt-px", CHECKBOX_CLASS, error && "border-pv-danger")}
        />
        {/* `block`: the Label primitive is a flex row; this label is a sentence. */}
        <Label
          htmlFor={id}
          className="block text-[13px] font-normal leading-relaxed text-pv-fg/80"
        >
          {children}
          {required ? (
            <>
              {" "}
              <RequiredMark />
            </>
          ) : null}
          {optional ? (
            <span className="text-pv-muted-fg"> (optional)</span>
          ) : null}
        </Label>
      </div>
      <FieldError message={error} />
    </div>
  );
}

export function QuantityStepper({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  /** Hard cap. Null means no cap the customer can hit. */
  max: number | null;
  onChange: (next: number) => void;
  /** Announced to screen readers, e.g. "Child Seat". */
  label: string;
}) {
  const ceiling = max ?? Number.POSITIVE_INFINITY;
  const canAdd = value < ceiling;

  // At zero the control collapses to one button (see v1 for why).
  if (value <= 0) {
    return (
      <Button
        type="button"
        variant="brand-outline"
        size="icon-sm"
        aria-label={`Add one ${label}`}
        disabled={!canAdd}
        onClick={() => onChange(1)}
        className="size-11 shrink-0 bg-pv-card lg:size-9"
      >
        <Plus strokeWidth={2} />
      </Button>
    );
  }

  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-pv-border bg-pv-card p-0.5">
      <Button
        type="button"
        variant="brand-ghost"
        size="icon-sm"
        aria-label={`Remove one ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="size-11 lg:size-8"
      >
        <Minus strokeWidth={2} />
      </Button>
      <span
        aria-live="polite"
        className="min-w-6 text-center text-sm font-semibold tabular-nums text-pv-fg"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="brand-ghost"
        size="icon-sm"
        aria-label={`Add one ${label}`}
        disabled={!canAdd}
        onClick={() => onChange(value + 1)}
        className="size-11 lg:size-8"
      >
        <Plus strokeWidth={2} />
      </Button>
    </div>
  );
}

/**
 * One option in the pickup/return chooser: a bordered selectable card that
 * tints when chosen. A real `<button role="radio">`, the whole card the target.
 */
export function ModeCard({
  selected,
  onSelect,
  title,
  badge,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge?: React.ReactNode;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex h-full min-h-11 w-full items-start gap-3 rounded-xl border p-3.5 text-left",
        MOTION,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30",
        selected
          ? "border-pv-primary bg-pv-tint"
          : "border-pv-border bg-pv-card hover:border-pv-primary/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border bg-pv-card",
          MOTION,
          selected ? "border-pv-primary" : "border-pv-border",
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-pv-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-pv-fg">{title}</span>
          {badge}
        </span>
        {description ? (
          <span className="mt-1 block text-xs leading-relaxed text-pv-muted-fg">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** A small text pill — "Free", "+$45", "per day". */
export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "positive" | "notice";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        tone === "positive" && "bg-pv-success-light text-pv-success",
        tone === "notice" && "bg-pv-warning-light text-pv-warning",
        tone === "neutral" && "bg-pv-muted text-pv-muted-fg",
      )}
    >
      {children}
    </span>
  );
}
