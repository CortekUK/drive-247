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
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalAnnouncements } from "@/hooks/use-portal-announcements";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { pickSystemBanners } from "@/lib/announcements/queue";
import {
  SYSTEM_BANNER_UI,
  TONE_CLASSES,
  resolveInPortalCta,
  type AnnouncementTone,
  type PortalAnnouncement,
} from "@/lib/announcements/contract";
import { ToneIcon } from "@/components/announcements/tone-icon";

/** Set on <html> while a banner is up; global.css offsets the fixed chrome by it. */
export const SYSTEM_BANNER_HEIGHT_VAR = "--system-banner-h";

/** How long one banner holds the bar before it slides to the next, when more than one is due. */
export const SYSTEM_BANNER_ROTATE_MS = 6000;

/**
 * How long the banner showing ignores a click on its X or its button after the bar moved
 * on by ITSELF (a close, the automatic slide, a poll).
 *
 * Every banner's X and button sit in one cell, so the control of the banner that arrives
 * is exactly where the one just pressed was: the second click of a double click on X
 * dismissed the next banner, unread, and recorded it as seen — for a "Once" notice, for
 * good. A move the operator made themselves (a dot, an arrow key, a swipe) lifts it at
 * once: they are looking at what they moved to.
 */
export const SYSTEM_BANNER_ACTIVATION_GUARD_MS = 450;

/** The slide from one banner to the next (a crossfade of SYSTEM_BANNER_FADE_MS under reduced motion). */
export const SYSTEM_BANNER_SLIDE_MS = 300;
export const SYSTEM_BANNER_FADE_MS = 200;

/**
 * How far a banner's text travels as it slides out and the next one slides in. It moves
 * inside its own column, which clips it, so it never runs over the dots or the buttons.
 */
const SLIDE_DISTANCE_PX = 28;
/**
 * The button and X travel less: they sit right beside the dots, and a full slide would
 * carry them across them.
 */
const CONTROL_SLIDE_DISTANCE_PX = 8;

/** Past this horizontal travel a touch drag on the bar counts as a swipe (the card deck uses 60 on a far wider card). */
const SWIPE_THRESHOLD_PX = 40;

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
   * (0.75rem), which live inside each slide: the bar wraps at exactly the widths it did
   * before there was a slider.
   */
  texts: "min-w-0 flex-1 basis-[17.75rem]",
  /** A slider's text column is the window the slides move through. */
  textsWindow: "overflow-hidden",
  textSlide: "flex items-center gap-x-3",
  actionSlide: "flex items-center justify-end gap-1.5",
  /** On the contract's actions group: at 360px the group drops under the text and wraps, never overflows. */
  tail: "max-w-full flex-wrap justify-end",
  /** A slider's CTA and X cells: each banner's control, right-aligned in a cell as wide as the widest. */
  controlCell: "flex items-center justify-end",
  /** The bar's tone colours follow the banner showing. */
  rootFade: "transition-colors duration-300 ease-out motion-reduce:transition-none",
  /** A horizontal touch drag is ours (a swipe); a vertical one still scrolls the page. */
  touch: "touch-pan-y",
  on: "visible opacity-100",
  off: "invisible opacity-0",
} as const;

/**
 * The dots: one per banner, the showing one a wider pill. The same look as the feature
 * card deck's dots (FEATURE_CARD_UI.dots / dotButton / dot / dotActive in the contract)
 * and the feature dialog's active pill, on the bar's own colours. Each dot is a 24px
 * tall button (the showing one 32px wide around its 16px pill, the rest 24px around a
 * 6px dot), so every hit area is at least 24px and the gaps between the marks stay even.
 */
const DOTS_UI = {
  group: "flex shrink-0 items-center self-center",
  button:
    "flex h-6 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-[width,background-color] duration-300 ease-out focus-visible:ring-2 motion-reduce:transition-none",
  buttonIdle: "w-6",
  buttonActive: "w-8",
  dot: "block h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none",
  dotIdle: "w-1.5",
  dotActive: "w-4",
} as const;

