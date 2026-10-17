'use client';

/**
 * Customise sidebar — Northwind's dialog
 * (apps/portal/src/components/shared/layout/sidebar-customizer-dialog.tsx)
 * for the super-admin rail: three columns, "Not shown" · "Your sidebar" ·
 * "Preview", the same rows, the same drag handle, eye and lock.
 *
 * The admin rail is one flat list (no groups, no pinning), so "Your sidebar"
 * is one sortable list. "Not shown" holds the default rows you hid and every
 * page that lives off the rail (Audit Logs, OpenAI Usage, Mode Requests …),
 * so a page you use every day can be put back one click away.
 *
 * Saved per person (lib/admin-nav-preferences.ts). The preview is drawn from
 * the same draft as the list, so the two can never disagree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Lock, Minus, Plus, RotateCcw, type LucideIcon } from 'lucide-react';
import { SIDEBAR_HIGHLIGHT_ACTIVE } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useAuthStore } from '@/store/authStore';
import { useAdminNav, type AdminNavItem } from '@/components/admin/admin-nav';
import {
  PERMANENT_ADMIN_HREFS,
  applyAdminNavPreferences,
  useAdminNavPreferences,
} from '@/lib/admin-nav-preferences';

interface Draft {
  shown: string[];
  hidden: string[];
}

/* Rows, flat (v2: no shadows, no boxes): a soft tint for what is in your
   sidebar, plain for what can be added, and the action on each row appears
   with the row's hover — the list reads as names, not as a wall of buttons. */
const ROW = 'group/row flex h-9 items-center gap-2.5 rounded-xl px-2.5 transition-colors';
const ROW_ACTION =
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[12px] font-medium outline-none transition-[opacity,background-color,color] duration-200 focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/30';

