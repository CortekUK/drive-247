'use client';

import { useState, useCallback, useRef } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface TraxAIChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function TraxAIChatInput({ onSend, disabled }: TraxAIChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || disabled) return;

    onSend(trimmedMessage);
    setMessage('');

    // Focus back on textarea
    textareaRef.current?.focus();
  }, [message, onSend, disabled]);

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

  const isDisabled = disabled || !message.trim();

  return (
    <div className="flex items-end gap-2 p-4 border-t bg-background">
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Trax anything..."
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
