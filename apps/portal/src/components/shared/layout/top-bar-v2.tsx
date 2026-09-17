"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CircleDollarSign, MessageCircle, Search, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import { Separator } from "@/components/ui-v2/separator";
import { SidebarTrigger } from "@/components/ui-v2/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { GlobalSearch } from "@/components/shared/layout/global-search";
import { MessagesSheet } from "@/components/shared/layout/dock-sheets";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { usePageSearchSlot } from "@/components/shared/layout/page-search-slot";

/**
 * The v2 top bar — the portal's chrome row, on every page.
 *
 * Modelled on the Stripe dashboard: a bar spanning the CONTENT column only
 * (right of the sidebar, never the full window), search on the left, a
 * right-aligned icon cluster (credits, messages, notifications), Trax beside
 * the search field, a hairline bottom border, pinned while the page
 * scrolls under it.
 *
 * It replaces two things the v2 chrome had instead of a bar:
 *   - the search field at the top of the left sidebar, and
 *   - the floating right-edge QuickDock that held Messages and Notifications.
 * Both were deliberate choices when v2 had no header. With a bar they are two
 * controls in an unexpected place, so they come home.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FIXES ⌘K RATHER THAN RE-IMPLEMENTING IT
 *
 * ⌘K was DEAD for the canary before this component existed, and not visibly:
 * `providers.tsx:28-30` intercepts the chord and dispatches an
 * `open-global-search` CustomEvent, and a repo-wide search finds NO listener for
 * it — only comments referring to one. The only working handler is the keydown
 * inside `HeaderSearch`, which is mounted exclusively in the `!v2Chrome` branch
 * of the dashboard layout. So on v2 the chord was swallowed by the dispatcher
 * and the sidebar's own ⌘K badge was decoration.
 *
 * This component listens for that event instead of registering a second keydown
 * handler. That gives the existing dispatch a home — one owner of the chord, no
 * double-open, and v1's HeaderSearch is untouched.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SIDEBAR TRIGGER IS IN HERE
 *
 * The layout pinned a `SidebarTrigger` to the left edge of the viewport
 * (`fixed left-0 top-1/2`) with a comment saying it existed because "v2 has no
 * top bar — and the SidebarTrigger lived in it": below `md` the sidebar is an
 * off-canvas Sheet with no opener of its own, so without that handle a v2 tenant
 * on a phone had no route to navigation at all. A bar restores the normal home
 * for it, so the floating handle can go and the artifact with it.
 *
 * `md:hidden` is kept rather than widened: on desktop the sidebar still
 * collapses via the `SidebarRail` hairline and ⌘B, which is what the v2 design
 * does today, and adding a second always-visible collapse control would be a
 * change nobody asked for.
 *
 * ---------------------------------------------------------------------------
 * TOKENS ARE BORROWED, NOT INVENTED
 *
 * The translucent-over-blur ground is this portal's own sticky-surface idiom,
 * already used verbatim in `ui-v2/tabs.tsx` and `notifications/notification-sheet.tsx`.
 * The search field is lifted from the sidebar field it replaces, so it reads as
 * the same control in a new place rather than a new control. The icon buttons are
 * the `ui-v2` Button at `size="icon-sm"`, which is what `SidebarTrigger` already
 * renders — so the cluster matches its neighbours for free.
 *
 * Two things deliberately avoided:
 *   - no `font-sans`: in this Tailwind config that resolves to Playfair Display,
 *     a SERIF. `body.v2-theme` already sets Manrope, so plain inheritance is
 *     correct and no font class belongs here.
 *   - no slash modifier on `border`/`input` tokens: under v2 dark mode
 *     `--border` is `0 0% 100% / 10%`, a triple that already carries an alpha, so
 *     `border-border/60` would expand to an invalid colour and be dropped. Plain
 *     `border-border` works in both themes.
 */

/** 32px, matching the icon buttons, so the row reads as one band of controls. */
const FIELD =
  "group relative flex h-8 w-full max-w-[380px] items-center gap-2 overflow-hidden rounded-full " +
  "border border-primary/25 bg-primary/[0.07] px-2.5 text-left backdrop-blur-[2px] transition-colors " +
  "hover:border-primary/40 hover:bg-primary/10 " +
  "focus-visible:border-primary/50 focus-visible:bg-primary/10 focus-visible:outline-none " +
  "focus-visible:ring-3 focus-visible:ring-ring/30";

/**
 * `!size-4` is load-bearing. NotificationBell hardcodes `size="icon"` (32px is
 * `icon-sm`; plain `icon` is 36px) and an `h-5 w-5` Bell, so the bar restyles it
 * from the outside to match the cluster. Without the `!`, the component's own
 * `h-5 w-5` wins on specificity and one icon sits larger than its neighbour.
 */
