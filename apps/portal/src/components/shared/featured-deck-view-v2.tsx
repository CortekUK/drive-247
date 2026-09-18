"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  browserStorage,
  readLastShown,
  startIndex,
  writeLastShown,
  type DeckCard,
  type FeaturedHandlers,
} from "@/lib/featured-cards";

/**
 * The featured deck, presentation only: one card at a time in one fixed slot.
 *
 * It is handed an already-ordered list (lib/featured-cards.ts `buildDeck`) and
 * owns only what happens on screen: which card is showing, rotation between
 * visits, auto-advance and its pauses, and manual navigation. The connected
 * wrapper that gathers the list from hooks is
 * components/shared/featured-deck-v2.tsx; tabs use that one.
 *
 * ---------------------------------------------------------------------------
 * FIXED SIZE, ONE ROOT
 *
 * This is the front face of a flip that animates when the face's measured
 * height changes (rentals-overview-flip.tsx), so rotating cards must never
 * change the height. The root is a grid item that stretches to the row the
 * chart sets, with a minimum for when the row stacks on a narrow screen. The
 * card is minimal (team lead, Sep 16 2026): a diagonal "opens" arrow at the top
 * right, and at the bottom the title (truncated) over a two-line description
 * (always reserved). No badge and no art; a paper-like background graphic is
 * planned for the empty middle. The root element is the same node from the first paint
 * (an empty shell while the inputs resolve) to the last card.
 *
 * ---------------------------------------------------------------------------
 * MOTION
 *
 * Auto-advance every ADVANCE_MS, paused while the pointer is over the deck,
 * while focus is inside it and while the tab is hidden. Any manual navigation
 * (dots, arrows, arrow keys) stops it for good: someone who has taken the wheel should not have it taken back. Under
 * reduced motion there is no auto-advance, no slide fade and no art animation.
 *
 * ---------------------------------------------------------------------------
 * ACCESSIBILITY
 *
 * APG carousel pattern: the root is a labelled region with
 * aria-roledescription="carousel"; the card on screen is a group with
 * aria-roledescription="slide" labelled "n of N". The polite live region speaks
 * only after a manual change, never on auto-advance, which would talk over
 * whatever the reader is doing. Arrow keys move while focus is anywhere in the
 * deck, and a keyboard user whose focus was on the card stays on the new card.
 * Titles and subtitles are rendered as text, never HTML.
 */

export const ADVANCE_MS = 8000;

/**
 * Dots up to this many cards; past it, an "n / N" count takes their place.
 *
 * MEASURED, not guessed. At a 1024px screen (16rem sidebar) the hero row is
 * ~720px and this card ~162px, leaving ~80px for dots beside the two 24px
 * step buttons. Seven fixed 12px dots overflowed there and clipped, so the dot
 * for the card on screen could be the one cut off. Each dot's hit box now
 * shrinks from 12px to 8px (the 6px dot itself never does), which fits eight
 * at that width (7 x 8 + 18 = 74px); a ninth would clip again, so the count
 * takes over. Prev/next reach every card either way. (HeroRow has since given
 * the card column a 15rem floor, so at lg the card is at least 240px; the
 * limit still holds for the narrowest case and costs nothing wider.)
 */
export const MAX_DOTS = 8;

/**
 * Minimal: a soft primary-tinted ground and a hairline border that deepens to
 * purple on hover. No glows, no lift, no shadow (team lead, Sep 16 2026).
 */
export const FEATURED_SHELL_CLASS =
  "group/deck relative isolate flex min-h-[15rem] flex-col overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent text-foreground transition-colors duration-200 hover:border-primary/40 motion-reduce:transition-none";

