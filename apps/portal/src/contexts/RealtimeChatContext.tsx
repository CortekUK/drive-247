'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './TenantContext';
import { useAuthStore } from '@/stores/auth-store';

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

interface PresenceState {
  [key: string]: {
    participantType: 'tenant' | 'customer';
    participantId: string;
    online_at: string;
  }[];
}

// Realtime context type - same API as Socket context
interface RealtimeChatContextType {
  isConnected: boolean;
  joinRoom: (customerId: string) => void;
  leaveRoom: (customerId: string) => void;
  sendMessage: (customerId: string, content: string, metadata?: Record<string, unknown>) => void;
  markRead: (channelId: string) => void;
  sendTyping: (customerId: string, isTyping: boolean) => void;
  sendBulkMessage: (customerIds: string[], content: string) => void;
  onNewMessage: (callback: (payload: NewMessagePayload) => void) => () => void;
  onTyping: (callback: (payload: TypingPayload) => void) => () => void;
  onMessagesRead: (callback: (payload: MessagesReadPayload) => void) => () => void;
  onUnreadCount: (callback: (payload: UnreadCountPayload) => void) => () => void;
  onPresenceUpdate: (callback: (payload: PresencePayload) => void) => () => void;
}

const RealtimeChatContext = createContext<RealtimeChatContextType | undefined>(undefined);

