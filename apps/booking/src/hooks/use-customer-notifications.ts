import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface CustomerNotification {
  id: string;
  customer_user_id: string;
  tenant_id: string | null;
  title: string;
  message: string;
  type: string;
  link: string | null;
  is_read: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useCustomerNotifications() {
  const { customerUser } = useCustomerAuthStore();
  const queryClient = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['customer-notifications', customerUser?.id],
    queryFn: async () => {
      if (!customerUser?.id) return [];

      const { data, error } = await supabase
        .from('customer_notifications')
        .select('*')
        .eq('customer_user_id', customerUser.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching customer notifications:', error);
        throw error;
      }

      return (data || []) as CustomerNotification[];
    },
    enabled: !!customerUser?.id,
    refetchInterval: 30000, // Poll every 30 seconds
  });

  const markAsRead = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['customer-notifications', customerUser?.id],
      });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: async () => {
      if (!customerUser?.id) return;

      const { error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true })
        .eq('customer_user_id', customerUser.id)
        .eq('is_read', false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['customer-notifications', customerUser?.id],
      });
    },
  });

  const deleteNotification = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('customer_notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['customer-notifications', customerUser?.id],
      });
    },
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!customerUser?.id) return;

      const { error } = await supabase
        .from('customer_notifications')
        .delete()
        .eq('customer_user_id', customerUser.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['customer-notifications', customerUser?.id],
      });
    },
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  };
}
