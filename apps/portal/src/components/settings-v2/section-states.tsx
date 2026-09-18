"use client";

/**
 * v2 Settings: the state kit. Every settings section (Extras, Locations,
 * Promo codes, Templates, ...) builds its non-happy paths from these parts, so
 * an operator sees the same thing for the same situation on every tab.
 *
 * v2 ONLY. These render inside a `useV2("chrome")` branch (or a v2-only
 * component), so nothing in here is gated: the other 56 tenants never mount it.
 *
 * WHICH STATE, IN WHAT ORDER. A section decides top to bottom and stops at the
 * first match. `SettingsSectionBoundary` does exactly this for a query:
 *
 *   1. loading, no data yet   -> <SettingsSectionSkeleton>  (same outer size)
 *   2. read failed, no data   -> <SettingsLoadError onRetry={refetch}>
 *   3. prerequisite missing   -> <SettingsDependencyNotice> (above the content)
 *   4. nothing configured     -> <SettingsEmptyState>       (teaches, one action)
 *   5. search/filter emptied  -> <SettingsNoMatch>          (echoes the query)
 *   6. content                -> the section, with <SettingsReadOnlyNotice> and
 *                                <SettingsSaveState> where they apply
 *
 * THE LOAD-ERROR RULE (non-negotiable). When the READ fails, render
 * `SettingsLoadError` INSTEAD OF the form. Never fall through to a form
 * populated with default values: a "0" deposit, an empty template or a
 * switched-off toggle looks like the tenant's real configuration, and one
 * click on Save then overwrites what is actually stored with those defaults.
 * If stale data IS in the cache (a background refetch failed), keep rendering
 * it and show the compact error above it; only an absent read blocks the form.
 *
 * "Empty" versus "no match". `SettingsEmptyState` is for a tenant who has not
 * set anything up; `SettingsNoMatch` is for a search box or filter that
 * narrowed a non-empty list to nothing. Only the section knows its unfiltered
 * count, so it must choose: teaching someone what an extra is because they
 * typed three letters is noise, and "clear your search" with no search is a
 * dead end.
 *
 * Read-only. Wrap a section's controls in `<SettingsReadOnlyFieldset>` (a
 * native `<fieldset disabled>`): every input, select, switch and button inside
 * is disabled by the browser and picks up its own `disabled:` styling, so no
 * control can be missed. Put view-only actions (copy a link, open a preview)
 * OUTSIDE the fieldset. `useSettingsAccess(tab)` answers the question once.
 *
 * Visual language: flat, one background, no dividers, `rounded-2xl bg-card`
 * surfaces, pill buttons from `ui-v2/button`, `font-heading` (Manrope) for
 * headlines, semantic tokens only (never `font-sans`: it is a serif here). The
 * status hues reuse the v2 list kit's `LIST_TONES`, so dark mode follows.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  Eye,
  ImageOff,
  Info,
  Loader2,
  RefreshCw,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Card, CardContent } from "@/components/ui-v2/card";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { LIST_CLASSES } from "@/components/shared/list-table-v2";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatCurrency } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { describeSaveError } from "@/components/settings-v2/settings-error-copy";

/* -------------------------------------------------------------------------- */
/* Shared action shape                                                         */
/* -------------------------------------------------------------------------- */

/** A button or a link. Give `href` to navigate, `onClick` to act. */
export interface SettingsAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

