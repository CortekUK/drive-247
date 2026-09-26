"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleDollarSign, MessageCircle, Search, SlidersHorizontal, X } from "lucide-react";
import { TraxMark } from "@/components/trax/trax-greeting";

import { Button } from "@/components/ui-v2/button";
import { Separator } from "@/components/ui-v2/separator";
import { SidebarTrigger } from "@/components/ui-v2/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { GlobalSearch } from "@/components/shared/layout/global-search";
import { MessagesSheet } from "@/components/shared/layout/dock-sheets";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useCreditWallet } from "@/hooks/use-credit-wallet";
// Northwind has no credits (docs/integration-billing/build-spec.md, D3).
import { useIntegrationBilling } from "@/lib/integration-billing/hooks";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { usePageSearchSlot } from "@/components/shared/layout/page-search-slot";

/**
 * The v2 top bar — the portal's chrome row, on every page.
 *
 * Modelled on the Stripe dashboard: a bar spanning the CONTENT column only
 * (right of the sidebar, never the full window), search on the left, a
 * right-aligned cluster of credits, Trax, messages and notifications.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT SCROLL, AND NOTHING SCROLLS UNDER IT (Sep 23 2026)
 *
 * The bar is a plain non-scrolling ROW of the v2 frame, exactly as the
 * sidebar's header is a non-scrolling row of the sidebar. `(dashboard)/layout.tsx`
 * bounds the shell to one viewport and makes `<main>` the only scroll
 * container, so the page scrolls BELOW this bar and no row ever passes
 * underneath it.
 *
 * That is why the bar carries no ground of its own — no border, no shadow, no
 * fill. It used to be `sticky top-0 z-40` over a window-scrolling page, which
 * meant content DID pass under it, so it painted a masked, blurred "veil"
 * (`data-slot="top-bar-veil"`) that faded in on scroll to keep the search field
 * readable, toggled by a `scrolled` state reading `window.scrollY`. Every fix
 * the team lead asked for — remove the hairline, widen the veil to the bar's
 * real edges, tint it with `--v2-wash` instead of white — was chasing the EDGE
 * OF THAT VEIL. With nothing passing under the bar there is no edge to draw and
 * nothing to hide, so the veil, its `scrolled` state and its window scroll
 * listener are gone rather than tuned again.
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
  // Dark: primary/10 over the dark bar is a 1.01:1 step, so hover and keyboard
  // focus use the v2 hover tint and a light brand rim (--v2-link) instead.
  "dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:focus-visible:bg-[hsl(var(--v2-hover,var(--muted)))] " +
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
  "[&>button:hover]:bg-primary/10 dark:[&>button:hover]:bg-[hsl(var(--v2-hover,var(--muted)))] [&>button[aria-expanded=true]]:bg-primary/10 " +
  "dark:[&>button[aria-expanded=true]]:bg-[hsl(var(--v2-hover,var(--muted)))] " +
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
  /* Integration billing (northwind): e-signing is on the plan and there are no
     credits, so there is no balance to show. Every other tenant keeps the pill. */
  const creditsRetired = useIntegrationBilling();

  /* The one dynamic part of the bar: a list page lends its own search and
     filters, and takes them back when it unmounts. Null on a page with nothing
     to filter, which is when the global ⌘K pill is the right thing to show. */
  const slot = usePageSearchSlot();

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
      /* A ROW, not a pinned layer. The v2 frame (see `(dashboard)/layout.tsx`)
         is one viewport tall and does not scroll; this bar and the banners are
         non-scrolling rows in it and `<main>` below is the only scroll
         container. So there is no `sticky`, no `top-0` and no `z-40`: nothing
         can pass under this element, which is the whole point.

         No border, no shadow, no fill either — it sits straight on the app
         gradient the layout paints, the way the sidebar's own header does, so
         the two sides of the screen read as one surface.

         h-16 and not h-14: six files already size themselves with
         `h-[calc(100svh-66px)]` / `h-[calc(100vh-4rem)]`, two of them Settings
         pages the canary reaches. Matching v1's 64px keeps that arithmetic true
         instead of leaving an 8px gap on those screens. */
      className={"flex h-16 shrink-0 items-center gap-2 bg-transparent px-3 sm:px-4"}
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
          <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={slot.placeholder}
            aria-label={slot.placeholder}
            /* Muted measures 4.22:1 on the field's light purple ground (4.01
               hovered); --v2-muted-on-tint is the v2 step that clears 4.5, and
               is the muted token itself in dark. */
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))]"
          />
          {slot.filters && (
            <button
              type="button"
              aria-label={slot.filters.open ? "Hide filters" : "Show filters"}
              aria-pressed={slot.filters.open}
              data-tour={slot.filters.tourAnchor}
              onClick={() => slot.filters!.onOpenChange(!slot.filters!.open)}
              className={
                "relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors " +
                (slot.filters.open
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary hover:bg-primary/20 dark:text-[hsl(var(--v2-link,var(--primary)))] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))]")
              }
            >
              <SlidersHorizontal className="size-4" />
              {/* Only while the panel is shut. Open, the chips say it better —
                  and closed, this is the sole thing on screen telling you the
                  list you are reading is not the whole list.
                  Pinned to the button's own corner, not hung outside it: the
                  field clips its overflow (for the rounded ends), which cut an
                  outside badge in half. */}
              {!slot.filters.open && slot.filters.activeCount > 0 && (
                <span className="absolute right-0 top-0 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-semibold leading-none text-primary-foreground">
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
          <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
          {/* Muted measures 4.22:1 on this light purple pill (4.01 hovered);
              --v2-muted-on-tint clears 4.5 and is the muted token in dark. */}
          <span className="min-w-0 flex-1 truncate text-[13px] text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))]">
            Search bookings, customers, vehicles…
          </span>
          <kbd className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
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
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] sm:hidden"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}

      {!phoneField && (
        <button
          type="button"
          onClick={slot ? () => setPhoneFieldOpen(true) : open}
          aria-label={slot ? "Search this page" : "Search"}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.07] text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] sm:hidden"
        >
          <Search className="size-4" aria-hidden />
        </button>
      )}

      {/* TRAX — in the right-hand cluster, immediately before messages (user,
          Sep 24 2026). It sat beside the search field until then, on the
          reading that search and Trax are both ways to ask the portal
          something; it now sits with the other things you reach for, which
          also leaves the search field the whole left side of the bar.
          Named, not just an icon. Its own control rather than a mode of the
          search field: only we know which search is global, so a magnifier
          that sometimes answers as an AI is a guess the operator would have to
          make every time.
          The label is deliberate. An unlabelled glyph is discoverable only by
          hovering, and Trax is the one thing in this bar nobody arrives
          already knowing.

          Labelled "Help", not "Trax" (team lead, Sep 2026): operators read
          "Help" and know what it is for, and Trax introduces itself on hover.
          The generic AI sparkle replaces the robot for now.

          Its sparkle is TRAX'S OWN MARK, not a line icon (team lead, Sep 20
          2026: "a bit bolder, a bit more 3D — but not so it gets too
          prominent"). The outline glyph was the one thing in this bar that
          looked like every other icon, while the thing it opens greets you
          with a round gradient badge. Now the button and the panel carry the
          same mark, at `xs`: one step past the old 16px glyph so it reads as a
          badge, and small enough to sit beside 13px text without outweighing
          it. The left padding matches the badge's top and bottom inset, so it
          sits in the hover pill like an avatar in a chip. */}

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

        {/* Order, left to right: credits, Trax, messages, notifications.
            Notifications sit at the extreme right (team lead, Sep 2026), and
            Trax moved here from beside the search field on Sep 24 2026 — it
            reads as one of the things you reach for, not as part of search. */}
        {/* CREDITS, deliberately on the face of every page.
            Presentation is v2's rather than reusing `CreditBalance`, which is the
            v1 pill: it hardcodes `text-[#404040]` and pulls the v1 Tooltip, both
            of which read wrong in this bar and in v2 dark mode. The LOGIC is not
            duplicated — both read the same `useCreditWallet`, so the low-balance
            threshold lives in one place. Same split as app-sidebar / -v2. */}
        {!creditsLoading && !creditsRetired && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/credits"
                aria-label={`Credits: ${balance.toFixed(0)}${isLowBalance ? " (low)" : ""}`}
                className={
                  "flex h-8 items-center gap-1.5 rounded-4xl px-2 text-[13px] font-medium transition-colors hover:bg-primary/10 dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] " +
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

        {trax && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Help, ask Trax"
                aria-expanded={trax.sheetOpen}
                onClick={trax.sheetOpen ? trax.closeSheet : trax.openSheet}
                className={
                  "h-8 gap-1.5 pl-1.5 pr-2.5 text-[13px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))] hover:bg-primary/10 hover:text-primary dark:hover:text-[hsl(var(--v2-link,var(--primary)))] aria-expanded:bg-primary/10 " +
                  "dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))] " +
                  (trax.sheetOpen ? "bg-primary/10 dark:bg-[hsl(var(--v2-hover,var(--muted)))]" : "") +
                  // On a phone the open page field takes the row (see phoneField).
                  (phoneField ? " max-sm:hidden" : "")
                }
              >
                <TraxMark size="xs" />
                Help
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8} className={TIP}>
              Hi, I&apos;m Trax. How can I help?
              <span className="ml-1.5 text-muted-foreground">⌘J</span>
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
                  className="relative text-muted-foreground hover:bg-primary/10 hover:text-foreground aria-expanded:bg-primary/10 aria-expanded:text-foreground dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] dark:aria-expanded:bg-[hsl(var(--v2-hover,var(--muted)))]"
                >
                  <MessageCircle />
                  {chatUnread > 0 && (
                    /* `ring-2 ring-background` is the one addition to the shared
                       badge: a 16px red dot needs a ring to seat it against the
                       app gradient this bar sits on. The dock's tucked handle
                       solved the same problem the same way. */
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
