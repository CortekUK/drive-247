"use client";

/**
 * The vehicle screen's own vocabulary.
 *
 * Ported from the design sandbox at `app/playground/vehicle-detail-fake`, which
 * is where this screen was argued out against fake data. The playground keeps
 * its copies; this file is the production one, and the two are deliberately
 * separate — the sandbox is free to keep moving without touching a screen that
 * 32 operators' data flows through.
 *
 * The grammar is northwind's, not an invention. It comes from
 * `components/ui-v2/*` and `components/dashboard-v2/*`, which is what the
 * canary actually renders, and it is specific enough to get subtly wrong:
 *
 *   surfaces   rounded-4xl wearing `ring-1 ring-foreground/5` + `shadow-md` —
 *              a RING and a shadow, never `border border-border`, never flat
 *   controls   inputs rounded-3xl on `bg-input/50` with a transparent border
 *   type       `font-heading` (Manrope) on titles
 *   icons      `size-N`, not `h-N w-N`
 *
 * `border border-border` + `rounded-xl` + no shadow is the v1 portal's design
 * system. It reads as a tidy, plausible app and looks nothing like the canary.
 */

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import {
  formatCurrency,
  getCurrencySymbol,
  getDistanceUnitShort,
  type DistanceUnit,
} from "@/lib/format-utils";

/* ══════════════════════════════════════════════════════════════════════════
 * Formatting — tenant-aware, and read from context rather than drilled
 *
 * Currency and distance unit are per-tenant (`tenants.currency_code`,
 * `tenants.distance_unit`). Nine tab files each taking two props to render a
 * number is nine chances to forget one and hardcode a dollar sign, so they
 * come from one provider mounted by the shell.
 * ═════════════════════════════════════════════════════════════════════════ */

type Fmt = {
  /** Whole units. Rates and totals are never shown to the cent here. */
  money: (n: number | null | undefined) => string;
  /** Cents-significant — an excess rate of $0.35 is not $0. */
  moneyExact: (n: number | null | undefined) => string;
  /** `12,340 mi` / `12,340 km`, in the tenant's unit. */
  dist: (n: number | null | undefined) => string;
  distUnit: string;
  currencySymbol: string;
};

const FmtContext = createContext<Fmt | null>(null);

export function FormatProvider({
  currencyCode,
  distanceUnit,
  children,
}: {
  currencyCode: string;
  distanceUnit: DistanceUnit;
  children: React.ReactNode;
}) {
  const unit = getDistanceUnitShort(distanceUnit);
  const value: Fmt = {
    // BOTH bounds, not just the max. `formatCurrency` defaults
    // `minimumFractionDigits` to 2, so passing max=0 alone makes min > max,
    // which is a RangeError inside Intl — and that helper swallows it and
    // returns its `USD 421.00` fallback. Every whole-dollar figure on the
    // screen printed as an ISO code with cents.
    money: (n) =>
      formatCurrency(Number(n) || 0, currencyCode, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    moneyExact: (n) => formatCurrency(Number(n) || 0, currencyCode),
    dist: (n) => `${(Number(n) || 0).toLocaleString("en-US")} ${unit}`,
    distUnit: unit,
    currencySymbol: getCurrencySymbol(currencyCode),
  };
  return <FmtContext.Provider value={value}>{children}</FmtContext.Provider>;
}

/** Falls back to plain USD/miles rather than throwing, so a stray subtree renders. */
export function useFmt(): Fmt {
  return (
    useContext(FmtContext) ?? {
      money: (n) =>
        formatCurrency(Number(n) || 0, "USD", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }),
      moneyExact: (n) => formatCurrency(Number(n) || 0, "USD"),
      dist: (n) => `${(Number(n) || 0).toLocaleString("en-US")} mi`,
      distUnit: "mi",
      currencySymbol: "$",
    }
  );
}

/* ── dates ──────────────────────────────────────────────────────────────── */

/**
 * A bare `YYYY-MM-DD` from Postgres, rendered without a timezone shift.
 *
 * `new Date('2026-09-04')` is parsed as UTC midnight and then printed in local
 * time, which moves the date back a day for anyone west of Greenwich — the
 * whole US customer base. Appending the time forces local parsing.
 */
