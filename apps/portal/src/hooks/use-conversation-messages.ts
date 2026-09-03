/**
 * useConversationMessages — Spec Section 6.4.
 * Realtime list of messages for a conversation, ordered chronologically.
 * Subscribes to inserts on conversation_messages filtered by conversation_id.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useRealtimeInvalidate } from "./use-realtime-invalidate";

export type MessageChannel = "sms" | "email" | "whatsapp" | "in_app" | "note" | "system" | "call_summary";
export type MessageDirection = "inbound" | "outbound" | "internal";
export type MessageSenderType = "lead" | "customer" | "staff" | "system" | "ai";
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export interface ConversationMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  channel: MessageChannel;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  sender_id: string | null;
  body: string | null;
  subject: string | null;
  attachments: unknown[];
  channel_message_id: string | null;
  status: MessageStatus;
  error: string | null;
  read_at: string | null;
  created_at: string;
}

export function useConversationMessages(conversationId: string | undefined) {
  const { tenant } = useTenant();

  useRealtimeInvalidate({
    table: "conversation_messages",
    tenantId: tenant?.id,
    queryKey: ["conversation-messages", tenant?.id, conversationId],
    extraFilter: conversationId ? `conversation_id=eq.${conversationId}` : undefined,
    channel: conversationId ? `tenant_${tenant?.id}_conversation_${conversationId}` : undefined,
    enabled: !!conversationId,
  });

  return useQuery({
    queryKey: ["conversation-messages", tenant?.id, conversationId],
    queryFn: async (): Promise<ConversationMessage[]> => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("conversation_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ConversationMessage[];
    },
    enabled: !!conversationId,
    staleTime: 10_000,
  });
}