function ActionButton({
  action,
  variant = "default",
  size = "sm",
}: {
  action: SettingsAction;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon && <Icon data-icon="inline-start" />}
      {action.label}
    </>
  );
  if (action.href && !action.disabled) {
    return (
      <Button asChild variant={variant} size={size}>
        <Link href={action.href} onClick={action.onClick}>
          {content}
        </Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant={variant} size={size} onClick={action.onClick} disabled={action.disabled}>
      {content}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Skeleton                                                                 */
/* -------------------------------------------------------------------------- */

export interface SettingsSectionSkeletonProps {
  /**
   * `table`: a v2 list-table card (header + rows at the kit's 45px row height).
   * `form`: label/field pairs. `cards`: a grid of soft cards.
   * `rows`: the stacked rows a list shows below `sm` instead of its table, so a
   * phone does not load a table that is cut off at the card edge and then jump.
   * `stack`: full-width cards one above the other, at every width (a page of
   * stacked panels, or options a person picks between).
   */
  variant?: "table" | "form" | "cards" | "rows" | "stack";
  /** `rows` only: a square thumbnail at the start of each row. */
  thumbnail?: boolean;
  /** Table rows, form pairs, or cards. Match what the section usually shows. */
  rows?: number;
  /** Table columns. */
  columns?: number;
  /** Show a title + action placeholder above, like a section header. */
  header?: boolean;
  /** Screen-reader label, e.g. "Loading extras". */
  label?: string;
  className?: string;
}

/** Varied widths so a skeleton reads as text, not as a barcode. */
const BAR_WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-2/5", "w-3/5"];

export function SettingsSectionSkeleton({
  variant = "table",
  rows = 5,
  columns = 4,
  header = false,
  label = "Loading",
  thumbnail = false,
  className,
}: SettingsSectionSkeletonProps) {
  const count = Math.max(1, rows);
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-settings-state="loading"
      className={cn("space-y-4", className)}
    >
      {header && (
        <div aria-hidden="true" className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-3.5 w-64 max-w-[60vw] rounded-full" />
          </div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      )}

      {variant === "table" && (
        // Same shell as `ListTable`: the v2 Card with a p-0 body, a 40px head
        // row and 45px body rows (py-3 cell + 20px line + 1px row border).
        // `min-w-0` on every column: the fixed-width header bars otherwise set
        // a minimum that pushed the last one past the card edge on a phone.
        <Card aria-hidden="true">
          <CardContent className="p-0">
            <div className="flex h-10 items-center gap-6 border-b px-3">
              {Array.from({ length: columns }).map((_, c) => (
                <div key={c} className="min-w-0 flex-1">
                  <Skeleton className={cn("h-2.5 rounded-full", c === 0 ? "w-24 max-w-full" : "w-16 max-w-full")} />
                </div>
              ))}
            </div>
            {Array.from({ length: count }).map((_, r) => (
              <div
                key={r}
                className={cn("flex h-[45px] items-center gap-6 px-3", r < count - 1 && "border-b")}
              >
                {Array.from({ length: columns }).map((_, c) => (
                  <div key={c} className="min-w-0 flex-1">
                    <Skeleton className={cn("h-3.5 rounded-full", BAR_WIDTHS[(r + c) % BAR_WIDTHS.length])} />
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {variant === "rows" && (
        <div aria-hidden="true" className="space-y-2">
          {Array.from({ length: count }).map((_, r) => (
            <div key={r} className="flex items-start gap-3 rounded-2xl bg-muted/40 px-4 py-3">
              {thumbnail && <Skeleton className="size-10 shrink-0 rounded-lg" />}
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                <Skeleton className={cn("h-3.5 rounded-full", BAR_WIDTHS[r % BAR_WIDTHS.length])} />
                <Skeleton className="h-3 w-1/2 rounded-full" />
                <Skeleton className="h-3 w-2/3 rounded-full" />
              </div>
              <Skeleton className="size-8 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {variant === "form" && (
        <div aria-hidden="true" className="space-y-5 rounded-2xl bg-card p-5 sm:p-6">
          {Array.from({ length: count }).map((_, r) => (
            <div key={r} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-6">
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28 rounded-full" />
                <Skeleton className="h-3 w-40 max-w-full rounded-full" />
              </div>
              <Skeleton className="h-9 w-full rounded-3xl" />
            </div>
          ))}
        </div>
      )}

      {variant === "stack" && (
        <div aria-hidden="true" className="space-y-4">
          {Array.from({ length: count }).map((_, r) => (
            <div key={r} className="space-y-3 rounded-2xl bg-card p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <Skeleton className={cn("h-4 rounded-full", BAR_WIDTHS[r % BAR_WIDTHS.length], "max-w-xs")} />
              </div>
              <Skeleton className="h-3 w-2/3 rounded-full" />
              <Skeleton className="h-14 w-full rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {variant === "cards" && (
        <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }).map((_, r) => (
            <div key={r} className="space-y-3 rounded-2xl bg-card p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {/* Last, not first: as the first child it made the first shape a later
          sibling, so space-y-4 gave it a 16px top margin. Inside a fieldset,
          grid or flex item that margin cannot collapse away, and the skeleton
          sat 16px below where the loaded section appears (Fees & tax, Deposit,
          Installments, Pricing rules, Locations); after a space-y-3 heading it
          sat 4px low. */}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Empty (nothing configured yet)                                           */
/* -------------------------------------------------------------------------- */

export interface SettingsEmptyStateProps {
  icon: LucideIcon;
  /** What this section IS, in the operator's words. Not "No extras". */
  headline: string;
  /** One or two sentences: what it is for and why it matters. */
  body: ReactNode;
  /** Up to three short payoffs (only shown in the full variant). */
  points?: string[];
  primaryAction?: SettingsAction;
  secondaryAction?: SettingsAction;
  /** One quiet line, e.g. what is reversible. */
  footnote?: string;
  /**
   * `card` (default): its own soft card, for a section with nothing else.
   * `compact`: no surface, tighter, for inside a table card or a sub-panel.
   */
  variant?: "card" | "compact";
  className?: string;
}

/**
 * Same job and anatomy as `empty-states/teaching-empty-state.tsx` (icon tile,
 * headline, why, payoffs, one primary action) but with v2 settings chrome: no
 * border, pill buttons, Manrope headline, link actions, and a compact variant.
 */
export function SettingsEmptyState({
  icon: Icon,
  headline,
  body,
  points,
  primaryAction,
  secondaryAction,
  footnote,
  variant = "card",
  className,
}: SettingsEmptyStateProps) {
  const compact = variant === "compact";
  return (
    <div
      data-settings-state="empty"
      className={cn(
        compact ? "px-4 py-8" : "rounded-2xl bg-card px-5 py-10 sm:px-10 sm:py-12",
        className,
      )}
    >
      <div className={cn("mx-auto flex flex-col items-center text-center", compact ? "max-w-sm" : "max-w-lg")}>
        <span
          className={cn(
            "flex items-center justify-center bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
            compact ? "size-9 rounded-xl" : "size-11 rounded-2xl",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        </span>

        <h3
          className={cn(
            "font-heading font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]",
            compact ? "mt-3 text-base" : "mt-5 text-lg",
          )}
        >
          {headline}
        </h3>

        <p className={cn("text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]", compact ? "mt-1" : "mt-2")}>
          {body}
        </p>

        {!compact && points && points.length > 0 && (
          <ul className="mt-6 w-full max-w-sm space-y-2 text-left">
            {points.slice(0, 3).map((point) => (
              <li key={point} className="flex items-start gap-2.5">
                <span className="mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Check className="size-2.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" strokeWidth={3} aria-hidden="true" />
                </span>
                <span className="text-sm leading-snug text-foreground/80">{point}</span>
              </li>
            ))}
          </ul>
        )}

        {(primaryAction || secondaryAction) && (
          <div className={cn("flex flex-wrap items-center justify-center gap-2", compact ? "mt-4" : "mt-7")}>
            {primaryAction && <ActionButton action={primaryAction} size={compact ? "sm" : "default"} />}
            {secondaryAction && (
              <ActionButton action={secondaryAction} variant="ghost" size={compact ? "sm" : "default"} />
            )}
          </div>
        )}

        {footnote && <p className="mt-4 text-xs text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. No match (search / filter narrowed a non-empty list to nothing)          */
/* -------------------------------------------------------------------------- */

export interface SettingsNoMatchProps {
  /** The search text. Echoed back (truncated if long). */
  query?: string;
  /** Plural noun for the rows: "extras", "locations", "settings". */
  noun?: string;
  /** Clears the search and/or filters. Omit to render no button. */
  onClear?: () => void;
  /** True when filters (not only a search) are narrowing the list. */
  filtersActive?: boolean;
  /** Overrides the button label ("Clear search" / "Clear filters"). */
  clearLabel?: string;
  /** `compact` for a rail or a dropdown list. */
  size?: "default" | "compact";
  className?: string;
}

export function SettingsNoMatch({
  query,
  noun = "results",
  onClear,
  filtersActive = false,
  clearLabel,
  size = "default",
  className,
}: SettingsNoMatchProps) {
  const q = query?.trim() ?? "";
  const compact = size === "compact";
  const label = clearLabel ?? (q && !filtersActive ? "Clear search" : q ? "Clear search and filters" : "Clear filters");

  return (
    <div
      role="status"
      data-settings-state="no-match"
      className={cn("flex flex-col items-center text-center", compact ? "px-3 py-5" : "px-4 py-10", className)}
    >
      {!compact && (
        <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <SearchX className="size-4" aria-hidden="true" />
        </span>
      )}
      <p
        className={cn(
          "flex max-w-full min-w-0 flex-wrap items-baseline justify-center gap-x-1 font-medium text-foreground",
          compact ? "text-sm" : "mt-3 font-heading text-base",
        )}
      >
        <span>No {noun} match</span>{" "}
        {q ? (
          <span className="inline-block max-w-[16rem] truncate align-bottom sm:max-w-[24rem]" title={q}>
            &ldquo;{q}&rdquo;
          </span>
        ) : (
          <span>these filters</span>
        )}
      </p>
      <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")}>
        {q ? "Check the spelling or try a shorter word." : "Loosen or clear the filters to see everything."}
      </p>
      {onClear && (
        <Button type="button" variant="outline" size={compact ? "xs" : "sm"} className="mt-3" onClick={onClear}>
          {label}
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Load error                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A short, operator-safe reason for a failed read. Never shows raw SQL or a
 * stack: those go to the console, not the screen.
 */
export function describeLoadError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const text = raw.toLowerCase();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You appear to be offline. Check your connection and try again.";
  }
  if (text.includes("failed to fetch") || text.includes("network") || text.includes("timeout") || text.includes("timed out")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (code === "42501" || code === "PGRST301" || text.includes("permission") || text.includes("not authorized") || text.includes("jwt")) {
    return "Your session may have expired or you don't have access. Sign in again or ask an admin.";
  }
  return "Something went wrong on our side. Nothing was changed.";
}

export interface SettingsLoadErrorProps {
  /** What failed to load, lower case: "extras", "your locations". */
  thing: string;
  /** The query error; turned into a short reason via `describeLoadError`. */
  error?: unknown;
  /** An explicit reason; wins over `error`. */
  reason?: string;
  /** Usually the query's `refetch`. */
  onRetry: () => unknown;
  /** Spinner on the button while a retry is in flight (`isFetching`). */
  retrying?: boolean;
  /** `inline`: one line above stale content, instead of a full card. */
  variant?: "card" | "inline";
  className?: string;
}

export function SettingsLoadError({
  thing,
  error,
  reason,
  onRetry,
  retrying = false,
  variant = "card",
  className,
}: SettingsLoadErrorProps) {
  const why = reason ?? describeLoadError(error);
  const retry = (
    <Button
      type="button"
      variant={variant === "inline" ? "ghost" : "outline"}
      size="sm"
      onClick={() => void onRetry()}
      disabled={retrying}
      aria-label={`Try loading ${thing} again`}
    >
      {retrying ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {retrying ? "Trying…" : "Try again"}
    </Button>
  );

  if (variant === "inline") {
    return (
      <div
        role="alert"
        data-settings-state="error"
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-destructive/10 px-4 py-2 text-sm", className)}
      >
        <CloudOff className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-foreground">
          <span className="font-medium">Couldn&apos;t refresh {thing}.</span>{" "}
          <span className="text-muted-foreground">Showing what was last loaded.</span>
        </span>
        {retry}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-settings-state="error"
      className={cn("rounded-2xl bg-card px-5 py-10 sm:px-10", className)}
    >
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <CloudOff className="size-5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-heading text-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
          Couldn&apos;t load {thing}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{why}</p>
        <div className="mt-5">{retry}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Read-only                                                                */
/* -------------------------------------------------------------------------- */

export const SETTINGS_READ_ONLY_COPY = "View only — ask an admin to change these";

export function SettingsReadOnlyNotice({
  copy = SETTINGS_READ_ONLY_COPY,
  className,
}: {
  copy?: string;
  className?: string;
}) {
  return (
    <p
      data-settings-state="read-only"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{copy}</span>
    </p>
  );
}

/**
 * The one read-only answer for a settings sub-tab. `tab` is the settings tab
 * value ("extras", "locations", ...), the same string `canEditSettings` takes.
 *
 * `controlProps` spreads onto a single control outside a fieldset:
 * `<Switch {...controlProps} />`.
 */
export function useSettingsAccess(tab: string) {
  const { canEditSettings, canViewSettings } = useManagerPermissions();
  const canEdit = canEditSettings(tab);
  return {
    canView: canViewSettings(tab),
    canEdit,
    readOnly: !canEdit,
    controlProps: settingsControlProps(canEdit),
  };
}

/** `disabled` plus a reason, for a control that cannot sit in a fieldset. */
export function settingsControlProps(canEdit: boolean, busy = false) {
  return {
    disabled: !canEdit || busy,
    "aria-disabled": !canEdit || busy || undefined,
    title: canEdit ? undefined : SETTINGS_READ_ONLY_COPY,
  } as const;
}

/**
 * Disables every native control inside when `readOnly` (browser-enforced:
 * inputs, selects, textareas and buttons, which covers Radix Switch, Select
 * and Checkbox triggers). Keep view-only actions outside it.
 *
 * The v2 Switch dims only on its own `disabled` prop (`data-[disabled]`), which
 * a disabled fieldset never sets, so a view-only switch kept full colour beside
 * dimmed inputs and looked editable. The fieldset dims it the same way.
 */
export function SettingsReadOnlyFieldset({
  readOnly,
  children,
  className,
}: {
  readOnly: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      disabled={readOnly}
      data-read-only={readOnly || undefined}
      className={cn(
        "m-0 min-w-0 border-0 p-0 [&_[role=switch]:disabled]:cursor-not-allowed [&_[role=switch]:disabled]:opacity-50",
        className,
      )}
    >
      {children}
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Dependency / feature off                                                 */
/* -------------------------------------------------------------------------- */

export interface SettingsDependencyNoticeProps {
  /** "Connect Stripe to take deposits" / "Lockbox is switched off". */
  title: string;
  /** What is blocked and what happens once it is fixed. */
  body?: ReactNode;
  action?: SettingsAction;
  tone?: "info" | "warning";
  icon?: LucideIcon;
  className?: string;
}

export function SettingsDependencyNotice({
  title,
  body,
  action,
  tone = "info",
  icon,
  className,
}: SettingsDependencyNoticeProps) {
  const Icon = icon ?? (tone === "warning" ? AlertTriangle : Info);
  return (
    <div
      role={tone === "warning" ? "alert" : "note"}
      data-settings-state="dependency"
      data-tone={tone}
      className={cn(
        "flex flex-col gap-3 rounded-2xl px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4",
        tone === "warning" ? "bg-amber-500/10" : "bg-primary/[0.06]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
          )}
        />
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {body && <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>}
        </div>
      </div>
      {action && (
        <div className="shrink-0 pl-7 sm:pl-0">
          <ActionButton action={action} variant="outline" size="sm" />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. Save state                                                               */
/* -------------------------------------------------------------------------- */

export type SettingsSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SettingsSaveStateProps {
  status: SettingsSaveStatus;
  /** The save error; shown through `describeSaveError`, never raw. */
  error?: unknown;
  onRetry?: () => unknown;
  onDiscard?: () => void;
  className?: string;
}

// Lives in a plain module so hooks can share it; re-exported for the kit's callers.
export { describeSaveError };

/**
 * Inline, next to the section's Save button. It complements the toast rather
 * than replacing it: a toast disappears, this stays until the state changes.
 */
export function SettingsSaveState({ status, error, onRetry, onDiscard, className }: SettingsSaveStateProps) {
  if (status === "idle") return <span aria-live="polite" className="sr-only" />;

  return (
    <div
      aria-live="polite"
      role={status === "error" ? "alert" : undefined}
      data-settings-state={`save-${status}`}
      className={cn("inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}
    >
      {status === "saving" && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </span>
      )}
      {status === "saved" && (
        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      )}
      {status === "dirty" && (
        <>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            Unsaved changes
          </span>
          {onDiscard && (
            <Button type="button" variant="ghost" size="xs" onClick={onDiscard}>
              Discard
            </Button>
          )}
        </>
      )}
      {status === "error" && (
        <>
          <span className="inline-flex min-w-0 items-start gap-1.5 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium">Couldn&apos;t save.</span> {describeSaveError(error)}
            </span>
          </span>
          {onRetry && (
            <Button type="button" variant="ghost" size="xs" onClick={() => void onRetry()}>
              <RefreshCw data-icon="inline-start" />
              Retry
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Derives the status from form + mutation flags, and flashes "saved" for
 * `savedMs` after a save finishes without error.
 *
 *   const status = useSettingsSaveStatus({
 *     isDirty: form.formState.isDirty,
 *     isPending: mutation.isPending,
 *     error: mutation.error,
 *   });
 */
export function useSettingsSaveStatus({
  isDirty,
  isPending,
  error,
  savedMs = 2500,
}: {
  isDirty: boolean;
  isPending: boolean;
  error?: unknown;
  savedMs?: number;
}): SettingsSaveStatus {
  const [justSaved, setJustSaved] = useState(false);
  const wasPending = useRef(isPending);

  useEffect(() => {
    if (wasPending.current && !isPending && !error) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), savedMs);
      wasPending.current = isPending;
      return () => clearTimeout(t);
    }
    wasPending.current = isPending;
  }, [isPending, error, savedMs]);

  useEffect(() => {
    if (isDirty) setJustSaved(false);
  }, [isDirty]);

  if (isPending) return "saving";
  if (error) return "error";
  if (isDirty) return "dirty";
  if (justSaved) return "saved";
  return "idle";
}

/** Browser "leave site?" prompt while there are unsaved changes. */
export function useWarnOnUnsavedChanges(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/* -------------------------------------------------------------------------- */
/* 8. Boundary: loading -> error -> empty -> content, for one query            */
/* -------------------------------------------------------------------------- */

export interface SettingsSectionBoundaryProps {
  /** Pass the React Query result's fields. */
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  /** True once the query has data (even stale). Blocks the error card when set. */
  hasData: boolean;
  refetch: () => unknown;
  isFetching?: boolean;
  /** "extras", "your locations". */
  thing: string;
  skeleton?: SettingsSectionSkeletonProps;
  /** True when the unfiltered data is empty; renders `empty`. */
  isEmpty?: boolean;
  empty?: ReactNode;
  children: ReactNode;
}

export function SettingsSectionBoundary({
  isLoading,
  isError,
  error,
  hasData,
  refetch,
  isFetching,
  thing,
  skeleton,
  isEmpty,
  empty,
  children,
}: SettingsSectionBoundaryProps) {
  if (isLoading && !hasData) {
    return <SettingsSectionSkeleton label={`Loading ${thing}`} {...skeleton} />;
  }
  if (isError && !hasData) {
    return <SettingsLoadError thing={thing} error={error} onRetry={refetch} retrying={isFetching} />;
  }
  return (
    <>
      {isError && hasData && (
        <SettingsLoadError thing={thing} error={error} onRetry={refetch} retrying={isFetching} variant="inline" className="mb-4" />
      )}
      {isEmpty && empty ? empty : children}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 9. Extreme data                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One line (or `lines`) with an ellipsis. The full text shows in a tooltip
 * only when it is actually cut off, and always in `title` for touch and AT.
 * The parent must constrain width (`min-w-0` in flex, a fixed table column).
 */
export function TruncatedText({
  text,
  lines = 1,
  className,
}: {
  text: string | null | undefined;
  lines?: 1 | 2 | 3;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  // Always controlled: switching `open` between `false` and `undefined` made
  // Radix warn "changing from controlled to uncontrolled" once a row measured.
  const [tipOpen, setTipOpen] = useState(false);
  const value = text ?? "";

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setCut(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  };
  useLayoutEffect(measure, [value, lines]);

  if (!value.trim()) return <span className={cn("text-muted-foreground", className)}>—</span>;

  const span = (
    <span
      ref={ref}
      title={value}
      onPointerEnter={measure}
      onFocus={measure}
      className={cn(
        "block min-w-0 max-w-full [overflow-wrap:anywhere]",
        lines === 1 ? "truncate" : lines === 2 ? "line-clamp-2" : "line-clamp-3",
        className,
      )}
    >
      {value}
    </span>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={cut && tipOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger asChild>{span}</TooltipTrigger>
        <TooltipContent className="max-w-sm break-words">{value}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * An image that becomes an icon tile when `src` is empty or fails to load
 * (expired storage URL, deleted file, hotlink blocked). Size it with
 * `className` (e.g. "size-9 rounded-xl"); the fallback keeps that box.
 */
export function SettingsImage({
  src,
  alt,
  fallbackIcon: FallbackIcon = ImageOff,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  fallbackIcon?: LucideIcon;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span
        role="img"
        aria-label={alt || "No image"}
        data-image-fallback=""
        className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-muted text-muted-foreground", className)}
      >
        <FallbackIcon className="size-1/2 max-h-5 max-w-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 bg-muted object-cover", className)}
    />
  );
}

/** A dash for a missing optional value, in the list kit's muted tone. */
export function SettingsBlank() {
  return (
    <span className="text-muted-foreground" aria-label="Not set">
      —
    </span>
  );
}

/**
 * Money for a settings row. `formatCurrency` from `lib/format-utils` does the
 * formatting (tenant currency, 2dp, exact, never compacted: money must read
 * exactly). This only adds the edge cases: null/NaN/Infinity -> "—".
 * Render the result inside `<TabularValue>` so columns align.
 */
/**
 * A phone list row's facts ("AED 12.50 · Active · 3 left"): the dot belongs to
 * the fact AFTER it and sits in the gap to its left, and the line clips its
 * left edge. When a fact wraps onto a new line its dot is cut off, instead of
 * dangling at the end of the line above.
 *
 *   <p className={SETTINGS_PHONE_FACTS.line}>
 *     <span>AED 12.50</span>
 *     <span className={SETTINGS_PHONE_FACTS.afterDot}>Active</span>
 *   </p>
 */
export const SETTINGS_PHONE_FACTS = {
  line: "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 overflow-hidden",
  afterDot:
    "relative before:absolute before:right-full before:w-3 before:text-center before:text-muted-foreground before:content-['·']",
} as const;

export function formatSettingsMoney(amount: number | string | null | undefined, currencyCode = "USD"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return formatCurrency(n, currencyCode);
}

/** Counts, percentages, days: grouped digits, null/NaN -> "—". */
export function formatSettingsNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions & { suffix?: string },
): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const { suffix, ...intl } = options ?? {};
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, ...intl }).format(n)}${suffix ?? ""}`;
}

/**
 * Tabular digits on one line. It NEVER truncates: an amount with its last
 * digits cut off reads as a different amount. Give its column `shrink-0` and
 * let the name column (a `TruncatedText`) give way instead.
 * `negative` tints the value in the list kit's danger hue.
 */
export function TabularValue({
  children,
  negative,
  className,
}: {
  children: ReactNode;
  negative?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        LIST_CLASSES.text,
        "inline-block whitespace-nowrap tabular-nums",
        negative && "text-red-500 dark:text-red-400",
        className,
      )}
    >
      {children}
    </span>
  );
}
