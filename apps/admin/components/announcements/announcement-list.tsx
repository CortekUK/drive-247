'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { reorderAfterDrop, sectionOf, type ListSection } from '@/lib/announcements/api';
import type { AdminAnnouncementRow, AdminAnnouncementStats, AnnouncementKind } from '@/lib/announcements/contract';
import type { RowPending } from '@/lib/announcements/row-actions';
import { cn } from '@/lib/utils';
import { AnnouncementCard } from './announcement-row';

interface RowActions {
  onToggleActive: (row: AdminAnnouncementRow, next: boolean) => void;
  onEdit: (row: AdminAnnouncementRow) => void;
  onDelete: (row: AdminAnnouncementRow) => void;
  onShowAgain: (row: AdminAnnouncementRow) => void;
  onDuplicate: (row: AdminAnnouncementRow) => void;
  /** The row whose duplicate is being prepared (images copying), if any. */
  duplicatingId: string | null;
}

/** Sortable ids carry their section, so a drag can be scoped to it: "hard:<uuid>". */
const sortableId = (row: AdminAnnouncementRow) => sectionOf(row) + ':' + row.id;
const scopeOf = (id: string) => id.slice(0, id.indexOf(':'));
const rowIdOf = (id: string) => id.slice(id.indexOf(':') + 1);

/**
 * One tab's announcements in display order, reordered by dragging the grip.
 * System rows are split into Hard then Soft sections that items can never cross,
 * so the order an admin sees is always the order tenants get.
 */
export function AnnouncementList({
  kind,
  rows: rowsInOrder,
  targetsById,
  statsById,
  statsCountSuperAdmins,
  pendingById,
  onReorder,
  ...actions
}: RowActions & {
  kind: AnnouncementKind;
  /** This kind's rows, in display order. */
  rows: AdminAnnouncementRow[];
  targetsById: Record<string, string[]>;
  statsById: Record<string, AdminAnnouncementStats> | null;
  /** false: the stats are staff only (older stats function), and the rows say so. */
  statsCountSuperAdmins: boolean;
  /** Writes still in flight, by announcement id. */
  pendingById: Readonly<Record<string, RowPending | undefined>>;
  onReorder: (kind: AnnouncementKind, ids: string[]) => void;
}) {
  // Active ones first; each group keeps its saved order (sort is stable).
  const rows = useMemo(
    () => [...rowsInOrder].sort((a, b) => Number(b.is_active) - Number(a.is_active)),
    [rowsInOrder],
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so the grip and the inline
    // switch and buttons never fight over a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = useMemo(() => {
    const map = new Map(rows.map((r) => [r.id, r.title]));
    return (id: string | number) => map.get(rowIdOf(String(id))) ?? 'announcement';
  }, [rows]);

  // Nearest VALID target only: candidates from another section are filtered out
  // first, so a drop is never silently discarded (sidebar-customizer precedent).
  const collisionDetection: CollisionDetection = (args) => {
    const scope = scopeOf(String(args.active.id));
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => scopeOf(String(c.id)) === scope),
    });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => 'Picked up ' + titleOf(active.id) + '.',
    onDragOver: ({ active, over }) =>
      over ? titleOf(active.id) + ' is now at the position of ' + titleOf(over.id) + '.' : titleOf(active.id) + ' is not over a position.',
    onDragEnd: ({ active, over }) =>
      over ? titleOf(active.id) + ' dropped at the position of ' + titleOf(over.id) + '.' : titleOf(active.id) + ' dropped.',
    onDragCancel: ({ active }) => 'Reordering cancelled. ' + titleOf(active.id) + ' is back in place.',
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o || scopeOf(a) !== scopeOf(o)) return;
    const ids = reorderAfterDrop(rows, kind, rowIdOf(a), rowIdOf(o));
    if (ids) onReorder(kind, ids);
  };

  const sections: Array<{ id: ListSection; title: string | null; rows: AdminAnnouncementRow[] }> =
    kind === 'feature'
      ? [{ id: 'feature', title: null, rows }]
      : [
          { id: 'hard', title: 'Hard blockers (shown first)', rows: rows.filter((r) => r.blocking === 'hard') },
          { id: 'soft', title: 'Soft', rows: rows.filter((r) => r.blocking !== 'hard') },
        ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements }}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        {sections.filter((section) => section.rows.length > 0).map((section) => (
          <section key={section.id} aria-label={section.title ?? undefined}>
            <SortableContext items={section.rows.map(sortableId)} strategy={rectSortingStrategy}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {section.rows.map((row) => (
                  <SortableAnnouncementRow
                    key={row.id}
                    row={row}
                    selectedTenantCount={targetsById[row.id]?.length ?? 0}
                    stats={statsById?.[row.id]}
                    statsAvailable={statsById !== null}
                    statsCountSuperAdmins={statsCountSuperAdmins}
                    pending={pendingById[row.id] ?? null}
                    anyDragging={activeId !== null}
                    {...actions}
                  />
                ))}
              </div>
            </SortableContext>
          </section>
        ))}
      </div>
    </DndContext>
  );
}

function SortableAnnouncementRow({
  row,
  selectedTenantCount,
  stats,
  statsAvailable,
  statsCountSuperAdmins,
  pending,
  anyDragging,
  ...actions
}: RowActions & {
  row: AdminAnnouncementRow;
  selectedTenantCount: number;
  stats: AdminAnnouncementStats | undefined;
  statsAvailable: boolean;
  statsCountSuperAdmins: boolean;
  pending: RowPending | null;
  anyDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId(row),
  });

  return (
    <div
      ref={setNodeRef}
      // Translate only: a scale would squash the card.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('h-full', isDragging && 'relative z-10', anyDragging && !isDragging && 'select-none')}
    >
      <AnnouncementCard
        row={row}
        selectedTenantCount={selectedTenantCount}
        stats={stats}
        statsAvailable={statsAvailable}
        statsCountSuperAdmins={statsCountSuperAdmins}
        pending={pending}
        dragging={isDragging}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={'Reorder ' + row.title}
            className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
        }
        {...actions}
      />
    </div>
  );
}

/** Loading state: three card-shaped placeholders. */
export function ListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading announcements">
      {[0, 1, 2].map((i) => (
        <div key={i} className="overflow-hidden rounded-3xl border border-border">
          <Skeleton className="aspect-[16/9] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-5 w-2/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
