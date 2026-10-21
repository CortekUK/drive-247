'use client';

/**
 * "Customise sidebar" — the operator's dialog (sidebar-customizer-dialog.tsx)
 * for the customer's five tabs: drag to reorder, hide what you do not use, a
 * live picture of the rail beside the list, and Reset / Cancel / Save along
 * the foot. Home stays put (the lock), as the operator's permanent rows do.
 *
 * The operator stores the arrangement on their account; a customer's lives in
 * this browser, keyed by the customer (`usePortalV2NavPreferences`). It only
 * ever arranges the customer's own rail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Lock } from 'lucide-react-nw';

import { useCustomer } from '@nw/hooks/use-customer';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_DEFAULT_SM, V2_BUTTON_GHOST_SM, V2_BUTTON_OUTLINE_SM } from '@portal-v2-shared/button-styles';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@portal-v2-shared/dialog';

import {
  DEFAULT_NAV_PREFERENCES,
  PORTAL_V2_ITEMS,
  arrangePortalV2Nav,
  parseNavPreferences,
  type PortalV2NavItem,
  type PortalV2NavPreferences,
} from './nav';

/* ─────────────────────────────── storage ───────────────────────────────── */

const PREFS_EVENT = 'pv2-nav-preferences';
const prefsKey = (customerId: string | null) => `pv2-nav:${customerId ?? 'anon'}`;

/** The customer's arrangement of the rail, remembered in this browser. */
export function usePortalV2NavPreferences(): {
  preferences: PortalV2NavPreferences;
  save: (next: PortalV2NavPreferences) => void;
} {
  const { customerId } = useCustomer();
  const [preferences, setPreferences] = useState<PortalV2NavPreferences>(DEFAULT_NAV_PREFERENCES);

  useEffect(() => {
    const read = () => {
      try {
        setPreferences(parseNavPreferences(window.localStorage.getItem(prefsKey(customerId))));
      } catch {
        setPreferences(DEFAULT_NAV_PREFERENCES);
      }
    };
    read();
    // The desktop rail and the phone drawer each hold the hook: one save
    // repaints both.
    window.addEventListener(PREFS_EVENT, read);
    return () => window.removeEventListener(PREFS_EVENT, read);
  }, [customerId]);

  const save = useCallback(
    (next: PortalV2NavPreferences) => {
      setPreferences(next);
      try {
        window.localStorage.setItem(prefsKey(customerId), JSON.stringify(next));
      } catch {
        /* not remembered past this visit — harmless */
      }
      window.dispatchEvent(new Event(PREFS_EVENT));
    },
    [customerId],
  );

  return { preferences, save };
}

/* ──────────────────────────────── rows ─────────────────────────────────── */

const ROW = 'flex items-center gap-2.5 rounded-lg border border-pv-border/60 bg-pv-card px-3 py-2.5';
const ROW_ICON_BUTTON =
  'cursor-pointer rounded-md p-1 text-pv-muted-fg/70 transition-colors duration-200 hover:bg-pv-hover hover:text-pv-fg motion-reduce:transition-none';

function RowBody({
  item,
  hidden,
  onToggle,
  handle,
}: {
  item: PortalV2NavItem;
  hidden: boolean;
  onToggle?: () => void;
  handle: React.ReactNode;
}) {
  const Icon = item.icon;
  return (
    <>
      {handle}
      <Icon aria-hidden className="size-4 shrink-0 text-pv-muted-fg" />
      <span className={cn('flex-1 truncate text-[13px]', hidden ? 'text-pv-muted-fg' : 'text-pv-fg')}>{item.label}</span>
      {item.locked ? (
        <span title="Always in your sidebar" aria-label={`${item.label} is always in your sidebar`} className="px-1 py-1 text-pv-muted-fg/70">
          <Lock aria-hidden className="size-3.5" />
        </span>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-label={hidden ? `Show ${item.label}` : `Hide ${item.label}`}
          title={hidden ? 'Show' : 'Hide'}
          className={ROW_ICON_BUTTON}
        >
          {hidden ? <Eye aria-hidden className="size-4" /> : <EyeOff aria-hidden className="size-4" />}
        </button>
      )}
    </>
  );
}

