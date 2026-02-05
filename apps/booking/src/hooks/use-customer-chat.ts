import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useCustomerSocket } from '@/contexts/CustomerSocketContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useEffect, useCallback, useRef } from 'react';

export interface ChatMessage {
  id: number;
  channel_id: string;
  sender_type: 'tenant' | 'customer';
  sender_id: string;
  content: string;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatChannel {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: 'active' | 'archived';
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

const PAGE_SIZE = 25;

export function useCustomerChat() {
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();
  const { onNewMessage, onMessagesRead, joinRoom, leaveRoom, markRead } = useCustomerSocket();
  const queryClient = useQueryClient();
  const hasJoinedRoom = useRef(false);

  const tenantId = tenant?.id || customerUser?.tenant_id;
  const customerId = customerUser?.customer_id;

  // Fetch the channel for this customer-tenant pair
  const { data: channel, isLoading: channelLoading } = useQuery({
    queryKey: ['customer-chat-channel', tenantId, customerId],
    queryFn: async () => {
      if (!tenantId || !customerId) throw new Error('No tenant or customer context');

      const { data, error } = await supabase
        .from('chat_channels')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return data as ChatChannel | null;
    },
    enabled: !!tenantId && !!customerId,
  });

  // Join room when component mounts
  useEffect(() => {
    if (customerId && !hasJoinedRoom.current) {
      joinRoom();
      hasJoinedRoom.current = true;
    }

    return () => {
      if (customerId && hasJoinedRoom.current) {
        leaveRoom();
        hasJoinedRoom.current = false;
      }
    };
  }, [customerId, joinRoom, leaveRoom]);

  // Infinite query for paginated messages
  const {
    data,
    isLoading: messagesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['customer-chat-messages', tenantId, channel?.id],
    queryFn: async ({ pageParam }) => {
      if (!channel?.id) throw new Error('No channel available');

      let query = supabase
        .from('chat_channel_messages')
        .select('*')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      // If we have a cursor, fetch messages older than that
      if (pageParam) {
        query = query.lt('id', pageParam);
      }

      const { data: messages, error } = await query;

      if (error) throw error;

      return {
        messages: (messages as ChatMessage[]).reverse(), // Reverse to show oldest first in chunk
        nextCursor: messages && messages.length === PAGE_SIZE ? messages[messages.length - 1]?.id : null,
      };
    },
    initialPageParam: null as number | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!channel?.id,
    staleTime: 10000,
  });

  // Flatten pages into single array of messages
  const messages = data?.pages.flatMap((page) => page.messages) || [];

  // Listen for new messages and update query cache
  useEffect(() => {
    if (!channel?.id) return;

    const unsubMessage = onNewMessage((payload) => {
      if (payload.channelId !== channel.id) return;

      // Add new message to the cache (with deduplication)
      queryClient.setQueryData(
        ['customer-chat-messages', tenantId, channel.id],
        (oldData: typeof data) => {
          if (!oldData) return oldData;

          // Check if message already exists in any page
          const messageExists = oldData.pages.some((page) =>
            page.messages.some((msg) => msg.id === payload.id)
          );

          if (messageExists) {
            return oldData; // Don't add duplicate
          }

          const newMessage: ChatMessage = {
            id: payload.id,
            channel_id: payload.channelId,
            sender_type: payload.senderType,
            sender_id: payload.senderId,
            content: payload.content,
            is_read: payload.isRead,
            read_at: null,
            metadata: payload.metadata || {},
            created_at: payload.createdAt,
          };

          // Add to the last page
          const pages = [...oldData.pages];
          const lastPageIndex = pages.length - 1;
          pages[lastPageIndex] = {
            ...pages[lastPageIndex],
            messages: [...pages[lastPageIndex].messages, newMessage],
          };

          return {
            ...oldData,
            pages,
          };
        }
      );

      // If message is from tenant, mark it as read
      if (payload.senderType === 'tenant') {
        markRead(channel.id);
      }
    });

    const unsubRead = onMessagesRead((payload) => {
      if (payload.channelId !== channel.id) return;

      // Update read status in cache
      queryClient.setQueryData(
        ['customer-chat-messages', tenantId, channel.id],
        (oldData: typeof data) => {
          if (!oldData) return oldData;

          const pages = oldData.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) => {
              const shouldMarkRead =
                (payload.readerType === 'tenant' && msg.sender_type === 'customer') ||
                (payload.readerType === 'customer' && msg.sender_type === 'tenant');

              if (shouldMarkRead && !msg.is_read) {
                return { ...msg, is_read: true, read_at: new Date().toISOString() };
              }
              return msg;
            }),
          }));

          return { ...oldData, pages };
        }
      );
    });

    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [channel?.id, onNewMessage, onMessagesRead, queryClient, tenantId, markRead]);

  // Mark messages as read when chat is opened
  useEffect(() => {
    if (channel?.id && messages.length > 0) {
      const hasUnreadFromTenant = messages.some(
        (msg) => msg.sender_type === 'tenant' && !msg.is_read
      );

      if (hasUnreadFromTenant) {
        markRead(channel.id);
      }
    }
  }, [channel?.id, messages, markRead]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    channel,
    messages,
    isLoading: channelLoading || messagesLoading,
    loadMore,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    refetch,
  };
}
