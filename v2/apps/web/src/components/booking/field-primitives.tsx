"use client";

import { CalendarDays, Minus, Plus } from "lucide-react";
import * as React from "react";
import type { DayButton } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseDateOnly } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { formatClockLabel, formatIsoDateLabel, isIsoDate } from "./time-utils";

/**
 * The booking form's furniture.
 *
 * The shadcn primitives under `components/ui` were generated against the
 * generic token set, whose `primary` / `accent` / `ring` all resolve to indigo —
 * a colour that appears nowhere on this site. Rather than edit the primitives
 * (they are shared, and the drift guard deliberately leaves them alone), every
 * control here passes a brand override through `className`. `cn()` is
 * tailwind-merge, so the later utility wins for the same property.
 *
 * The one place that is not solvable with a class is the calendar's selected
 * day, which is painted by a nested `<Button variant="ghost">` inside the
 * primitive. `BrandDayButton` below replaces that component outright.
 *
 * LAYOUT CONTRACT — every control renders a self-contained block whose first
 * child is the label and whose last child is the error. That is what lets
 * `FieldGrid` pair two of them side by side: the cells are top-aligned, so an
 * error appearing under one field grows the row without nudging its partner's
 * input off the shared baseline. Every control therefore takes a `className`,
 * because the grid cell — not the control — decides how wide it is.
 */

export const FIELD_INPUT_CLASS =
  "h-11 rounded-md border-brand-border bg-white text-sm text-brand-text shadow-none " +
  "placeholder:text-brand-placeholder selection:bg-brand-forest selection:text-white " +
  "focus-visible:border-brand-forest focus-visible:ring-brand-forest/25";

/*
  `data-[size=default]:h-11` is NOT redundant with the `h-11` beside it. The
  shadcn SelectTrigger ships `data-[size=default]:h-9`, an attribute selector
  that out-specifies a plain utility, and tailwind-merge cannot dedupe across
  two different variants — so without this the time and location pickers render
  36px tall next to 44px date fields, and miss the touch-target floor.
*/
export const FIELD_TRIGGER_CLASS =
  "h-11 w-full rounded-md border-brand-border bg-white text-sm text-brand-text shadow-none " +
  "data-[size=default]:h-11 data-[placeholder]:text-brand-placeholder " +
  "focus-visible:border-brand-forest focus-visible:ring-brand-forest/25";

export const SELECT_ITEM_CLASS =
  "text-sm text-brand-text focus:bg-brand-stone focus:text-brand-text";

/*
  The box stays 18px — that is the design — but `before:` gives it a 44px
  invisible hit area so a thumb does not have to be accurate. (The label is
  `htmlFor`-bound and toggles it too; this is the belt to that pair of braces.)

  The inset is 14px, not 13px, because an absolutely-positioned pseudo-element
  resolves its insets against the PADDING box, not the border box. The 1px
  border makes that padding box 16px, so `-inset-[13px]` measured 42px in
  Chrome — 2px under the floor. 16 + 2x14 = 44. Verified by hit-testing, and
  the two consent rows sit 55px apart centre-to-centre, so the widened areas
  still cannot overlap and steal each other's taps.
*/
export const CHECKBOX_CLASS =
  "relative size-[18px] rounded-[5px] border-brand-border shadow-none " +
  "before:absolute before:-inset-[14px] before:content-[''] " +
  "data-[state=checked]:border-brand-forest data-[state=checked]:bg-brand-forest data-[state=checked]:text-white " +
  "focus-visible:border-brand-forest focus-visible:ring-brand-forest/25";

/**
 * Make a field occupy the whole `FieldGrid` row.
 *
 * For anything that genuinely needs the width — an address, a consent
 * sentence, a note — rather than as a way out of pairing.
 */
export const FIELD_FULL_WIDTH = "sm:col-span-2";

/* ────────────────────────────── layout ───────────────────────────────── */

/**
 * One titled block of the form.
 *
 * The padding is deliberately tighter than a marketing card's: six of these
 * stack up, and every extra 8px of section chrome costs ~50px of page. The
 * heading is a real `<h2>` — the vehicle name in the rail is the page's `<h1>`.
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
    <section
      className={cn(
        "border-b border-brand-border-soft px-4 py-3 last:border-b-0 sm:px-5 sm:py-4",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-brand-text-subtle">
          {title}
        </h2>
        {action}
      </div>
      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-brand-text-soft">
          {description}
        </p>
      ) : null}
      <div className="mt-2.5 space-y-3">{children}</div>
    </section>
  );
}

/**
 * The two-up field grid.
 *
 * `items-start` is the load-bearing utility. Without it the cells stretch to the
 * tallest in the row, and a validation message under one field drags its
 * partner's input downward; with it both inputs stay on the same line and only
 * the row below moves.
 */
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
        "grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2",
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
    <p role="alert" className="text-xs leading-snug text-danger">
      {message}
    </p>
  );
}