/** A page that is off the sidebar, with "+ Add". */
function AvailableRow({ label, icon: Icon, onAdd }: { label: string; icon?: LucideIcon; onAdd: () => void }) {
  return (
    <div className={`${ROW} hover:bg-primary/[0.06]`}>
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">{label}</span>
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add ${label} to your sidebar`}
        className={`${ROW_ACTION} bg-primary/10 text-primary hover:bg-primary/15`}
      >
        <Plus className="size-3.5" aria-hidden />
        Add
      </button>
    </div>
  );
}

/** A row in your sidebar: drag to move, remove on hover; a locked one says so. */
function SortableRow({
  id,
  label,
  icon: Icon,
  locked,
  onRemove,
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  locked?: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${ROW} bg-muted/50 hover:bg-muted ${isDragging ? 'relative z-10 bg-card ring-1 ring-primary/30' : ''}`}
    >
      <button
        type="button"
        className="-ml-1 cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
      {locked ? (
        <span className="inline-flex items-center gap-1 px-2 text-[11px] text-muted-foreground" title="Always in your sidebar">
          <Lock className="size-3" aria-hidden />
          Always shown
        </span>
      ) : (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from your sidebar`}
          className={`${ROW_ACTION} text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100`}
        >
          <Minus className="size-3.5" aria-hidden />
          Remove
        </button>
      )}
    </div>
  );
}

/** A row of the preview, drawn the way the real rail draws it. */
function PreviewRow({ item, active, muted }: { item: { name: string; icon?: LucideIcon }; active?: boolean; muted?: boolean }) {
  const Icon = item.icon;
  return (
    <div
      className={`flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium ${
        active ? SIDEBAR_HIGHLIGHT_ACTIVE : muted ? 'text-muted-foreground' : 'text-foreground/80'
      }`}
    >
      {Icon ? <Icon className={`size-4 shrink-0 ${active ? '' : 'text-muted-foreground'}`} /> : null}
      <span className="min-w-0 flex-1 truncate">{item.name}</span>
    </div>
  );
}

function ColumnHeading({ title, count, hint }: { title: string; count?: number; hint: string }) {
  return (
    <div className="mb-3">
      <h4 className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </h4>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/* No scrolling (Ghulam, Oct 17 2026): every column is its natural height and
   the rows are compact enough that the whole dialog fits one screen. */
const SCROLL_COLUMN = 'px-6 py-4';

export function SidebarCustomizerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const nav = useAdminNav();
  const { user } = useAuthStore();
  const { preferences, save, isSaving, isUnavailable, isLoading } = useAdminNavPreferences(user?.id);

  const catalogue = useMemo(() => {
    const byHref = new Map<string, AdminNavItem>();
    for (const item of [...nav.defaultTopLevel, ...nav.extras]) byHref.set(item.href, item);
    return byHref;
  }, [nav.defaultTopLevel, nav.extras]);

  const buildDraft = (): Draft => {
    const shown = applyAdminNavPreferences(nav.defaultTopLevel, nav.extras, preferences).map((i) => i.href);
    return { shown, hidden: [...catalogue.keys()].filter((href) => !shown.includes(href)) };
  };

  const [draft, setDraft] = useState<Draft>(buildDraft);

  // Seeded once per opening, after the saved arrangement has loaded.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || isLoading) return;
    setDraft(buildDraft());
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((current) => {
      const from = current.shown.indexOf(String(active.id));
      const to = current.shown.indexOf(String(over.id));
      if (from < 0 || to < 0) return current;
      return { ...current, shown: arrayMove(current.shown, from, to) };
    });
  };

  const hide = (href: string) =>
    setDraft((current) =>
      PERMANENT_ADMIN_HREFS.includes(href)
        ? current
        : { shown: current.shown.filter((h) => h !== href), hidden: [...current.hidden, href] },
    );

  const show = (href: string) =>
    setDraft((current) => ({ shown: [...current.shown, href], hidden: current.hidden.filter((h) => h !== href) }));

  const persist = async (value: Parameters<typeof save>[0], message: string) => {
    try {
      await save(value);
      toast.success(message);
      onOpenChange(false);
    } catch {
      toast.error('Could not save your sidebar', { description: 'Your changes were not stored. Please try again.' });
    }
  };

  const defaultHrefs = new Set(nav.defaultTopLevel.map((i) => i.href));
  const itemsOf = (hrefs: string[]) => hrefs.map((href) => catalogue.get(href)).filter(Boolean) as AdminNavItem[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-border px-7 py-4">
          <DialogTitle>Customise sidebar</DialogTitle>
          <DialogDescription>Put the pages you use in the order you use them.</DialogDescription>
        </DialogHeader>

        {isUnavailable ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            Your saved sidebar could not be loaded, so customising is unavailable right now.
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-[310px_1fr_280px] sm:divide-x sm:divide-y-0">
            {/* Pages off the sidebar */}
            <div className={SCROLL_COLUMN}>
              <ColumnHeading title="Add to your sidebar" count={draft.hidden.length} hint="Pages you removed, and pages that live elsewhere." />
              {draft.hidden.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  Everything is in your sidebar
                </p>
              ) : (
                <div className="space-y-0.5">
                  {draft.hidden.map((href) => {
                    const item = catalogue.get(href);
                    if (!item) return null;
                    return <AvailableRow key={href} label={item.name} icon={item.icon} onAdd={() => show(href)} />;
                  })}
                </div>
              )}
            </div>

            {/* The sidebar itself */}
            <div className={SCROLL_COLUMN}>
              <ColumnHeading title="Your sidebar" count={draft.shown.length} hint="Drag to reorder. Hover a row to remove it." />
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={draft.shown} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {draft.shown.map((href) => {
                      const item = catalogue.get(href);
                      if (!item) return null;
                      return (
                        <SortableRow
                          key={href}
                          id={href}
                          label={item.name}
                          icon={item.icon}
                          locked={PERMANENT_ADMIN_HREFS.includes(href)}
                          onRemove={() => hide(href)}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            {/* Preview — drawn from the same draft, so it cannot disagree with the list. */}
            <div className="bg-muted/20 px-6 py-4" data-testid="sidebar-preview">
              <ColumnHeading title="Preview" hint="How your sidebar will look." />
              <div className="rounded-2xl bg-background p-2 ring-1 ring-foreground/5">
                {/* The org row, as the rail starts. */}
                <div className="mb-1 flex items-center gap-2 px-1.5 py-1.5">
                  <img src="/icons/icon-192.png" alt="" aria-hidden className="h-6 w-6 rounded-md" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold leading-tight text-foreground">Drive247</span>
                    <span className="block truncate text-[10px] leading-tight text-muted-foreground">Super Admin</span>
                  </span>
                </div>
                <div className="space-y-0.5">
                  {itemsOf(draft.shown).map((item, i) => (
                    <PreviewRow key={item.href} item={item} active={i === 0} />
                  ))}
                </div>
                {nav.settings && (
                  <div className="mt-2 border-t border-border/60 pt-2">
                    <PreviewRow item={nav.settings} muted />
                  </div>
                )}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Dashboard and Settings are always there. Only your own sidebar changes.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border px-7 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={isSaving || isUnavailable}
            onClick={() => persist(null, 'Sidebar reset to default')}
            className="text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isSaving || isUnavailable}
              onClick={() =>
                persist(
                  { order: draft.shown, hidden: draft.hidden.filter((href) => defaultHrefs.has(href)) },
                  'Sidebar updated',
                )
              }
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
