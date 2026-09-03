import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useSocket } from '@/contexts/RealtimeChatContext';
import { useEffect } from 'react';

export type MessageChannel = 'in_app' | 'sms' | 'whatsapp' | 'email' | 'voice';

export interface ChatChannel {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: 'active' | 'archived';
  last_message_at: string | null;
  last_channel: MessageChannel;
  created_at: string;
  updated_at: string;
  // Joined data
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    profile_photo_url: string | null;
  } | null;
  // Computed fields
  unread_count: number;
  last_message_preview: string | null;
  last_message_channel: MessageChannel | null;
}

export interface UnknownSmsThread {
  id: string;
  tenant_id: string;
  phone_number: string;
  linked_customer_id: string | null;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
}

interface RawChannel {
  id: string;
  tenant_id: string;
  customer_id: string;
  status: 'active' | 'archived';
  last_message_at: string | null;
  last_channel: MessageChannel;
  created_at: string;
  updated_at: string;
  customers: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    profile_photo_url: string | null;
  } | null;
}

export function useChatChannels() {
  const { tenant } = useTenant();
  const { onNewMessage, onMessagesRead } = useSocket();
  const queryClient = useQueryClient();

  const { data: channels = [], isLoading, refetch } = useQuery({
    queryKey: ['chat-channels', tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error('No tenant context available');

      // Fetch channels with customer data
      const { data: rawChannels, error: channelsError } = await supabase
        .from('chat_channels')
        .select(`
          *,
          customers!chat_channels_customer_id_fkey (
            id,
            name,
            email,
            phone,
            profile_photo_url
          )
        `)
        .eq('tenant_id', tenant.id)
        .eq('status', 'active')
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (channelsError) throw channelsError;

      // For each channel, get unread count and last message
      const channelsWithData: ChatChannel[] = await Promise.all(
        (rawChannels as RawChannel[]).map(async (channel) => {
          // Get unread count (messages from customer that haven't been read)
          const { count: unreadCount } = await supabase
            .from('chat_channel_messages')
            .select('*', { count: 'exact', head: true })
            .eq('channel_id', channel.id)
            .eq('sender_type', 'customer')
            .eq('is_read', false);

          // Get last message preview with channel info
          const { data: lastMessage } = await supabase
            .from('chat_channel_messages')
            .select('content, channel')
            .eq('channel_id', channel.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          return {
            id: channel.id,
            tenant_id: channel.tenant_id,
            customer_id: channel.customer_id,
            status: channel.status,
            last_message_at: channel.last_message_at,
            last_channel: channel.last_channel || 'in_app',
            created_at: channel.created_at,
            updated_at: channel.updated_at,
            customer: channel.customers,
            unread_count: unreadCount || 0,
            last_message_preview: lastMessage?.content
              ? lastMessage.content.substring(0, 50) + (lastMessage.content.length > 50 ? '...' : '')
              : null,
            last_message_channel: (lastMessage?.channel as MessageChannel) || null,
          };
        })
      );

      return channelsWithData;
    },
    enabled: !!tenant,
    staleTime: 30000, // 30 seconds
  });

  // Refetch channels when new messages arrive or messages are read
  useEffect(() => {
    const unsubMessage = onNewMessage(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-channels', tenant?.id] });
    });

    const unsubRead = onMessagesRead(() => {
      queryClient.invalidateQueries({ queryKey: ['chat-channels', tenant?.id] });
    });

    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [onNewMessage, onMessagesRead, queryClient, tenant?.id]);

  // Fetch unknown SMS threads (unlinked)
  const { data: unknownThreads = [], isLoading: unknownLoading } = useQuery({
    queryKey: ['sms-unknown-threads', tenant?.id],
    queryFn: async () => {
      if (!tenant) throw new Error('No tenant context');

      const { data, error } = await supabase
        .from('sms_unknown_threads')
        .select('*')
        .eq('tenant_id', tenant.id)
        .is('linked_customer_id', null)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) throw error;
      return (data || []) as UnknownSmsThread[];
    },
    enabled: !!tenant,
    staleTime: 30000,
  });

  // Refetch unknown threads on new messages too
  useEffect(() => {
    const unsubMessage = onNewMessage(() => {
      queryClient.invalidateQueries({ queryKey: ['sms-unknown-threads', tenant?.id] });
    });
    return () => { unsubMessage(); };
  }, [onNewMessage, queryClient, tenant?.id]);

  return {
    channels,
    unknownThreads,
    isLoading: isLoading || unknownLoading,
    refetch,
  };
}