export function FeaturedCardShell({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { children?: ReactNode; "data-tour"?: string; "data-motion"?: string }) {
  return (
    <section className={cn(FEATURED_SHELL_CLASS, className)} {...rest}>
      {children}
    </section>
  );
}

/** The inside of the card: the "opens" arrow, then the title and description. */
export function FeaturedCardFace({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <div className="relative flex shrink-0 justify-end">
        {/* Diagonal on purpose: it says "this opens", which a plain right
            arrow (read as "next") did not. */}
        <ArrowUpRight aria-hidden className="size-5 shrink-0 text-primary dark:text-[hsl(var(--chart-2))]" />
      </div>
      <div className="relative shrink-0">
        <div className="truncate text-lg font-bold leading-6 tracking-tight" title={title}>
          {title}
        </div>
        <div className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-muted-foreground">{subtitle}</div>
      </div>
    </>
  );
}

const ACTION_CLASS =
  "relative flex min-h-0 flex-1 flex-col justify-between rounded-2xl px-4 pt-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function CardAction({
  card,
  handlers,
  actionRef,
  withControls,
}: {
  card: DeckCard;
  handlers: FeaturedHandlers;
  actionRef: MutableRefObject<HTMLElement | null>;
  withControls: boolean;
}) {
  const className = cn(ACTION_CLASS, withControls ? "pb-1.5" : "pb-4");
  const setRef = (el: HTMLElement | null) => {
    actionRef.current = el;
  };
  const face = <FeaturedCardFace title={card.title} subtitle={card.subtitle} />;

  if (card.action.kind === "handler") {
    const handler = handlers[card.action.handler];
    return (
      <button ref={setRef} type="button" className={className} onClick={() => handler?.()}>
        {face}
      </button>
    );
  }
  return (
    <Link ref={setRef} href={card.action.href} className={className}>
      {face}
    </Link>
  );
}

/**
 * The dots are the only visible shape of the dot buttons and the only sighted
 * count of the deck, so an idle dot must hold 3:1 against the card (WCAG
 * 1.4.11), and the active one must still stand out from it.
 *
 * MEASURED against the card beside each dot (scratchpad featured-deck/run.mjs,
 * `contrast`). Idle dots at primary/25 measured 1.5:1 in light mode and 1.1:1
 * in dark, where --primary sinks into the ground. Now: light idle primary/70
 * (primary/60 only reached 3.0:1 on the pale end of the gradient), active
 * primary 6.8:1; dark moves the dots to --chart-1, the lightest chart indigo,
 * idle at 60% about 4:1 and active 9.6:1. Width marks the active dot as well.
 */
const DOT_CLASS = {
  active: "w-4 bg-primary dark:bg-[hsl(var(--chart-1))]",
  idle: "w-1.5 bg-primary/70 group-hover/dot:bg-primary/90 dark:bg-[hsl(var(--chart-1)/0.6)] dark:group-hover/dot:bg-[hsl(var(--chart-1)/0.8)]",
} as const;

// p-1 around a 16px icon: a 24px target (WCAG 2.5.8). The dots stay small; these
// two reach every card, which is what the target-size exception asks for.
const STEP_BUTTON =
  "rounded-full p-1 text-muted-foreground/70 outline-none transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

export interface FeaturedDeckViewProps {
  /** Ordered, eligible cards (`buildDeck`). */
  cards: readonly DeckCard[];
  /**
   * False while the inputs that decide the deck are still resolving. The shell
   * is drawn (if there is anything to show yet) but no card is chosen, so the
   * visit's start card is picked once, from the final list.
   */
  ready?: boolean;
  /** Callbacks by handler name. */
  handlers?: FeaturedHandlers;
  /** localStorage key for rotation between visits. Omit to start at the first card. */
  storageKey?: string;
  /** data-tour anchor on the root. */
  anchor?: string;
  /** Accessible name of the carousel region. */
  label?: string;
  className?: string;
}

