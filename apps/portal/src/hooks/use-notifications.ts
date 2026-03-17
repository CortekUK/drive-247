import { useEffect } from "react";
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

  const queryKey = ["notifications", tenant?.id, appUser?.id];

  // Fetch notifications for current user and tenant
  const { data: notifications, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!appUser?.id || !tenant?.id) {
        return [];
      }

      // Everyone sees their own notifications + broadcasts (user_id is null)
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("tenant_id", tenant.id)
        .or(`user_id.eq.${appUser.id},user_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        throw new Error(error.message || "Failed to fetch notifications");
      }

      return data as Notification[];
    },
    enabled: !!appUser?.id && !!tenant?.id,
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });

  // Realtime subscription — instantly refetch when notifications change
  useEffect(() => {
    if (!tenant?.id || !appUser?.id) return;

    const channel = supabase
      .channel(`notifications:${tenant.id}:${appUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          // Only invalidate if this notification is for our tenant
          const newRow = payload.new as any;
          if (newRow.tenant_id === tenant.id &&
              (newRow.user_id === appUser.id || newRow.user_id === null)) {
            queryClient.invalidateQueries({ queryKey });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id, appUser?.id, queryClient, queryKey]);

  // Count of unread notifications
  const unreadCount = notifications?.filter((n) => !n.is_read).length || 0;

  // Mark single notification as read
  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Mark all notifications as read
  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!appUser?.id || !tenant?.id) return;

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("tenant_id", tenant.id)
        .eq("is_read", false)
        .or(`user_id.eq.${appUser.id},user_id.is.null`);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Delete a notification
  const deleteNotification = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Clear all notifications
  const clearAll = useMutation({
    mutationFn: async () => {
      if (!appUser?.id || !tenant?.id) return;

      const { error } = await supabase
        .from("notifications")
        .delete()
        .eq("tenant_id", tenant.id)
        .or(`user_id.eq.${appUser.id},user_id.is.null`);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
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
