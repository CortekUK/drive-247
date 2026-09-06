"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — the design vocabulary.
 *
 * This is the playground's grammar made production. It deliberately does NOT
 * import from `app/playground/*`: that tree is a sandbox three sessions edit at
 * once, it renders against hardcoded fixtures, and a production screen that
 * imports from it inherits every experiment anybody tries there. The pieces
 * below were ported rather than referenced.
 *
 * The grammar is northwind's, taken from `components/ui-v2/*` — specific, and
 * easy to get subtly wrong:
 *
 *   surfaces   rounded-4xl, `ring-1 ring-foreground/5` + `shadow-md` — a RING
 *              and a shadow, never `border border-border`, never flat
 *   nested     one step down the radius ramp, on `bg-muted/40`, hairline ring
 *   controls   inputs rounded-3xl on `bg-input/50`; buttons via ui-v2/button
 *   type       `font-heading` (Manrope) on titles
 *   icons      `size-N`, not `h-N w-N`
 *
 * COLOUR MEANS SOMETHING HERE. Amber is reserved for exactly one thing: an
 * output that is behind the inputs it was produced from. It is an ordinary
 * Tuesday, never an error. Anything destructive is red and never amber.
 * ────────────────────────────────────────────────────────────────────────── */

import { AlertTriangle, Check, ChevronRight, ImageIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";
import type { TabId } from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Dates
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Today, as a local `YYYY-MM-DD`.
 *
 * Local, not UTC: the server renders in UTC and the operator's browser does
 * not, so a UTC "today" makes every relative label wrong for anybody west of
 * Greenwich after early evening. This screen never renders its record on the
 * server — React Query has no data there, so the SSR pass is the skeleton — but
 * the helper is written to be right either way rather than to depend on that.
 */
export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A date-only column (`YYYY-MM-DD`) or a timestamptz, rendered short. */
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

/** Trims a timestamptz down to the date column shape the record edits in. */
export const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/**
 * Whole days from today until `iso`. Negative once past.
 *
 * Both ends are parsed at local midnight so the subtraction is a whole number
 * of days and cannot land on a 23- or 25-hour DST boundary.
 */
export const daysUntil = (iso: string | null | undefined) => {
  if (!iso) return null;
  const from = new Date(`${todayISO()}T00:00:00`).getTime();
  const to = new Date(`${dateOnly(iso)}T00:00:00`).getTime();
  if (Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
};

export const dayCount = (a: string | null, b: string | null) => {
  if (!a || !b) return 0;
  return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
};

export type Expiry = { state: "none" | "valid" | "soon" | "expired"; label: string; days: number | null };

/**
 * How an expiry date reads, in one place.
 *
 * "Soon" is 30 days, roughly how long it takes a customer to get a replacement
 * document back — so it is the point at which chasing them is still useful
 * rather than merely alarming.
 */
export const expiryOf = (iso: string | null | undefined): Expiry => {
  const d = daysUntil(iso);
  if (d === null) return { state: "none", label: "No expiry", days: null };
  if (d < 0) return { state: "expired", label: `Expired ${Math.abs(d)}d ago`, days: d };
  if (d <= 30) return { state: "soon", label: `Expires in ${d}d`, days: d };
  return { state: "valid", label: "In date", days: d };
};

/**
 * The customer's address as one line, in US postal order: `street, city, ST ZIP`.
 *
 * There is exactly one of these on purpose. The verification drift check
 * compares the address the provider read off the licence against the address on
 * the record, so the two have to be assembled the same way — a naive
 * `[street, city, state, zip].join(', ')` yields "FL, 32204" where the document
 * says "FL 32204", and the screen then opens claiming a change nobody made.
 * A false amber is worse than no amber: it teaches the operator to ignore it.
 */
export const addressOf = (a: { street: string; city: string; state: string; zip: string }) => {
  const region = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street, a.city, region].filter(Boolean).join(", ");
};

/* ══════════════════════════════════════════════════════════════════════════
   Surfaces
   ══════════════════════════════════════════════════════════════════════════ */

/** Mirrors `components/ui-v2/card.tsx`, as a class string. */
export const cardCls =
  "rounded-4xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";

/**
 * A list sitting INSIDE a card: one step down the radius ramp, a hairline ring
 * instead of a shadow, and a muted ground so it reads as inset rather than as a
 * second card floating on the first.
 */
export const listCls =
  "overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5 divide-y divide-foreground/5";

export const inputCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export const textareaCls =
  "flex min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-3 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60";

export function Surface({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(cardCls, "p-6", className)}>{children}</div>;
}

export function Section({
  title,
  description,
  right,
  children,
  className,
}: {
  title?: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Surface className={className}>
      {(title || right) && (
        <div className="mb-5 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {title && <h3 className="font-heading text-sm font-semibold">{title}</h3>}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </Surface>
  );
}

/**
 * A block that takes something away — blocking, deleting, rejecting.
 *
 * Given its own surface rather than a red button dropped into an ordinary card,
 * so that the moment the reader's eye lands on it they already know what kind
 * of thing lives here.
 */
export function DangerSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-4xl bg-destructive/[0.04] p-6 ring-1 ring-destructive/15">
      <h3 className="font-heading text-sm font-semibold text-destructive">{title}</h3>
      {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

/**
 * A panel: fixed head, scrolling body.
 *
 * The screen is a fixed frame — nothing scrolls the page itself. Each column is
 * its own viewport-height column and only the CONTENT inside one moves, so a
 * title never scrolls out of view to reach a row below it.
 */
export function Panel({
  title,
  description,
  right,
  children,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="flex shrink-0 items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-2xl font-medium tracking-tight">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {right && <div className="shrink-0 pt-1">{right}</div>}
      </div>

      {/* `min-h-0` is load-bearing: without it a flex child refuses to shrink
          below its content and the column grows the page instead of scrolling. */}
      <div className="mt-7 min-h-0 flex-1 space-y-6 overflow-y-auto pb-8 pr-1">{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Controls
   ══════════════════════════════════════════════════════════════════════════ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  tone = "primary",
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  /** `destructive` is for switches that take something away from the customer. */
  tone?: "primary" | "destructive";
  disabled?: boolean;
}) {
  const on = tone === "destructive" ? "bg-destructive/10 ring-destructive/25" : "bg-primary-light ring-primary/30";
  const knob = tone === "destructive" ? "bg-destructive" : "bg-primary";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-4 rounded-3xl px-5 py-4 text-left ring-1 transition-all",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        checked ? on : "bg-muted/40 ring-foreground/5 hover:bg-muted/60"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? knob : "bg-foreground/15")}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full transition-all",
            checked ? "left-[22px] bg-primary-foreground" : "left-0.5 bg-card"
          )}
        />
      </span>
    </button>
  );
}

/**
 * Two or three mutually exclusive views of the same panel.
 *
 * Deliberately not the ui-v2 `Tabs`: this sits INSIDE a panel that already has
 * a title, and a full tab strip there reads as a second page rather than as a
 * lens on the one you are on.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  /**
   * `NoInfer` on everything except `value` is deliberate. Left to itself
   * TypeScript infers T from all three properties at once: the options array's
   * string literals widen to `string`, and a `Dispatch<SetStateAction<…>>`
   * handed to `onChange` contributes `SetStateAction<…>` from a contravariant
   * position. The candidates disagree, T silently falls back to its `string`
   * constraint, and passing a `useState` setter becomes a type error with no
   * visible cause. Pinning T to `value` alone is what makes the obvious call
   * site compile.
   */
  onChange: (v: NoInfer<T>) => void;
  options: { value: NoInfer<T>; label: string; badge?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-3xl bg-muted/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-3xl px-3.5 py-1.5 text-[13px] font-medium transition-all",
            value === o.value
              ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/5"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
          {o.badge}
        </button>
      ))}
    </div>
  );
}

