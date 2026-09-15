"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Maximize2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { TraxThread } from "./trax-thread";
import { useTraxOptional } from "./trax-provider";

/**
 * Trax as a docked side panel — the Stripe Assistant shape.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE `Sheet` PRIMITIVE
 *
 * `ui-v2/sheet.tsx` renders `<SheetOverlay />` UNCONDITIONALLY inside
 * `SheetContent` (sheet.tsx:61) — `fixed inset-0 z-50 bg-black/30
 * backdrop-blur-md`, with no prop to suppress it. A Radix sheet would therefore
 * DIM, BLUR and BLOCK the page behind Trax, and that is the one thing this
 * surface must not do: the argument for a panel over a dialog was that the
 * operator keeps reading the record they are asking about. An overlay that
 * hides and blocks it is a dialog wearing a sheet's geometry.
 *
 * So this is hand-rolled: pinned, no backdrop, no focus trap, no scroll lock,
 * no dismiss-on-outside. The page stays fully live, which is the feature.
 *
 * ---------------------------------------------------------------------------
 * IT PINS OVER THE CONTENT. IT USED TO DOCK, AND THAT WAS WRONG.
 *
 * The first version was a flex sibling of `SidebarInset`: `SidebarProvider`
 * renders a flex ROW and the Inset is `flex-1`, so a docked third child made the
 * content column NARROWER instead of covering it — which is what Stripe does.
 *
 * It broke, visibly. `SidebarInset` ships `flex w-full flex-1` with no
 * `min-width`, and a flex item defaults to `min-width: auto` — floored at its
 * CONTENT width. `flex-1` therefore could not shrink it, so the row became
 * `sidebar + content + 440px`, wider than the viewport, and BOTH the page's
 * right edge (the Add Customer button) and the panel's own text were clipped off
 * screen. That floor is the exact horizontal twin of the `min-h-0` problem the
 * dashboard layout already documents for height.
 *
 * `min-w-0` fixes the floor — but not the real problem, which is that there is
 * nothing to reflow INTO. The v2 chrome wraps mostly v1 page bodies: the
 * customers list, the vehicles list and ~60 other screens still live under
 * `components/<area>/` and are shared with the other 56 tenants. None was built
 * for a narrower column, and retrofitting them is the hero-tab rewrite, not a
 * change that belongs behind this panel. Stripe reflows because Stripe's pages
 * were built to; ours were not.
 *
 * So it pins instead. The left of the page stays visible and clickable — no dim,
 * no block — and what the panel covers is reachable by closing it. When the
 * listing pages are rebuilt to the new pattern, docking becomes a one-line
 * change back.
 */

/** Stripe's assistant column is ~440px. Wide enough for a paragraph, narrow
 *  enough that a rental record beside it stays legible. */
const PANEL_WIDTH = "md:w-[440px]";

export function TraxPanel() {
  /* Optional: the Messages workspace bypasses parts of the layout, so the
     provider may legitimately be absent. Throwing there would take the whole
     route down for a panel that is not even open. */
  const trax = useTraxOptional();
  const pathname = usePathname();

  if (!trax) return null;

  const { sheetOpen, closeSheet, startNewConversation, chat } = trax;

  /* On the full page the panel would be a second copy of the same conversation
     side by side with itself. The provider keeps the state, so closing it here
     costs nothing. */
  const onFullPage = pathname?.startsWith("/trax");
  if (!sheetOpen || onFullPage) return null;

  return (
    <aside
      aria-label="Trax"
      /* Pinned, not docked. `inset-y-0 right-0` at md+ gives a full-height
         column over the right edge; below md it takes the screen, because a
         440px column cannot sit beside content on a phone and at that width the
         record behind it would be unreadable anyway.
         z-40 matches the top bar so the two form one plane — above page content,
         below the portalled overlays (GlobalSearch, sheets) which sit at z-50. */
      className={
        "fixed inset-0 z-40 flex flex-col border-border bg-card shadow-xl " +
        `md:inset-y-0 md:left-auto md:right-0 md:border-l ${PANEL_WIDTH}`
      }
    >
      {/* Same 64px as the top bar, so the two read as one band across the app. */}
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex size-7 items-center justify-center rounded-4xl bg-primary/10 text-primary">
          <Bot className="size-4" aria-hidden />
        </span>
        <span className="text-[13px] font-semibold">Trax</span>

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New conversation"
                onClick={startNewConversation}
                disabled={chat.messages.length === 0}
                className="text-muted-foreground hover:text-foreground"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New conversation</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                asChild
                className="text-muted-foreground hover:text-foreground"
              >
                {/* The conversation survives the navigation because the provider
                    is mounted in the layout, ABOVE the route — so this is the
                    same thread, full screen, not a new one. */}
                <Link href="/trax" aria-label="Open full screen">
                  <Maximize2 />
                </Link>
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
            <TooltipContent side="bottom">Close</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <TraxThread density="sheet" />
    </aside>
  );
}
