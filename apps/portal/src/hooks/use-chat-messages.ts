import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSocket } from '@/contexts/RealtimeChatContext';
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

const PAGE_SIZE = 25;

export function useChatMessages(channelId: string | null, customerId: string | null) {
  const { tenant } = useTenant();
  const { onNewMessage, onMessagesRead, joinRoom, leaveRoom, markRead } = useSocket();
  const queryClient = useQueryClient();
  const hasJoinedRoom = useRef(false);

  // Join room when component mounts with a valid customerId
  useEffect(() => {
    if (customerId && !hasJoinedRoom.current) {
      joinRoom(customerId);
      hasJoinedRoom.current = true;
    }

    return () => {
      if (customerId && hasJoinedRoom.current) {
        leaveRoom(customerId);
        hasJoinedRoom.current = false;
      }
    };
  }, [customerId, joinRoom, leaveRoom]);

  // Infinite query for paginated messages
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['chat-messages', tenant?.id, channelId],
    queryFn: async ({ pageParam }) => {
      if (!tenant || !channelId) throw new Error('No tenant or channel context');

      let query = supabase
        .from('chat_channel_messages')
        .select('*')
        .eq('channel_id', channelId)
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
    enabled: !!tenant && !!channelId,
    staleTime: 10000, // 10 seconds
  });

  // Flatten pages into single array of messages
  const messages = data?.pages.flatMap((page) => page.messages) || [];

  // Listen for new messages and update query cache
  useEffect(() => {
    if (!channelId) return;

    const unsubMessage = onNewMessage((payload) => {
      if (payload.channelId !== channelId) return;

      // Add new message to the cache
      queryClient.setQueryData(
        ['chat-messages', tenant?.id, channelId],
        (oldData: typeof data) => {
          if (!oldData) return oldData;

          // Check if message already exists in any page to prevent duplicates
          const messageExists = oldData.pages.some((page) =>
            page.messages.some((msg) => msg.id === payload.id)
          );

          if (messageExists) {
            return oldData;
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

      // If message is from customer, mark it as read
      if (payload.senderType === 'customer') {
        markRead(channelId);
      }
    });

    const unsubRead = onMessagesRead((payload) => {
      if (payload.channelId !== channelId) return;

      // Update read status in cache
      queryClient.setQueryData(
        ['chat-messages', tenant?.id, channelId],
        (oldData: typeof data) => {
          if (!oldData) return oldData;

          const pages = oldData.pages.map((page) => ({
            ...page,
            messages: page.messages.map((msg) => {
              // Mark messages from the opposite party as read
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
  }, [channelId, onNewMessage, onMessagesRead, queryClient, tenant?.id, markRead]);

  // Mark messages as read when channel is opened
  useEffect(() => {
    if (channelId && messages.length > 0) {
      // Check if there are unread messages from customer
      const hasUnreadFromCustomer = messages.some(
        (msg) => msg.sender_type === 'customer' && !msg.is_read
      );

      if (hasUnreadFromCustomer) {
        markRead(channelId);
      }
    }
  }, [channelId, messages, markRead]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    messages,
    isLoading,
    loadMore,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    refetch,
  };
}
