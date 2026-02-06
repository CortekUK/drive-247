'use client';

import { useEffect, useRef } from 'react';
import { Bot } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTraxChat } from '@/hooks/use-trax-chat';
import { TraxAIChatMessage } from './TraxAIChatMessage';
import { TraxAIChatInput } from './TraxAIChatInput';
import { TypingIndicator } from '../chat/CustomerChatMessage';
import { useCustomerAuth } from '@/stores/customer-auth-store';

export function TraxAIChatWindow() {
  const { messages, isLoading, error, sendMessage, clearChat } = useTraxChat();
  const { customerUser } = useCustomerAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const customerProfilePhoto = customerUser?.customer?.profile_photo_url;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isLoading]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <ScrollArea className="flex-1 px-4 pt-4">
        {/* Welcome message when no messages */}
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold mb-2">Hi! I'm Trax</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your AI assistant for all things related to your rentals, payments, and bookings.
            </p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Try asking:</p>
              <p className="italic">"What's the status of my rental?"</p>
              <p className="italic">"Show me my recent payments"</p>
              <p className="italic">"When is my next payment due?"</p>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((message) => (
          <TraxAIChatMessage
            key={message.id}
            message={message}
            customerProfilePhoto={customerProfilePhoto}
          />
        ))}

        {/* Loading indicator */}
        {isLoading && <TypingIndicator name="Trax" />}

        {/* Error message */}
        {error && (
          <div className="mx-2 mb-3 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} className="h-4" />
      </ScrollArea>

      {/* Input */}
      <TraxAIChatInput
        onSend={sendMessage}
        disabled={isLoading}
      />
    </div>
  );
}