export function RealtimeChatProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const { tenant } = useTenant();
  const { appUser } = useAuthStore();

  // Track active subscriptions
  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const tenantChannelRef = useRef<RealtimeChannel | null>(null);

  // Event listener refs
  const messageListenersRef = useRef<Set<(payload: NewMessagePayload) => void>>(new Set());
  const typingListenersRef = useRef<Set<(payload: TypingPayload) => void>>(new Set());
  const readListenersRef = useRef<Set<(payload: MessagesReadPayload) => void>>(new Set());
  const unreadListenersRef = useRef<Set<(payload: UnreadCountPayload) => void>>(new Set());
  const presenceListenersRef = useRef<Set<(payload: PresencePayload) => void>>(new Set());

  // Helper to get or create channel for a customer
  const getOrCreateChannel = useCallback(async (customerId: string) => {
    if (!tenant) return null;

    // Try to get existing channel
    const { data: existingChannel } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customerId)
      .single();

    if (existingChannel) return existingChannel.id;

    // Create new channel
    const { data: newChannel, error } = await supabase
      .from('chat_channels')
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[RealtimeChat] Error creating channel:', error);
      return null;
    }

    return newChannel.id;
  }, [tenant]);

  // Subscribe to tenant-wide channel for new messages (badge updates)
  useEffect(() => {
    if (!tenant?.id || !appUser?.id) return;

    setIsConnected(true);

    // Subscribe to all messages for this tenant via Postgres Changes
    const tenantChannel = supabase
      .channel(`tenant:${tenant.id}:messages`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_channel_messages',
        },
        async (payload) => {
          // Verify this message belongs to our tenant by checking the channel
          const { data: channel } = await supabase
            .from('chat_channels')
            .select('tenant_id')
            .eq('id', payload.new.channel_id)
            .single();

          if (channel?.tenant_id !== tenant.id) return;

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
          filter: `is_read=eq.true`,
        },
        async (payload) => {
          // Verify this message belongs to our tenant
          const { data: channel } = await supabase
            .from('chat_channels')
            .select('tenant_id')
            .eq('id', payload.new.channel_id)
            .single();

          if (channel?.tenant_id !== tenant.id) return;

          // Determine reader type based on who sent the message
          // If message is from tenant and now read, customer read it
          const readerType = payload.new.sender_type === 'tenant' ? 'customer' : 'tenant';

          const readPayload: MessagesReadPayload = {
            channelId: payload.new.channel_id,
            readerType,
          };

          readListenersRef.current.forEach((listener) => listener(readPayload));
        }
      )
      .subscribe((status) => {
        console.log('[RealtimeChat] Tenant channel status:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    tenantChannelRef.current = tenantChannel;

    // Reconnect on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[RealtimeChat] Tab visible, ensuring connection...');
        if (tenantChannelRef.current) {
          // Supabase handles reconnection automatically
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (tenantChannelRef.current) {
        supabase.removeChannel(tenantChannelRef.current);
        tenantChannelRef.current = null;
      }
      setIsConnected(false);
    };
  }, [tenant?.id, appUser?.id]);

  const joinRoom = useCallback(
    async (customerId: string) => {
      if (!tenant || !appUser) return;

      const channelKey = `chat:${customerId}`;
      if (channelsRef.current.has(channelKey)) {
        // Already subscribed
        return;
      }

      const channelId = await getOrCreateChannel(customerId);
      if (!channelId) return;

      // Get initial unread count
      const { count } = await supabase
        .from('chat_channel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', channelId)
        .eq('sender_type', 'customer')
        .eq('is_read', false);

      unreadListenersRef.current.forEach((listener) =>
        listener({ channelId, count: count || 0 })
      );

      // Create presence channel for this customer
      const presenceChannel = supabase.channel(`chat:${customerId}:presence`, {
        config: {
          presence: {
            key: appUser.id,
          },
        },
      });

      // Subscribe to typing broadcast
      const typingChannel = supabase
        .channel(`chat:${customerId}:typing`)
        .on('broadcast', { event: 'typing' }, (payload) => {
          const typingPayload = payload.payload as TypingPayload;
          // Only notify if it's not from us
          if (typingPayload.userId !== appUser.id) {
            typingListenersRef.current.forEach((listener) => listener(typingPayload));
          }
        })
        .subscribe();

      // Track presence
      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          const state = presenceChannel.presenceState<{
            participantType: 'tenant' | 'customer';
            participantId: string;
            online_at: string;
          }>();

          // Notify about all presence states
          Object.entries(state).forEach(([key, presences]) => {
            presences.forEach((presence) => {
              if (presence.participantType !== 'tenant' || presence.participantId !== appUser.id) {
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
            if (presence.participantType !== 'tenant' || presence.participantId !== appUser.id) {
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
            presenceListenersRef.current.forEach((listener) =>
              listener({
                channelId,
                participantType: presence.participantType,
                participantId: presence.participantId,
                isOnline: false,
                lastSeenAt: new Date().toISOString(),
              })
            );
          });
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            // Track our presence
            await presenceChannel.track({
              participantType: 'tenant',
              participantId: appUser.id,
              online_at: new Date().toISOString(),
            });
          }
        });

      // Store channel references
      channelsRef.current.set(channelKey, presenceChannel);
      channelsRef.current.set(`${channelKey}:typing`, typingChannel);

      console.log(`[RealtimeChat] Joined room for customer ${customerId}`);
    },
    [tenant, appUser, getOrCreateChannel]
  );

  const leaveRoom = useCallback(
    (customerId: string) => {
      const channelKey = `chat:${customerId}`;

      // Unsubscribe from presence channel
      const presenceChannel = channelsRef.current.get(channelKey);
      if (presenceChannel) {
        presenceChannel.untrack();
        supabase.removeChannel(presenceChannel);
        channelsRef.current.delete(channelKey);
      }

      // Unsubscribe from typing channel
      const typingChannel = channelsRef.current.get(`${channelKey}:typing`);
      if (typingChannel) {
        supabase.removeChannel(typingChannel);
        channelsRef.current.delete(`${channelKey}:typing`);
      }

      console.log(`[RealtimeChat] Left room for customer ${customerId}`);
    },
    []
  );

  const sendMessage = useCallback(
    async (customerId: string, content: string, metadata?: Record<string, unknown>) => {
      if (!tenant || !appUser) return;

      const channelId = await getOrCreateChannel(customerId);
      if (!channelId) return;

      // Insert message directly - Postgres Changes will broadcast it
      const { data: message, error } = await supabase
        .from('chat_channel_messages')
        .insert({
          channel_id: channelId,
          sender_type: 'tenant',
          sender_id: appUser.id,
          content,
          metadata: metadata || {},
        })
        .select()
        .single();

      if (error) {
        console.error('[RealtimeChat] Error sending message:', error);
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
    [tenant, appUser, getOrCreateChannel]
  );

  const markRead = useCallback(
    async (channelId: string) => {
      // Mark customer messages as read (we're the tenant)
      const { error } = await supabase
        .from('chat_channel_messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('channel_id', channelId)
        .eq('sender_type', 'customer')
        .eq('is_read', false);

      if (error) {
        console.error('[RealtimeChat] Error marking messages read:', error);
      }
    },
    []
  );

  const sendTyping = useCallback(
    (customerId: string, isTyping: boolean) => {
      if (!appUser) return;

      const typingChannel = channelsRef.current.get(`chat:${customerId}:typing`);
      if (typingChannel) {
        typingChannel.send({
          type: 'broadcast',
          event: 'typing',
          payload: {
            customerId,
            userType: 'tenant',
            userId: appUser.id,
            isTyping,
          } as TypingPayload,
        });
      }
    },
    [appUser]
  );

  const sendBulkMessage = useCallback(
    async (customerIds: string[], content: string) => {
      if (!tenant || !appUser) return;

      for (const customerId of customerIds) {
        const channelId = await getOrCreateChannel(customerId);
        if (!channelId) continue;

        // Insert message - Postgres Changes will broadcast it
        const { data: message, error } = await supabase
          .from('chat_channel_messages')
          .insert({
            channel_id: channelId,
            sender_type: 'tenant',
            sender_id: appUser.id,
            content,
            metadata: { bulk: true },
          })
          .select()
          .single();

        if (error) {
          console.error(`[RealtimeChat] Error sending bulk message to ${customerId}:`, error);
          continue;
        }

        // Update channel's last_message_at
        await supabase
          .from('chat_channels')
          .update({
            last_message_at: message.created_at,
            updated_at: new Date().toISOString(),
          })
          .eq('id', channelId);
      }
    },
    [tenant, appUser, getOrCreateChannel]
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

  // Cleanup all channels on unmount
  useEffect(() => {
    return () => {
      channelsRef.current.forEach((channel) => {
        supabase.removeChannel(channel);
      });
      channelsRef.current.clear();
    };
  }, []);

  return (
    <RealtimeChatContext.Provider
      value={{
        isConnected,
        joinRoom,
        leaveRoom,
        sendMessage,
        markRead,
        sendTyping,
        sendBulkMessage,
        onNewMessage,
        onTyping,
        onMessagesRead,
        onUnreadCount,
        onPresenceUpdate,
      }}
    >
      {children}
    </RealtimeChatContext.Provider>
  );
}

export function useRealtimeChat() {
  const context = useContext(RealtimeChatContext);

  if (context === undefined) {
    // Return safe defaults when provider is not mounted
    return {
      isConnected: false,
      joinRoom: () => {},
      leaveRoom: () => {},
      sendMessage: () => {},
      markRead: () => {},
      sendTyping: () => {},
      sendBulkMessage: () => {},
      onNewMessage: () => () => {},
      onTyping: () => () => {},
      onMessagesRead: () => () => {},
      onUnreadCount: () => () => {},
      onPresenceUpdate: () => () => {},
    };
  }

  return context;
}

// Re-export as useSocket for backward compatibility with existing code
export const useSocket = useRealtimeChat;