/**
 * Tone-aware dot colours, light and dark. Full literal strings so Tailwind sees them. On
 * the tinted tones the showing dot is a dark shade of the tone and the others the same
 * ink at 40%; on the solid red critical bar they are white and white at 50%.
 */
const DOT_TONE: Readonly<Record<AnnouncementTone, { dot: string; active: string; button: string }>> = {
  info: {
    dot: "bg-sky-900/40 dark:bg-sky-100/40",
    active: "bg-sky-800 dark:bg-sky-200",
    button: "hover:bg-sky-100 focus-visible:ring-sky-700 dark:hover:bg-sky-900 dark:focus-visible:ring-sky-200",
  },
  success: {
    dot: "bg-emerald-900/40 dark:bg-emerald-100/40",
    active: "bg-emerald-800 dark:bg-emerald-200",
    button:
      "hover:bg-emerald-100 focus-visible:ring-emerald-700 dark:hover:bg-emerald-900 dark:focus-visible:ring-emerald-200",
  },
  warning: {
    dot: "bg-amber-900/40 dark:bg-amber-100/40",
    active: "bg-amber-800 dark:bg-amber-200",
    button: "hover:bg-amber-100 focus-visible:ring-amber-700 dark:hover:bg-amber-900 dark:focus-visible:ring-amber-200",
  },
  critical: {
    dot: "bg-white/50",
    active: "bg-white",
    button: "hover:bg-red-700 focus-visible:ring-white dark:hover:bg-red-800",
  },
};

type ControlRole = "dot" | "cta" | "dismiss";

interface SlotPosition {
  /** The banner in the slot. Tracked by id, so a poll that re-orders or adds rows never moves it. */
  id: string | null;
  /** Where it was: after it leaves the list (closed, deactivated), the banner now at this place takes over. */
  index: number;
  /**
   * The list's ids (newline-joined) when this position was set. "The banner now at this
   * place takes over" only makes sense for the SAME list minus the one that left: a list
   * sharing no id with it (the bar emptied and refilled, every row replaced in one poll,
   * a super admin switched tenant) starts from its first, highest-priority banner.
   */
  ids: string;
  /** The HARD banners' ids (newline-joined) at that time. A hard banner that arrives since takes the slot. */
  hard: string;
}

const START: SlotPosition = { id: null, index: 0, ids: "", hard: "" };

const splitIds = (joined: string) => (joined ? joined.split("\n") : []);

/**
 * A modal layer covers the bar: any Radix modal (it counts its open layers on
 * `<body data-scroll-locked="n">`: the subscription gate, an announcement dialog, the
 * migration blocker, a sheet) or an `aria-modal` screen of our own (the first-run
 * wizard). Same Radix signal as useAnnouncementBlocked, and conservative the same way: a
 * modal dropdown counts too, which only delays the slide and `shown` while it is open.
 * `[role="dialog"]` alone is NOT a signal: Radix popovers carry it.
 */
function readCoveredByModal(): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const locks = Number(document.body.getAttribute("data-scroll-locked") || 0);
  if (Number.isFinite(locks) && locks > 0) return true;
  return !!document.querySelector('[aria-modal="true"]');
}

/** Watches for a modal covering the bar, only while there is a bar to cover. */
function useCoveredByModal(active: boolean): boolean {
  const [covered, setCovered] = useState(readCoveredByModal);
  // Always equal to `covered`: `update` below is the only writer of both.
  const last = useRef(covered);
  useEffect(() => {
    if (!active || typeof document === "undefined" || !document.body) return;
    // The observer fires for every DOM change in the app while a bar is up: only a real
    // change of answer may reach React.
    const update = () => {
      const next = readCoveredByModal();
      if (next === last.current) return;
      last.current = next;
      setCovered(next);
    };
    update();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-scroll-locked", "aria-modal"],
    });
    return () => observer.disconnect();
  }, [active]);
  return covered;
}

