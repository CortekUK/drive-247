/**
 * BannerStack — the single top-of-app notice slot.
 *
 * Generic by construction: it knows `AppBanner`, severity and dismissal, and
 * nothing about deposits, accounting, Bonzah or credits. Every existing banner can
 * move in behind an adapter that returns `AppBanner[]`, and the two with
 * genuinely bespoke bodies (go-live's gradient, bonzah-pending's three buttons
 * and retry progress) can move in unchanged via the `render` escape hatch.
 *
 * ── WHY A CAROUSEL, AND WHAT IT COSTS ─────────────────────────────────────
 *
 * One notice occupies the slot; the rest queue behind it. This was an explicit
 * product decision, taken after the stack-with-collapse alternative was built
 * and reviewed: seven bars at ~44px is ~300px of chrome, an entire phone
 * viewport, and a wall of amber is how banners get trained into invisibility.
 *
 * The cost is real and worth stating plainly, because it is the same shape as
 * the incident that prompted this work — four cars out with no deposit held,
 * signalled only by a notification nobody opened. A carousel converts
 * information into information behind an interaction.
 *
 * Three mitigations, all load-bearing rather than decorative:
 *   · a permanent "N of M" counter, so the SIZE of the queue is visible even
 *     when its contents are not;
 *   · severity-first ordering plus a "· N urgent" flag beside the counter, so an
 *     off-screen critical is announced in words with no click required;
 *   · severity-coloured dots, and a live region that announces every critical in
 *     the queue rather than only the visible one.
 *
 * Auto-advance is deliberately NOT implemented. It can scroll a critical past an
 * operator mid-read, and `prefers-reduced-motion` would have to disable it —
 * handing the users least able to recover the worst variant.
 *
 * `maxVisible` is retained in the props for API compatibility but has no effect:
 * the slot is always one.
 */

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  X,
} from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import {
  compareBanners,
  type AppBanner,
  type BannerAction,
  type BannerSeverity,
} from "./banner-types";
import { useBannerDismissal } from "./use-banner-dismissal";

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

interface Tone {
  wrap: string;
  icon: string;
  title: string;
  body: string;
  btn: string;
  Icon: typeof AlertTriangle;
}

/**
 * The amber row is lifted verbatim from
 * `dashboard/accounting-connection-expired-banner.tsx` so that the accounting bar is
 * pixel-identical once it moves in — a migration nobody can see is a migration
 * nobody has to review. Red/blue/emerald are matched to it, and the dark
 * variants follow the existing `dark:bg-*-950/40` idiom already established in
 * `dashboard/maintenance-banner.tsx`.
 *
 * Colour is never the only channel: each severity also gets a distinct icon and
 * the title states the problem in words.
 */
const TONE: Record<BannerSeverity, Tone> = {
  critical: {
    wrap: "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40",
    icon: "text-red-700 dark:text-red-400",
    title: "text-red-900 dark:text-red-50",
    body: "text-red-800 dark:text-red-200",
    btn: "bg-red-700 text-white hover:bg-red-800",
    Icon: AlertOctagon,
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40",
    icon: "text-amber-700 dark:text-amber-400",
    title: "text-amber-900 dark:text-amber-50",
    body: "text-amber-800 dark:text-amber-200",
    btn: "bg-amber-700 text-white hover:bg-amber-800",
    Icon: AlertTriangle,
  },
  info: {
    wrap: "border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40",
    icon: "text-blue-700 dark:text-blue-400",
    title: "text-blue-900 dark:text-blue-50",
    body: "text-blue-800 dark:text-blue-200",
    btn: "bg-blue-700 text-white hover:bg-blue-800",
    Icon: Info,
  },
  success: {
    wrap: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40",
    icon: "text-emerald-700 dark:text-emerald-400",
    title: "text-emerald-900 dark:text-emerald-50",
    body: "text-emerald-800 dark:text-emerald-200",
    btn: "bg-emerald-700 text-white hover:bg-emerald-800",
    Icon: CheckCircle2,
  },
};

/* -------------------------------------------------------------------------- */
/* BannerStack                                                                 */
/* -------------------------------------------------------------------------- */

export interface BannerStackProps {
  banners: AppBanner[];
  /** Which mount point this is. Banners declare their own `scope`. */
  scope?: "app" | "dashboard";
  /** Non-critical slots. Default 2 on desktop, 1 on mobile. */
  maxVisible?: number;
  /**
   * Pin the stack under the header while the page scrolls.
   *
   * OFF by default, deliberately. The design called for
   * `sticky top-16`, but the dashboard header in `(dashboard)/layout.tsx` is
   * `h-16 shrink-0` — it is NOT itself sticky, and the page scrolls the body.
   * A sticky stack would therefore detach and float 64px from the top with
   * page content visible above it. Flip this on (and pass an appropriate
   * `top-*` via `className`) once the header is pinned.
   */
  sticky?: boolean;
  className?: string;
}