export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * The year is shown only when it is not this one.
 *
 * The activity rail runs back years, and "27 Aug" three rows under "15 Feb"
 * reads as a list that has lost its order rather than one that has crossed a
 * new year — while putting 2026 on every row from the last fortnight is noise
 * on the rows people actually read.
 */
export const fmtDateTime = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

/** Today as `YYYY-MM-DD` in the browser's own timezone, never UTC. */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Signed whole days from today. Negative is in the past. */
export const daysUntil = (iso: string | null | undefined) => {
  if (!iso) return 0;
  const target = new Date(`${String(iso).slice(0, 10)}T00:00:00`).getTime();
  const now = new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round((target - now) / 86_400_000);
};

export const daysBetween = (from: string | null | undefined, to: string | null | undefined) => {
  if (!from || !to) return 0;
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${String(to).slice(0, 10)}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

/**
 * Tolerant parse. An operator mid-keystroke — "0.", "$12", "" — is not an
 * error, so anything unparseable reads as 0 rather than NaN, which would
 * propagate into every total on the screen as "NaN".
 */
export const num = (v: string | number | null | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/* ══════════════════════════════════════════════════════════════════════════
 * Surfaces
 * ═════════════════════════════════════════════════════════════════════════ */

export const cardCls =
  "rounded-4xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";

export const inputCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export const textareaCls =
  "flex min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-3 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A tab's frame: fixed head, scrolling body.
 *
 * The screen is a fixed frame — nothing scrolls the page itself. Each column is
 * its own viewport-height column and only the CONTENT inside one moves, so the
 * tab's title stays put while the list under it runs.
 */
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-medium tracking-tight">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>

      {/* `min-h-0` is load-bearing: without it a flex child refuses to shrink
          below its content and the column grows the page instead of scrolling. */}
      <div className="mt-7 min-h-0 flex-1 space-y-6 overflow-y-auto pb-8 pr-1">{children}</div>
    </div>
  );
}

export function Surface({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(cardCls, "p-6", className)}>{children}</div>;
}

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
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
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

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-4xl bg-muted/40 px-6 py-8 text-center ring-1 ring-foreground/5">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The strip under a `Section` title when something needs saying but is not the
 * tab's headline. Quieter than a banner on purpose.
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

/** The one loud surface on the screen. Amber, never red. */
export function WarningBanner({
  title,
  children,
  icon = true,
}: {
  title: string;
  children?: React.ReactNode;
  icon?: boolean;
}) {
  return (
    <div className="rounded-4xl bg-warning-light/70 p-6 shadow-md ring-1 ring-warning/30">
      <div className="flex items-start gap-3">
        {icon && <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />}
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold">{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Controls
 *
 * Everything here writes THROUGH — there is no Save button on this screen. A
 * form that asks you to confirm you meant it is a form that does not trust its
 * own record. What that costs is one request per keystroke, so the text inputs
 * below own their string locally and publish it upward on a timer; see
 * `use-vehicle-record.ts`, which does the coalescing.
 * ═════════════════════════════════════════════════════════════════════════ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-2 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Text/number/date input with an optional unit affix. */
export function AffixInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  type = "text",
  className,
  disabled,
  onBlur,
}: {
  value: string | number;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  type?: "text" | "number" | "date";
  className?: string;
  disabled?: boolean;
  onBlur?: () => void;
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
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
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
 * A text input that owns the string it is shown while it has focus.
 *
 * Round-tripping every keystroke through the record and back would fight the
 * cursor: an async write that lands mid-word re-renders with the older server
 * value and the caret jumps. So the raw string is local, the record is written
 * on a timer, and the local copy is only re-seeded from the record when this
 * input is NOT the one being typed in — which is what lets an edit made
 * elsewhere (or a failed write rolling back) still show up here.
 */
export function TextInput({
  value,
  onChange,
  ...rest
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  type?: "text" | "date";
  className?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(value ?? "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setRaw(value ?? "");
  }, [value]);

  return (
    <span
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setRaw(value ?? "");
      }}
    >
      <AffixInput
        {...rest}
        value={raw}
        onChange={(v) => {
          setRaw(v);
          onChange(v);
        }}
      />
    </span>
  );
}

