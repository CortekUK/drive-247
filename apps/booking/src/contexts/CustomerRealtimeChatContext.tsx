'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './TenantContext';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

// Event payload types matching the Socket.io API for backward compatibility
interface NewMessagePayload {
  id: number;
  channelId: string;
  senderType: 'tenant' | 'customer';
  senderId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface TypingPayload {
  customerId: string;
  userType: 'tenant' | 'customer';
  userId: string;
  isTyping: boolean;
}

interface UnreadCountPayload {
  channelId: string;
  count: number;
}

interface MessagesReadPayload {
  channelId: string;
  readerType: string;
}

interface PresencePayload {
  channelId: string;
  participantType: 'tenant' | 'customer';
  participantId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
}

// Customer Realtime context type
interface CustomerRealtimeChatContextType {
  isConnected: boolean;
  joinRoom: () => void;
  leaveRoom: () => void;
  sendMessage: (content: string, metadata?: Record<string, unknown>) => void;
  markRead: (channelId: string) => void;
  sendTyping: (isTyping: boolean) => void;
  onNewMessage: (callback: (payload: NewMessagePayload) => void) => () => void;
  onTyping: (callback: (payload: TypingPayload) => void) => () => void;
  onMessagesRead: (callback: (payload: MessagesReadPayload) => void) => () => void;
  onUnreadCount: (callback: (payload: UnreadCountPayload) => void) => () => void;
  onPresenceUpdate: (callback: (payload: PresencePayload) => void) => () => void;
}

const CustomerRealtimeChatContext = createContext<CustomerRealtimeChatContextType | undefined>(undefined);

export function CustomerRealtimeChatProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const { tenant } = useTenant();
  const { customerUser } = useCustomerAuthStore();

  // Customer ID from the authenticated customer
  const customerId = customerUser?.customer_id;
  const tenantId = tenant?.id || customerUser?.tenant_id;

  // Track active subscriptions
  const messagesChannelRef = useRef<RealtimeChannel | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const channelIdRef = useRef<string | null>(null);

  // Event listener refs
  const messageListenersRef = useRef<Set<(payload: NewMessagePayload) => void>>(new Set());
  const typingListenersRef = useRef<Set<(payload: TypingPayload) => void>>(new Set());
  const readListenersRef = useRef<Set<(payload: MessagesReadPayload) => void>>(new Set());
  const unreadListenersRef = useRef<Set<(payload: UnreadCountPayload) => void>>(new Set());
  const presenceListenersRef = useRef<Set<(payload: PresencePayload) => void>>(new Set());

