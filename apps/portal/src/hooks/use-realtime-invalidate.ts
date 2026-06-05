/**
 * useRealtimeInvalidate — Spec Section 16.2.
 *
 * Subscribes to a tenant-scoped Supabase Realtime channel on a table and
 * invalidates the provided React Query key on every postgres_changes event.
 * Used by the kanban board and any list view that needs live updates.
 *
 * Mirror of the pattern in RealtimeChatContext.
 */
"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Options {
  table: string;
  tenantId: string | undefined;
  queryKey: QueryKey;
  /** Filter beyond tenant_id (e.g. `lead_id=eq.${leadId}`) */
  extraFilter?: string;
  /** Optional channel name override; default = `${table}_tenant_${tenantId}` */
  channel?: string;
  enabled?: boolean;
}

export function useRealtimeInvalidate({
  table,
  tenantId,
  queryKey,
  extraFilter,
  channel,
  enabled = true,
}: Options) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !tenantId) return;

    const channelName = channel ?? `${table}_tenant_${tenantId}`;
    const filter = extraFilter
      ? `tenant_id=eq.${tenantId},${extraFilter}`
      : `tenant_id=eq.${tenantId}`;

    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter,
        },
        () => {
          qc.invalidateQueries({ queryKey });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [enabled, tenantId, table, JSON.stringify(queryKey), extraFilter, channel, qc]);
}