/**
 * Numeric input that owns the raw string it is shown.
 *
 * Parsing every keystroke eats the half-typed states: "0." parses to 0,
 * re-renders as "0", and a decimal rate becomes impossible to type. So the
 * string is local and only the parsed value is published upward.
 */
export function NumberInput({
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState(value == null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setRaw(value == null ? "" : String(value));
  }, [value]);

  return (
    <span
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setRaw(value == null ? "" : String(value));
      }}
    >
      <AffixInput
        value={raw}
        prefix={prefix}
        suffix={suffix}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(v) => {
          setRaw(v);
          onChange(num(v));
        }}
      />
    </span>
  );
}

/** Native select in the input grammar — `appearance-none` plus our own chevron. */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[] | readonly string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "cursor-pointer appearance-none pr-9")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
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

/** A compact on/off row for a `List` — a boolean that is one fact among many. */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-foreground/[0.02] disabled:cursor-not-allowed disabled:opacity-60"
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
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone?: "muted" | "primary" | "destructive";
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
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

/** One action button call-site shape for the whole screen. */
export function ActionButton({
  children,
  onClick,
  variant = "primary",
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "outline";
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={variant === "primary" ? "default" : "outline"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

/** A selectable tile — pickup locations, handover methods. */
export function OptionCard({
  selected,
  onClick,
  title,
  subtitle,
  right,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-4xl px-5 py-4 text-left transition-all",
        selected
          ? "bg-primary-light ring-2 ring-primary/40"
          : "bg-card shadow-md ring-1 ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {right}
      {selected && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary">
          <Check className="size-3 text-primary-foreground" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Badges
 * ═════════════════════════════════════════════════════════════════════════ */

export type Tone = "neutral" | "primary" | "success" | "warning";

/** Inside a card. Solid, low-contrast. */
export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
  } as const;
  return <Badge className={cn("gap-1.5", tones[tone])}>{children}</Badge>;
}

/**
 * The page-hero chip, copied from `dashboard-v2/dashboard-v2.tsx`.
 *
 * Deliberately NOT the ui-v2 `Badge`: northwind's hero uses a bordered
 * `rounded-full` chip with a 1.5 dot at 11px — a lighter thing than the solid
 * badges used inside cards. A Badge up here reads as a card component that
 * escaped onto the page title.
 */
export function HeroChip({
  tone = "muted",
  dot = true,
  children,
}: {
  tone?: "muted" | "success" | "warning" | "primary";
  dot?: boolean;
  children: React.ReactNode;
}) {
  const tones = {
    muted: { chip: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground/40" },
    success: { chip: "border-success/30 bg-success/10 text-success", dot: "bg-success" },
    warning: { chip: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning" },
    primary: { chip: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary" },
  } as const;
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        t.chip,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * The left rail
 *
 * `shared/layout/app-sidebar-v2.tsx` already solves this exact problem for
 * Settings: a sidebar scoped to one area, with a Back link in its header, a
 * title under it, and grouped nav below. Its measurements are copied here
 * rather than approximated, because "sidebar-ish" is what makes a screen read
 * as not-quite-the-app.
 * ═════════════════════════════════════════════════════════════════════════ */

export function RailHeader({
  backHref,
  backLabel = "Back",
  title,
  subtitle,
}: {
  backHref: string;
  backLabel?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <>
      <div className="flex h-11 items-center px-2">
        <Link
          href={backHref}
          className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="text-[13px]">{backLabel}</span>
        </Link>
      </div>
      <div className="px-4 pb-1 pt-1">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
    </>
  );
}

export function RailGroup({
  label,
  first,
  children,
}: {
  label: string;
  /** The first group skips the divider that separates it from the one above. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="p-1.5 pb-0">
      {!first && <div className="mx-2.5 mb-1.5 border-t" />}
      <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * A plain rail row. Icon, label, active state. Nothing else.
 *
 * It reads no record state on purpose. Hanging a live summary and a colour off
 * every row turns the sidebar into a second readout, and that has two costs:
 * the eye is pulled left every time anything is typed in the middle, and the
 * rail stops being navigable by shape — you can no longer find "Compliance" by
 * where it sits, because everything around it keeps changing height and colour.
 *
 * Navigation is a fixed thing you learn once. The state of the record belongs
 * in the right rail, which exists to be read.
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