export function BannerStack({
  banners,
  scope = "app",
  maxVisible,
  sticky = false,
  className,
}: BannerStackProps) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const cap = maxVisible ?? (isMobile ? 1 : 2);

  const dismissRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const regionRef = useRef<HTMLElement | null>(null);

  const scoped = useMemo(
    () =>
      banners
        .filter((b) => (b.scope ?? "app") === scope)
        // "Don't nag me about the page I'm already on."
        .filter(
          (b) =>
            !(b.hideOnPathPrefix ?? []).some((p) => pathname?.startsWith(p)),
        )
        .sort(compareBanners),
    [banners, scope, pathname],
  );

  const { visible, dismiss, ready } = useBannerDismissal(scoped);

  /**
   * SLIDER: exactly one notice occupies the slot at a time.
   *
   * `visible` is already sorted by `compareBanners`, so index 0 is the most
   * severe thing the operator has — whatever else is in the queue, the first
   * thing they see is the worst thing.
   *
   * The single honest risk of a carousel is that a notice can go unread because
   * it was never on screen. Three things offset it, and all three are load-
   * bearing rather than decoration:
   *   · a permanent "1 of 3" counter, so the queue's SIZE is never hidden even
   *     when its contents are;
   *   · severity-first ordering, so the item most likely to matter needs no
   *     interaction to be seen;
   *   · the screen-reader live region below still announces every critical in
   *     the queue, not just the visible one.
   *
   * `maxVisible` is deliberately ignored in this mode; the slot is always one.
   */
  const [index, setIndex] = useState(0);

  // Clamp when the queue shrinks — a dismissal or a resolved problem must never
  // leave the index pointing past the end and render an empty bar.
  const cursor = visible.length === 0 ? 0 : Math.min(index, visible.length - 1);
  useEffect(() => {
    if (index !== cursor) setIndex(cursor);
  }, [index, cursor]);

  const current = visible[cursor];
  const criticalCount = visible.filter((b) => b.severity === "critical").length;

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        if (visible.length === 0) return 0;
        // Wrap, so the operator can never reach a dead end and assume the queue
        // has been exhausted when it has not.
        return (i + delta + visible.length) % visible.length;
      });
    },
    [visible.length],
  );

  void cap; // superseded by the one-at-a-time slot; kept in the API for callers.

  /**
   * ONE live region for the whole stack, not one per row.
   *
   * Per-row `aria-live` would re-announce every banner on every React Query
   * refetch — the deposit sources poll every 5 minutes and refetch on window
   * focus — which is precisely how a screen-reader user learns to tune the app
   * out. Keying the effect on the SET of critical ids means it fires when the
   * situation changes and stays silent when the same situation is merely
   * re-fetched.
   *
   * The 600ms delay keeps it from colliding with the route's own page-title
   * announcement on first paint.
   */
  // Keyed on the whole QUEUE, not the visible row: in slider mode a critical
  // sitting at index 2 must still be announced, or the one accessibility
  // guarantee that survives a carousel is lost.
  const criticalIds = visible
    .filter((b) => b.severity === "critical")
    .map((b) => b.id)
    .join("|");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!criticalIds) {
      setAnnouncement("");
      return;
    }
    const titles = criticalIds
      .split("|")
      .map((id) => visible.find((b) => b.id === id)?.plainTitle)
      .filter((t): t is string => !!t);
    const timer = setTimeout(() => {
      setAnnouncement(
        titles.length === 1
          ? `Urgent notice: ${titles[0]}`
          : `${titles.length} urgent notices: ${titles.join("; ")}`,
      );
    }, 600);
    return () => clearTimeout(timer);
    // `shown` is intentionally omitted: it is a new array on every render and
    // would defeat the whole point of keying on the id set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criticalIds]);

  /**
   * Move focus on dismiss, or the keyboard user is teleported to `<body>` and
   * lands back at the top of the document. Prefer the next dismissible row,
   * then the previous one, then the region itself when the stack empties.
   */
  const handleDismiss = useCallback(
    (banner: AppBanner) => {
      // The row leaving is the one on screen. Whatever slides into the slot
      // takes the focus, so a keyboard user is never dropped to <body>.
      const remaining = visible.filter((b) => b.id !== banner.id);
      const nextId = remaining[cursor]?.id ?? remaining[cursor - 1]?.id ?? null;

      dismiss(banner);

      requestAnimationFrame(() => {
        const target = nextId ? dismissRefs.current.get(nextId) : null;
        (target ?? regionRef.current)?.focus();
        dismissRefs.current.delete(banner.id);
      });
    },
    [visible, cursor, dismiss],
  );

  if (!ready || visible.length === 0) return null;

  return (
    <section
      ref={regionRef}
      // Focusable as the last-resort focus target after the final dismissal.
      tabIndex={-1}
      aria-label="Account notices"
      data-banner-stack={scope}
      className={cn(
        "outline-none",
        // Never let the notice slot eat the viewport, no matter how many
        // criticals are live.
        "max-h-[40vh] overflow-y-auto",
        sticky && "sticky top-16 z-30",
        className,
      )}
    >
      {/*
        `assertive` is reserved for criticals. Warnings and info are reachable
        inside the labelled region and are deliberately not announced — an
        interruption that is not urgent devalues the ones that are.
      */}
      <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {announcement}
      </p>

      {/* ── The slot: exactly one notice ─────────────────────────────────── */}
      <div className="relative">
        <BannerRow
          key={current.id}
          banner={current}
          ref={(el) => {
            dismissRefs.current.set(current.id, el);
          }}
          onDismiss={() => handleDismiss(current)}
        />

        {/*
          Queue controls. Rendered ONLY when there is a queue — a lone notice
          gets no chrome, no dots and no "1 of 1", which is the common case and
          must stay as quiet as the single-banner design it replaces.
        */}
        {visible.length > 1 && (
          <div
            className={cn(
              "flex items-center justify-center gap-1 border-b px-4 py-1.5",
              "bg-muted/30 text-[11px] font-medium text-muted-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={`Previous notice (${cursor + 1} of ${visible.length})`}
              className={cn(
                "grid h-5 w-5 place-items-center rounded hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>

            {/*
              The counter is the whole safety argument for a carousel: the SIZE
              of the queue stays visible even when its contents do not, so an
              operator can never mistake slide 1 for "everything there is".
            */}
            {/*
              NO aria-live here. The stack has exactly ONE live region (for
              criticals) so that a 5-minute refetch cannot spam a screen reader;
              a second region announcing "1 of 3 / 2 of 3" on every navigation
              would undo that. Position is carried on the button labels below,
              where it is read on demand instead of shouted.
            */}
            <span className="px-1 tabular-nums">
              {cursor + 1} of {visible.length}
            </span>

            {/*
              Dots carry severity, not just position. A plain dot row says
              "there is more"; a red dot says "and one of them is money leaving
              the building" — which is the entire reason this slot exists.
            */}
            <span className="flex items-center gap-1" aria-hidden>
              {visible.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all motion-reduce:transition-none",
                    i === cursor ? "w-4" : "w-1.5",
                    b.severity === "critical"
                      ? "bg-red-600 dark:bg-red-400"
                      : b.severity === "warning"
                        ? "bg-amber-600 dark:bg-amber-400"
                        : "bg-muted-foreground/40",
                    i !== cursor && "opacity-60 hover:opacity-100",
                  )}
                />
              ))}
            </span>

            <button
              type="button"
              onClick={() => go(1)}
              aria-label={`Next notice (${cursor + 1} of ${visible.length})`}
              className={cn(
                "grid h-5 w-5 place-items-center rounded hover:bg-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>

            {/*
              Urgency escapes the carousel. If a critical is sitting off-screen
              the operator is told so in words, right next to the counter, so no
              click is required to learn that something serious is queued.
            */}
            {criticalCount > 0 && current.severity !== "critical" && (
              <span className="ml-1 font-semibold text-red-700 dark:text-red-400">
                · {criticalCount} urgent
              </span>
            )}
          </div>
        )}
      </div>

    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* BannerRow                                                                   */
/* -------------------------------------------------------------------------- */

interface BannerRowProps {
  banner: AppBanner;
  onDismiss: () => void;
}

/**
 * The ref is forwarded to the DISMISS BUTTON specifically, because that is the
 * element the stack needs to focus after a sibling is dismissed.
 *
 * NOTE ON ESCAPE: Escape does not dismiss, and that is deliberate, not an
 * omission. Escape belongs to modals. Wiring it here would mean closing a Radix
 * autocomplete or the command palette silently nukes a critical money warning
 * the operator never read.
 */
const BannerRow = forwardRef<HTMLButtonElement, BannerRowProps>(
  ({ banner, onDismiss }, ref) => {
    const tone = TONE[banner.severity];
    const Icon = banner.icon ?? tone.Icon;

    const dismissButton = banner.dismissal ? (
      <DismissButton ref={ref} banner={banner} tone={tone} onDismiss={onDismiss} />
    ) : null;

    /**
     * Legacy escape hatch. The stack still owns placement, ordering, collapse
     * and dismissal — including rendering the dismiss control the bespoke body
     * does not have — while the body itself stays exactly as it renders today.
     * Drop `render` per component as bodies converge.
     */
    if (banner.render) {
      return (
        <div className="relative border-b" data-severity={banner.severity}>
          {banner.render(banner)}
          {dismissButton && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {dismissButton}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className={cn("border-b", tone.wrap)}
        data-severity={banner.severity}
        data-banner-id={banner.id}
      >
        <div className="flex flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            <Icon
              className={cn("mt-0.5 h-4 w-4 shrink-0 sm:mt-0", tone.icon)}
              aria-hidden
            />
            {/*
              Title and description are adjacent inline spans inside ONE block,
              so a screen reader reads them as a single sentence rather than two
              disconnected fragments.
            */}
            <div className="min-w-0">
              <span className={cn("font-medium", tone.title)}>{banner.title}</span>
              {banner.description ? (
                <>
                  {" "}
                  <span className={tone.body}>{banner.description}</span>
                </>
              ) : null}
            </div>
          </div>
          {/* On mobile the row goes column so the CTA sits below the text at
              full width instead of being crushed against the dismiss target. */}
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            {banner.secondaryAction && (
              <ActionButton action={banner.secondaryAction} tone={tone} ghost />
            )}
            {banner.action && <ActionButton action={banner.action} tone={tone} />}
            {dismissButton}
          </div>
        </div>
      </div>
    );
  },
);
BannerRow.displayName = "BannerRow";

/* -------------------------------------------------------------------------- */
/* Dismiss control                                                             */
/* -------------------------------------------------------------------------- */

interface DismissButtonProps {
  banner: AppBanner;
  tone: Tone;
  onDismiss: () => void;
}

const DismissButton = forwardRef<HTMLButtonElement, DismissButtonProps>(
  ({ banner, tone, onDismiss }, ref) => {
    /**
     * Never a bare "Dismiss": with three stacked banners a screen reader would
     * read three identical buttons and the user could not tell which one they
     * were about to silence.
     *
     * A critical should pass `dismissal.label = "Snooze 24h"` so the control
     * tells the truth — the underlying TTL brings it back tomorrow, and a
     * button that reads like a permanent would misrepresent that.
     */
    const label = banner.dismissal?.label ?? `Dismiss: ${banner.plainTitle}`;
    const hasVisibleLabel = !!banner.dismissal?.label;

    return (
      <button
        ref={ref}
        type="button"
        onClick={onDismiss}
        aria-label={label}
        title={banner.dismissal?.tooltip}
        className={cn(
          // 44px touch target on mobile, tightened at desktop where the
          // pointer is precise.
          "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md sm:h-8",
          hasVisibleLabel ? "w-11 sm:w-auto sm:px-2" : "w-11 sm:w-8",
          "text-xs font-medium",
          tone.icon,
          "hover:bg-black/5 dark:hover:bg-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1",
        )}
      >
        <X className="h-4 w-4" aria-hidden />
        {hasVisibleLabel && (
          <span className="hidden sm:inline" aria-hidden>
            {banner.dismissal?.label}
          </span>
        )}
      </button>
    );
  },
);
DismissButton.displayName = "DismissButton";

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

function ActionButton({
  action,
  tone,
  ghost,
}: {
  action: BannerAction;
  tone: Tone;
  ghost?: boolean;
}): ReactNode {
  const classes = cn(
    "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium sm:h-8",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-1",
    ghost
      ? cn("bg-transparent hover:bg-black/5 dark:hover:bg-white/10", tone.body)
      : tone.btn,
  );

  if (action.href) {
    // Some fixes genuinely live outside the portal — a chargeback can only be
    // answered in Stripe — so an external action gets a real anchor with the
    // reverse-tabnabbing guard rather than being pushed through the router.
    if (action.external) {
      return (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
        >
          {action.label}
        </a>
      );
    }
    return (
      <Link href={action.href} className={classes}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.busy}
      className={cn(classes, "disabled:opacity-60")}
    >
      {action.busy && (
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {action.label}
    </button>
  );
}

export default BannerStack;
