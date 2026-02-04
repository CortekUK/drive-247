import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSocket } from '@/contexts/SocketContext';
import { useEffect } from 'react';

/**
 * Hook to get the total unread message count across all channels for the tenant.
 * Used for the global badge in the sidebar.
 */
export function useUnreadCount() {
  const { tenant } = useTenant();
  const { onNewMessage, onMessagesRead } = useSocket();
  const queryClient = useQueryClient();

  const { data: unreadCount = 0, isLoading, refetch } = useQuery({
    queryKey: ['chat-unread-count', tenant?.id],
    queryFn: async () => {
      if (!tenant) return 0;

      try {
        // Direct query instead of RPC for reliability
        // Count unread messages from customers across all active channels
        const { data: channels, error: channelsError } = await supabase
          .from('chat_channels')
          .select('id')
          .eq('tenant_id', tenant.id)
          .eq('status', 'active');

        if (channelsError || !channels || channels.length === 0) {
          return 0;
        }

        const channelIds = channels.map(c => c.id);

        const { count, error: countError } = await supabase
          .from('chat_channel_messages')
          .select('*', { count: 'exact', head: true })
          .in('channel_id', channelIds)
          .eq('sender_type', 'customer')
          .eq('is_read', false);

        if (countError) {
          console.error('Error getting unread count:', countError);
          return 0;
        }

        return count || 0;
      } catch (error) {
        console.error('Error in useUnreadCount:', error);
        return 0;
      }
    },
    enabled: !!tenant,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute as backup
    retry: false, // Don't retry on errors
  });

  // Refetch when new messages arrive or messages are read
  useEffect(() => {
    const unsubMessage = onNewMessage((payload) => {
      // Only count new messages from customers
      if (payload.senderType === 'customer') {
        console.log('[useUnreadCount] New message from customer, refreshing count');
        queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenant?.id] });
      }
    });

    const unsubRead = onMessagesRead((payload) => {
      // Only update when tenant reads messages
      if (payload.readerType === 'tenant') {
        queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenant?.id] });
      }
    });

    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [onNewMessage, onMessagesRead, queryClient, tenant?.id]);

  // Refetch when tab becomes visible (handles browser throttling of background tabs)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && tenant?.id) {
        console.log('[useUnreadCount] Tab visible, refreshing count');
        queryClient.invalidateQueries({ queryKey: ['chat-unread-count', tenant?.id] });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [queryClient, tenant?.id]);

  return {
    unreadCount,
    isLoading,
    refetch,
  };
}

/**
 * Hook to get unread count for a specific channel.
 */
export function useChannelUnreadCount(channelId: string | null) {
  const { tenant } = useTenant();
  const { onNewMessage, onMessagesRead } = useSocket();
  const queryClient = useQueryClient();

  const { data: unreadCount = 0, isLoading } = useQuery({
    queryKey: ['chat-channel-unread', tenant?.id, channelId],
    queryFn: async () => {
      if (!tenant || !channelId) return 0;

      const { count, error } = await supabase
        .from('chat_channel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('sender_type', 'customer')
        .eq('is_read', false);

      if (error) throw error;

      return count || 0;
    },
    enabled: !!tenant && !!channelId,
    staleTime: 10000,
  });

  // Update on new messages or read status changes
  useEffect(() => {
    if (!channelId) return;

    const unsubMessage = onNewMessage((payload) => {
      if (payload.channelId === channelId && payload.senderType === 'customer') {
        queryClient.invalidateQueries({ queryKey: ['chat-channel-unread', tenant?.id, channelId] });
      }
    });

    const unsubRead = onMessagesRead((payload) => {
      if (payload.channelId === channelId) {
        queryClient.invalidateQueries({ queryKey: ['chat-channel-unread', tenant?.id, channelId] });
      }
    });

    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [channelId, onNewMessage, onMessagesRead, queryClient, tenant?.id]);

  return { unreadCount, isLoading };
}
