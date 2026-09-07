"use client";

/**
 * The rental control centre's component kit.
 *
 * A copy of `app/playground/_shared.tsx`, brought onto the real route. Copied
 * rather than imported, per V2_PLAN §3: the playground is a sandbox anyone may
 * break at any time, and a production screen that imports out of it inherits
 * every experiment. This file is now the only thing the real stages depend on,
 * and `app/playground/` stays free to move.
 *
 * The visual grammar is NOT invented: it is northwind's, taken from
 * `components/ui-v2/*` and `components/dashboard-v2/*`, which is what the canary
 * actually renders. That grammar is specific and easy to get subtly wrong:
 *
 *   surfaces   rounded-4xl, `ring-1 ring-foreground/5` + `shadow-md` — a RING
 *              and a shadow, never `border border-border`, and never flat
 *   spacing    1.5rem inside a card (`--card-spacing` in ui-v2/card)
 *   controls   inputs rounded-3xl on `bg-input/50` with a transparent border;
 *              buttons rounded-4xl via ui-v2/button; badges rounded-3xl, h-5
 *   type       `font-heading` (Manrope) on titles
 *   icons      `size-N`, not `h-N w-N`
 *
 * An earlier version of this file used `rounded-xl` + `border border-border` and
 * no shadows — the v1 portal's flat design system. It read as a tidy, plausible
 * app and looked nothing like the canary.
 *
 * ONE difference from the playground copy, and it is deliberate: the sandbox
 * pinned itself to light mode (`playground/_force-light.tsx`). The real route
 * follows the operator's own theme, so everything below is tokens only — no
 * literal light-mode colour reaches this file. `dark:ring-foreground/10` on the
 * card surface is the one place the two themes are told apart, and it is the
 * same pair `ui-v2/card` uses.
 */

import Link from "next/link";
import { Check, AlertTriangle, ChevronRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-v2/button";
import { Badge } from "@/components/ui-v2/badge";

/* ── formatting ─────────────────────────────────────────────────────────── */

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * A `date` column ("2026-09-04") as a short human date.
 *
 * The `T00:00:00` suffix is load-bearing: `new Date("2026-09-04")` is parsed as
 * UTC midnight and then printed in the operator's zone, which west of Greenwich
 * renders the day BEFORE. Every rental date in this app is a plain calendar
 * day, so it must be built as local midnight.
 */
export const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

export const fmtDateTime = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

/* ── surfaces ───────────────────────────────────────────────────────────── */

/**
 * The canary's card surface, as a class string so ad-hoc blocks can wear it
 * without importing the whole ui-v2 Card slot machinery.
 * Mirrors `components/ui-v2/card.tsx`.
 */
export const cardCls =
  "rounded-4xl bg-card text-card-foreground shadow-md ring-1 ring-foreground/5 dark:ring-foreground/10";

export const inputCls =
  "flex h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3.5 py-1 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export const textareaCls =
  "flex min-h-16 w-full resize-none rounded-2xl border border-transparent bg-input/50 px-3.5 py-3 text-sm outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

/* ── item state ─────────────────────────────────────────────────────────── */

/**
 * The four states any rail item can be in.
 *
 * `stale` is deliberately its own state and not a kind of error: a rental whose
 * terms moved after the agreement went out is an ordinary Tuesday, not a fault.
 * It is amber, never red.
 */
export type ItemState = "empty" | "progress" | "done" | "stale";

/* ── rail ───────────────────────────────────────────────────────────────── */

/*
 * The rail is northwind's SETTINGS sidebar, not an invention.
 *
 * `shared/layout/app-sidebar-v2.tsx` already solves exactly this problem: a
 * sidebar scoped to one area, with a Back link in an h-16 header, a title block
 * under it, and grouped nav below. Its measurements are copied here rather than
 * approximated, because "sidebar-ish" is what makes a screen read as not-quite-
 * the-app:
 *
 *   item      rounded-lg px-3 py-2, h-9, label 13px
 *   idle      text-sidebar-foreground/70, icon at /60
 *   active    bg-primary/10 + text-primary + font-medium  (NOT a lavender block)
 *   hover     bg-primary/10 + text-primary
 *   group     p-1.5, label 10px uppercase tracking-widest at /50
 *   divider   mx-2.5 border-t between groups
 */

/** Back link + title, mirroring `app-sidebar-v2`'s SidebarHeader. */
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
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
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

export function RailItem({
  icon: Icon,
  label,
  summary,
  state,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  summary?: string;
  state: ItemState;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2 text-left transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-sidebar-foreground/70 hover:bg-primary/10 hover:text-primary"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-sidebar-foreground/60")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight">{label}</span>
        {summary && (
          <span
            className={cn(
              "mt-0.5 block truncate text-[11px] leading-tight",
              state === "stale" ? "font-medium text-warning" : "text-muted-foreground"
            )}
          >
            {summary}
          </span>
        )}
      </span>
    </button>
  );
}

