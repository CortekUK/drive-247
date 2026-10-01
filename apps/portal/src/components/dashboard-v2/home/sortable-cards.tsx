'use client';

/**
 * The three operations cards, rearrangeable (Sep 27 2026).
 *
 * Each card shows a small grip (`CardGrip`) in its header, just before its
 * top-right icon; drag a card by the grip to put it somewhere else in the row. Only the grip starts a drag, so the rest
 * of a card keeps its own clicks (the Trax card opens Trax, rows open records).
 *
 * The order is remembered per user in this browser (localStorage) — a
 * convenience, not a setting: a new browser, a private window or cleared site
 * data simply shows the default order again.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SortableCardItem {
  id: string;
  /** For the grip's label: "Move the To do card". */
  label: string;
  node: ReactNode;
}

/**
 * The drag handle, wired by the card's SortableCard and read here, so each
 * card can put its grip wherever its header wants it — just before the
 * top-right icon (Ghulam, Sep 27 2026). Renders nothing outside a sortable row.
 */
type Grip = ReturnType<typeof useSortable> & { label: string };
const GripContext = createContext<Grip | null>(null);

export function CardGrip() {
  const g = useContext(GripContext);
  if (!g) return null;
  return (
    <button
      ref={g.setActivatorNodeRef}
      type="button"
      aria-label={`Move the ${g.label} card`}
      title="Drag to move"
      {...g.attributes}
      {...g.listeners}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex size-7 touch-none items-center justify-center rounded-lg text-[var(--pv-ink-3)] max-md:hidden transition-colors hover:bg-[var(--pv-accent-bg)] hover:text-[var(--pv-accent-ink)]',
        g.isDragging ? 'cursor-grabbing bg-[var(--pv-accent-bg)] text-[var(--pv-accent-ink)]' : 'cursor-grab'
      )}
    >
      <GripHorizontal className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}

function SortableCard({ item }: { item: SortableCardItem }) {
  const sortable = useSortable({ id: item.id });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  return (
    <GripContext.Provider value={{ ...sortable, label: item.label }}>
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('relative flex min-h-0 min-w-0 flex-col [&>*]:flex-1', isDragging && 'z-20 opacity-90')}
    >
      {item.node}
    </div>
    </GripContext.Provider>
  );
}

export function SortableCards({
  items,
  storageKey,
  className,
}: {
  items: SortableCardItem[];
  /** Where this user's order is kept in localStorage. */
  storageKey: string;
  className?: string;
}) {
  const ids = items.map((i) => i.id);
  const [order, setOrder] = useState<string[]>(ids);

  // Restore a saved order, keeping only cards that still exist and adding any
  // new ones at the end.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as string[];
      if (Array.isArray(saved) && saved.length) {
        const kept = saved.filter((id) => ids.includes(id));
        setOrder([...kept, ...ids.filter((id) => !kept.includes(id))]);
      }
    } catch {
      /* storage unavailable — keep the default order */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, ids.join(',')]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id)));
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const visible = order.filter((id) => byId.has(id));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visible} strategy={horizontalListSortingStrategy}>
        <div className={className}>
          {visible.map((id) => (
            <SortableCard key={id} item={byId.get(id)!} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