  // Helper to get or create channel
  const getOrCreateChannel = useCallback(async () => {
    if (!tenantId || !customerId) return null;

    // Try to get existing channel
    const { data: existingChannel } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .single();

    if (existingChannel) return existingChannel.id;

    // Create new channel
    const { data: newChannel, error } = await supabase
      .from('chat_channels')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[CustomerRealtimeChat] Error creating channel:', error);
      return null;
    }

    return newChannel.id;
  }, [tenantId, customerId]);

  // Auto-join room when component mounts (like the Socket.io version)
  useEffect(() => {
    if (!tenantId || !customerId) return;

    let isMounted = true;

    const setupChannels = async () => {
      const channelId = await getOrCreateChannel();
      if (!channelId || !isMounted) return;

      channelIdRef.current = channelId;

      // Get initial unread count (messages from tenant that are unread)
      const { count } = await supabase
        .from('chat_channel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('sender_type', 'tenant')
        .eq('is_read', false);

      unreadListenersRef.current.forEach((listener) =>
        listener({ channelId, count: count || 0 })
      );

      // Subscribe to messages for this channel
      const messagesChannel = supabase
        .channel(`chat:${customerId}:messages`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_channel_messages',
            filter: `channel_id=eq.${channelId}`,
          },
          (payload) => {
            const newMessage: NewMessagePayload = {
              id: payload.new.id,
              channelId: payload.new.channel_id,
              senderType: payload.new.sender_type,
              senderId: payload.new.sender_id,
              content: payload.new.content,
              isRead: payload.new.is_read,
              createdAt: payload.new.created_at,
              metadata: payload.new.metadata || {},
            };

            messageListenersRef.current.forEach((listener) => listener(newMessage));
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'chat_channel_messages',
            filter: `channel_id=eq.${channelId}`,
          },
          (payload) => {
            if (payload.new.is_read && !payload.old.is_read) {
              // Message was marked as read
              const readerType = payload.new.sender_type === 'customer' ? 'tenant' : 'customer';
              const readPayload: MessagesReadPayload = {
                channelId: payload.new.channel_id,
                readerType,
              };
              readListenersRef.current.forEach((listener) => listener(readPayload));
            }
          }
        )
        .subscribe((status) => {
          console.log('[CustomerRealtimeChat] Messages channel status:', status);
          setIsConnected(status === 'SUBSCRIBED');
        });

      messagesChannelRef.current = messagesChannel;

      // Subscribe to typing broadcast
      const typingChannel = supabase
        .channel(`chat:${customerId}:typing`)
        .on('broadcast', { event: 'typing' }, (payload) => {
          const typingPayload = payload.payload as TypingPayload;
          // Only notify if it's not from us
          if (typingPayload.userId !== customerId) {
            typingListenersRef.current.forEach((listener) => listener(typingPayload));
          }
        })
        .subscribe();

      typingChannelRef.current = typingChannel;

      // Create presence channel
      const presenceChannel = supabase.channel(`chat:${customerId}:presence`, {
        config: {
          presence: {
            key: customerId,
          },
        },
      });

      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel.presenceState<{
            participantType: 'tenant' | 'customer';
            participantId: string;
            online_at: string;
          }>();

          // Notify about all presence states (mainly interested in tenant)
          Object.entries(state).forEach(([key, presences]) => {
            presences.forEach((presence) => {
              if (presence.participantType === 'tenant') {
                presenceListenersRef.current.forEach((listener) =>
                  listener({
                    channelId,
                    participantType: presence.participantType,
                    participantId: presence.participantId,
                    isOnline: true,
                    lastSeenAt: presence.online_at,
                  })
                );
              }
            });
          });
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          newPresences.forEach((presence) => {
            if (presence.participantType === 'tenant') {
              presenceListenersRef.current.forEach((listener) =>
                listener({
                  channelId,
                  participantType: presence.participantType,
                  participantId: presence.participantId,
                  isOnline: true,
                  lastSeenAt: new Date().toISOString(),
                })
              );
            }
          });
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          leftPresences.forEach((presence) => {
            if (presence.participantType === 'tenant') {
              presenceListenersRef.current.forEach((listener) =>
                listener({
                  channelId,
                  participantType: presence.participantType,
                  participantId: presence.participantId,
                  isOnline: false,
                  lastSeenAt: new Date().toISOString(),
                })
              );
            }
          });
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            // Track our presence as customer
            await presenceChannel.track({
              participantType: 'customer',
              participantId: customerId,
              online_at: new Date().toISOString(),
            });
          }
        });

      presenceChannelRef.current = presenceChannel;

      console.log('[CustomerRealtimeChat] Auto-joined chat room for badge updates');
    };

    setupChannels();

    // Reconnect on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[CustomerRealtimeChat] Tab visible, ensuring connection...');
        // Supabase handles reconnection automatically, but we can re-track presence
        if (presenceChannelRef.current && customerId) {
          presenceChannelRef.current.track({
            participantType: 'customer',
            participantId: customerId,
            online_at: new Date().toISOString(),
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (messagesChannelRef.current) {
        supabase.removeChannel(messagesChannelRef.current);
        messagesChannelRef.current = null;
      }
      if (typingChannelRef.current) {
        supabase.removeChannel(typingChannelRef.current);
        typingChannelRef.current = null;
      }
      if (presenceChannelRef.current) {
        presenceChannelRef.current.untrack();
        supabase.removeChannel(presenceChannelRef.current);
        presenceChannelRef.current = null;
      }
      channelIdRef.current = null;
      setIsConnected(false);
    };
  }, [tenantId, customerId, getOrCreateChannel]);

  const joinRoom = useCallback(() => {
    // Room is auto-joined on mount, this is a no-op for compatibility
    console.log('[CustomerRealtimeChat] joinRoom called (auto-joined on mount)');
  }, []);

  const leaveRoom = useCallback(() => {
    // Handled by effect cleanup
    console.log('[CustomerRealtimeChat] leaveRoom called (handled by cleanup)');
  }, []);

  const sendMessage = useCallback(
    async (content: string, metadata?: Record<string, unknown>) => {
      if (!tenantId || !customerId) return;

      const channelId = channelIdRef.current || (await getOrCreateChannel());
      if (!channelId) return;

      // Insert message directly - Postgres Changes will broadcast it
      const { data: message, error } = await supabase
        .from('chat_channel_messages')
        .insert({
          channel_id: channelId,
          sender_type: 'customer',
          sender_id: customerId,
          content,
          metadata: metadata || {},
        })
        .select()
        .single();

      if (error) {
        console.error('[CustomerRealtimeChat] Error sending message:', error);
        return;
      }

      // Update channel's last_message_at
      await supabase
        .from('chat_channels')
        .update({
          last_message_at: message.created_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', channelId);
    },
    [tenantId, customerId, getOrCreateChannel]
  );

  const markRead = useCallback(
    async (channelId: string) => {
      // Mark tenant messages as read (we're the customer)
      const { error } = await supabase
        .from('chat_channel_messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('channel_id', channelId)
        .eq('sender_type', 'tenant')
        .eq('is_read', false);

      if (error) {
        console.error('[CustomerRealtimeChat] Error marking messages read:', error);
      }
    },
    []
  );

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!customerId || !typingChannelRef.current) return;

      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          customerId,
          userType: 'customer',
          userId: customerId,
          isTyping,
        } as TypingPayload,
      });
    },
    [customerId]
  );

  // Event listener registration functions
  const onNewMessage = useCallback((callback: (payload: NewMessagePayload) => void) => {
    messageListenersRef.current.add(callback);
    return () => {
      messageListenersRef.current.delete(callback);
    };
  }, []);

  const onTyping = useCallback((callback: (payload: TypingPayload) => void) => {
    typingListenersRef.current.add(callback);
    return () => {
      typingListenersRef.current.delete(callback);
    };
  }, []);

  const onMessagesRead = useCallback((callback: (payload: MessagesReadPayload) => void) => {
    readListenersRef.current.add(callback);
    return () => {
      readListenersRef.current.delete(callback);
    };
  }, []);

  const onUnreadCount = useCallback((callback: (payload: UnreadCountPayload) => void) => {
    unreadListenersRef.current.add(callback);
    return () => {
      unreadListenersRef.current.delete(callback);
    };
  }, []);

  const onPresenceUpdate = useCallback((callback: (payload: PresencePayload) => void) => {
    presenceListenersRef.current.add(callback);
    return () => {
      presenceListenersRef.current.delete(callback);
    };
  }, []);

  return (
    <CustomerRealtimeChatContext.Provider
      value={{
        isConnected,
        joinRoom,
        leaveRoom,
        sendMessage,
        markRead,
        sendTyping,
        onNewMessage,
        onTyping,
        onMessagesRead,
        onUnreadCount,
        onPresenceUpdate,
      }}
    >
      {children}
    </CustomerRealtimeChatContext.Provider>
  );
}

export function useCustomerRealtimeChat() {
  const context = useContext(CustomerRealtimeChatContext);

  if (context === undefined) {
    // Return safe defaults when provider is not mounted
    return {
      isConnected: false,
      joinRoom: () => {},
      leaveRoom: () => {},
      sendMessage: () => {},
      markRead: () => {},
      sendTyping: () => {},
      onNewMessage: () => () => {},
      onTyping: () => () => {},
      onMessagesRead: () => () => {},
      onUnreadCount: () => () => {},
      onPresenceUpdate: () => () => {},
    };
  }

  return context;
}

// Re-export as useCustomerSocket for backward compatibility with existing code
export const useCustomerSocket = useCustomerRealtimeChat;
