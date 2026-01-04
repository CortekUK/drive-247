import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export interface AuditLog {
  id: string;
  action: string;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any> | null;
  created_at: string;
  target_user_id: string | null;
  // Joined data
  actor?: {
    name: string | null;
    email: string;
  } | null;
}

export interface AuditLogsFilters {
  entityType?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useAuditLogs(filters?: AuditLogsFilters) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["audit-logs", tenant?.id, filters],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      let query = supabase
        .from("audit_logs")
        .select(
          `
          id,
          action,
          actor_id,
          entity_type,
          entity_id,
          details,
          created_at,
          target_user_id,
          actor:app_users!audit_logs_actor_id_fkey (
            name,
            email
          )
        `
        )
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters?.entityType && filters.entityType !== "all") {
        query = query.eq("entity_type", filters.entityType);
      }

      if (filters?.action && filters.action !== "all") {
        query = query.eq("action", filters.action);
      }

      if (filters?.actorId && filters.actorId !== "all") {
        query = query.eq("actor_id", filters.actorId);
      }

      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo + "T23:59:59");
      }

      const { data, error } = await query.limit(500);

      if (error) {
        console.error("Error fetching audit logs:", error);
        throw error;
      }

      return data as AuditLog[];
    },
    enabled: !!tenant,
  });
}

// Hook to get unique action types for filtering
export function useAuditLogActions() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["audit-log-actions", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("audit_logs")
        .select("action")
        .eq("tenant_id", tenant.id)
        .order("action");

      if (error) throw error;

      // Get unique actions
      const uniqueActions = [...new Set(data?.map((d) => d.action) || [])];
      return uniqueActions;
    },
    enabled: !!tenant,
  });
}

// Hook to get admin users for filtering
export function useAdminUsers() {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: ["admin-users-list", tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");

      const { data, error } = await supabase
        .from("app_users")
        .select("id, name, email")
        .eq("tenant_id", tenant.id)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!tenant,
  });
}

// Helper to format action names for display
export function formatActionName(action: string): string {
  // Special cases for better formatting
  const actionMap: Record<string, string> = {
    update_settings: "Update Settings",
    create_user: "Create User",
    update_user: "Update User",
    delete_user: "Delete User",
    blocked_customer: "Block Customer",
    unblocked_customer: "Unblock Customer",
  };

  if (actionMap[action]) {
    return actionMap[action];
  }

  // Default: capitalize each word
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Helper to get action color
export function getActionColor(action: string): string {
  if (action.includes("rejected") || action.includes("deleted") || action.includes("blocked")) {
    return "text-red-600 bg-red-50 dark:bg-red-950/20";
  }
  if (action.includes("approved") || action.includes("created") || action.includes("unblocked")) {
    return "text-green-600 bg-green-50 dark:bg-green-950/20";
  }
  if (action.includes("updated") || action.includes("changed")) {
    return "text-blue-600 bg-blue-50 dark:bg-blue-950/20";
  }
  return "text-gray-600 bg-gray-50 dark:bg-gray-800";
}
