import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerSocket } from '@/contexts/CustomerSocketContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useEffect } from 'react';

/**
 * Hook to get the total unread message count for the customer.
 * Used for the badge in the customer portal sidebar.
 */
export function useCustomerUnreadCount() {
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const { onNewMessage, onMessagesRead } = useCustomerSocket();
  const queryClient = useQueryClient();

  const customerId = customerUser?.customer_id;

  const { data: unreadCount = 0, isLoading, refetch } = useQuery({
    queryKey: ['customer-chat-unread', customerId],
    queryFn: async () => {
      if (!customerId) return 0;

      try {
        // Get customer's channel
        const { data: channel, error: channelError } = await supabase
          .from('chat_channels')
          .select('id')
          .eq('customer_id', customerId)
          .single();

        if (channelError || !channel) {
          return 0;
        }

        // Count unread messages from tenant
        const { count, error: countError } = await supabase
          .from('chat_channel_messages')
          .select('*', { count: 'exact', head: true })
          .eq('channel_id', channel.id)
          .eq('sender_type', 'tenant')
          .eq('is_read', false);

        if (countError) {
          console.error('Error getting unread count:', countError);
          return 0;
        }

        return count || 0;
      } catch (error) {
        console.error('Error in useCustomerUnreadCount:', error);
        return 0;
      }
    },
    enabled: !!customerId,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute as backup
    retry: false,
  });

  // Refetch when new messages arrive or messages are read
  useEffect(() => {
    const unsubMessage = onNewMessage((payload) => {
      // Only count new messages from tenant
      if (payload.senderType === 'tenant') {
        console.log('[useCustomerUnreadCount] New message from tenant, refreshing count');
        queryClient.invalidateQueries({ queryKey: ['customer-chat-unread', customerId] });
      }
    });

    const unsubRead = onMessagesRead((payload) => {
      // Only update when customer reads messages
      if (payload.readerType === 'customer') {
        queryClient.invalidateQueries({ queryKey: ['customer-chat-unread', customerId] });
      }
    });

    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [onNewMessage, onMessagesRead, queryClient, customerId]);

  // Refetch when tab becomes visible (handles browser throttling of background tabs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && customerId) {
        console.log('[useCustomerUnreadCount] Tab visible, refreshing count');
        queryClient.invalidateQueries({ queryKey: ['customer-chat-unread', customerId] });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [queryClient, customerId]);

  return {
    unreadCount,
    isLoading,
    refetch,
  };
}
