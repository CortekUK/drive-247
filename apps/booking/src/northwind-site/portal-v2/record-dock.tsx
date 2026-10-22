'use client';

/**
 * The record dock — the operator's (apps/portal/src/components/ui-v2/
 * record-dock.tsx), copied for the customer's rental page: below the width
 * where the side column fits, that column stops being a column and becomes a
 * control on a bar floating clear of the bottom edge, where a thumb already
 * is. Tapping opens it as a bottom sheet over the page.
 *
 *   ╭─────────────────────────────────╮
 *   │  ←            ( ● )             │   Back on the left, the record's
 *   ╰─────────────────────────────────╯   panel as the circle in the middle
 *
 * As the operator's: the phone tab bar hides itself while this is on the page
 * (`data-record-dock`, see mobile-tab-bar.tsx); icons only on the bar, the name
 * as the sheet's title and the button's accessible name; nothing when there are
 * no panels. The sheets are vaul drawers, as the operator's ui-v2 Drawer.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Drawer as DrawerPrimitive } from 'vaul';

import { cn } from '@nw/lib/utils';

export type DockPanel = {
  id: string;
  /** The button's accessible name and the sheet's title. Never drawn on the bar. */
  label: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  content: (close: () => void) => ReactNode;
};

export type DockBack = { href: string; label: string; icon: ComponentType<{ className?: string }> };

/** The room the dock needs under the page's last row (the operator's DOCK_CLEARANCE). */
export const DOCK_CLEARANCE = 'pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]';

const ICON_BUTTON =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-pv-muted-fg ' +
  'transition-[color,background-color,transform] hover:bg-pv-fg/[0.06] hover:text-pv-fg ' +
  'active:scale-95 active:bg-pv-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50';
const ICON_GLYPH = 'size-[18px]';

export function RecordDock({
  back,
  primary,
  secondary = [],
  className,
}: {
  back?: DockBack;
  primary?: DockPanel;
  secondary?: DockPanel[];
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(null), [pathname]);

  const panels = [...(primary ? [primary] : []), ...secondary];
  if (panels.length === 0) return null;

  const centre = primary ?? secondary[0];
  const flanking = primary ? secondary : secondary.slice(1);
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
      <panel.icon className={ICON_GLYPH} />
    </button>
  );

  // Into <body>: the page column carries the entry animation's transform,
  // which would pin a `fixed` bar to the column instead of the screen.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div
        data-record-dock=""
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4',
          'pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]',
          className,
        )}
      >
        <nav
          aria-label="This rental's panels"
          className={cn(
            'pointer-events-auto relative flex h-14 max-w-full items-center gap-0.5 rounded-full px-1.5',
            'border border-pv-fg/10 bg-pv-bg/80 shadow-[0_8px_30px_rgb(0_0_0/0.12)] backdrop-blur-xl',
          )}
        >
          <div className="flex flex-1 basis-0 items-center justify-end gap-1">
            {back ? (
              <Link href={back.href} aria-label={back.label} title={back.label} className={ICON_BUTTON}>
                <back.icon className={ICON_GLYPH} />
              </Link>
            ) : null}
            {left.map(panelButton)}
          </div>

          <button
            type="button"
            onClick={() => setOpen(centre.id)}
            aria-haspopup="dialog"
            aria-label={centre.label}
            title={centre.label}
            className={cn(
              'mx-0.5 flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full',
              'bg-pv-primary text-pv-primary-fg',
              'shadow-[0_4px_12px_-4px_color-mix(in_srgb,var(--pv-primary)_45%,transparent)] transition-transform',
              'active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50 focus-visible:ring-offset-2',
            )}
          >
            <centre.icon className="size-5" />
          </button>

          <div className="flex flex-1 basis-0 items-center justify-start gap-1">{right.map(panelButton)}</div>
        </nav>
      </div>

      {panels.map((panel) => (
        <DrawerPrimitive.Root key={panel.id} open={open === panel.id} onOpenChange={(next) => setOpen(next ? panel.id : null)}>
          <DrawerPrimitive.Portal>
            <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-md" />
            <DrawerPrimitive.Content
              {...(panel.description ? {} : { 'aria-describedby': undefined })}
              className={cn(
                'fixed inset-x-0 bottom-0 z-50 mt-24 flex max-h-[85svh] flex-col p-4 text-sm text-pv-fg outline-none',
                'before:absolute before:inset-2 before:-z-10 before:rounded-4xl before:border before:border-pv-border before:bg-pv-card before:shadow-xl',
              )}
            >
              <div className="mx-auto mt-4 h-1.5 w-[100px] shrink-0 rounded-full bg-pv-muted" />
              <div className="flex flex-col gap-1 p-4 pb-3 text-left">
                <DrawerPrimitive.Title className="text-base font-semibold text-pv-fg">{panel.label}</DrawerPrimitive.Title>
                {panel.description ? (
                  <DrawerPrimitive.Description className="text-sm text-pv-muted-fg">{panel.description}</DrawerPrimitive.Description>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
                {panel.content(() => setOpen(null))}
              </div>
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Portal>
        </DrawerPrimitive.Root>
      ))}
    </>,
    document.body,
  );
}

/** The dock shows below this width, where the side column no longer fits (Tailwind `lg`). */
export function useBelow(px: number): boolean {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${px - 0.02}px)`);
    const read = () => setBelow(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, [px]);
  return below;
}
