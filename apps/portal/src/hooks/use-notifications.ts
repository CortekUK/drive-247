import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";

export interface Notification {
  id: string;
  user_id: string | null;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  link: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export function useNotifications() {
  const { appUser } = useAuth();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();

  // Fetch notifications for current user
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications", tenant?.id, appUser?.id],
    queryFn: async () => {
      if (!appUser?.id) return [];

      let query = supabase
        .from("notifications")
        .select("*")
        .or(`user_id.eq.${appUser.id},user_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching notifications:", error);
        return [];
      }

      return data as Notification[];
    },
    enabled: !!appUser?.id && !!tenant,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Count of unread notifications
  const unreadCount = notifications?.filter((n) => !n.is_read).length || 0;

  // Mark single notification as read
  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      let query = supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id] });
    },
  });

  // Mark all notifications as read
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!appUser?.id) return;

      let query = supabase
        .from("notifications")
        .update({ is_read: true })
        .or(`user_id.eq.${appUser.id},user_id.is.null`)
        .eq("is_read", false);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id] });
    },
  });

  // Delete a notification
  const deleteNotification = useMutation({
    mutationFn: async (notificationId: string) => {
      let query = supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id] });
    },
  });

  // Clear all notifications
  const clearAll = useMutation({
    mutationFn: async () => {
      if (!appUser?.id) return;

      let query = supabase
        .from("notifications")
        .delete()
        .or(`user_id.eq.${appUser.id},user_id.is.null`);

      if (tenant?.id) {
        query = query.eq("tenant_id", tenant.id);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id] });
    },
  });

  return {
    notifications: notifications || [],
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  };
}
