import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';

export interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ name: string; value: number }>;
}

export interface TraxMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  chart?: ChartData;
}

interface UseTraxChatReturn {
  messages: TraxMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  clearChat: () => void;
}

export function useTraxChat(): UseTraxChatReturn {
  const { customerUser, session } = useCustomerAuthStore();
  const [messages, setMessages] = useState<TraxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    if (!customerUser || !session) {
      setError('Please log in to use Trax');
      return;
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    setIsLoading(true);
    setError(null);

    // Add user message to UI immediately
    const userMessage: TraxMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedMessage,
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('customer-chat', {
        body: {
          message: trimmedMessage,
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to send message');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Add assistant response
      const assistantMessage: TraxMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data?.response || 'Sorry, I could not generate a response.',
        createdAt: new Date(),
        chart: data?.chart,
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      console.error('Trax chat error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove the user message if the request failed
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  }, [customerUser, session]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearChat,
  };
}
