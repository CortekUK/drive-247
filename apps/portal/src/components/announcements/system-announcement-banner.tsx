"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { pickSystemBanners } from "@/lib/announcements/queue";
import {
  SYSTEM_BANNER_UI,
  TONE_CLASSES,
  resolveInPortalCta,
  type PortalAnnouncement,
} from "@/lib/announcements/contract";
import { ToneIcon } from "@/components/announcements/tone-icon";

/** Set on <html> while a banner is up; global.css offsets the fixed chrome by it. */
export const SYSTEM_BANNER_HEIGHT_VAR = "--system-banner-h";

/** How long one banner holds the bar before the next one, when more than one is due. */
export const SYSTEM_BANNER_ROTATE_MS = 8000;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The slider's own classes. Local on purpose: the contract's SYSTEM_BANNER_UI map is
 * shared with the admin preview and is only ever APPENDED to here, never replaced.
 */
const SLIDER_UI = {
  /** One grid cell holding every slide, so the cell is as tall and as wide as the largest. */
  stack: "grid",
  /** Every slide sits in that same cell. */
  cell: "col-start-1 row-start-1 min-w-0",
  /**
   * The text column. `17.75rem` = the old text basis (16rem) + the icon (1rem) + its gap
   * (0.75rem), which now live inside each slide: the bar wraps at exactly the widths
   * it did with one banner.
   */
  texts: "min-w-0 flex-1 basis-[17.75rem]",
  textSlide: "flex items-center gap-x-3",
  actionSlide: "flex items-center justify-end gap-1.5",
  /** On the contract's actions group: at 360px the controls and a long button wrap, never overflow. */
  tail: "max-w-full flex-wrap justify-end",
  controls: "flex items-center",
  counter: "text-center text-[12px] font-semibold leading-5 tabular-nums",
  chevron: "h-4 w-4",
  crossfade: "transition-[opacity,visibility] duration-200 ease-out motion-reduce:transition-none",
  rootFade: "transition-colors duration-200 ease-out motion-reduce:transition-none",
  on: "visible opacity-100",
  off: "invisible opacity-0",
} as const;

type ControlRole = "prev" | "next" | "cta" | "dismiss";

interface SlotPosition {
  /** The banner in the slot. Tracked by id, so a poll that re-orders or adds rows never moves it. */
  id: string | null;
  /** Where it was: after it leaves the list (closed, deactivated), the banner now at this place takes over. */
  index: number;
  /** Whether the list was hard-only. A flip (a blocker arrives or clears) restarts from the first. */
  hardOnly: boolean;
}

// The effect below measures before paint, so the sidebar, top bar and content never
// flash under the banner for a frame. The layout is a client component that still
// server-renders, where there is nothing to measure.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function readReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches;
  } catch {
    return false;
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    let query: MediaQueryList | null = null;
    try {
      query = window.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
    } catch {
      query = null;
    }
    if (!query) return;
    const mql = query;
    const update = () => setReduced(!!mql.matches);
    update();
    try {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    } catch {
      try {
        mql.addListener(update);
        return () => mql.removeListener(update);
      } catch {
        return undefined;
      }
    }
  }, []);
  return reduced;
}

const readPageHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(readPageHidden);
  useEffect(() => {
    const update = () => setHidden(readPageHidden());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

/**
 * The ONE full-width system banner slot, for every tenant in both chromes.
 *
 * WHERE IT SITS. Mounted as the first child of the dashboard layout's
 * DynamicThemeProvider, OUTSIDE the sidebar wrapper, as `position: fixed` across the
 * top of the viewport: end to end, over the sidebar column and above the top bar
 * (meeting: "like the red Stripe banner, but full width"). Not `sticky`: sticky does
 * not pin on v1, where `html, body { overflow-x: hidden }` makes <body> a scroll
 * container that never scrolls.
 *
 * MAKING ROOM. A fixed bar takes no space, so two things push the app down by exactly
 * its measured height:
 *   - an in-flow spacer rendered right before the app shell, for the document flow;
 *   - `html[data-system-banner]` + `--system-banner-h` for everything already pinned
 *     to the viewport (both sidebars, the sticky v2 top bar, the docked Trax panel,
 *     the bounded-height Messages/Trax routes). Those rules live in global.css,
 *     attribute selectors only. Same pattern as TraxPanel's `data-trax-panel`.
 * Both are removed the moment there is nothing to show, so a tenant with no active
 * banner gets byte-for-byte the page it had.
 *
 * WHICH BANNERS. Rows arrive in priority order (`pickSystemBanners`). While any HARD
 * banner applies, the bar holds only the hard ones: a blocker is never rotated away by
 * a soft notice. Otherwise it holds every soft banner that is due.
 *
 * MORE THAN ONE: A SLIDER.
 *   - Previous / next buttons and "1 / 3" sit at the end of the bar, before the
 *     button and X of the banner showing. Left / Right arrow keys work anywhere inside
 *     the bar. A visually hidden live region says "Announcement 1 of 3".
 *   - It moves on by itself every SYSTEM_BANNER_ROTATE_MS, but never while the pointer
 *     is over the bar, while focus is inside it, while the tab is hidden, or at all
 *     under prefers-reduced-motion (the buttons and keys still work there). The live
 *     region is `polite` whenever it is not moving by itself and `off` while it is, so
 *     a screen reader hears the position when the user changes it, not every 8 s
 *     (WAI-ARIA carousel pattern).
 *   - NO LAYOUT JUMP. Every banner in the list is rendered, stacked in the same grid
 *     cell (the text in one stack, the button and X in another), and the ones not
 *     showing are `invisible`, `aria-hidden` and `inert`. So the bar is always as tall
 *     as the tallest banner, the controls never move, and `--system-banner-h` does not
 *     change as it rotates. The slides crossfade (about 200 ms; none under reduced
 *     motion) and the bar's tone colours follow the banner showing.
 *   - Each banner keeps its own tone, text, button and X (soft only).
 *
 * CLOSING. X records `dismissed` for the banner showing; the next one takes the slot
 * straight away, and keyboard focus moves to its X (or button) instead of being lost.
 * A hard banner has no X and stays until the admin deactivates it or the tenant leaves
 * its smart filter.
 *
 * IMPRESSIONS. `shown` is recorded once per banner (id + revision) when it is actually
 * the one showing in a visible tab, never while it waits hidden in the stack. The data
 * hook also de-duplicates per page load.
 *
 * The body renders in full and wraps; its line breaks collapse to spaces in this
 * one-line form. Plain text only.
 */
export function SystemAnnouncementBanner(): JSX.Element | null {
  const router = useRouter();
  const { system, recordEvent } = usePortalAnnouncements();
  const { canAccessRoute } = useManagerPermissions();

  const banners = pickSystemBanners(system);
  const count = banners.length;
  const hardOnly = count > 0 && banners[0].blocking === "hard";

  // ── Which one is showing ────────────────────────────────────────────────────
  const [pos, setPos] = useState<SlotPosition>({ id: null, index: 0, hardOnly: false });
  let index = pos.id === null ? -1 : banners.findIndex((b) => b.id === pos.id);
  if (index === -1) index = pos.hardOnly === hardOnly && pos.index < count ? pos.index : 0;
  const current: PortalAnnouncement | null = banners[index] ?? null;
  if (current && (pos.id !== current.id || pos.index !== index || pos.hardOnly !== hardOnly)) {
    // Adjusting state from the rows during render (React's documented pattern): the
    // next render derives the same position, so this settles at once.
    setPos({ id: current.id, index, hardOnly });
  }
  const currentTag = current ? `${current.id}:${current.revision}` : null;
  const stackKey = banners.map((b) => `${b.id}:${b.revision}`).join("|");

  const latest = useRef({ banners, index, hardOnly });
  latest.current = { banners, index, hardOnly };

  const go = useCallback((delta: number) => {
    const { banners: list, index: at, hardOnly: hard } = latest.current;
    if (list.length < 2) return;
    const next = (((at + delta) % list.length) + list.length) % list.length;
    setPos({ id: list[next].id, index: next, hardOnly: hard });
  }, []);

  // ── Refs, measurement ───────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  // Centred is right for one line. Once a banner's text wraps, a centred icon floats
  // beside a middle line (the third of five on a phone), so it moves up to the first
  // line. Newline-joined ids of the banners whose text wraps.
  const [wrapped, setWrapped] = useState("");

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.removeAttribute("data-system-banner");
      root.style.removeProperty(SYSTEM_BANNER_HEIGHT_VAR);
    };
    const el = rootRef.current;
    if (!stackKey || !el) {
      clear();
      setHeight(0);
      setWrapped("");
      return;
    }
    const texts = () => Array.from(el.querySelectorAll<HTMLElement>("[data-system-banner-text]"));
    const publish = () => {
      // The whole stack is laid out (the hidden slides are `invisible`, not removed),
      // so this is the tallest banner's height and does not change as the bar rotates.
      const measured = Math.ceil(el.getBoundingClientRect().height);
      setHeight(measured);
      root.setAttribute("data-system-banner", "");
      root.style.setProperty(SYSTEM_BANNER_HEIGHT_VAR, `${measured}px`);
      const wraps: string[] = [];
      for (const text of texts()) {
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight) || 20;
        if (text.getBoundingClientRect().height > lineHeight * 1.5) {
          wraps.push(text.getAttribute("data-system-banner-text") ?? "");
        }
      }
      setWrapped(wraps.join("\n"));
    };
    publish();
    // Re-measure when the text wraps differently (resize, zoom, font load). An
    // environment without a working ResizeObserver keeps the first measurement
    // rather than taking the whole layout down with it.
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => publish());
      observer.observe(el);
      for (const text of texts()) observer.observe(text);
    } catch {
      observer = null;
    }
    return () => {
      observer?.disconnect();
      clear();
    };
  }, [stackKey]);

  // ── Pausing and moving on by itself ─────────────────────────────────────────
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const pageHidden = usePageHidden();
  const reducedMotion = usePrefersReducedMotion();
  const rotating = count > 1 && !hovered && !focusWithin && !pageHidden && !reducedMotion;

  useEffect(() => {
    if (!rotating) return;
    // Restarts with every change of banner, so each one gets the full interval,
    // including after a manual move or the end of a pause.
    const timer = window.setTimeout(() => go(1), SYSTEM_BANNER_ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, currentTag, count, go]);

  // ── Keyboard focus across a change of banner ────────────────────────────────
  // The X or button that had focus may just have been removed (closed) or made inert
  // (rotated away). Remember what it was, and hand focus to the same control on the
  // banner now showing.
  const focusRestore = useRef<ControlRole | null>(null);
  const captureFocus = () => {
    const root = rootRef.current;
    const active = typeof document === "undefined" ? null : document.activeElement;
    focusRestore.current =
      root && active && root.contains(active)
        ? ((active.getAttribute("data-banner-control") as ControlRole | null) ?? "next")
        : null;
  };

  useIsomorphicLayoutEffect(() => {
    const role = focusRestore.current;
    focusRestore.current = null;
    const root = rootRef.current;
    if (!root) {
      // Nothing showing: no pointer can be over it and no focus inside it, even though
      // no pointerleave or blur arrived when it went away.
      setHovered(false);
      setFocusWithin(false);
      return;
    }
    const focusedInside = () => {
      const active = document.activeElement;
      return !!active && active !== document.body && root.contains(active) && !active.closest("[inert]");
    };
    if (role && !focusedInside()) {
      const showing = root.querySelector<HTMLElement>("[data-system-banner-slide-actions][data-active]");
      const order: ControlRole[] = role === "cta" ? ["cta", "dismiss"] : ["dismiss", "cta"];
      let target: HTMLElement | null = null;
      for (const r of order) {
        target = showing?.querySelector<HTMLElement>(`[data-banner-control="${r}"]`) ?? null;
        if (target) break;
      }
      (target ?? root.querySelector<HTMLElement>('[data-banner-control="next"]'))?.focus();
    }
    setFocusWithin(focusedInside());
  }, [currentTag, count]);

  // ── Impressions ─────────────────────────────────────────────────────────────
  const shownRef = useRef<{ recorder: unknown; tags: Set<string> }>({ recorder: null, tags: new Set() });
  useEffect(() => {
    if (!current || !currentTag || pageHidden) return;
    const seen = shownRef.current;
    if (seen.recorder !== recordEvent) {
      // A different tenant or staff user: a fresh session of impressions.
      seen.recorder = recordEvent;
      seen.tags = new Set();
    }
    if (seen.tags.has(currentTag)) return;
    seen.tags.add(currentTag);
    recordEvent(current, "shown");
    // `current` is keyed by `currentTag`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTag, pageHidden, recordEvent]);

  if (!current) return null;

  const tone = current.tone ?? "info";
  const toneClasses = TONE_CLASSES[tone] ?? TONE_CLASSES.info;
  const multi = count > 1;
  const wrappedIds = wrapped ? wrapped.split("\n") : [];

  const slides = banners.map((b, i) => {
    const slideTone = b.tone ?? "info";
    const cta = b.cta_label ? resolveInPortalCta(b.cta_url) : null;
    return {
      banner: b,
      active: i === index,
      tone: slideTone,
      classes: TONE_CLASSES[slideTone] ?? TONE_CLASSES.info,
      soft: b.blocking !== "hard",
      cta: cta && canAccessRoute(cta.pathname) ? cta : null,
      body: (b.body ?? "").replace(/\n+/g, " "),
    };
  });
  const hasActions = slides.some((s) => s.cta || s.soft);

  const slideProps = (active: boolean) => ({
    "data-active": active ? "" : undefined,
    "aria-hidden": active ? undefined : true,
    inert: !active,
  });
  const slideClasses = (active: boolean, layout: string) =>
    cn(SLIDER_UI.cell, layout, multi && SLIDER_UI.crossfade, active ? SLIDER_UI.on : SLIDER_UI.off);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!multi || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    captureFocus();
    go(e.key === "ArrowRight" ? 1 : -1);
  };

  return (
    <>
      <div aria-hidden="true" data-system-banner-spacer="" style={{ height }} />
      <div
        ref={rootRef}
        role="region"
        aria-label="Announcement"
        aria-roledescription={multi ? "carousel" : undefined}
        data-system-banner-root=""
        data-blocking={current.blocking}
        data-tone={tone}
        data-banner-count={count}
        data-banner-index={index}
        className={cn(
          SYSTEM_BANNER_UI.position,
          SYSTEM_BANNER_UI.root,
          toneClasses.banner,
          multi && SLIDER_UI.rootFade,
        )}
        onKeyDown={onKeyDown}
        onPointerEnter={(e: PointerEvent<HTMLDivElement>) => {
          // A touch has no hover: a tap must not leave the bar paused for good.
          if (e.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e: FocusEvent<HTMLDivElement>) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) setFocusWithin(false);
        }}
      >
        <div className={SYSTEM_BANNER_UI.inner}>
          <div className={cn(SLIDER_UI.stack, SLIDER_UI.texts)} data-system-banner-texts="">
            {slides.map((s) => (
              <div
                key={s.banner.id}
                data-system-banner-slide={s.banner.id}
                {...slideProps(s.active)}
                className={slideClasses(s.active, SLIDER_UI.textSlide)}
              >
                <ToneIcon
                  tone={s.tone}
                  className={cn(SYSTEM_BANNER_UI.icon, wrappedIds.includes(s.banner.id) && "mt-0.5 self-start")}
                />
                <p data-system-banner-text={s.banner.id} className={SYSTEM_BANNER_UI.text}>
                  <strong className={SYSTEM_BANNER_UI.title}>{s.banner.title}</strong>
                  {s.body && <span className={SYSTEM_BANNER_UI.body}>{s.body}</span>}
                </p>
              </div>
            ))}
          </div>
          {(multi || hasActions) && (
            <div className={cn(SYSTEM_BANNER_UI.actions, SLIDER_UI.tail)}>
              {multi && (
                <div className={SLIDER_UI.controls} data-system-banner-controls="">
                  <button
                    type="button"
                    data-banner-control="prev"
                    aria-label="Previous announcement"
                    className={cn(SYSTEM_BANNER_UI.dismiss, toneClasses.bannerDismiss)}
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft className={SLIDER_UI.chevron} aria-hidden="true" />
                  </button>
                  <span
                    aria-hidden="true"
                    data-system-banner-counter=""
                    className={SLIDER_UI.counter}
                    // Wide enough for the longest "n / n" at this count, so the arrows never shift.
                    style={{ minWidth: `${String(count).length * 2 + 3}ch` }}
                  >
                    {index + 1} / {count}
                  </span>
                  <button
                    type="button"
                    data-banner-control="next"
                    aria-label="Next announcement"
                    className={cn(SYSTEM_BANNER_UI.dismiss, toneClasses.bannerDismiss)}
                    onClick={() => go(1)}
                  >
                    <ChevronRight className={SLIDER_UI.chevron} aria-hidden="true" />
                  </button>
                  <span
                    className="sr-only"
                    aria-live={rotating ? "off" : "polite"}
                    aria-atomic="true"
                    data-system-banner-live=""
                  >
                    Announcement {index + 1} of {count}
                  </span>
                </div>
              )}
              {hasActions && (
                <div className={SLIDER_UI.stack} data-system-banner-actions="">
                  {slides.map((s) => (
                    <div
                      key={s.banner.id}
                      data-system-banner-slide-actions={s.banner.id}
                      {...slideProps(s.active)}
                      className={slideClasses(s.active, SLIDER_UI.actionSlide)}
                    >
                      {s.cta && (
                        <button
                          type="button"
                          data-banner-control="cta"
                          className={cn(SYSTEM_BANNER_UI.action, s.classes.bannerAction)}
                          onClick={() => {
                            recordEvent(s.banner, "cta_clicked");
                            router.push(s.cta!.href);
                          }}
                        >
                          {s.banner.cta_label}
                        </button>
                      )}
                      {s.soft && (
                        <button
                          type="button"
                          data-banner-control="dismiss"
                          aria-label="Dismiss announcement"
                          className={cn(SYSTEM_BANNER_UI.dismiss, s.classes.bannerDismiss)}
                          onClick={() => {
                            captureFocus();
                            recordEvent(s.banner, "dismissed");
                          }}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
