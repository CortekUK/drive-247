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

  // Check if user is admin (can see all tenant notifications)
  const isAdmin = appUser?.role === 'admin' || appUser?.role === 'head_admin';

  // Fetch notifications for current user and tenant
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["notifications", tenant?.id, appUser?.id, isAdmin],
    queryFn: async () => {
      if (!appUser?.id || !tenant?.id) {
        return [];
      }

      let query = supabase
        .from("notifications")
        .select("*")
        .eq("tenant_id", tenant.id);

      // Admins see ALL notifications for the tenant they're viewing
      // Non-admins only see notifications addressed to them or broadcasts
      if (!isAdmin) {
        query = query.or(`user_id.eq.${appUser.id},user_id.is.null`);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error fetching notifications:", error);
        return [];
      }

      return data as Notification[];
    },
    enabled: !!appUser?.id && !!tenant,
    refetchInterval: 30000,
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
      if (!appUser?.id || !tenant?.id) return;

      let query = supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("tenant_id", tenant.id)
        .eq("is_read", false);

      // Non-admins can only mark their own notifications + broadcasts
      if (!isAdmin) {
        query = query.or(`user_id.eq.${appUser.id},user_id.is.null`);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id, isAdmin] });
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
      if (!appUser?.id || !tenant?.id) return;

      let query = supabase
        .from("notifications")
        .delete()
        .eq("tenant_id", tenant.id);

      // Non-admins can only delete their own notifications + broadcasts
      if (!isAdmin) {
        query = query.or(`user_id.eq.${appUser.id},user_id.is.null`);
      }

      const { error } = await query;

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", tenant?.id, appUser?.id, isAdmin] });
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
