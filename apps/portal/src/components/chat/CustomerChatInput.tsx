'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSocket } from '@/contexts/SocketContext';
import { cn } from '@/lib/utils';

interface CustomerChatInputProps {
  customerId: string;
  disabled?: boolean;
  onSend?: () => void;
}

export function CustomerChatInput({ customerId, disabled, onSend }: CustomerChatInputProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { sendMessage, sendTyping } = useSocket();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle typing indicator
  const handleTyping = useCallback(() => {
    sendTyping(customerId, true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing indicator after 2 seconds of no input
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(customerId, false);
    }, 2000);
  }, [customerId, sendTyping]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const handleSend = useCallback(() => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isSending) return;

    setIsSending(true);
    sendMessage(customerId, trimmedMessage);
    setMessage('');
    sendTyping(customerId, false);
    setIsSending(false);

    // Focus back on textarea
    textareaRef.current?.focus();

    // Callback for parent component
    onSend?.();
  }, [message, customerId, sendMessage, sendTyping, isSending, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
      handleTyping();
    },
    [handleTyping]
  );

  const isDisabled = disabled || !message.trim() || isSending;

  return (
    <div className="flex items-end gap-2 p-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        className={cn(
          'min-h-[44px] max-h-[120px] resize-none',
          'focus-visible:ring-1 focus-visible:ring-primary'
        )}
        rows={1}
      />
      <Button
        size="icon"
        onClick={handleSend}
        disabled={isDisabled}
        className="h-[44px] w-[44px] shrink-0"
      >
        <Send className="h-4 w-4" />
        <span className="sr-only">Send message</span>
      </Button>
    </div>
  );
}