/** A selectable tile — account holder type, account status, blocklist key. */
export function OptionCard({
  selected,
  onClick,
  title,
  subtitle,
  right,
  meta,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-4xl px-5 py-4 text-left transition-all",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        selected
          ? "bg-primary-light ring-2 ring-primary/40"
          : "bg-card shadow-md ring-1 ring-foreground/5 hover:ring-primary/30 dark:ring-foreground/10"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-sm font-medium">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>}
        {meta}
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
   Read-only display
   ══════════════════════════════════════════════════════════════════════════ */

/** A label/value line. `mono` for references and licence numbers. */
export function Row({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: "muted" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-[13px] font-medium",
          mono && "font-mono text-xs",
          tone === "muted" && "font-normal text-muted-foreground",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "destructive";
}) {
  const tones = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  } as const;
  return (
    <div className={cn(cardCls, "px-5 py-4")}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-heading text-lg font-semibold tracking-tight tabular-nums", tone && tones[tone])}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium">{value}</p>
    </div>
  );
}

/** Thin wrapper on ui-v2's Badge so the four tones map to one place. */
export function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "primary" | "success" | "warning" | "destructive";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
    destructive: "bg-destructive/10 text-destructive",
  } as const;
  return <Badge className={cn("gap-1.5", tones[tone])}>{children}</Badge>;
}