/* ── stages ─────────────────────────────────────────────────────────────── */

/**
 * How strongly a filled stage is tinted, by its position in the rail.
 *
 * The ramp is the point: the rental is read top-down, so the first decision
 * carries the most accent and each one after it a little less. That gives the
 * rail a shape you can see from across a desk — how far into the rental you
 * are — without a progress bar, a tick or a percentage.
 *
 * Written as alphas rather than Tailwind classes because `bg-primary/${n}` is
 * composed at build time; a computed class name never reaches the stylesheet.
 * Extra stages beyond the ramp settle at its last, faintest step.
 */
const STAGE_TINT = [0.2, 0.15, 0.11, 0.08, 0.06, 0.05];

const tintFor = (i: number) => STAGE_TINT[Math.min(i, STAGE_TINT.length - 1)];

/**
 * A stage in the left rail.
 *
 * Not a nav label — a record of a decision. Before the rental carries an answer
 * it asks its question ("Who is renting?") on a flat grey ground. Once it has
 * one, the question is replaced by the answer and the block takes its share of
 * the accent. The grey is permanent, not a hover state: an unanswered stage is
 * a real state and it should be visible without touching anything.
 *
 * `value` carries ONLY what belongs to THIS rental. Not the customer's rating,
 * not the vehicle's daily rate — those describe the entity, they live in the
 * main panel, and in 280px they crowd out the one thing the rail is for. No
 * tick either: a stage that carries an answer is already evidence it is done.
 *
 * Rendered as an `<a>` rather than a `<button>` on the real route, because the
 * stage lives in the URL (`?stage=…`) — see `stages.ts`. Middle-click and
 * "open in new tab" therefore work, and the rail needs no shared state with the
 * page to stay in step with it.
 */
export function StageItem({
  index,
  label,
  value,
  prompt,
  active,
  href,
  onClick,
}: {
  /** Position in the rail, which decides its share of the accent. */
  index: number;
  label: string;
  /** The decision, once made. Null while the stage is still asking. */
  value: string | null;
  /** What the stage wants, shown until it has an answer. */
  prompt: string;
  active: boolean;
  /** Where the stage lives. Given, it renders as a link; omitted, a button. */
  href?: string;
  onClick?: () => void;
}) {
  const filled = value !== null;
  const style = filled ? { backgroundColor: `hsl(var(--primary) / ${tintFor(index)})` } : undefined;
  const className = cn(
    "block w-full cursor-pointer rounded-2xl px-3.5 py-2.5 text-left transition-all",
    !filled && "bg-foreground/[0.055] hover:bg-foreground/[0.08]",
    active && "ring-2 ring-primary/40"
  );

  const body = (
    <span className="flex items-baseline gap-2.5">
      <span
        className={cn(
          "shrink-0 text-[10px] font-semibold uppercase tracking-widest",
          filled ? "text-primary/60" : "text-muted-foreground/60"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-right text-[13px]",
          filled ? "font-medium text-primary" : "text-muted-foreground"
        )}
      >
        {value ?? prompt}
      </span>
    </span>
  );

  if (href) {
    return (
      // `replace` + `scroll={false}`: switching stage is not a navigation an
      // operator should have to press Back through eight times to escape, and
      // the frame does not scroll, so there is no scroll position to restore.
      // This is exactly how the Settings rail moves between its tabs.
      <Link href={href} replace scroll={false} prefetch={false} style={style} className={className} onClick={onClick}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} style={style} className={className}>
      {body}
    </button>
  );
}

/* ── panel chrome ───────────────────────────────────────────────────────── */

/**
 * A stage panel: fixed head, scrolling body.
 *
 * The screen is a fixed frame — nothing scrolls the page itself. Each column is
 * its own viewport-height column, and only the CONTENT inside one moves. So the
 * stage's title, and anything a tab pins via `toolbar`, stay put while the list
 * under them runs; the operator never scrolls a title out of view to reach a
 * row, and never loses the search box they are typing into.
 */