/* ────────────────────── required / optional markers ──────────────────── */

/**
 * The asterisk on a required field's label.
 *
 * DELIBERATELY DECORATIVE. It is `aria-hidden`, and the requirement itself is
 * carried on the control as `aria-required` — so a screen reader announces
 * "required" rather than reading out a star, and the meaning survives even
 * where the glyph cannot be seen. The asterisk is only the sighted half of
 * that fact, and `RequiredLegend` is what tells a sighted reader what it
 * means: an asterisk with no key is the classic form-accessibility complaint.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="font-normal text-danger">
      *
    </span>
  );
}

/**
 * The key for the asterisk. Rendered ONCE, at the top of the form.
 *
 * Its own asterisk is NOT hidden — this is the one place the glyph is the
 * subject rather than a marker, so it has to reach a screen reader too.
 */
export function RequiredLegend({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "border-b border-brand-border-soft px-4 py-2.5 text-xs leading-relaxed text-brand-text-subtle sm:px-5",
        className,
      )}
    >
      <span className="text-danger">*</span> indicates a required field —
      everything else is optional.
    </p>
  );
}

/**
 * "Optional" beside a section heading, for a whole block nothing depends on.
 *
 * Cheaper than tagging every control inside it: three "(optional)" markers in
 * one short section read as noise, whereas one word against the heading reads
 * as a fact. It goes in `FormSection`'s existing `action` slot, so it shares
 * the heading's line and costs no extra row.
 */
export function OptionalTag() {
  return (
    <span className="shrink-0 text-[11px] leading-4 text-brand-text-subtle">
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
  /**
   * Draws the asterisk. The CALLER must also put `aria-required` on the
   * control — this prop paints, it does not announce.
   */
  required?: boolean;
  optional?: boolean;
}) {
  /*
    `gap-1` overrides the shadcn Label's `gap-2`. A marker belongs to the word
    in front of it; 8px of air reads as a second, unrelated item.
  */
  return (
    <Label
      htmlFor={htmlFor}
      className="gap-1 text-xs font-medium text-brand-text-soft"
    >
      {children}
      {required ? <RequiredMark /> : null}
      {optional ? (
        <span className="font-normal text-brand-text-subtle">(optional)</span>
      ) : null}
    </Label>
  );
}

/** A quiet one-liner under a field — the age rule, a fee caveat, a duration. */
export function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-brand-text-subtle">{children}</p>
  );
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

/**
 * A native `<input type="date">`.
 *
 * Distinct from `DateField` on purpose: a date of birth is typed, not browsed —
 * nobody wants to page a calendar back forty years — and it has no disabled
 * days to express.
 */
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
 * The calendar's day button, rebuilt on the brand palette.
 *
 * The primitive's version paints the selected day with the generic indigo
 * token, which appears nowhere else on this site. Overriding that from a
 * `className` is a specificity fight; replacing the component is not.
 */
function BrandDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  return (
    <Button
      variant="brand-ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      className={cn(
        "flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-md font-normal leading-none text-brand-text",
        modifiers.today && !modifiers.selected && "ring-1 ring-brand-border",
        modifiers.selected &&
          "bg-brand-forest text-white hover:bg-brand-forest hover:text-white hover:opacity-90",
        modifiers.disabled && "text-brand-text-subtle line-through opacity-40",
        modifiers.outside && "text-brand-text-subtle",
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
  /**
   * Draws the asterisk and sets `aria-required`.
   *
   * The control here is the popover TRIGGER — a `<button>`, not a text input —
   * so the marker rides the same two signals as every other field: the visible
   * asterisk sits in the bound `<label>` (which supplies the name), and
   * `aria-required` sits on the thing that is focused.
   */
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = isIsoDate(value) ? parseDateOnly(value) : undefined;
  const defaultMonth =
    selected ??
    (defaultMonthIso && isIsoDate(defaultMonthIso)
      ? parseDateOnly(defaultMonthIso)
      : undefined);

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
              "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-brand-border bg-white px-3 text-left text-sm transition-colors",
              "hover:border-brand-text-subtle focus-visible:border-brand-forest focus-visible:ring-[3px] focus-visible:ring-brand-forest/25 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-danger",
              selected ? "text-brand-text" : "text-brand-placeholder",
            )}
          >
            <span className="truncate">
              {selected ? formatIsoDateLabel(value) : placeholder}
            </span>
            <CalendarDays
              className="size-4 shrink-0 text-brand-text-subtle"
              strokeWidth={1.75}
            />
          </button>
        </PopoverTrigger>
        {/*
          `w-auto` plus a max-width: the calendar is ~280px wide, which fits a
          360px phone, but the popover must never be allowed to outgrow the
          viewport and push the page sideways.
        */}
        <PopoverContent
          align="start"
          collisionPadding={12}
          className="w-auto max-w-[calc(100vw-1.5rem)] rounded-[14px] border-brand-border-soft bg-white p-2"
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={defaultMonth}
            disabled={isDisabledDate}
            buttonVariant="brand-ghost"
            classNames={{
              today: "rounded-md",
              weekday: "flex-1 text-[0.75rem] font-normal text-brand-text-subtle",
              caption_label: "text-sm font-medium text-brand-text",
            }}
            components={{ DayButton: BrandDayButton }}
            onSelect={(date) => {
              if (!date) return;
              // Format from the local Y/M/D, never `toISOString()` — that is UTC
              // and shifts the chosen day back for anyone west of Greenwich.
              const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              onChange(iso);
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
          className={cn(FIELD_TRIGGER_CLASS, error && "border-danger")}
        >
          <SelectValue placeholder="Select a time" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
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
      {/*
        `py-1 -my-1` widens the row's hit area to a comfortable touch target
        without adding any visible height to the stack.
      */}
      <div className="flex items-start gap-2.5 py-1 -my-1">
        <Checkbox
          id={id}
          checked={checked}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          onCheckedChange={(state) => onChange(state === true)}
          className={cn("mt-0.5", CHECKBOX_CLASS, error && "border-danger")}
        />
        {/*
          `block`, not the primitive's `flex`: the shadcn Label is a flex row, so
          a label made of a bold <span> plus trailing prose lays those out as two
          columns instead of one sentence.
        */}
        <Label
          htmlFor={id}
          className="block text-xs font-normal leading-relaxed text-brand-text-soft"
        >
          {children}
          {/*
            The marker TRAILS the sentence here rather than hugging a heading,
            because a consent row's label is the sentence. The space is
            explicit: this Label is `block`, so its children lay out inline and
            JSX would otherwise butt the asterisk against the full stop.
          */}
          {required ? (
            <>
              {" "}
              <RequiredMark />
            </>
          ) : null}
          {optional ? (
            <span className="text-brand-text-subtle"> (optional)</span>
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

  /*
    At zero there is nothing to remove and nothing to count, so the control
    collapses to one button. That is not only tidier: it hands ~70px back to the
    extra's name on a 360px phone, which is the difference between "Roadside
    Assistance" and "Roadside …", and it takes a row off the tile.
  */
  if (value <= 0) {
    return (
      <Button
        type="button"
        variant="brand-outline"
        size="icon-sm"
        aria-label={`Add one ${label}`}
        disabled={!canAdd}
        onClick={() => onChange(1)}
        className="size-11 shrink-0 lg:size-9"
      >
        <Plus strokeWidth={2} />
      </Button>
    );
  }

  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-brand-border bg-white p-0.5">
      {/*
        44px buttons on touch, 32px once there is a pointer. The `size-*`
        override lands after cva's `icon-sm`, and tailwind-merge keeps the last
        rule for the property, so the size really does change at the breakpoint.
      */}
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
        className="min-w-6 text-center text-sm font-medium tabular-nums text-brand-text"
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
 * One option in the pickup/return chooser.
 *
 * A real `<button role="radio">` rather than a styled div: the whole card is the
 * hit target, and keyboard users get the control they expect.
 *
 * It carries NO nested fields. An earlier version tucked the address input and
 * the location select inside the selected card, which made the chooser a tall
 * stack whose height jumped as you switched between options. The detail now
 * lives in the field grid below, so the three options are a single short row
 * and the field that follows lands in the same place whichever you pick.
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
        "flex h-full w-full items-start gap-2.5 rounded-[14px] border bg-white p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25",
        selected
          ? "border-brand-forest ring-1 ring-brand-forest/20"
          : "border-brand-border-soft hover:border-brand-text-subtle",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
          selected ? "border-brand-forest" : "border-brand-border",
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-brand-forest" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-brand-text">{title}</span>
          {badge}
        </span>
        {description ? (
          <span className="mt-1 block text-xs leading-relaxed text-brand-text-soft">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** A small text pill — "FREE", "+$45", "per day". Never the indigo `Badge`. */
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
        tone === "positive" && "bg-success-light text-success",
        tone === "notice" && "bg-brand-pale-yellow text-brand-text",
        tone === "neutral" && "bg-brand-stone text-brand-text-soft",
      )}
    >
      {children}
    </span>
  );
}