function SortableRow({ item, onToggle }: { item: PortalV2NavItem; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(ROW, isDragging && 'relative z-10 shadow-lg')}
    >
      <RowBody
        item={item}
        hidden={false}
        onToggle={onToggle}
        handle={
          <button
            type="button"
            className="cursor-grab touch-none text-pv-muted-fg/60 hover:text-pv-muted-fg active:cursor-grabbing"
            aria-label={`Reorder ${item.label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="size-4" />
          </button>
        }
      />
    </div>
  );
}

/* ─────────────────────────────── dialog ────────────────────────────────── */

interface Draft {
  order: string[];
  hidden: string[];
}

function toDraft(prefs: PortalV2NavPreferences): Draft {
  const { shown, hidden } = arrangePortalV2Nav(prefs);
  return { order: [...shown, ...hidden].map((item) => item.href), hidden: hidden.map((item) => item.href) };
}

export function SidebarCustomizerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { preferences, save } = usePortalV2NavPreferences();
  const [draft, setDraft] = useState<Draft>(() => toDraft(preferences));

  // Each opening starts from what is saved.
  useEffect(() => {
    if (open) setDraft(toDraft(preferences));
  }, [open, preferences]);

  const byHref = useMemo(() => new Map(PORTAL_V2_ITEMS.map((item) => [item.href, item])), []);
  const home = PORTAL_V2_ITEMS.filter((item) => item.locked);
  const movable = draft.order
    .map((href) => byHref.get(href))
    .filter((item): item is PortalV2NavItem => !!item && !item.locked);
  const shown = movable.filter((item) => !draft.hidden.includes(item.href));
  const hidden = movable.filter((item) => draft.hidden.includes(item.href));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = shown.map((item) => item.href);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setDraft((current) => ({ ...current, order: [...next, ...hidden.map((item) => item.href)] }));
  };

  const toggle = (href: string) =>
    setDraft((current) => {
      const isHidden = current.hidden.includes(href);
      const nextHidden = isHidden ? current.hidden.filter((h) => h !== href) : [...current.hidden, href];
      // A tab brought back joins the end of the shown list.
      const rest = current.order.filter((h) => h !== href);
      const shownCount = rest.filter((h) => !nextHidden.includes(h) && !byHref.get(h)?.locked).length;
      const order = isHidden ? [...rest.slice(0, shownCount), href, ...rest.slice(shownCount)] : [...rest, href];
      return { order, hidden: nextHidden };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-pv-border px-7 py-5">
          <DialogTitle className="text-[17px] font-semibold tracking-tight text-pv-fg">Customise sidebar</DialogTitle>
          <DialogDescription>
            Drag to reorder and hide anything you don&apos;t use. Home stays put. This only changes your own sidebar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 px-7 py-6 md:grid-cols-[minmax(0,1fr)_240px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-pv-muted-fg">In your sidebar</p>
              {home.map((item) => (
                <div key={item.href} className={ROW}>
                  <RowBody item={item} hidden={false} handle={<span className="w-4" aria-hidden />} />
                </div>
              ))}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={shown.map((item) => item.href)} strategy={verticalListSortingStrategy}>
                  {shown.map((item) => (
                    <SortableRow key={item.href} item={item} onToggle={() => toggle(item.href)} />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {hidden.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-pv-muted-fg">Hidden</p>
                {hidden.map((item) => (
                  <div key={item.href} className={cn(ROW, 'border-dashed bg-transparent')}>
                    <RowBody item={item} hidden onToggle={() => toggle(item.href)} handle={<span className="w-4" aria-hidden />} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* The rail as it will look. */}
          <div className="hidden flex-col gap-2 md:flex">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-pv-muted-fg">Preview</p>
            <div className="flex flex-col gap-0.5 rounded-2xl border border-pv-border/60 bg-pv-sidebar p-2">
              {[...home, ...shown].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.href} className="flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-pv-sidebar-fg/70">
                    <Icon aria-hidden className="size-[17px] shrink-0 text-pv-sidebar-fg/60" />
                    <span className="truncate">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-pv-border px-7 py-4">
          <button type="button" className={V2_BUTTON_GHOST_SM} onClick={() => setDraft(toDraft(DEFAULT_NAV_PREFERENCES))}>
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className={V2_BUTTON_OUTLINE_SM} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={V2_BUTTON_DEFAULT_SM}
              onClick={() => {
                save({ order: draft.order, hidden: draft.hidden });
                onOpenChange(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
