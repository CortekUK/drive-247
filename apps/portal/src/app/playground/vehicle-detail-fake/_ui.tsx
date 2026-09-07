"use client";

/**
 * Local primitives for the vehicle screen.
 *
 * Anything shared with the other two sandbox screens lives in `_shared.tsx`;
 * this file is only what the vehicle tabs need between themselves. It exists so
 * the tab files can be split apart without each one re-declaring its own
 * slightly different card, input and switch — which is how three screens that
 * are meant to be one design end up looking like three.
 *
 * The grammar is northwind's, not an invention: `rounded-4xl` surfaces wearing
 * `ring-1 ring-foreground/5` + `shadow-md`, inputs `rounded-3xl` on `bg-input/50`
 * with a transparent border, `font-heading` on titles, `size-N` on icons. Never
 * `border border-border`, never flat — that is the v1 portal's design system and
 * it reads as a different product.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { cardCls, inputCls } from "@/app/playground/_shared";
import { num } from "./_data";

/* ── navigation ─────────────────────────────────────────────────────────── */

/**
 * A plain left-rail row. Icon, label, active state. Nothing else.
 *
 * Deliberately NOT `_shared`'s `RailItem`, which hangs a live one-line summary
 * and a colour state off every row. That turns the sidebar into a second
 * readout of the record, and it has two costs: the eye is pulled left every
 * time anything is typed in the middle, and the rail stops being navigable by
 * shape — you can no longer find "Compliance" by where it sits, because
 * everything around it keeps changing height and colour.
 *
 * Navigation is a fixed thing you learn once. The state of the record belongs
 * in the right rail, which exists to be read.
 *
 * The measurements are `shared/layout/app-sidebar-v2.tsx` verbatim — h-8 row,
 * `size-4` icon, 13px label, `gap-2.5`, `rounded-lg` — because "sidebar-ish"
 * is exactly what makes a screen read as not-quite-the-app.
 */
export function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-sidebar-foreground/70 hover:bg-primary/10 hover:text-primary",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} />
      <span className="truncate text-[13px]">{label}</span>
    </button>
  );
}

/* ── surfaces ───────────────────────────────────────────────────────────── */

export function Section({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(cardCls, "p-6", className)}>
      {(title || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && <h3 className="font-heading text-sm font-semibold tracking-tight">{title}</h3>}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/** The bordered list every record is reported back in. */
export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A key/value line inside a `List`. Reporting, not editing. */
export function DataRow({
  label,
  sub,
  right,
}: {
  label: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">{label}</p>
      <p className="mt-1.5 truncate font-heading text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StatDivider() {
  return <div className="w-px shrink-0 bg-foreground/10" />;
}

/* ── controls ───────────────────────────────────────────────────────────── */

/**
 * Text/number/date input with an optional unit affix, so `$` and `/mile` never
 * become part of the value the operator has to type around.
 */
export function AffixInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  type = "text",
  className,
}: {
  value: string | number;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  type?: "text" | "number" | "date";
  className?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, prefix && "pl-7", suffix && "pr-20", className)}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

/**
 * Numeric input that owns the raw string it is shown.
 *
 * Round-tripping every keystroke through `Number()` eats the half-typed states:
 * "0." parses to 0, re-renders as "0", and a decimal rate becomes impossible to
 * type. So the string is local and only the parsed value is published upward.
 * Switching tabs unmounts this, which re-seeds it from the record on the way
 * back — which is what keeps it from drifting away from what it is editing.
 */
export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(value ? String(value) : "");
  return (
    <AffixInput
      value={raw}
      prefix={prefix}
      suffix={suffix}
      placeholder={placeholder}
      onChange={(v) => {
        setRaw(v);
        onChange(num(v));
      }}
    />
  );
}

/** Native select in the input grammar — `appearance-none` plus our own chevron. */
export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "cursor-pointer appearance-none pr-9")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** Just the track and knob, for use inside another control. */
export function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-card transition-all",
          checked ? "left-[1.125rem]" : "left-0.5",
        )}
      />
    </span>
  );
}

/**
 * A compact on/off row for a `List` — used where a boolean is one fact among
 * many rather than a decision worth a whole card of its own.
 */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-foreground/[0.02]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} />
    </button>
  );
}

export function IconButton({
  onClick,
  title,
  children,
  tone = "muted",
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone?: "muted" | "primary" | "destructive";
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "shrink-0",
        tone === "primary" && "text-primary hover:bg-primary-light hover:text-primary",
        tone === "destructive" && "text-destructive hover:bg-destructive/10 hover:text-destructive",
        tone === "muted" && "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

/**
 * The strip that sits under a `Section` title when something on this tab is
 * feeding something amber elsewhere. Quieter than `OutOfDateBanner` on purpose:
 * this is a heads-up from a neighbouring tab, not the tab's own headline.
 */
export function Aside({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning" | "primary";
  children: React.ReactNode;
}) {
  const tones = {
    muted: "bg-muted/40 text-muted-foreground ring-foreground/5",
    warning: "bg-warning-light/60 text-foreground ring-warning/30",
    primary: "bg-primary-light/50 text-foreground ring-primary/20",
  } as const;
  return <div className={cn("rounded-3xl px-5 py-3.5 text-xs ring-1", tones[tone])}>{children}</div>;
}
