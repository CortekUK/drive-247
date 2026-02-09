import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useTenant } from "@/contexts/TenantContext";
import { useAuditLog } from "@/hooks/use-audit-log";

export interface BlockedDate {
  id: string;
  start_date: string;
  end_date: string;
  reason?: string;
  created_at: string;
  created_by?: string;
  vehicle_id?: string;
  vehicles?: {
    make: string;
    model: string;
    reg: string;
  };
}

export interface AddBlockedDateData {
  start_date: Date;
  end_date: Date;
  reason?: string;
  vehicle_id?: string;
}

export const useBlockedDates = (vehicle_id?: string) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { logAction } = useAuditLog();

  // Fetch blocked dates
  const { data: blockedDates = [], isLoading } = useQuery({
    queryKey: vehicle_id ? ["blocked-dates", tenant?.id, vehicle_id] : ["blocked-dates", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      let query = supabase
        .from("blocked_dates")
        .select("*, vehicles!blocked_dates_vehicle_id_fkey(make, model, reg)")
        .eq("tenant_id", tenant.id);

      // If vehicle_id is provided, get only vehicle-specific blocks
      if (vehicle_id) {
        query = query.eq('vehicle_id', vehicle_id);
      }
      // If no vehicle_id, get all blocks (general and vehicle-specific) - no filter needed

      query = query.order("start_date", { ascending: true });

      const { data, error } = await query;

      if (error) throw error;
      return data as BlockedDate[];
    },
    enabled: !!tenant,
  });

  // Add blocked date mutation
  const addBlockedDateMutation = useMutation({
    mutationFn: async (data: AddBlockedDateData) => {
      if (!tenant) throw new Error("No tenant context available");

      const { data: inserted, error } = await supabase.from("blocked_dates").insert({
        start_date: format(data.start_date, 'yyyy-MM-dd'),
        end_date: format(data.end_date, 'yyyy-MM-dd'),
        reason: data.reason,
        vehicle_id: data.vehicle_id || null,
        tenant_id: tenant.id,
      }).select().single();

      if (error) throw error;
      return inserted;
    },
    onSuccess: (data) => {
      // Invalidate all blocked-dates queries (general and vehicle-specific)
      queryClient.invalidateQueries({ queryKey: ["blocked-dates"] });
      toast({
        title: "Date Range Blocked",
        description: "The date range has been successfully blocked.",
      });
      logAction({
        action: "blocked_date_created",
        entityType: "blocked_date",
        entityId: data.id,
        details: { start_date: data.start_date, end_date: data.end_date, reason: data.reason },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to block date range. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Delete blocked date mutation
  const deleteBlockedDateMutation = useMutation({
    mutationFn: async (id: string) => {
      let query = supabase
        .from("blocked_dates")
        .delete()
        .eq("id", id);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["blocked-dates"] });
      toast({
        title: "Date Range Unblocked",
        description: "The date range has been successfully unblocked.",
      });
      logAction({
        action: "blocked_date_deleted",
        entityType: "blocked_date",
        entityId: id,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to unblock date range. Please try again.",
        variant: "destructive",
      });
    },
  });

  return {
    blockedDates,
    isLoading,
    addBlockedDate: addBlockedDateMutation.mutate,
    deleteBlockedDate: deleteBlockedDateMutation.mutate,
    isAdding: addBlockedDateMutation.isPending,
    isDeleting: deleteBlockedDateMutation.isPending,
  };
};
