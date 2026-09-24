"use client";

/**
 * The record dock — how a record's side panels are reached on a small screen.
 *
 * A record screen (a rental, a customer, a vehicle) is three columns on a
 * desktop: the rail on the left, the panel in the middle, context on the right.
 * Neither side column fits on a phone, and stacking them above the panel buries
 * the thing the operator opened the record to read.
 *
 * So below the width where a column fits, it stops being a column and becomes a
 * control on this dock: a bar floating clear of the bottom edge, where a thumb
 * already is. Tapping opens that column as a bottom sheet over the panel, and
 * closing returns to exactly where they were — the middle column never moves,
 * never reflows, and never scrolls away underneath them.
 *
 * ── The shape (asked for Sep 24 2026, with a sketch) ──────────────────────
 *
 *   ╭─────────────────────────────────╮
 *   │  ◇   ◇        ( ● )       ◇   ◇ │   the circle breaks the bar's top
 *   ╰─────────────────────────────────╯   edge and sits proud of it
 *
 * One raised circle in the MIDDLE, holding the record's own navigation — a
 * rental's stages, a customer's sections. It is the control used on every
 * visit, so it is the biggest thing here and it sits under where a thumb
 * already rests rather than off in a corner.
 *
 * Everything else flanks it as a plain icon: the way back to the list on one
 * side, the record's context panel on the other. Icons only, never a label —
 * a label is a sentence wide, and the two labelled buttons this replaces made
 * a bar wider than the screen, which then scrolled sideways to reach its own
 * second item. Each name still appears in full as the sheet's title, and as
 * the button's accessible name for anyone who cannot see the icon.
 *
 * The two flanks are equal-width flex boxes, so the circle sits on the
 * screen's centre line whatever each side holds — two icons, one, or none.
 *
 * It is deliberately NOT a second navigation: the app's own sidebar keeps the
 * nav, and on a phone the top bar's trigger still opens it. This carries one
 * record's own panels and nothing else, exactly once — one dock per record
 * screen, and nothing else pinned to the bottom of it.
 *
 * The dock only ever carries panels the caller says are off screen, so at full
 * width it renders nothing at all and the page is the three columns it always
 * was. There is no desktop state to keep in step.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { PanelRight } from "lucide-react";
import type { ContextTab } from "@/components/timeline-v2/context-rail";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui-v2/drawer";
import { cn } from "@/lib/utils";

/**
 * Is the viewport at least this wide?
 *
 * A media query rather than a Tailwind variant because the answer decides what
 * is RENDERED, not how it looks: a column that is merely hidden with CSS still
 * mounts, still fetches, and still lands in the tab order.
 *
 * The server and the first paint answer `false` — the narrow layout — so the
 * markup the client hydrates against is the one that needs no measurement.
 */
export function useWiderThan(px: number): boolean {
  const media = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (listener: () => void) => {
      const query = window.matchMedia(media);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    [media],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(media).matches,
    () => false,
  );
}

export type DockPanel = {
  id: string;
  /** The button's accessible name and the sheet's title. Never drawn on the bar. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** One line under the title, saying what the sheet holds. */
  description?: string;
  /** `close` lets a row inside dismiss the sheet after it has acted. */
  content: (close: () => void) => ReactNode;
};

/** The way out of the record — the same Back link the rail carries on a desktop. */
export type DockBack = { href: string; label: string; icon: ComponentType<{ className?: string }> };

/**
 * The room the dock needs above it, as a class for the scrolling panel.
 *
 * Exported so the three record screens cannot each guess a different number
 * and leave their last row under the bar. It adds up the bar (3.5rem), the gap
 * it floats on (1rem), the part of the circle that rises above it (1.25rem)
 * and a little air, plus the phone's home indicator.
 */
export const DOCK_CLEARANCE = "pb-[calc(env(safe-area-inset-bottom,0px)+6rem)]";

