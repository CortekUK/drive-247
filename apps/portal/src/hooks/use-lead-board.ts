/**
 * useLeadBoard — Wraps useLeads and groups results by kanban column.
 * Spec Section 6.3.
 */
"use client";

import { useMemo } from "react";
import { useLeads, type LeadFilters, type LeadRow } from "./use-leads";
import { ACTIVE_COLUMNS, type LeadStage } from "@/lib/lead-stage-machine";

export interface BoardColumn {
  id: string;
  label: string;
  stages: LeadStage[];
  leads: LeadRow[];
}

export function useLeadBoard(filters: Omit<LeadFilters, "stages"> = {}) {
  // Always fetch the union of all stages visible on the Active tab.
  const stages: LeadStage[] = useMemo(
    () => ACTIVE_COLUMNS.flatMap((c) => c.stages),
    [],
  );

  const query = useLeads({ ...filters, stages });

  const columns: BoardColumn[] = useMemo(() => {
    const all = query.data ?? [];
    return ACTIVE_COLUMNS.map((c) => ({
      id: c.id,
      label: c.label,
      stages: c.stages,
      leads: all
        .filter((l) => c.stages.includes(l.stage))
        .sort((a, b) => (a.stage_updated_at < b.stage_updated_at ? 1 : -1)),
    }));
  }, [query.data]);

  return { ...query, columns };
}
