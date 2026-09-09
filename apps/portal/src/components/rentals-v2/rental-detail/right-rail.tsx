"use client";

/**
 * The right rail of the rental control centre.
 *
 * A matched pair with the stage rail on the far side of the screen. Where the
 * left rail carries the DECISIONS a rental is made of, this side carries what
 * has happened to it since — the conversation with the person renting, and the
 * record of everything the rental has produced.
 *
 * The rail is SECONDARY. The middle column is where the rental is decided;
 * this side supports it. 13px body, 11px meta, `size-4` icons — the left
 * rail's rhythm, and two sizes only. If anything in here pulls the eye away
 * from the middle, it is wrong.
 *
 * ── Why the tab is not in the URL ───────────────────────────────────────────
 *
 * The stages are (`?stage=`), and deliberately: a stage is the thing you send
 * someone a link to. The rail's tab is not. It is a secondary view of a screen
 * you are already on, and putting it in the URL would mean two independent
 * controls writing the same query string — every tab click would also have to
 * carry the current stage forward, and every stage click the current tab, or
 * one would silently reset the other. So the tab is plain local state, and the
 * `?stage=` param stays owned by one thing.
 *
 * ── Each tab owns its own scrolling ─────────────────────────────────────────
 *
 * Every tab has the same shape: a scrolling middle and something pinned. What
 * is pinned is whatever an operator reaches for — the composer, the filter —
 * so it is never scrolled out of reach by a long list. That is
 * why this component supplies a flex column and nothing else: no tab is
 * special-cased here, and none of them can push a control off the bottom.
 *
 * Tabs are rendered one at a time rather than hidden with CSS. That is load-
 * bearing for Messages: mounting it joins the customer's realtime room and
 * marks their unread messages read, which must happen when an operator looks
 * at the thread and not merely because they opened the rental.
 */

import { useState } from "react";
import { CalendarPlus, MessageSquare, History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { SHOW_MULTI_PERIOD } from "./multi-period";
import { RailMessages } from "./rail-messages";
import { RailActivity } from "./rail-activity";

type TabId = "extensions" | "messages" | "activity";

const ALL_TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "extensions", label: "Extensions", icon: CalendarPlus },
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "activity", label: "Activity", icon: History },
];

/**
 * A rental is one fixed period, so there is nothing for an Extensions tab to
 * show — see `SHOW_MULTI_PERIOD`. The entry stays in the list above rather than
 * being deleted from it, so turning the rail back into three tabs is that one
 * constant plus the `RailExtensions` import.
 */
const TABS = ALL_TABS.filter((t) => t.id !== "extensions" || SHOW_MULTI_PERIOD);

const DEFAULT_TAB: TabId = SHOW_MULTI_PERIOD ? "extensions" : "messages";

/**
 * `h-11` is not a taste call — it is the left rail's back-link row, so the two
 * headers line up across the screen. Idle / active / hover are `RailItem`'s
 * verbatim; a second active treatment in one viewport is how a screen starts
 * reading as two apps stitched together.
 *
 * At three tabs the strip is icon-only — three words up here would be the only
 * text in the rail competing with the content under it. At two it is not: two
 * squares in an `h-11` strip read as a leftover, and two short words at 11px
 * are the smallest thing that makes the pair look chosen. The labels drop
 * again on their own if a third tab comes back.
 */
function TabStrip({ tab, onTab }: { tab: TabId; onTab: (t: TabId) => void }) {
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-1 border-b border-foreground/10 px-2"
      data-tour="rental-right-rail"
    >
      {TABS.map((t) => {
        const on = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTab(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl transition-colors",
              TABS.length > 2 ? "w-8" : "px-2.5",
              on
                ? "bg-primary/10 text-primary"
                : "text-sidebar-foreground/60 hover:bg-primary/10 hover:text-primary"
            )}
          >
            <t.icon className="size-4" />
            {TABS.length <= 2 && <span className="text-[11px] font-medium">{t.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RightRail({ detail }: { detail: RentalDetailV2; refetch: () => void }) {
  // Messages is the default: with the rental's shape fixed, the conversation
  // with the person renting is the thing that moves while a rental is open.
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);

  return (
    <>
      <TabStrip tab={tab} onTab={setTab} />

      {/* One column for every tab. `min-h-0` is load-bearing: without it a flex
          child refuses to shrink below its content, and a long stack would
          grow the rail instead of scrolling inside it — taking the pinned
          footer off the bottom of the screen with it.

          `pr-12` rather than `pr-4`, and it is not a margin: the v2 chrome's
          QuickDock is a FIXED strip pinned to the right edge of the viewport
          and vertically centred, so it floats OVER this column rather than
          being laid out beside it. Without the gutter its icons sit on top of
          whatever the rail is showing. It is kept uniform down the whole
          column — including the pinned footer, which clears the dock on its
          own — because a full-width button under a narrower list reads as a
          layout bug rather than as a gutter. */}
      <div className="flex min-h-0 flex-1 flex-col pb-3 pl-4 pr-12 pt-2">
        {/* Restoring the third tab is `SHOW_MULTI_PERIOD`, the `RailExtensions`
            import, and one branch here. */}
        {tab === "activity" ? <RailActivity detail={detail} /> : <RailMessages detail={detail} />}
      </div>
    </>
  );
}

export default RightRail;
