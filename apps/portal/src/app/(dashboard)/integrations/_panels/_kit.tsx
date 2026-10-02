"use client";

// ── Integration panel kit ─────────────────────────────────────────────────────
//
// The shared contract and presentation primitives every integration panel is
// built from. One panel per integration, one file per panel, and this is the
// only file they have in common — so seven panels can be written at once
// without two of them ever landing edits on the same lines (V2_PLAN §2).
//
// SCOPE. Everything under `_panels/` is reachable only from
// `(dashboard)/integrations/page.tsx`, which resolves `isV2('appearance', slug)`
// on the server and 404s for anyone who is not the canary. So the gate is
// already spent by the time a panel renders: a panel does not re-check it, and
// must not assume it can be reached by a non-canary tenant.
//
// ⚠️ ISOLATION. RLS is OFF on the core tables (V2_PLAN §5). The gate above stops
// another tenant from OPENING these screens; it does nothing to stop a query
// written here from READING or WRITING another tenant's row. Every select,
// update and delete a panel issues must carry `.eq('tenant_id', tenant.id)` —
// or, on `tenants` itself, `.eq('id', tenant.id)`. Treat a missing filter as a
// data-loss bug, because with no net beneath it that is what it is.

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui-v2/badge";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonFaker } from "@/lib/skeleton-data";
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { createContext, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui-v2/button";

/* ───────────────────────────── contract ─────────────────────────────────── */

/**
 * The tenant, as a panel sees it.
 *
 * Deliberately `any`-shaped rather than the `Tenant` interface from
 * `TenantContext`: that interface lists ~60 hand-picked columns and every panel
 * would otherwise have to widen it to reach the one integration column it
 * cares about — turning a shared v1 file into a merge point for seven parallel
 * pieces of work. Panels read what they need and fetch anything the context
 * does not carry themselves (scoped to `tenant.id`).
 */
export type PanelTenant = { id: string; slug: string } & Record<string, any>;

export type IntegrationPanelProps = {
  /** Never null — the board does not render a panel before the tenant resolves. */
  tenant: PanelTenant;
  /** Closes the dialog. Call after a destructive action that ends the session. */
  onClose: () => void;
  /**
   * Back from a panel's FIRST screen — returns to the education screens.
   * Only given to panels that run their own screens (`ownsScreens`), and only
   * when the operator came through the education.
   */
  onBack?: () => void;
  /**
   * The operator just pressed the education's last button ("Set up Stripe").
   * A panel that has ONE obvious first action takes it straight away, instead
   * of showing a second screen asking for the same click.
   */
  fromIntro?: boolean;
};

/**
 * What a card's status chip can say.
 *
 * `attention` is the one worth having: an integration can be connected and
 * still be unable to do its job — Stripe onboarding submitted but charges not
 * enabled, a Twilio number bought but no webhook pointed at it, an accounting
 * token that expired overnight. Collapsing that into "Connected" is how an
 * operator finds out from a customer instead of from this screen.
 */
export type IntegrationState =
  | "loading"
  | "connected"
  | "attention"
  | "disconnected";

/**
 * One integration's contribution to the board.
 *
 * `StatusChip` renders on the card in the grid, `Panel` inside the dialog.
 * They are separate components rather than one component plus a hook because
 * the board renders a chip for every card at once: a per-integration component
 * gives React a stable identity per card, where a `registry[name].useStatus()`
 * call from one shared component would make the hook order depend on data.
 */
export type IntegrationPanelEntry = {
  Panel: ComponentType<IntegrationPanelProps>;
  StatusChip: ComponentType<{ tenant: PanelTenant }>;
  /**
   * The panel draws its own screens and Back / Next (the screen standard,
   * `_screens.tsx`), so the dialog must not page it or add a second nav.
   */
  ownsScreens?: boolean;
};

/* ─────────────────────────── presentation ───────────────────────────────── */

/**
 * READABILITY. Every primitive below carries `panel-text`.
 *
 * The panels' grey is liked and stays grey — it was only too faint to read
 * comfortably at the 11–13px this board runs at, on 55 tinted warn/danger notes
 * that were failing WCAG AA outright in light mode. The correction is one CSS
 * block in `styles/v2-theme.css` keyed on this class, which does two things:
 *
 *   • redefines `--muted-foreground` — a custom PROPERTY, not a colour — so it
 *     cascades to every nested `text-muted-foreground`, including raw ones in
 *     the thirteen panel files that this kit never sees. That is what makes a
 *     single edit here reach all of them without touching one of those files,
 *     which matters while several are being edited in parallel (V2_PLAN §2);
 *   • gives the warn/danger/success inks their own tokens, because amber and
 *     red at full saturation on a 10% tint of themselves come out at 2.0:1 and
 *     4.0:1 on white — the classic tinted-callout failure.
 *
 * The global `--muted-foreground` is deliberately NOT touched: it would move
 * every v2 screen, far past what was asked for.
 */
const PANEL_TEXT = "panel-text";

const STATE_LABEL: Record<Exclude<IntegrationState, "loading">, string> = {
  connected: "Connected",
  attention: "Needs attention",
  disconnected: "Not connected",
};

/* ───────────────────────────── card tags ────────────────────────────────── */

/**
 * The ONE tag a board card carries, top-left. At most one at a time; the board
 * decides which, in this order: unavailable → soon → addon → live → none.
 * A free integration that is simply not connected yet carries no tag at all,
 * so the tags only ever mark something worth noticing.
 */
export type CardTagKind = "live" | "soon" | "addon" | "unavailable";

const CARD_TAG: Record<CardTagKind, { text: string; className: string }> = {
  live: { text: "Live", className: "border-success/30 bg-success/10 text-success" },
  soon: {
    text: "Soon",
    className:
      "border-primary/30 bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]",
  },
  addon: { text: "Add-on", className: "border-border bg-muted text-foreground/75" },
  unavailable: { text: "Unavailable", className: "border-border/70 bg-muted/60 text-muted-foreground" },
};

export function CardTag({ kind, className }: { kind: CardTagKind; className?: string }) {
  const tag = CARD_TAG[kind];
  return (
    <span
      data-card-tag={kind}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-wide",
        tag.className,
        className,
      )}
    >
      {tag.text}
    </span>
  );
}