/** 44px — the touch target every control on this bar meets. */
const ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground/70 transition-colors " +
  "hover:bg-foreground/5 hover:text-foreground active:bg-foreground/10 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RecordDock({
  back,
  primary,
  secondary = [],
  className,
}: {
  back?: DockBack;
  /** The record's own navigation: the raised circle in the middle. */
  primary?: DockPanel;
  /** Flanking panels. They split either side of the circle, in order. */
  secondary?: DockPanel[];
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  /*
   * A sheet closes when the page underneath it changes.
   *
   * The nav rows call `close` themselves, but a context view can navigate too
   * — a customer's "At a glance" jumps to the section that owns a problem —
   * and those rows have no handle on the dock. Without this the operator
   * arrives at the section they asked for with the sheet still over it.
   *
   * Keyed on the whole URL because a section is sometimes a path segment and
   * sometimes a query parameter.
   */
  // Both can be null where there is no route context around the component —
  // a unit test, a story — and a dock that throws there is a dock nobody can
  // test.
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => setOpen(null), [pathname, search]);

  // No rail to reach and no context to open means there is nothing for a dock
  // to carry, and a bar holding one Back arrow is furniture, not navigation.
  const panels = [...(primary ? [primary] : []), ...secondary];
  if (panels.length === 0) return null;

  // The circle is the record's own nav. Where that column already fits on
  // screen the caller passes no `primary`, and rather than leave a hole in the
  // middle the first flanking panel is promoted into it.
  const centre = primary ?? secondary[0];
  const flanking = primary ? secondary : secondary.slice(1);
  // Back already weights the left, so an odd icon goes right; without it the
  // odd one goes left, and either way the two sides stay as even as they can.
  const leftCount = back ? Math.floor(flanking.length / 2) : Math.ceil(flanking.length / 2);
  const left = flanking.slice(0, leftCount);
  const right = flanking.slice(leftCount);

  const panelButton = (panel: DockPanel) => (
    <button
      key={panel.id}
      type="button"
      onClick={() => setOpen(panel.id)}
      aria-haspopup="dialog"
      aria-label={panel.label}
      title={panel.label}
      className={ICON_BUTTON}
    >
      <panel.icon className="size-5" />
    </button>
  );

  return (
    <>
      {/*
        Bottom centre, above the panel's own scrolling. `pointer-events-none` on
        the strip and `auto` on the bar so the dock never eats a tap meant for
        the content beside it.

        The padding adds the phone's home indicator (`safe-area-inset-bottom`)
        to a 1rem gap, so the bar floats clear of the bottom edge rather than
        sitting on it — which is the difference between a dock and a toolbar.
        z-40 keeps it under every Radix overlay (z-50), so an open dialog covers
        it rather than fighting it.
      */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4",
          "pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]",
          className,
        )}
      >
        <nav
          aria-label="This record's panels"
          /* Translucent and blurred over whatever scrolls beneath, with a wide
             soft shadow so it reads as lifted off the page rather than drawn on
             it. `h-14` leaves the circle room to rise out of the top edge
             without the bar growing to contain it. */
          className={cn(
            "pointer-events-auto relative flex h-14 max-w-full items-center gap-1 rounded-full px-2",
            "border border-foreground/10 bg-background/80 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl",
          )}
        >
          {/* Equal-width flanks: the circle stays on the centre line whether a
              side holds two icons, one, or none. */}
          <div className="flex flex-1 basis-0 items-center justify-end gap-1">
            {back ? (
              <Link href={back.href} aria-label={back.label} title={back.label} className={ICON_BUTTON}>
                <back.icon className="size-5" />
              </Link>
            ) : null}
            {left.map(panelButton)}
          </div>

          {/* The focal point. `-translate-y-5` lifts it clear of the bar's top
              edge and the background ring cuts a clean hole around it, so the
              two read as one piece rather than a button dropped on a bar. */}
          <button
            type="button"
            onClick={() => setOpen(centre.id)}
            aria-haspopup="dialog"
            aria-label={centre.label}
            title={centre.label}
            className={cn(
              "flex size-14 shrink-0 -translate-y-5 items-center justify-center rounded-full",
              "bg-primary text-primary-foreground ring-4 ring-background",
              "shadow-[0_10px_25px_-5px_hsl(var(--primary)_/_0.5)] transition-transform",
              "active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring",
            )}
          >
            <centre.icon className="size-6" />
          </button>

          <div className="flex flex-1 basis-0 items-center justify-start gap-1">
            {right.map(panelButton)}
          </div>
        </nav>
      </div>

      {panels.map((panel) => (
        <Drawer key={panel.id} open={open === panel.id} onOpenChange={(next) => setOpen(next ? panel.id : null)}>
          {/* 85svh, not a fixed height: the sheet is as tall as it needs to be
              and never taller than the visible viewport on a phone with its
              address bar showing. The body scrolls, the header does not. */}
          {/* A panel without a description has no element to point at, and
              Radix warns rather than silently shipping a dangling
              aria-describedby. Passing undefined drops the attribute, which is
              the acknowledged form of "this dialog has no description". */}
          <DrawerContent
            className="max-h-[85svh]"
            {...(panel.description ? {} : { "aria-describedby": undefined })}
          >
            <DrawerHeader className="gap-1 pb-3 text-left">
              <DrawerTitle className="text-base">{panel.label}</DrawerTitle>
              {panel.description ? <DrawerDescription>{panel.description}</DrawerDescription> : null}
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
              {panel.content(() => setOpen(null))}
            </div>
          </DrawerContent>
        </Drawer>
      ))}
    </>
  );
}

