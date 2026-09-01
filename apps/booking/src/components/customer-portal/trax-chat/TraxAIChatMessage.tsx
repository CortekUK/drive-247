'use client';

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Bot, User } from 'lucide-react';
import type { TraxMessage } from '@/hooks/use-trax-chat';
import { TraxChatChart } from './TraxChatChart';

interface TraxAIChatMessageProps {
  message: TraxMessage;
  customerProfilePhoto?: string | null;
}

export function TraxAIChatMessage({ message, customerProfilePhoto }: TraxAIChatMessageProps) {
  const isUser = message.role === 'user';
  const formattedTime = format(message.createdAt, 'h:mm a');

  return (
    <div
      className={cn(
        'flex w-full mb-3 gap-2',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {/* Avatar for assistant */}
      {!isUser && (
        <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        {/* Message content */}
        <div
          className={cn(
            'text-sm whitespace-pre-wrap break-words',
            // Render markdown-like formatting for assistant messages
            !isUser && 'prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5'
          )}
        >
          {message.content}
        </div>

        {/* Chart if present */}
        {message.chart && (
          <TraxChatChart chart={message.chart} />
        )}

        {/* Timestamp */}
        <div
          className={cn(
            'flex items-center gap-1 mt-1',
            isUser ? 'justify-end' : 'justify-start'
          )}
        >
          <span
            className={cn(
              'text-[10px]',
              isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}
          >
            {formattedTime}
          </span>
        </div>
      </div>

      {/* Avatar for user */}
      {isUser && (
        customerProfilePhoto ? (
          <img
            src={customerProfilePhoto}
            alt="You"
            className="flex-shrink-0 h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex-shrink-0 h-7 w-7 rounded-full bg-primary flex items-center justify-center">
            <User className="h-4 w-4 text-primary-foreground" />
          </div>
        )
      )}
    </div>
  );
}