export function FeaturedDeckView({
  cards,
  ready = true,
  handlers = {},
  storageKey,
  anchor,
  label = "Featured",
  className,
}: FeaturedDeckViewProps) {
  const reduceMotion = useReducedMotion() === true;
  const count = cards.length;

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const lastIndexRef = useRef(0);
  const slideRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const refocusRef = useRef(false);

  // THE START CARD, chosen once, the first time the deck is ready with cards:
  // the one after the card shown last visit. Chosen during render (not in an
  // effect) so there is no frame showing the wrong card; storage is only read
  // here once `ready`, which the connected deck never is on the server.
  if (ready && count > 0 && currentId === null) {
    const last = storageKey ? readLastShown(browserStorage(), storageKey) : null;
    setCurrentId(cards[startIndex(cards, last)].id);
  }

  const found = currentId === null ? -1 : cards.findIndex((c) => c.id === currentId);
  // The card on screen can leave the deck (a gate closing on a reload): the
  // card that slid into its place shows, clamped to the end.
  const activeIndex = count === 0 ? -1 : found !== -1 ? found : Math.min(lastIndexRef.current, count - 1);
  const active = ready && activeIndex >= 0 ? cards[activeIndex] : null;
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (activeId !== null && currentId !== null && activeId !== currentId) setCurrentId(activeId);
  }, [activeId, currentId]);

  // Remember what was on screen, so the next visit starts on the card after it.
  useEffect(() => {
    if (activeId === null) return;
    lastIndexRef.current = activeIndex;
    if (storageKey) writeLastShown(browserStorage(), storageKey, activeId);
  }, [activeId, activeIndex, storageKey]);

  // A keyboard user whose focus was on the card keeps focus on the new card
  // (the card element is replaced when the slide changes).
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    actionRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    const sync = () => setDocumentHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const paused = stopped || reduceMotion || hovered || focusInside || documentHidden;

  // One timeout per card on screen, so every card gets its full interval and a
  // pause always restarts the count. Keyed on the id, not the array: the page
  // rebuilds `cards` on every render and must not keep resetting the clock.
  useEffect(() => {
    if (!ready || count < 2 || paused || activeId === null) return;
    const timer = window.setTimeout(() => {
      const list = cardsRef.current;
      if (list.length < 2) return;
      const i = list.findIndex((c) => c.id === activeId);
      setCurrentId(list[(i + 1) % list.length].id);
    }, ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, count, paused, activeId]);

  const goTo = useCallback((target: number) => {
    const list = cardsRef.current;
    const n = list.length;
    if (n < 2) return;
    const i = ((target % n) + n) % n;
    const card = list[i];
    setStopped(true);
    setCurrentId(card.id);
    setLiveMessage(`${card.title}, ${i + 1} of ${n}`);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!ready || count < 2 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // React bubbles events through portals; only keys pressed inside the deck.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    refocusRef.current = !!slideRef.current?.contains(document.activeElement);
    goTo(activeIndex + delta);
  };

  if (count === 0) return null;

  const withControls = ready && count > 1;

  return (
    <>
      <FeaturedCardShell
        aria-roledescription={ready ? "carousel" : undefined}
        aria-label={ready ? label : undefined}
        aria-hidden={ready ? undefined : true}
        data-tour={anchor}
        data-motion={reduceMotion ? "still" : "live"}
        className={className}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocusInside(true)}
        onBlur={(e) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFocusInside(false);
        }}
        onKeyDown={onKeyDown}
      >
        {active && (
          <div
            key={active.id}
            ref={slideRef}
            role="group"
            aria-roledescription="slide"
            aria-label={`${activeIndex + 1} of ${count}`}
            className="relative flex min-h-0 flex-1 flex-col"
            style={reduceMotion ? undefined : { animation: "v2-fade-in 0.35s ease-out" }}
          >
            <CardAction
              card={active}
              handlers={handlers}
              actionRef={actionRef}
              withControls={withControls}
            />
          </div>
        )}

        {withControls && (
          <div className="relative flex h-8 shrink-0 items-center justify-between gap-2 px-3 pb-2">
            {count <= MAX_DOTS ? (
              <div className="flex min-w-0 items-center overflow-hidden">
                {cards.map((card, i) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Show ${card.title}, ${i + 1} of ${count}`}
                    aria-current={i === activeIndex ? "true" : undefined}
                    className={cn(
                      "group/dot flex h-6 shrink items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      // Hit boxes shrink on a narrow card; the dot inside does not. See MAX_DOTS.
                      i === activeIndex ? "w-[22px] min-w-[18px]" : "w-3 min-w-[8px]",
                    )}
                  >
                    <span className={cn("block h-1.5 shrink-0 rounded-full transition-all duration-300 motion-reduce:transition-none", DOT_CLASS[i === activeIndex ? "active" : "idle"])} />
                  </button>
                ))}
              </div>
            ) : (
              // The slide already says "n of N" to assistive tech; this is the sighted copy.
              <span aria-hidden className="text-xs tabular-nums text-muted-foreground" data-deck-count="">
                {activeIndex + 1} / {count}
              </span>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" onClick={() => goTo(activeIndex - 1)} aria-label="Previous card" className={STEP_BUTTON}>
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" onClick={() => goTo(activeIndex + 1)} aria-label="Next card" className={STEP_BUTTON}>
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}

        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {liveMessage}
        </p>
      </FeaturedCardShell>
    </>
  );
}
