/**
 * LeadBoard — kanban container with drag-drop validated by state machine.
 * Spec Section 6.3.
 *
 * - Optimistic UI updates on drop; rollback + toast if transition is invalid.
 * - Realtime invalidation handled by `useLeads` via useRealtimeInvalidate.
 */
"use client";

import { useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { LeadBoardColumn } from "./lead-board-column";
import { LeadCard } from "./lead-card";
import type { LeadRow } from "@/hooks/use-leads";
import type { BoardColumn } from "@/hooks/use-lead-board";
import { useUpdateLeadStage } from "@/hooks/use-lead-mutations";
import { canTransition, entryStageForColumn, type LeadStage } from "@/lib/lead-stage-machine";

interface LeadBoardProps {
  columns: BoardColumn[];
  staleThresholdHours?: number;
}

export function LeadBoard({ columns, staleThresholdHours }: LeadBoardProps) {
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);
  const updateStage = useUpdateLeadStage();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { lead?: LeadRow } | undefined;
    if (data?.lead) setActiveLead(data.lead);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = e;
    if (!over) return;

    const lead = (active.data.current as { lead?: LeadRow } | undefined)?.lead;
    const overType = over.data.current?.type;
    if (!lead) return;

    // Resolve the destination column id. If hovering over another card, look up its column.
    let columnId: string | null = null;
    if (overType === "column") {
      columnId = String(over.id);
    } else {
      const targetLeadId = String(over.id);
      const col = columns.find((c) => c.leads.some((l) => l.id === targetLeadId));
      columnId = col?.id ?? null;
    }
    if (!columnId) return;

    const nextStage = entryStageForColumn(columnId);
    if (!nextStage) return;

    const currentStage = lead.stage as LeadStage;
    // Already in this column (any merged stage) → no-op
    const sourceCol = columns.find((c) => c.stages.includes(currentStage));
    if (sourceCol?.id === columnId) return;

    if (!canTransition(currentStage, nextStage)) {
      toast.error(`Can't move from ${currentStage} to ${nextStage}`);
      return;
    }

    updateStage.mutate({ leadId: lead.id, currentStage, nextStage });
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((c) => (
          <LeadBoardColumn
            key={c.id}
            id={c.id}
            label={c.label}
            leads={c.leads}
            staleThresholdHours={staleThresholdHours}
          />
        ))}
      </div>
      <DragOverlay>
        {activeLead && (
          <div className="rotate-2">
            <LeadCard lead={activeLead} draggable={false} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