const BELL_FIX =
  "[&>button]:relative [&>button]:size-8 [&>button]:rounded-4xl [&>button]:text-muted-foreground " +
  "[&>button:hover]:bg-primary/10 dark:[&>button:hover]:bg-primary/15 [&>button[aria-expanded=true]]:bg-primary/10 " +
  "[&>button:hover]:text-foreground [&>button>svg]:!size-4";

/** The v2 tooltip surface, matching what the dock used, so labels feel in-place. */
const TIP =
  "rounded-xl border border-border bg-card px-3 py-1.5 text-[12px] text-foreground shadow-sm";

export function TopBarV2({ showNavTrigger = true }: { showNavTrigger?: boolean }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const { unreadCount: chatUnread } = useUnreadCount();
  const fieldRef = useRef<HTMLButtonElement>(null);
  /* The shared conversation, from the provider in the dashboard layout. Optional
     because the Messages workspace bypasses part of that layout — the button is
     simply not rendered there rather than throwing.
     This replaced a `TraxLauncher` that drove the v1 `TraxAIDialog`: a
     full-screen overlay is the wrong shape for something you consult WHILE
     reading a record, which is why the panel exists. */
  const trax = useTraxOptional();
  /* `isLoading` matters: the pill must not flash a 0 before the wallet resolves,
     because a zero credit balance is an alarming number to show by accident. */
  const { balance, isLowBalance, isLoading: creditsLoading } = useCreditWallet();

  /* The one dynamic part of the bar: a list page lends its own search and
     filters, and takes them back when it unmounts. Null on a page with nothing
     to filter, which is when the global ⌘K pill is the right thing to show. */
  const slot = usePageSearchSlot();

  // Whether the page has scrolled under the bar. The window is the scroller on
  // every page but the bounded workspaces (Messages, Trax), which scroll inside
  // their own panel, so there the bar simply stays transparent.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 2);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  /* Typed locally and pushed on a delay. The rentals list serialises its search
     into the QUERY STRING, so one push per keystroke is one navigation per
     keystroke — the 400ms is carried over from the search box this replaces,
     not invented here. */
  const [term, setTerm] = useState("");

  /* Phones. Below `sm` the bar has no room for the page's field beside Trax and
     the icons, so it used to be hidden outright, and a page's search (Settings,
     the blacklist, every v2 list) could not be reached at all: the phone Search
     button opens the global dialog, which searches bookings, customers and
     vehicles only. With a page field, that button opens the field in the bar
     instead, the way the field replaces the ⌘K pill on wider screens. It stays
     open while it holds a term, so a filtered list always shows what filters
     it, and its X clears the term and closes it. */
  const [phoneFieldOpen, setPhoneFieldOpen] = useState(false);
  const phoneField = !!slot && (phoneFieldOpen || term !== "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (phoneFieldOpen) inputRef.current?.focus();
  }, [phoneFieldOpen]);

  /**
   * Values this field has pushed to the page whose echo has not come back yet,
   * oldest first. This is how the field tells its own echo from a real change.
   *
   * Without it the bar ate keystrokes. A plain `setTerm(slot.value)` wrote every
   * committed value back into the field, so anything typed between a push and
   * its echo was overwritten by the OLDER term: type "abc", pause, type "d", and
   * the field snaps back to "abc". Rentals and vehicles widen that window,
   * because both commit through `router.push`. A slow navigation can let a
   * second pause and a second push land before the first echo returns, which a
   * single "last pushed" value cannot cover.
   *
   * An incoming value found in the queue is our own echo: drop it, and anything
   * pushed before it, and leave the field alone. Anything else came from
   * outside (Clear filters, back/forward, a shared link), so the queue is void
   * and the field takes the new value.
   */
  const inFlight = useRef<string[]>([]);
  /** The debounced push still waiting to fire, so a page change can cancel it. */
  const pendingPush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const incoming = slot?.value ?? "";
    const i = inFlight.current.indexOf(incoming);
    if (i !== -1) {
      inFlight.current.splice(0, i + 1);
      return;
    }
    inFlight.current = [];
    setTerm(incoming);
  }, [slot?.value]);

  /* A different page lending the bar is a different field. Start clean rather
     than let the last page's queue decide whether the new page's value is an
     echo; unrelated pages easily share a term, most often "". Keyed on the
     placeholder because every registration carries one and each page words
     its own differently. */
  useEffect(() => {
    // A push still waiting belongs to the page that just left. The term alone
    // can't be relied on to cancel it: when the field already matches the new
    // page (both "", say) the term never changes, so the debounce cleanup never
    // runs. Fired late it would call the old page's onChange from the new route,
    // and for rentals that is a router.push of rentals' filters onto it.
    clearTimeout(pendingPush.current);
    inFlight.current = [];
    setTerm(slot?.value ?? "");
    setPhoneFieldOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot?.placeholder]);

  useEffect(() => {
    if (!slot) return;
    // Compare with what the page WILL hold once pending pushes land, not what it
    // holds now. Type "ab" and delete it before the echo returns: the page is
    // about to hold "ab" while the field shows "", and that still needs a push.
    const q = inFlight.current;
    const expected = q.length ? q[q.length - 1] : (slot.value ?? "");
    if (term === expected) return;
    pendingPush.current = setTimeout(() => {
      inFlight.current.push(term);
      slot.onChange(term);
    }, 400);
    return () => clearTimeout(pendingPush.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const open = useCallback(() => setSearchOpen(true), []);

  /**
   * The chord's one owner. `providers.tsx` already preventDefaults ⌘K/Ctrl+K and
   * dispatches this event; before the bar existed nothing was listening, which
   * is why the shortcut did nothing for the canary.
   */
  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("open-global-search", onOpen);
    return () => window.removeEventListener("open-global-search", onOpen);
  }, []);

  return (
    <header
      /* `sticky` here depends on the dashboard layout dropping `overflow-x-hidden`
         from the v2 Inset — `overflow-x: hidden` forces `overflow-y` to compute
         to `auto`, which makes that element a scroll container, and a sticky
         child pins to ITS scrollport rather than the viewport. Since the Inset's
         height grows with its content it never scrolls, so the bar would have
         scrolled away. See the note in (dashboard)/layout.tsx.

         h-16 and not h-14: four files already size themselves with
         `h-[calc(100vh-4rem)]`, two of them Settings pages the canary reaches.
         Matching v1's 64px keeps that arithmetic true instead of leaving an 8px
         gap on those screens. */
      className={
        "sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 px-3 transition-[background-color,box-shadow] duration-200 sm:px-4 " +
        // The bar has NO ground of its own. The app gradient is painted on the
        // layout's root, behind the sidebar and this bar alike, and a white
        // 60-95% fill here cut a band across the top so the page's colour
        // appeared to start below the bar (team lead's review). At the top of
        // the page it is fully transparent and the gradient runs from the very
        // top, as it does in the sidebar. Only once content scrolls underneath
        // does a light blur and a hairline come in, so the search field stays
        // readable over the rows passing below it.
        (scrolled
          ? "bg-background/60 shadow-[inset_0_-1px_0_hsl(var(--border))] backdrop-blur-xl"
          : "bg-transparent")
      }
    >
      {/* Phone-only navigation opener. Replaces the floating left-edge handle.
          Suppressed where the layout renders no sidebar at all — the Messages
          workspace does that — because the trigger would still toggle sidebar
          state and open nothing, which is a control that looks broken rather
          than absent. */}
      {showNavTrigger && (
        <SidebarTrigger aria-label="Open navigation" className="-ml-1 shrink-0 md:hidden" />
      )}

      {/* sm+ : either the page's own list search, or the global ⌘K pill.
          Never both — two search fields on one screen, one global and one
          local with nothing saying which, is the confusion this bar removes. */}
      {slot ? (
        <div
          className={`${phoneField ? "flex" : "hidden sm:flex"} ${FIELD}`}
          /* Carried from the search box this replaces. `tab-tours/rentals.ts`
             and `payments.ts` anchor a step to it, and a missing anchor does not
             fail loudly — it waits out the full timeout, skips, and starves the
             rest of that route's steps of their wait budget. */
          data-tour={slot.tourAnchor}
        >
          <Search className="size-4 shrink-0 text-primary" aria-hidden />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={slot.placeholder}
            aria-label={slot.placeholder}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {slot.filters && (
            <button
              type="button"
              aria-label={slot.filters.open ? "Hide filters" : "Show filters"}
              aria-pressed={slot.filters.open}
              onClick={() => slot.filters!.onOpenChange(!slot.filters!.open)}
              className={
                "relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors " +
                (slot.filters.open
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary hover:bg-primary/20")
              }
            >
              <SlidersHorizontal className="size-4" />
              {/* Only while the panel is shut. Open, the chips say it better —
                  and closed, this is the sole thing on screen telling you the
                  list you are reading is not the whole list. */}
              {!slot.filters.open && slot.filters.activeCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {slot.filters.activeCount}
                </span>
              )}
            </button>
          )}
        </div>
      ) : (
        <button
          ref={fieldRef}
          type="button"
          onClick={open}
          aria-label="Search"
          className={`hidden sm:flex ${FIELD}`}
        >
          <Search className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
            Search bookings, customers, vehicles…
          </span>
          <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
            ⌘K
          </kbd>
        </button>
      )}

      {phoneField && (
        <button
          type="button"
          onClick={() => {
            setPhoneFieldOpen(false);
            setTerm("");
          }}
          aria-label="Clear and close search"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground sm:hidden"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}

      {!phoneField && (
        <button
          type="button"
          onClick={slot ? () => setPhoneFieldOpen(true) : open}
          aria-label={slot ? "Search this page" : "Search"}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.07] text-primary sm:hidden"
        >
          <Search className="size-4" aria-hidden />
        </button>
      )}

      {/* TRAX — right after the search field, not at the far end of the icon
          cluster (team lead, Sep 2026): the two are the ways to ask the portal
          something, so they sit together. Named, not just an icon. Its own control rather than a mode of
          the search field: only we know which search is global, so a magnifier
          that sometimes answers as an AI is a guess the operator would have to
          make every time.
          The label is deliberate. An unlabelled glyph is discoverable only by
          hovering, and Trax is the one thing in this bar nobody arrives
          already knowing. */}
      {trax && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Ask Trax"
              aria-expanded={trax.sheetOpen}
              onClick={trax.sheetOpen ? trax.closeSheet : trax.openSheet}
              className={
                "h-8 gap-1.5 px-2.5 text-[13px] font-medium text-primary hover:bg-primary/10 hover:text-primary aria-expanded:bg-primary/10 dark:hover:bg-primary/15 " +
                (trax.sheetOpen ? "bg-primary/10" : "") +
                // On a phone the open page field takes the row (see phoneField).
                (phoneField ? " max-sm:hidden" : "")
              }
            >
              <Bot className="size-4" aria-hidden />
              Trax
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8} className={TIP}>
            Ask Trax · ⌘J
          </TooltipContent>
        </Tooltip>
      )}

      {/* gap-0.5, and 8px side padding on credits: the icons sit a little closer
          together (team lead, Sep 2026) while each keeps its full hover pill. */}
      <div className={`ml-auto flex items-center gap-0.5${phoneField ? " max-sm:hidden" : ""}`}>
        <Separator
          orientation="vertical"
          /* The `data-[orientation=vertical]:` prefix has to be repeated: the
             primitive ships `self-stretch` behind that same modifier, and
             tailwind-merge treats modified and unmodified utilities as separate
             groups — so a bare `h-5 self-center` would not displace it. */
          className="mx-1 hidden data-[orientation=vertical]:h-5 data-[orientation=vertical]:self-center sm:block"
        />

        {/* Order, left to right: credits, messages, notifications. Notifications
            sit at the extreme right (team lead, Sep 2026). */}
        {/* CREDITS, deliberately on the face of every page.
            Presentation is v2's rather than reusing `CreditBalance`, which is the
            v1 pill: it hardcodes `text-[#404040]` and pulls the v1 Tooltip, both
            of which read wrong in this bar and in v2 dark mode. The LOGIC is not
            duplicated — both read the same `useCreditWallet`, so the low-balance
            threshold lives in one place. Same split as app-sidebar / -v2. */}
        {!creditsLoading && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/credits"
                aria-label={`Credits: ${balance.toFixed(0)}${isLowBalance ? " (low)" : ""}`}
                className={
                  "flex h-8 items-center gap-1.5 rounded-4xl px-2 text-[13px] font-medium transition-colors hover:bg-primary/10 " +
                  (isLowBalance ? "text-destructive" : "text-foreground")
                }
              >
                <CircleDollarSign
                  className={`size-4 shrink-0 ${isLowBalance ? "text-destructive" : "text-emerald-500"}`}
                  aria-hidden
                />
                <span className="tabular-nums">{balance.toFixed(0)}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8} className={TIP}>
              {isLowBalance ? "Credits running low" : "Credits"}
            </TooltipContent>
          </Tooltip>
        )}

        <MessagesSheet
          trigger={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Messages"
                  className="relative text-muted-foreground hover:bg-primary/10 hover:text-foreground aria-expanded:bg-primary/10 aria-expanded:text-foreground dark:hover:bg-primary/15"
                >
                  <MessageCircle />
                  {chatUnread > 0 && (
                    /* `ring-2 ring-background` is the one addition to the shared
                       badge: the bar's ground is translucent over a blur, and a
                       16px red dot on that smears without a ring to seat it. The
                       dock's tucked handle solves the same problem the same way. */
                    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white ring-2 ring-background">
                      {chatUnread > 9 ? "9+" : chatUnread}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8} className={TIP}>
                Messages
              </TooltipContent>
            </Tooltip>
          }
        />

        {/* Restyled in place rather than re-implemented: a second copy of the
            mark-read / delete / navigate logic is the kind of duplicate that
            drifts silently. It draws its own unread badge. */}
        <div className={BELL_FIX}>
          <NotificationBell />
        </div>




      </div>

      {/* The canary's ONLY GlobalSearch mount. It used to live in the sidebar and
          is moved here in the same change, because removing it first would leave
          the tenant with no global search dialog at all — absent, not degraded. */}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
