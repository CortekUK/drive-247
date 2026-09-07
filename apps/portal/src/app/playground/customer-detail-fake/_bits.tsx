"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Playground · customer control centre — local chrome
 *
 * Anything reusable across the THREE playground screens lives in
 * `app/playground/_shared.tsx`. This file is the vocabulary only the customer
 * screen needs, kept beside it so the shared file does not accumulate one-offs.
 *
 * The grammar is northwind's, not an invention: rounded-4xl surfaces wearing a
 * ring plus a shadow (never `border border-border`), nested blocks one step
 * down the radius ramp on a muted ground, `font-heading` on titles, icons sized
 * with `size-N`.
 * ────────────────────────────────────────────────────────────────────────── */

import { ImageIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface, cardCls } from "@/app/playground/_shared";
import { TODAY } from "./_data";
import type { TabId } from "./_data";

/* ── surfaces ───────────────────────────────────────────────────────────── */

/**
 * A list sitting INSIDE a card is a softer, tighter version of the card — one
 * step down the radius ramp, a hairline ring instead of a shadow, and a muted
 * ground so it reads as inset rather than as a second card floating on the first.
 */
export const listCls =
  "overflow-hidden rounded-3xl bg-muted/40 ring-1 ring-foreground/5 divide-y divide-foreground/5";

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
            {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </Surface>
  );
}

/* ── controls ───────────────────────────────────────────────────────────── */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  tone = "primary",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  /** `destructive` is for switches that take something away from the customer. */
  tone?: "primary" | "destructive";
}) {
  const on = tone === "destructive" ? "bg-destructive/10 ring-destructive/25" : "bg-primary-light ring-primary/30";
  const knob = tone === "destructive" ? "bg-destructive" : "bg-primary";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-4 rounded-3xl px-5 py-4 text-left ring-1 transition-all",
        checked ? on : "bg-muted/40 ring-foreground/5 hover:bg-muted/60"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? knob : "bg-foreground/15"
        )}
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
 * Two or three mutually exclusive views of the same panel — used for the two
 * verification providers, and for Rentals' by-booking / by-car split.
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

/* ── read-only display ──────────────────────────────────────────────────── */

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
      <p
        className={cn(
          "mt-1 font-heading text-lg font-semibold tracking-tight tabular-nums",
          tone && tones[tone]
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A stand-in for a file — never a real image URL, this whole screen is fake. */
export function Thumb({
  className,
  filled,
  caption,
}: {
  className?: string;
  filled?: boolean;
  caption?: string;
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex items-center justify-center rounded-3xl bg-muted ring-1 ring-foreground/5",
          className
        )}
      >
        <ImageIcon className={cn("size-4", filled ? "text-muted-foreground" : "text-muted-foreground/40")} />
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

/* ── helpers ────────────────────────────────────────────────────────────── */

export const dayCount = (a: string, b: string) =>
  Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));

/**
 * Whole days from the sandbox's pinned today until `iso`. Negative once past.
 *
 * Measured from `TODAY`, never from the wall clock — see the note on that
 * constant. Both dates are parsed at local midnight so the subtraction is a
 * whole number of days and cannot land on a 23- or 25-hour DST boundary.
 */
export const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const from = new Date(`${TODAY}T00:00:00`).getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - from) / 86_400_000);
};

export type Expiry = { state: "none" | "valid" | "soon" | "expired"; label: string; days: number | null };

/**
 * How an expiry date reads, in one place.
 *
 * "Soon" is 30 days, which is roughly how long it takes a customer to get a
 * replacement document back — so it is the point at which chasing them is still
 * useful rather than merely alarming.
 */
export const expiryOf = (iso: string | null): Expiry => {
  if (!iso) return { state: "none", label: "No expiry", days: null };
  const d = daysUntil(iso) as number;
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

export const signedMoney = (n: number, money: (v: number) => string) =>
  n < 0 ? `−${money(Math.abs(n))}` : money(n);