/**
 * A context column's tabs, as one dock icon each.
 *
 * Asked for Sep 24 2026. The column used to arrive here as a single panel, so
 * a phone got one button that opened a sheet with a tab strip inside it: every
 * view two taps deep, and all but the first one's name hidden behind the
 * first. One icon per view puts them all on the bar, each a single tap.
 *
 * The tabs come from the rail's own list (`customerRailTabs`,
 * `rentalRailTabs`, `vehicleRailTabs`), which is also what the desktop strip
 * renders, so the two cannot offer different views.
 *
 * `svh` rather than a fixed height: a view is as tall as the visible viewport
 * allows on a phone with its address bar showing. `scroll: false` marks the
 * views that pin their own layout and scroll inside it — Messages does — so
 * those get a flex column and the rest get the sheet's own scrolling.
 */
export function contextTabPanels(tabs: ContextTab[]): DockPanel[] {
  return tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon ?? PanelRight,
    content: () => (
      <div className={cn("h-[68svh] min-h-0", tab.scroll === false && "flex flex-col")}>{tab.content}</div>
    ),
  }));
}

/**
 * The right-hand context column, for the widths where it fits.
 *
 * Same markup the pages drew before the dock existed, kept in one place so the
 * column and its docked twin cannot drift apart.
 */
export function ContextColumn({
  label, width = 360, children,
}: { label: string; width?: number; children: ReactNode }) {
  return (
    <aside className="flex min-h-0 shrink-0 flex-col border-l border-foreground/10" style={{ width }} aria-label={label}>
      {children}
    </aside>
  );
}

type DockNavItem<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

/**
 * A record's rail, as rows inside a dock sheet.
 *
 * The same list the rail draws on a desktop — the pages hand it `STAGES` or
 * `SECTION_GROUPS` — so a stage cannot exist in one place and not the other.
 * Rows are links where the caller gives an href, so a stage stays
 * deep-linkable and long-pressable; where a page switches sections without a
 * navigation (the vehicle screen does), it passes `onSelect` instead.
 */
export function RecordDockNav<T extends string>({
  groups,
  current,
  hrefFor,
  onSelect,
  close,
}: {
  groups: readonly { label?: string; items: readonly DockNavItem<T>[] }[];
  current: T;
  hrefFor?: (id: T) => string;
  onSelect?: (id: T) => void;
  close: () => void;
}) {
  return (
    <div className="space-y-4 pb-2">
      {groups.map((group, i) => (
        <div key={group.label ?? i} className="space-y-1">
          {group.label ? (
            <p className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
          ) : null}
          {group.items.map((item) => {
            const isCurrent = item.id === current;
            const className = cn(
              "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
              isCurrent ? "bg-foreground/10 font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/5 active:bg-foreground/10",
            );
            const inner = (
              <>
                <item.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {isCurrent ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
              </>
            );
            return hrefFor ? (
              <Link
                key={item.id}
                href={hrefFor(item.id)}
                scroll={false}
                onClick={close}
                aria-current={isCurrent ? "page" : undefined}
                className={className}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => {
                  onSelect?.(item.id);
                  close();
                }}
                className={className}
              >
                {inner}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