/** A left-bordered timeline of what has happened to an output so far. */
export function Timeline({ steps }: { steps: { label: string; at?: string; done: boolean }[] }) {
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-foreground/10 pl-6">
      {steps.map((s, i) => (
        <li key={`${s.label}-${i}`} className="relative">
          <span
            className={cn(
              "absolute -left-[30px] top-1 size-2.5 rounded-full border-2",
              s.done ? "border-success bg-success" : "border-foreground/20 bg-background"
            )}
          />
          <p className={cn("text-sm", s.done ? "font-medium" : "text-muted-foreground")}>{s.label}</p>
          {s.at && <p className="text-xs text-muted-foreground">{s.at}</p>}
        </li>
      ))}
    </ol>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-4xl bg-muted/40 px-6 py-8 text-center ring-1 ring-foreground/5">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** A stand-in for an image that is missing, or that we hold no URL for. */
export function Thumb({
  className,
  filled,
  caption,
  src,
  onClick,
}: {
  className?: string;
  filled?: boolean;
  caption?: string;
  src?: string | null;
  onClick?: () => void;
}) {
  return (
    <div className="min-w-0">
      <div
        role={onClick ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-3xl bg-muted ring-1 ring-foreground/5",
          onClick && src && "cursor-pointer transition-opacity hover:opacity-80",
          className
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={caption || ""} className="size-full object-cover" />
        ) : (
          <ImageIcon className={cn("size-4", filled ? "text-muted-foreground" : "text-muted-foreground/40")} />
        )}
      </div>
      {caption && <p className="mt-2 truncate text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/**
 * Names the inputs an output was built from, and lets you walk straight to
 * them. Half the point of the rail's three bands is lost if the reader has to
 * guess which one feeds which.
 */
export function ProducedFrom({
  sources,
  onJump,
}: {
  sources: { key: TabId; label: string }[];
  onJump: (t: TabId) => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <Sparkles className="size-3.5" />
      Produced from
      {sources.map((s, i) => (
        <span key={s.key}>
          <button
            type="button"
            onClick={() => onJump(s.key)}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            {s.label}
          </button>
          {i < sources.length - 1 && <span className="text-muted-foreground"> and</span>}
        </span>
      ))}
    </p>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The out-of-date banner
   ══════════════════════════════════════════════════════════════════════════ */

export type Drift = { label: string; was: string; now: string };

/**
 * The heart of the whole idea: an output that was produced from terms which
 * have since moved says so itself, shows exactly what moved, and offers both
 * ways out — re-issue it, or accept that the old one still stands.
 */
export function OutOfDateBanner({
  title,
  meta,
  drift,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  secondaryDisabled,
}: {
  title: string;
  meta?: string;
  drift: Drift[];
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel: string;
  onSecondary: () => void;
  secondaryDisabled?: boolean;
}) {
  return (
    <div className="rounded-4xl bg-warning-light/70 p-6 shadow-md ring-1 ring-warning/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="font-heading text-sm font-semibold">{title}</p>
          {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}

          <div className="mt-4 divide-y divide-foreground/5 overflow-hidden rounded-3xl bg-card/80 ring-1 ring-foreground/5">
            {drift.map((d) => (
              <div key={d.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-3">
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">Was checked as</span>
                  <span className="block truncate font-medium line-through decoration-muted-foreground/50">
                    {d.was}
                  </span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 text-xs">
                  <span className="block text-muted-foreground">{d.label} now</span>
                  <span className="block truncate font-semibold text-foreground">{d.now}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={onPrimary} disabled={primaryDisabled}>
              {primaryLabel}
            </Button>
            <Button variant="outline" onClick={onSecondary} disabled={secondaryDisabled}>
              {secondaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
