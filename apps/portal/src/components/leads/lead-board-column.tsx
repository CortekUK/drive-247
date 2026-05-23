/**
 * LeadBoardColumn — single kanban column for the Active tab.
 * Drop-target via @dnd-kit's useDroppable. Renders LeadCard list.
 */
"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LeadCard } from "./lead-card";
import type { LeadRow } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";

interface LeadBoardColumnProps {
  id: string;
  label: string;
  leads: LeadRow[];
  staleThresholdHours?: number;
}

export function LeadBoardColumn({ id, label, leads, staleThresholdHours }: LeadBoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "column" } });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-[60vh] w-[280px] shrink-0 flex-col rounded-lg border border-[#f1f5f9] bg-[#f8fafc] transition-colors",
        isOver && "border-indigo-300 bg-indigo-50/40",
      )}
    >
      <div className="flex items-center justify-between rounded-t-lg border-b border-[#f1f5f9] bg-[#eef2ff] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[#404040]">
          {label}
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#737373]">
          {leads.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} staleThresholdHours={staleThresholdHours} />
            ))}
            {leads.length === 0 && (
              <div className="rounded-md border border-dashed border-[#e0e7ff] bg-white py-6 text-center text-xs text-[#737373]">
                No leads here
              </div>
            )}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}