/**
 * Keyboard focus, as the browser itself judges it (`:focus-visible`). A mouse click on a
 * dot leaves focus on it, but the pointer already pauses the bar while it is over it;
 * once the pointer leaves, a mouse user expects it to slide on again. An engine that
 * cannot answer counts every focus as keyboard focus (the cautious side).
 */
function isKeyboardFocus(el: Element | null): boolean {
  if (!el) return false;
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
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
 * WHICH BANNERS. Every banner that is due, in one slider (`pickSystemBanners`): the hard
 * ones first, then the soft ones, each in the admin's drag order. A hard banner does not
 * hide the soft ones (Sep 17 2026: with only the blocker ever showing, the other banners
 * were never seen). A hard banner that arrives mid-session takes the slot. Dialogs never
 * enter the bar.
 *
 * ONE BANNER: no dots, nothing moves, and the bar is exactly what it was before there
 * was a slider.
 *
 * MORE THAN ONE: IT SLIDES, WITH DOTS (user, Sep 17 2026: "like we have sliding effect in
 * dialogs ... dot", not a media player: no pause button, no arrows, no counter).
 *   - Every SYSTEM_BANNER_ROTATE_MS it slides to the next banner, looping. The banner
 *     showing (icon, title, body, its button and X) slides out to the left and fades
 *     while the next one slides in from the right, like the feature dialog's slides;
 *     the bar's colour follows. Under prefers-reduced-motion it crossfades instead and
 *     never moves by itself.
 *   - Dots at the end of the bar, just before the X (or before the buttons when no
 *     banner in the list has an X): one per banner, the showing one a wider pill. Each
 *     is a button ("Show announcement 2 of 3", `aria-current` on the showing one): a
 *     click slides there and gives that banner a full interval; Left / Right on a dot
 *     moves and keeps focus on the dots. A horizontal swipe on a touch screen moves too.
 *   - It waits, with no button to press, while the pointer is over the bar, while
 *     keyboard focus is inside it, while the tab is hidden and while a modal dialog or
 *     gate covers it. Each banner gets a full interval again once that ends.
 *   - A visually hidden polite live region says "Announcement 2 of 3" when the user
 *     moves (a dot, a key, a swipe, a close), and stays silent while it slides by
 *     itself, so a screen reader is not interrupted every 6 s (WAI-ARIA carousel).
 *   - A new list (the bar emptied, or every row was replaced at once) starts from its
 *     first banner, so the highest priority is always the first one seen.
 *   - NO LAYOUT JUMP. Every banner in the list is rendered, stacked in the same grid
 *     cell (the text in one stack; the buttons and the X each in their own), and the
 *     ones not showing are `invisible`, `aria-hidden` and `inert`. So the bar is always
 *     as tall as the tallest banner, the dots never move, and `--system-banner-h` does
 *     not change as it slides. The slide itself is a Web Animation on those same
 *     elements (transform and opacity only), so it never touches layout either.
 *
 * CLOSING. X (soft only) records `dismissed` for the banner showing; the next remaining
 * one slides in, and keyboard focus moves to its X (or button, or the dots) instead of
 * being lost. A hard banner has no X: it stays until the admin deactivates it or the
 * tenant leaves its smart filter, and it slides like the others.
 *
 * IMPRESSIONS. `shown` is recorded once per banner (id + revision) when it is actually
 * the one showing in a visible tab with no modal over it, never while it waits hidden
 * in the stack or under a gate. The data hook also de-duplicates per page load.
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
  const multi = count > 1;

  // ── Which one is showing ────────────────────────────────────────────────────
  const ids = banners.map((b) => b.id).join("\n");
  const hardIds = banners.filter((b) => b.blocking === "hard").map((b) => b.id);
  const hard = hardIds.join("\n");
  const [pos, setPos] = useState<SlotPosition>(START);
  let index = -1;
  if (pos.id !== null) {
    const hardBefore = splitIds(pos.hard);
    const arrived = hardIds.find((id) => !hardBefore.includes(id));
    index = banners.findIndex((b) => b.id === (arrived ?? pos.id));
  }
  if (index === -1) {
    const before = splitIds(pos.ids);
    const sameList = banners.some((b) => before.includes(b.id));
    index = sameList && pos.index < count ? pos.index : 0;
  }
  const current: PortalAnnouncement | null = banners[index] ?? null;
  // Adjusting state from the rows during render (React's documented pattern): the next
  // render derives the same position, so this settles at once. Nothing showing resets
  // it, so whatever arrives next starts from the first.
  if (current) {
    if (pos.id !== current.id || pos.index !== index || pos.ids !== ids || pos.hard !== hard) {
      setPos({ id: current.id, index, ids, hard });
    }
  } else if (pos.id !== null) {
    setPos(START);
  }
  const currentTag = current ? `${current.id}:${current.revision}` : null;
  const stackKey = banners.map((b) => `${b.id}:${b.revision}`).join("|");

  const latest = useRef({ banners, index, ids, hard });
  latest.current = { banners, index, ids, hard };

  /** Bumped by every move the user makes, so the interval restarts even on the dot already showing. */
  const [restart, setRestart] = useState(0);
  /** The move in flight: which banner is sliding out, and which way. Read once, by the slide effect. */
  const turnRef = useRef<{ from: string | null; dir: 1 | -1 } | null>(null);
  /** The user moved: the next change of banner is announced. */
  const manualRef = useRef(false);
  /**
   * The banner showing when the operator last moved the bar themselves (a dot, an arrow
   * key, a swipe). The change of banner that follows is theirs, so its X and button are
   * live at once; every other change holds them for SYSTEM_BANNER_ACTIVATION_GUARD_MS.
   */
  const movedFrom = useRef<string | null>(null);
  const held = useRef(false);
  const holdTimer = useRef<number | null>(null);
  /** A key on a dot moved: focus follows onto the new showing dot. */
  const focusDotRef = useRef(false);
  const [liveText, setLiveText] = useState("");

  const moveTo = useCallback((target: number, dir: 1 | -1, manual: boolean) => {
    const { banners: list, index: at, ids: listIds, hard: listHard } = latest.current;
    const n = list.length;
    if (n < 2) return;
    const next = ((target % n) + n) % n;
    // A click on the dot already showing is not a move: it only gives this banner a full
    // interval again. Announcing it, or clearing the flags, would report the NEXT
    // automatic slide as though the operator had made it.
    if (manual) setRestart((k) => k + 1);
    if (next === at) return;
    if (manual) {
      manualRef.current = true;
      movedFrom.current = list[at]?.id ?? null;
    }
    turnRef.current = { from: list[at]?.id ?? null, dir };
    setPos({ id: list[next].id, index: next, ids: listIds, hard: listHard });
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
      // so this is the tallest banner's height and does not change as the bar slides.
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

  // ── Waiting, and sliding on by itself ───────────────────────────────────────
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const pageHidden = usePageHidden();
  const reducedMotion = usePrefersReducedMotion();
  const covered = useCoveredByModal(count > 0);
  const rotating = multi && !hovered && !focusWithin && !pageHidden && !covered && !reducedMotion;

  useEffect(() => {
    if (!rotating) return;
    // Restarts with every change of banner and every move the user makes, so each
    // banner gets the full interval, including after a wait ends.
    const timer = window.setTimeout(() => {
      moveTo(latest.current.index + 1, 1, false);
    }, SYSTEM_BANNER_ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, currentTag, count, restart, moveTo]);

  // ── The slide ───────────────────────────────────────────────────────────────
  // Transform and opacity on the stacked elements themselves, never their size or
  // place, so the bar cannot jump. The CSS end state is already the resting state
  // (showing: visible; the rest: invisible), so an environment without Web Animations
  // simply switches, and a finished animation hands over without a flash.
  const running = useRef<Animation[]>([]);
  useIsomorphicLayoutEffect(() => {
    const turn = turnRef.current;
    turnRef.current = null;
    const root = rootRef.current;
    if (!turn || !root || !current || turn.from === current.id) return;
    for (const animation of running.current) {
      try {
        animation.cancel();
      } catch {
        // Already gone.
      }
    }
    running.current = [];
    const partsOf = (id: string | null) =>
      id === null
        ? []
        : Array.from(root.querySelectorAll<HTMLElement>("[data-slide-of]")).filter(
            (el) => el.getAttribute("data-slide-of") === id,
          );
    const timing: KeyframeAnimationOptions = {
      duration: reducedMotion ? SYSTEM_BANNER_FADE_MS : SYSTEM_BANNER_SLIDE_MS,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    };
    const play = (id: string | null, leaving: boolean) => {
      for (const el of partsOf(id)) {
        if (typeof el.animate !== "function") continue;
        const travel = reducedMotion
          ? 0
          : el.hasAttribute("data-system-banner-slide")
            ? SLIDE_DISTANCE_PX
            : CONTROL_SLIDE_DISTANCE_PX;
        const at = (x: number) => `translateX(${x}px)`;
        // The one leaving is gone a little past halfway and the one arriving starts a
        // little after, so the two never sit on top of each other at full strength.
        const keyframes: Keyframe[] = leaving
          ? [
              { offset: 0, opacity: 1, transform: at(0), visibility: "visible" },
              { offset: 0.6, opacity: 0 },
              { offset: 1, opacity: 0, transform: at(-turn.dir * travel), visibility: "visible" },
            ]
          : [
              { offset: 0, opacity: 0, transform: at(turn.dir * travel), visibility: "visible" },
              { offset: 0.25, opacity: 0 },
              { offset: 1, opacity: 1, transform: at(0), visibility: "visible" },
            ];
        try {
          running.current.push(el.animate(keyframes, timing));
        } catch {
          // No Web Animations here: it just switches.
        }
      }
    };
    play(turn.from, true);
    play(current.id, false);
    // `current` is keyed by `currentTag`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTag]);

  // ── A banner that changes under the pointer ─────────────────────────────────
  // For SYSTEM_BANNER_ACTIVATION_GUARD_MS after the bar moves on by itself, the X and
  // the button of the banner that arrived do nothing: the second click of a double click
  // on X (or a tap that lands as the bar slides) must not close a banner nobody saw.
  const lastShowing = useRef<string | null>(null);
  const hold = (on: boolean) => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    held.current = on;
    if (!on || typeof window === "undefined") return;
    holdTimer.current = window.setTimeout(() => {
      held.current = false;
      holdTimer.current = null;
    }, SYSTEM_BANNER_ACTIVATION_GUARD_MS);
  };
  useIsomorphicLayoutEffect(() => {
    const showing = current?.id ?? null;
    const before = lastShowing.current;
    lastShowing.current = showing;
    const byOperator = movedFrom.current !== null && movedFrom.current === before;
    movedFrom.current = null;
    // The first banner of a list, the bar emptying, and a new revision of the same
    // banner are not a change of control under the pointer.
    hold(before !== null && showing !== null && before !== showing && !byOperator);
    // `current` is keyed by `currentTag`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTag]);
  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  // ── Keyboard focus and the live region across a change of banner ─────────────
  // The X or button that had focus may just have been removed (closed) or made inert
  // (slid away). Remember what it was, and hand focus to the same control on the
  // banner now showing.
  const focusRestore = useRef<ControlRole | null>(null);
  const captureFocus = () => {
    const root = rootRef.current;
    const active = typeof document === "undefined" ? null : document.activeElement;
    focusRestore.current =
      root && active && root.contains(active)
        ? ((active.getAttribute("data-banner-control") as ControlRole | null) ?? "dot")
        : null;
  };

  useIsomorphicLayoutEffect(() => {
    const role = focusRestore.current;
    focusRestore.current = null;
    const dotFocus = focusDotRef.current;
    focusDotRef.current = false;
    const announce = manualRef.current;
    manualRef.current = false;
    const root = rootRef.current;
    if (!root) {
      // Nothing showing: no pointer can be over it and no focus inside it, even though
      // no pointerleave or blur arrived when it went away.
      setHovered(false);
      setFocusWithin(false);
      return;
    }
    const { index: at, banners: list } = latest.current;
    if (announce && list.length > 1) setLiveText(`Announcement ${at + 1} of ${list.length}`);
    const activeDot = () => root.querySelector<HTMLElement>("[data-system-banner-dot][aria-current]");
    if (dotFocus) {
      activeDot()?.focus();
    } else {
      const focusedInside = () => {
        const active = document.activeElement;
        return !!active && active !== document.body && root.contains(active) && !active.closest("[inert]");
      };
      if (role && !focusedInside()) {
        const showing = (r: ControlRole) =>
          root.querySelector<HTMLElement>(`[data-active] [data-banner-control="${r}"]`);
        const order: ControlRole[] = role === "cta" ? ["cta", "dismiss"] : ["dismiss", "cta"];
        let target: HTMLElement | null = null;
        for (const r of order) {
          target = showing(r);
          if (target) break;
        }
        (target ?? activeDot())?.focus();
      }
    }
    const active = document.activeElement;
    setFocusWithin(
      !!active && active !== document.body && root.contains(active) && !active.closest("[inert]") && isKeyboardFocus(active),
    );
  }, [currentTag, count]);

  // ── Impressions ─────────────────────────────────────────────────────────────
  const shownRef = useRef<{ recorder: unknown; tags: Set<string> }>({ recorder: null, tags: new Set() });
  useEffect(() => {
    // The DOM as well as the state: a gate already up when the rows arrive is only
    // reported by the watcher's effect in this same commit.
    if (!current || !currentTag || pageHidden || covered || readCoveredByModal()) return;
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
  }, [currentTag, pageHidden, covered, recordEvent]);

  // ── Touch swipe ─────────────────────────────────────────────────────────────
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  if (!current) return null;

  const tone = current.tone ?? "info";
  const toneClasses = TONE_CLASSES[tone] ?? TONE_CLASSES.info;
  const dotTone = DOT_TONE[tone] ?? DOT_TONE.info;
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
  type Slide = (typeof slides)[number];
  const hasCta = slides.some((s) => s.cta);
  const hasDismiss = slides.some((s) => s.soft);

  const slideProps = (s: Slide) => ({
    "data-slide-of": s.banner.id,
    "data-active": s.active ? "" : undefined,
    "aria-hidden": s.active ? undefined : true,
    inert: !s.active,
  });
  const slideClasses = (active: boolean, layout: string) =>
    cn(SLIDER_UI.cell, layout, active ? SLIDER_UI.on : SLIDER_UI.off);

  const ctaButton = (s: Slide) =>
    s.cta ? (
      <button
        type="button"
        data-banner-control="cta"
        className={cn(SYSTEM_BANNER_UI.action, s.classes.bannerAction)}
        onClick={() => {
          if (held.current) return;
          recordEvent(s.banner, "cta_clicked");
          router.push(s.cta!.href);
        }}
      >
        {s.banner.cta_label}
      </button>
    ) : null;

  const dismissButton = (s: Slide) =>
    s.soft ? (
      <button
        type="button"
        data-banner-control="dismiss"
        aria-label="Dismiss announcement"
        className={cn(SYSTEM_BANNER_UI.dismiss, s.classes.bannerDismiss)}
        onClick={() => {
          if (held.current) return;
          captureFocus();
          if (multi) {
            // The next remaining banner slides in where this one was.
            turnRef.current = { from: null, dir: 1 };
            manualRef.current = true;
            setRestart((k) => k + 1);
          }
          recordEvent(s.banner, "dismissed");
        }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    ) : null;

  const onDotKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    focusDotRef.current = true;
    moveTo(index + dir, dir, true);
  };

  const dots = (
    <div className={DOTS_UI.group} data-system-banner-dots="">
      {slides.map((s, i) => (
        <button
          key={s.banner.id}
          type="button"
          data-banner-control="dot"
          data-system-banner-dot={i}
          aria-label={`Show announcement ${i + 1} of ${count}`}
          aria-current={s.active ? "true" : undefined}
          className={cn(DOTS_UI.button, s.active ? DOTS_UI.buttonActive : DOTS_UI.buttonIdle, dotTone.button)}
          onClick={() => moveTo(i, i >= index ? 1 : -1, true)}
          onKeyDown={onDotKeyDown}
        >
          <span
            aria-hidden="true"
            className={cn(DOTS_UI.dot, s.active ? cn(DOTS_UI.dotActive, dotTone.active) : cn(DOTS_UI.dotIdle, dotTone.dot))}
          />
        </button>
      ))}
    </div>
  );

  const ctaStack = (
    <div className={SLIDER_UI.stack} data-system-banner-ctas="">
      {slides.map((s) => (
        <div key={s.banner.id} {...slideProps(s)} className={slideClasses(s.active, SLIDER_UI.controlCell)}>
          {ctaButton(s)}
        </div>
      ))}
    </div>
  );

  const dismissStack = (
    <div className={SLIDER_UI.stack} data-system-banner-dismisses="">
      {slides.map((s) => (
        <div key={s.banner.id} {...slideProps(s)} className={slideClasses(s.active, SLIDER_UI.controlCell)}>
          {dismissButton(s)}
        </div>
      ))}
    </div>
  );

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
        data-rotating={multi ? String(rotating) : undefined}
        className={cn(
          SYSTEM_BANNER_UI.position,
          SYSTEM_BANNER_UI.root,
          toneClasses.banner,
          multi && SLIDER_UI.rootFade,
          multi && SLIDER_UI.touch,
        )}
        onPointerEnter={(e: PointerEvent<HTMLDivElement>) => {
          // A touch has no hover: a tap must not leave the bar waiting for good.
          if (e.pointerType !== "touch") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
          swipeStart.current = multi && e.pointerType !== "mouse" ? { x: e.clientX, y: e.clientY } : null;
        }}
        onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start || !multi) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
          const dir = dx < 0 ? 1 : -1;
          moveTo(index + dir, dir, true);
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        onFocus={(e: FocusEvent<HTMLDivElement>) => {
          if (isKeyboardFocus(e.target)) setFocusWithin(true);
        }}
        onBlur={(e: FocusEvent<HTMLDivElement>) => {
          const next = e.relatedTarget as Node | null;
          if (!next || !e.currentTarget.contains(next)) setFocusWithin(false);
        }}
      >
        <div className={SYSTEM_BANNER_UI.inner}>
          <div className={cn(SLIDER_UI.stack, SLIDER_UI.texts, multi && SLIDER_UI.textsWindow)} data-system-banner-texts="">
            {slides.map((s) => (
              <div
                key={s.banner.id}
                data-system-banner-slide={s.banner.id}
                {...slideProps(s)}
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

          {!multi ? (
            (hasCta || hasDismiss) && (
              <div className={cn(SYSTEM_BANNER_UI.actions, SLIDER_UI.tail)}>
                <div className={SLIDER_UI.stack} data-system-banner-actions="">
                  {slides.map((s) => (
                    <div
                      key={s.banner.id}
                      data-system-banner-slide-actions={s.banner.id}
                      {...slideProps(s)}
                      className={slideClasses(s.active, SLIDER_UI.actionSlide)}
                    >
                      {ctaButton(s)}
                      {dismissButton(s)}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className={cn(SYSTEM_BANNER_UI.actions, SLIDER_UI.tail)} data-system-banner-tail="">
              {hasDismiss ? (
                <>
                  {hasCta && ctaStack}
                  {dots}
                  {dismissStack}
                </>
              ) : (
                <>
                  {dots}
                  {hasCta && ctaStack}
                </>
              )}
              <span className="sr-only" aria-live="polite" aria-atomic="true" data-system-banner-live="">
                {liveText}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
