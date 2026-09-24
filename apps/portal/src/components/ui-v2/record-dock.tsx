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
 * button on this dock: a floating pill at the bottom of the screen, where a
 * thumb already is. Tapping opens that column as a bottom sheet over the panel,
 * and closing returns to exactly where they were — the middle column never
 * moves, never reflows, and never scrolls away underneath them.
 *
 * The dock only ever carries panels the caller says are off screen, so at full
 * width it renders nothing at all and the page is the three columns it always
 * was. There is no desktop state to keep in step.
 *
 * It is deliberately NOT a second navigation: the app's own sidebar keeps the
 * nav, and on a phone the top bar's trigger still opens it. This carries one
 * record's own panels and nothing else.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
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
  /** On the dock button and as the sheet's title. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** One line under the title, saying what the sheet holds. */
  description?: string;
  /** `close` lets a row inside dismiss the sheet after it has acted. */
  content: (close: () => void) => ReactNode;
};

export function RecordDock({ panels, className }: { panels: DockPanel[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (panels.length === 0) return null;

  return (
    <>
      {/*
        Bottom centre, above the panel's own scrolling. `pointer-events-none` on
        the strip and `auto` on the pill so the dock never eats a tap meant for
        the content beside it.

        The padding adds the phone's home indicator (`safe-area-inset-bottom`)
        to a base gap, so the pill clears the bar on an iPhone and sits at 12px
        everywhere else. z-40 keeps it under every Radix overlay (z-50), so an
        open dialog covers it rather than fighting it.
      */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4",
          "pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]",
          className,
        )}
      >
        <nav
          aria-label="This record's panels"
          className={cn(
            "pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1.5 no-scrollbar",
            "border border-foreground/10 bg-background/85 shadow-lg shadow-black/10 backdrop-blur-xl",
          )}
        >
          {panels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => setOpen(panel.id)}
              aria-haspopup="dialog"
              /* h-11 is the 44px touch target; the row never wraps, so a long
                 label scrolls the pill rather than growing it into two lines. */
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium",
                "text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground",
                "active:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <panel.icon className="size-4 shrink-0" />
              {panel.label}
            </button>
          ))}
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
