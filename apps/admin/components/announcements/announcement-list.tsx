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
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { reorderAfterDrop, sectionOf, type ListSection } from '@/lib/announcements/api';
import type { AdminAnnouncementRow, AdminAnnouncementStats, AnnouncementKind } from '@/lib/announcements/contract';
import type { RowPending } from '@/lib/announcements/row-actions';
import { cn } from '@/lib/utils';
import { AnnouncementRow } from './announcement-row';

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
  rows,
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
      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.id} aria-label={section.title ?? undefined} className="space-y-2.5">
            {section.title && (
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {section.title}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums tracking-normal">
                  {section.rows.length}
                </span>
              </h3>
            )}
            {section.rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
                {section.id === 'hard' ? 'No hard blockers.' : 'No soft system announcements.'}
              </p>
            ) : (
              <SortableContext items={section.rows.map(sortableId)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
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
            )}
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
      // Translate only: rows differ in height, and a scale would squash them.
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10', anyDragging && !isDragging && 'select-none')}
    >
      <AnnouncementRow
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

/** Loading state: three row-shaped placeholders. */
export function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading announcements">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-border p-3">
          <Skeleton className="h-9 w-6 rounded-md" />
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="hidden h-6 w-11 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}
