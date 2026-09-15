"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { Maximize2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { TraxThread } from "./trax-thread";
import { TraxMark } from "./trax-greeting";
import { isTraxPath, useTraxOptional } from "./trax-provider";

/**
 * Trax as a docked side panel — the Stripe Assistant shape.
 *
 * ---------------------------------------------------------------------------
 * IT DOCKS: THE PAGE GETS NARROWER, NOTHING IS COVERED
 *
 * Opening the panel shrinks the whole content column — top bar included — by
 * the panel's width, the way Stripe's assistant does, so the record the
 * operator is asking about stays fully readable beside the answer.
 *
 * The mechanism is the one the Sidebar primitive already uses on the left
 * (ui-v2/sidebar.tsx), mirrored on the right. This component renders two things
 * into `SidebarProvider`'s flex ROW, after `SidebarInset`:
 *
 *   1. a FLOW GAP (`[data-slot=trax-gap]`) — an empty block whose width
 *      animates between 0 and `--trax-width`. It is a real flex item, so the
 *      `flex-1` Inset gives up exactly that much room.
 *   2. the PANEL — `position: fixed` over the space the gap reserved, so it
 *      stays viewport-tall while a long page scrolls under the top bar.
 *
 * Both move on the sidebar's own 200ms linear curve, so opening Trax and
 * collapsing the sidebar feel like the same piece of furniture.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FAILED THE FIRST TIME, AND WHAT FIXES IT
 *
 * An earlier docked version clipped the page's right edge (the Add Customer
 * button) off screen. A flex item defaults to `min-width: auto` — floored at its
 * CONTENT width — and `SidebarInset` shipped no `min-w-0`, so `flex-1` could not
 * shrink it and the row became `sidebar + content + panel`, wider than the
 * viewport. `body.v2-theme` clips horizontal overflow rather than scrolling it,
 * so the symptom was silently missing content, not a scrollbar.
 *
 * The dashboard layout now puts `min-w-0` on the Inset and its `<main>` under
 * v2 (the horizontal twin of the `min-h-0` it already documents for height).
 * With the floor gone, wide content does what it was built to do: list tables
 * scroll inside their own cards, grids take `minmax(0, …)` tracks.
 *
 * The caveat that remains is breakpoints. Tailwind's `lg:` / `xl:` read the
 * VIEWPORT, not this narrower column, so a page keeps its wide layout in a
 * column up to 440px narrower than it expects. `--trax-width` is a clamp for
 * that reason: 30vw, never below 340px, never above 440px.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE `Sheet` PRIMITIVE
 *
 * `ui-v2/sheet.tsx` renders its overlay unconditionally — dim, blur, and a
 * click-catcher over the page. Trax is consulted WHILE reading a record, so the
 * page must stay live: no backdrop, no focus trap, no scroll lock. Below `md`
 * there is no room to sit beside anything, so there it is a full-screen sheet.
 *
 * ---------------------------------------------------------------------------
 * ALWAYS MOUNTED, LAZILY FILLED
 *
 * The panel element stays mounted so it can slide both ways. Closed, it is
 * `invisible` as well as off-screen, which takes it out of the tab order and the
 * accessibility tree. It becomes visible the instant it opens and hidden only
 * once the slide-out finishes (see the class list for why that asymmetry is
 * load-bearing). The conversation inside is not rendered until the panel is
 * first opened, so a page load that never opens Trax renders no thread and
 * sends no request for it.
 *
 * On `/trax` it renders nothing: the full page IS the conversation, and a
 * docked copy beside it would be the same thread twice.
 */