/**
 * The "!" beside a card's tag: the integration is set up far enough to matter
 * but cannot do its job yet. The warning itself is on hover, in the panel's own
 * words, so the card stays quiet until someone asks.
 */
export function AttentionMark({ warning }: { warning: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={warning}
          data-attention-mark
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full border border-warning/30 bg-warning/15 text-[13px] font-bold leading-none text-warning focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          !
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        className="rounded-xl border border-border bg-card px-3 py-1.5 text-[12px] text-foreground shadow-sm"
      >
        {warning}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Where a `StatusChip` is being drawn. The dialog header (the default) gets the
 * full pill; a board card sets "tag", and the same per-integration status
 * component then renders as the card's top-left tag instead:
 *   connected    → LIVE
 *   attention    → "!" alone, the label on hover (not LIVE: most attention
 *                  states are half-set-up, e.g. Stripe not receiving yet)
 *   disconnected → nothing
 *   loading      → nothing (no skeleton flicker in the corner)
 * Done here, once, so none of the thirteen panel files had to change.
 */
const StatusChipModeContext = createContext<"chip" | "tag">("chip");

/**
 * Lets the dialog LISTEN to an integration's state without each of the
 * thirteen panel files exporting it. The board wraps the header chip in this;
 * every chip reports the state it is drawing, and the dialog uses it to decide
 * whether to open on the education screens (not set up yet) or straight on the
 * working screens (active).
 */
export const StatusReportContext = createContext<((state: IntegrationState) => void) | null>(null);
export const StatusChipTagMode = ({ children }: { children: ReactNode }) => (
  <StatusChipModeContext.Provider value="tag">{children}</StatusChipModeContext.Provider>
);

/**
 * The small status pill shown on a card and in the dialog header.
 *
 * `label` overrides the default word for the state — use it to say what is
 * actually wrong ("Charges disabled", "Token expired"), never to dress a
 * broken integration up as a working one.
 */
export function StatusChip({
  state,
  label,
  className,
}: {
  state: IntegrationState;
  label?: string;
  className?: string;
}) {
  const mode = useContext(StatusChipModeContext);
  const report = useContext(StatusReportContext);
  useEffect(() => {
    report?.(state);
  }, [report, state]);
  if (mode === "tag") {
    if (state === "connected") return <CardTag kind="live" />;
    if (state === "attention") return <AttentionMark warning={label ?? STATE_LABEL.attention} />;
    return null;
  }

  if (state === "loading") {
    return <Skeleton className={cn("h-5 w-24 rounded-full", className)} />;
  }

  const text = label ?? STATE_LABEL[state];

  if (state === "connected") {
    return (
      <Badge
        variant="outline"
        className={cn(
          PANEL_TEXT,
          "panel-ink-success gap-1.5 border-success/30 bg-success/10",
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-success" />
        {text}
      </Badge>
    );
  }

  if (state === "attention") {
    return (
      <Badge
        variant="outline"
        className={cn(
          PANEL_TEXT,
          "panel-ink-warn gap-1.5 border-warning/30 bg-warning/10",
          className,
        )}
      >
        <AlertTriangle className="size-3" />
        {text}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(PANEL_TEXT, "gap-1.5 text-muted-foreground", className)}
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      {text}
    </Badge>
  );
}

/** A titled block inside a panel. */
export function PanelSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(PANEL_TEXT, "space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            {title && (
              <h3 className="text-sm font-medium leading-none text-foreground">{title}</h3>
            )}
            {description && (
              <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A label/value row. Values wrap; long ids get `mono`. */
export function PanelRow({
  label,
  children,
  mono,
  hint,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className={cn(PANEL_TEXT, "flex items-baseline justify-between gap-4 py-1.5")}>
      <div className="min-w-0">
        <span className="text-sm text-muted-foreground">{label}</span>
        {/* Was `text-muted-foreground/70`, which came out at 2.7:1 on white —
            the faintest thing on the board, on the line that explains what the
            row above it means. Full-strength muted at 11px instead. */}
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div
        className={cn(
          // Shrinks and wraps rather than `shrink-0`: a long email, URL or id
          // used to push the row wider than the dialog (no horizontal scroll,
          // Ghulam Oct 1 2026). `overflow-wrap:anywhere` breaks unspaced ids.
          "min-w-0 text-right text-sm text-foreground [overflow-wrap:anywhere]",
          mono && "font-mono text-[13px]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A bordered container — the panel's default surface for grouped rows. */
export function PanelCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(PANEL_TEXT, "rounded-xl border bg-muted/20 px-3.5 py-2.5", className)}>
      {children}
    </div>
  );
}

/**
 * An inline note. `tone="warn"` for a condition the operator must act on,
 * `tone="danger"` for one that is actively costing them money or blocking
 * customers. Do not use `danger` for anything reversible in one click.
 */
export function PanelNote({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        PANEL_TEXT,
        // `overflow-wrap:anywhere`: notes carry raw error messages and URLs,
        // which must wrap inside the note, never widen the dialog.
        "rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed [overflow-wrap:anywhere]",
        tone === "info" && "border-border bg-muted/30 text-muted-foreground",
        // `text-warning` / `text-destructive` are the ACCENT ramp — sized for a
        // solid button, not for 12px type on a 10% wash of themselves, where
        // they measured 2.0:1 and 4.0:1 against white. `panel-ink-*` are the
        // same hues taken down (or, in dark, up) to a reading weight; see
        // styles/v2-theme.css.
        tone === "warn" && "panel-ink-warn border-warning/30 bg-warning/10",
        tone === "danger" && "panel-ink-danger border-destructive/30 bg-destructive/10",
      )}
    >
      {children}
    </div>
  );
}

/** A value with a copy button — account ids, webhook URLs, phone numbers. */
export function CopyValue({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {
            /* clipboard blocked (insecure origin / permission) — value is still on screen */
          },
        );
      }}
      className={cn(
        PANEL_TEXT,
        "group inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 font-mono text-[13px] hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]",
        className,
      )}
      title="Copy"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-success" />
      ) : (
        <Copy className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

/** An outbound link to the provider's own dashboard. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:underline"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * Placeholder while a panel's first fetch is in flight: label/value rows of
 * placeholder words, which <AutoSkeleton> turns into bones at the panel's real
 * text sizes (the same bones every other v2 screen loads with).
 */
export function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" className={cn(PANEL_TEXT, "py-1")}>
      <span className="sr-only">Loading</span>
      <AutoSkeleton loading className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => {
          const f = skeletonFaker(i);
          return (
            <div key={i} aria-hidden className="flex h-9 items-center justify-between gap-3">
              <span className="min-w-0 truncate">{f.text(1, 3)}</span>
              <span className="shrink-0">{f.text(1, 2)}</span>
            </div>
          );
        })}
      </AutoSkeleton>
    </div>
  );
}

/**
 * What a panel renders when its own fetch failed.
 *
 * A panel must never present a failed read as "not connected" — that invites
 * the operator to reconnect something that is already connected, and for
 * Stripe and the accounting pairs, reconnecting is destructive.
 */
export function PanelError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={cn(PANEL_TEXT, "space-y-2.5")}>
      <PanelNote tone="warn">
        Could not read this integration&rsquo;s status. It has not been changed.
        <span className="mt-1 block font-mono text-[11px] opacity-80">{message}</span>
      </PanelNote>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
