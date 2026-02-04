import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ChatChannel, ChatMessage } from './types.js';

// Lazy-initialized Supabase client with service role for full access
let _supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }

    _supabase = createClient(supabaseUrl, supabaseServiceKey);
  }
  return _supabase;
}

/**
 * Get or create a chat channel for a tenant-customer pair
 */
export async function getOrCreateChannel(
  tenantId: string,
  customerId: string
): Promise<ChatChannel> {
  const supabase = getSupabaseClient();

  // Try to get existing channel
  const { data: existingChannel, error: fetchError } = await supabase
    .from('chat_channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .single();

  // If channel exists, return it
  if (existingChannel) {
    return existingChannel as ChatChannel;
  }

  // If error is not "no rows", throw it
  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching channel:', fetchError);
    throw fetchError;
  }

  // Create new channel
  const { data: newChannel, error: insertError } = await supabase
    .from('chat_channels')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
    })
    .select()
    .single();

  if (insertError) {
    console.error('Error creating channel:', insertError);
    throw insertError;
  }

  return newChannel as ChatChannel;
}

/**
 * Insert a new message into a channel
 */
export async function insertMessage(
  channelId: string,
  senderType: 'tenant' | 'customer',
  senderId: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<ChatMessage> {
  const supabase = getSupabaseClient();

  // Insert the message
  const { data, error } = await supabase
    .from('chat_channel_messages')
    .insert({
      channel_id: channelId,
      sender_type: senderType,
      sender_id: senderId,
      content,
      metadata,
    })
    .select()
    .single();

  if (error) {
    console.error('Error inserting message:', error);
    throw error;
  }

  // Update channel's last_message_at
  await supabase
    .from('chat_channels')
    .update({
      last_message_at: data.created_at,
      updated_at: new Date().toISOString()
    })
    .eq('id', channelId);

  return data as ChatMessage;
}

/**
 * Mark messages as read in a channel
 */
export async function markMessagesRead(
  channelId: string,
  readerType: 'tenant' | 'customer'
): Promise<number> {
  const supabase = getSupabaseClient();

  // Determine which messages to mark as read (opposite of reader type)
  const senderType = readerType === 'tenant' ? 'customer' : 'tenant';

  // Mark unread messages from the opposite party as read
  const { data, error } = await supabase
    .from('chat_channel_messages')
    .update({
      is_read: true,
      read_at: new Date().toISOString()
    })
    .eq('channel_id', channelId)
    .eq('sender_type', senderType)
    .eq('is_read', false)
    .select('id');

  if (error) {
    console.error('Error marking messages read:', error);
    throw error;
  }

  return data?.length || 0;
}

/**
 * Get channel by tenant and customer ID
 */
export async function getChannelByParticipants(
  tenantId: string,
  customerId: string
): Promise<ChatChannel | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_channels')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 is "no rows returned"
    console.error('Error fetching channel:', error);
    throw error;
  }

  return data as ChatChannel | null;
}

/**
 * Get unread count for a channel (messages from the opposite party)
 */
export async function getUnreadCount(
  channelId: string,
  readerType: 'tenant' | 'customer'
): Promise<number> {
  const supabase = getSupabaseClient();
  const senderType = readerType === 'tenant' ? 'customer' : 'tenant';

  const { count, error } = await supabase
    .from('chat_channel_messages')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .eq('sender_type', senderType)
    .eq('is_read', false);

  if (error) {
    console.error('Error getting unread count:', error);
    throw error;
  }

  return count || 0;
}

/**
 * Get customer details
 */
export async function getCustomer(customerId: string): Promise<{ id: string; tenant_id: string } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('customers')
    .select('id, tenant_id')
    .eq('id', customerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching customer:', error);
    throw error;
  }

  return data;
}

/**
 * Update user presence (online status and last seen)
 */
export async function updatePresence(
  channelId: string,
  participantType: 'tenant' | 'customer',
  participantId: string,
  isOnline: boolean
): Promise<void> {
  const supabase = getSupabaseClient();

  // Upsert the participant record with presence info
  const { error } = await supabase
    .from('chat_channel_participants')
    .upsert({
      channel_id: channelId,
      participant_type: participantType,
      participant_id: participantId,
      is_online: isOnline,
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: 'channel_id,participant_type,participant_id'
    });

  if (error) {
    console.error('Error updating presence:', error);
    // Don't throw - presence is not critical
  }
}

/**
 * Get participant presence info
 */
export async function getPresence(
  channelId: string,
  participantType: 'tenant' | 'customer'
): Promise<{ is_online: boolean; last_seen_at: string | null } | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('chat_channel_participants')
    .select('is_online, last_seen_at')
    .eq('channel_id', channelId)
    .eq('participant_type', participantType)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error getting presence:', error);
  }

  return data;
}