export function TraxPanel() {
  /* Optional: the provider is v2-only, and a panel is never worth throwing for. */
  const trax = useTraxOptional();
  const pathname = usePathname();
  const onFullPage = isTraxPath(pathname);
  const open = !!trax?.sheetOpen && !onFullPage;

  /* First open fills the panel; it then stays filled so reopening is instant.
     Set during render (React's derived-state pattern) rather than in an
     effect, so the thread is already there on the frame the slide starts. */
  const [hasOpened, setHasOpened] = useState(false);
  if (open && !hasOpened) setHasOpened(true);

  /* Arriving back from `/trax` mounts the panel already open. Hold it in the
     closed position for two frames so it slides in — and the page column
     narrows — instead of snapping into place. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (onFullPage) {
      setArmed(false);
      return;
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [onFullPage]);
  const shown = open && armed;

  /* Hand focus back to the page when the panel closes with focus inside it.
     Without this, focus drops to <body> and a keyboard user starts again from
     the top of the page.
     The target is the last element focused OUTSIDE the panel, tracked with a
     `focusin` listener rather than read when the panel opens: the thread
     focuses its composer from its own effect, and a child's effect runs before
     this component's, so "what had focus on open" would already be the
     composer. */
  const asideRef = useRef<HTMLElement>(null);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && !asideRef.current?.contains(t)) lastOutsideFocusRef.current = t;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const wasShownRef = useRef(false);
  useEffect(() => {
    if (shown) {
      wasShownRef.current = true;
      return;
    }
    if (!wasShownRef.current) return;
    wasShownRef.current = false;
    const aside = asideRef.current;
    const target = lastOutsideFocusRef.current;
    if (aside && target?.isConnected && aside.contains(document.activeElement)) {
      target.focus({ preventScroll: true });
    }
  }, [shown]);

  /* Publish the dock state on <html> for everything that is NOT in the flex
     row: viewport-pinned overlays (the setup guide is portalled to <body>, the
     Appearance save bar is `fixed`) cannot see the gap, so they read
     `--trax-offset` instead — 0px when closed or below `md`, the panel's width
     when docked. The variables themselves live in styles/v2-theme.css, keyed on
     this attribute, so the width has one definition. The attribute exists only
     while this v2-only component is mounted: no v1 page ever gets it. */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-trax-panel", shown ? "open" : "closed");
  }, [shown]);
  useEffect(() => () => document.documentElement.removeAttribute("data-trax-panel"), []);

  if (!trax || onFullPage) return null;

  const { closeSheet, startNewConversation, expandToFullPage, chat } = trax;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    /* Escape closes the panel from anywhere inside it. `defaultPrevented`
       yields to a Radix menu or popover that already used this Escape to close
       itself; `isComposing` yields to an IME candidate window. */
    if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    e.preventDefault();
    closeSheet();
  };

  return (
    <>
      {/* The flow gap. Desktop only: below `md` the panel is a full-screen
          sheet and there is no column to share. */}
      <div
        aria-hidden
        data-slot="trax-gap"
        data-state={shown ? "open" : "closed"}
        className="hidden shrink-0 transition-[width] duration-200 ease-linear motion-reduce:transition-none md:block"
        style={{ width: shown ? "var(--trax-width, 440px)" : 0 }}
      />

      <aside
        ref={asideRef}
        aria-label="Trax"
        data-slot="trax-panel"
        data-state={shown ? "open" : "closed"}
        onKeyDown={onKeyDown}
        className={[
          "fixed inset-0 z-40 flex flex-col text-foreground",
          "md:inset-y-0 md:left-auto md:right-0 md:w-[var(--trax-width,440px)]",
          /* Visibility flips ON at once and OFF only after the slide. A
             `visibility` transition interpolates as `hidden` on its very first
             frame, and the composer focuses its textarea on exactly that frame
             — the browser silently refuses to focus a hidden element, so ⌘J
             opened a panel you could not type into. Opening therefore
             transitions `transform` alone; closing delays `visibility` by the
             slide's 200ms so the panel stays painted while it leaves. */
          shown
            ? "visible translate-x-0 [transition:transform_200ms_linear]"
            : "invisible translate-x-full [transition:transform_200ms_linear,visibility_0s_linear_200ms]",
          "motion-reduce:transition-none",
          /* ONE background. Beside the page (md+) the panel is transparent and
             the layout's app gradient shows straight through the space the gap
             reserved — no slab, no edge. Full screen on a phone it sits OVER the
             page, so it paints the same ground itself: an opaque colour plus
             the gradient. `!` because `.v2-theme .bg-app-gradient` outranks a
             bare utility.
             Joined by hand, NOT through `cn()`: tailwind-merge reads
             `bg-app-gradient` as a background COLOUR and drops `bg-background`
             as its conflict, which left the phone sheet see-through. */
          "bg-background bg-app-gradient md:!bg-transparent md:!bg-none",
        ].join(" ")}
      >
        {/* 64px, the top bar's height, so the two read as one band across the
            screen. No rule underneath: the header is set apart by space. */}
        <header className="flex h-16 shrink-0 items-center gap-2.5 pl-4 pr-3">
          <TraxMark size="sm" animated={false} />
          <span className="text-[14px] font-semibold tracking-tight">Trax</span>

          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New conversation"
                  onClick={startNewConversation}
                  /* Not mid-reply: `useChat` appends the answer to whatever
                     thread is on screen when it lands. */
                  disabled={chat.messages.length === 0 || chat.isLoading}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New conversation</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                {/* Same thread, full screen: the provider sits above the route,
                    so this continues the conversation rather than starting one. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open full screen"
                  onClick={expandToFullPage}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Maximize2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Full screen</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close Trax"
                  onClick={closeSheet}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close · ⌘J</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {hasOpened && <TraxThread density="sheet" autoFocus={shown} />}
      </aside>
    </>
  );
}
