import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthStore } from '@/stores/auth-store';
import { useTenant } from '@/contexts/TenantContext';
import type {
  ChatAttachment,
  ChatMessage,
  ChatApiResponse,
  SendMessageOptions,
  TraxAttachmentCapability,
  UseChatReturn,
} from '@/types/chat';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hviqoaokxvlancmftwuo.supabase.co";

/**
 * Ask the deployed chat function whether it can take file attachments.
 *
 * WHY A PROBE AND NOT A FLAG: the function parses its body loosely, so a build
 * that predates attachments would accept `{ attachments: [...] }`, ignore it,
 * and answer as if the model had read the file. The only honest source is the
 * running function itself. A version that knows the `capabilities` route
 * answers with its limits; an older one falls through to the chat route and
 * returns 400 "Message is required" before any model call or DB write.
 *
 * Returns `null` for a definite "no" (any non-2xx, or a body without a
 * versioned capability). THROWS when the question could not be asked at all
 * (no session, network failure) so React Query records an error and asks
 * again on the next mount, instead of caching a transient blip as "no".
 */
export async function probeChatCapabilities(tenantId: string): Promise<TraxAttachmentCapability | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ type: 'capabilities', tenantId }),
  });

  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const cap = data?.capabilities?.attachments;
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (
    !cap ||
    !positive(cap.version) ||
    !positive(cap.maxFiles) ||
    !positive(cap.maxImageBytes) ||
    !positive(cap.maxTextBytes) ||
    !positive(cap.maxTotalBytes) ||
    !strings(cap.imageTypes) ||
    !strings(cap.textTypes)
  ) {
    return null;
  }

  return {
    version: cap.version,
    maxFiles: cap.maxFiles,
    maxImageBytes: cap.maxImageBytes,
    maxTextBytes: cap.maxTextBytes,
    maxTotalBytes: cap.maxTotalBytes,
    imageTypes: cap.imageTypes,
    textTypes: cap.textTypes,
  };
}

/** The wire shape: the client-only `id` and `truncated` stay behind. */
function toWireAttachment(a: ChatAttachment) {
  return a.kind === 'image'
    ? { name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind, dataUrl: a.dataUrl }
    : { name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind, text: a.text };
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const { appUser } = useAuthStore();
  const { tenant } = useTenant();

  // Get user's display name
  const getUserName = useCallback((): string => {
    if (appUser?.name) {
      // Extract first name
      return appUser.name.split(' ')[0];
    }
    if (appUser?.email) {
      // Extract from email
      return appUser.email.split('@')[0];
    }
    return 'there';
  }, [appUser]);

  // Helper to call the chat edge function
  const callChatFunction = useCallback(async (body: Record<string, unknown>): Promise<ChatApiResponse> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed: ${response.status}`);
    }

    return await response.json();
  }, []);

  const sendMessage = useCallback(async (content: string, options?: SendMessageOptions) => {
    /* `options` is read defensively: v1 passes this function straight through
       as an `onSend` / `onSuggestionClick` prop, so a stray second argument
       must never be mistaken for attachments. */
    const attachments: ChatAttachment[] =
      options && typeof options === 'object' && Array.isArray(options.attachments)
        ? options.attachments
        : [];
    if (!content.trim() && attachments.length === 0) return;

    // Check for tenant context
    if (!tenant?.id) {
      setError('No tenant context available');
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'I apologize, but I need a tenant context to access data. Please make sure you are logged in with proper tenant access.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      return;
    }

    setError(null);
    setIsLoading(true);

    // Create optimistic user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
      ...(attachments.length > 0
        ? {
            attachments: attachments.map(({ id, name, mimeType, size, kind, dataUrl }) => ({
              id, name, mimeType, size, kind, dataUrl,
            })),
          }
        : {}),
    };

    setMessages((prev) => [...prev, userMessage]);

    /** Mark whether the function confirmed every file (see ChatMessage.attachmentsDelivered). */
    const markDelivery = (delivered: boolean) => {
      if (attachments.length === 0) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === userMessage.id ? { ...m, attachmentsDelivered: delivered } : m))
      );
    };

    try {
      const data = await callChatFunction({
        message: content.trim(),
        conversationId,
        userName: getUserName(),
        tenantId: tenant.id,
        // Key omitted entirely for text-only sends, so that payload is
        // byte-identical to what every caller sent before attachments existed.
        ...(attachments.length > 0 ? { attachments: attachments.map(toWireAttachment) } : {}),
      });

      markDelivery(
        Array.isArray(data.attachmentsReceived) &&
          data.attachmentsReceived.length === attachments.length
      );

      // Update conversation ID if this is a new conversation
      if (!conversationId) {
        setConversationId(data.conversationId);
      }

      // Create assistant message
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        sources: data.sources,
        chart: data.chart,
        rentalRequests: data.rentalRequests,
        action: data.action,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      console.error('Chat error:', err);
      markDelivery(false);

      // Add error message to chat
      const errorAssistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `I apologize, but I encountered an error: ${errorMessage}. Please try again.`,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorAssistantMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, getUserName, tenant?.id, callChatFunction]);

  const confirmAction = useCallback(async (messageId: string) => {
    // Find the message with the action
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.action) return;

    if (!tenant?.id) return;

    setIsLoading(true);

    try {
      const data = await callChatFunction({
        type: 'execute_action',
        actionName: msg.action.actionName,
        resolvedParams: msg.action.resolvedParams,
        conversationId,
        tenantId: tenant.id,
      });

      // Update the original message to remove the action (it's been handled)
      // and add a result message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, action: undefined } : m
        )
      );

      const resultMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        actionResult: data.actionResult,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, resultMessage]);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Action failed';
      console.error('Action execution error:', err);

      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, the action failed: ${errorMessage}`,
        actionResult: { success: false, message: errorMessage },
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, conversationId, tenant?.id, callChatFunction]);

  const rejectAction = useCallback((messageId: string) => {
    // Remove the action from the message and add a cancellation note
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, action: undefined } : m
      )
    );

    const cancelMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'No problem, I\'ve cancelled that action.',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, cancelMessage]);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  /**
   * Reopen a stored conversation.
   *
   * The edge function persists every exchange to `chat_messages` keyed on
   * `conversation_id` (chat/index.ts:587-612), but nothing here ever read it
   * back — so a refresh emptied the thread on screen while the rows stayed in
   * the database. This is the read half.
   *
   * The id is set alongside the messages deliberately: `sendMessage` passes
   * `conversationId` to the function, so loading messages WITHOUT it would make
   * the next reply start a second conversation that looks like a continuation.
   */
  const loadConversation = useCallback((id: string, loaded: ChatMessage[]) => {
    setMessages(loaded);
    setConversationId(id);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    conversationId,
    sendMessage,
    confirmAction,
    rejectAction,
    clearChat,
    loadConversation,
  };
}
