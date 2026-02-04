'use client';

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck } from 'lucide-react';
import type { ChatMessage } from '@/hooks/use-chat-messages';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean;  // true if sent by tenant (current user)
}

export function ChatMessageBubble({ message, isOwnMessage }: ChatMessageBubbleProps) {
  const formattedTime = format(new Date(message.created_at), 'h:mm a');
  const formattedDate = format(new Date(message.created_at), 'MMM d, yyyy');

  return (
    <div
      className={cn(
        'flex w-full mb-3',
        isOwnMessage ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-2xl px-4 py-2.5 shadow-sm',
          isOwnMessage
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        {/* Message content */}
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>

        {/* Timestamp and read status */}
        <div
          className={cn(
            'flex items-center gap-1 mt-1',
            isOwnMessage ? 'justify-end' : 'justify-start'
          )}
        >
          <span
            className={cn(
              'text-[10px]',
              isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
            title={`${formattedDate} at ${formattedTime}`}
          >
            {formattedTime}
          </span>

          {/* Read status indicator for own messages */}
          {isOwnMessage && (
            message.is_read ? (
              <CheckCheck className="h-3.5 w-3.5 text-primary-foreground/70" />
            ) : (
              <Check className="h-3.5 w-3.5 text-primary-foreground/70" />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// Date separator component
interface DateSeparatorProps {
  date: string;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  const formattedDate = format(new Date(date), 'MMMM d, yyyy');
  const today = new Date();
  const messageDate = new Date(date);

  let displayDate = formattedDate;
  if (
    messageDate.getDate() === today.getDate() &&
    messageDate.getMonth() === today.getMonth() &&
    messageDate.getFullYear() === today.getFullYear()
  ) {
    displayDate = 'Today';
  } else {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      messageDate.getDate() === yesterday.getDate() &&
      messageDate.getMonth() === yesterday.getMonth() &&
      messageDate.getFullYear() === yesterday.getFullYear()
    ) {
      displayDate = 'Yesterday';
    }
  }

  return (
    <div className="flex items-center justify-center my-4">
      <div className="bg-muted/60 text-muted-foreground text-xs px-3 py-1 rounded-full">
        {displayDate}
      </div>
    </div>
  );
}