export function Panel({
  title,
  description,
  toolbar,
  footer,
  children,
}: {
  title: string;
  description?: string;
  /** Pinned under the head — a search box, filters. Never scrolls away. */
  toolbar?: React.ReactNode;
  /** Pinned to the bottom of the column — the stage's primary action. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="shrink-0">
        <h2 className="font-heading text-2xl font-medium tracking-tight">{title}</h2>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
        {toolbar && <div className="mt-6">{toolbar}</div>}
      </div>

      {/* `min-h-0` is load-bearing: without it a flex child refuses to shrink
          below its content and the column grows the page instead of scrolling. */}
      <div className="mt-7 min-h-0 flex-1 space-y-6 overflow-y-auto pb-2 pr-1">{children}</div>

      {footer && <div className="shrink-0 pt-4">{footer}</div>}
    </div>
  );
}

/** A plain card surface in the canary's grammar. */
export function Surface({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(cardCls, "p-6", className)}>{children}</div>;
}

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
    <div>
      <label className="mb-2 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A selectable tile — used for customers, vehicles, handover methods, plans. */
export function OptionCard({
  selected,
  onClick,
  title,
  subtitle,
  right,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-4xl px-5 py-4 text-left transition-all",
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

/* ── the out-of-date banner ─────────────────────────────────────────────── */

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
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  meta?: string;
  drift: Drift[];
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
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
                <span className="text-xs">
                  <span className="block text-muted-foreground">Document says</span>
                  <span className="font-medium line-through decoration-muted-foreground/50">{d.was}</span>
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground/60" />
                <span className="text-xs">
                  <span className="block text-muted-foreground">{d.label} now</span>
                  <span className="font-semibold text-foreground">{d.now}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={onPrimary}>{primaryLabel}</Button>
            <Button variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── page hero ──────────────────────────────────────────────────────────── */

/**
 * The canary's status chip, copied from `dashboard-v2/dashboard-v2.tsx`.
 *
 * Deliberately NOT the ui-v2 `Badge`: northwind's page hero uses a bordered
 * `rounded-full` chip with a 1.5 dot, at 11px — a lighter thing than the solid
 * badges used inside cards. Using `Badge` up here reads as a card component
 * that escaped onto the page title.
 */
export function HeroChip({
  tone = "muted",
  dot = true,
  children,
}: {
  tone?: "muted" | "success" | "warning" | "primary" | "destructive";
  dot?: boolean;
  children: React.ReactNode;
}) {
  const tones = {
    muted: { chip: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground/40" },
    success: { chip: "border-success/30 bg-success/10 text-success", dot: "bg-success" },
    warning: { chip: "border-warning/40 bg-warning/10 text-warning", dot: "bg-warning" },
    primary: { chip: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary" },
    destructive: { chip: "border-destructive/30 bg-destructive/10 text-destructive", dot: "bg-destructive" },
  } as const;
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        t.chip
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

/* ── misc ───────────────────────────────────────────────────────────────── */

/** Thin wrapper on ui-v2's Badge so the screen's four tones map to one place. */
export function Pill({
  tone,
  children,
}: {
  tone: "neutral" | "primary" | "success" | "warning";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-light text-primary",
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
  } as const;
  return <Badge className={cn("gap-1.5", tones[tone])}>{children}</Badge>;
}

/** A left-bordered timeline of what has happened to an output so far. */
export function Timeline({ steps }: { steps: { label: string; at?: string; done: boolean }[] }) {
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-foreground/10 pl-6">
      {steps.map((s) => (
        <li key={s.label} className="relative">
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

/** Kept so every stage shares one action button call-site shape. */
export function ActionButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline";
  disabled?: boolean;
  /** Native tooltip — the honest note on an affordance that is not wired yet. */
  title?: string;
}) {
  return (
    <Button
      variant={variant === "primary" ? "default" : "outline"}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </Button>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-4xl bg-muted/40 px-6 py-8 text-center ring-1 ring-foreground/5">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/* ── shared blocks the stages reach for ─────────────────────────────────── */

/** A framed list — rows divided by a hairline, on the recessed ground. */
export const listCls =
  "overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5 divide-y divide-foreground/5";

/** The recessed ground a card uses for its own sub-blocks. */
export const insetCls = "rounded-3xl bg-muted/40 ring-1 ring-foreground/5";

/** A titled block inside a stage. */
export function Section({
  title,
  description,
  right,
  children,
}: {
  title?: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Surface>
      {(title || right) && (
        <div className="mb-5 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {title && <h3 className="font-heading text-sm font-semibold">{title}</h3>}
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </Surface>
  );
}

/** One figure, labelled. Three across is the shape every stage uses. */
export function StatBlock({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className={cn(insetCls, "px-4 py-3")}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-heading text-lg font-semibold tracking-tight", tone)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "Marcus Bell" → "MB". Two letters, never three. */
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "—";
