'use client';

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck } from 'lucide-react';
import type { ChatMessage } from '@/hooks/use-customer-chat';
import { BookingReferenceCard } from './BookingReferenceCard';
import type { BookingReference } from './BookingPicker';

interface CustomerChatMessageProps {
  message: ChatMessage;
  isOwnMessage: boolean;  // true if sent by customer (current user)
  tenantName?: string;
}

export function CustomerChatMessage({ message, isOwnMessage, tenantName }: CustomerChatMessageProps) {
  const formattedTime = format(new Date(message.created_at), 'h:mm a');
  const formattedDate = format(new Date(message.created_at), 'MMM d, yyyy');

  // Check for booking reference in metadata
  const metadata = message.metadata as { type?: string; booking?: BookingReference } | undefined;
  const hasBookingReference = metadata?.type === 'booking_reference' && metadata?.booking;

  // Hide "Shared a booking" placeholder text when booking reference is present
  const displayContent =
    hasBookingReference && message.content === 'Shared a booking' ? '' : message.content;

  return (
    <div
      className={cn(
        'flex w-full mb-3',
        isOwnMessage ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm',
          isOwnMessage
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        )}
      >
        {/* Sender name for tenant messages */}
        {!isOwnMessage && tenantName && (
          <p className="text-xs font-medium mb-1 text-muted-foreground">
            {tenantName}
          </p>
        )}

        {/* Message content */}
        {displayContent && (
          <p className="text-sm whitespace-pre-wrap break-words">{displayContent}</p>
        )}

        {/* Booking reference card */}
        {hasBookingReference && metadata?.booking && (
          <BookingReferenceCard booking={metadata.booking} isOwnMessage={isOwnMessage} />
        )}

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

// Typing indicator component
interface TypingIndicatorProps {
  name?: string;
  className?: string;
}

export function TypingIndicator({ name, className }: TypingIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 mb-3', className)}>
      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
        <div className="flex items-center gap-1">
          <span className="flex gap-1">
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '0ms', animationDuration: '600ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '150ms', animationDuration: '600ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '300ms', animationDuration: '600ms' }}
            />
          </span>
        </div>
      </div>
      {name && (
        <span className="text-xs text-muted-foreground">{name} is typing...</span>
      )}
    </div>
  );
}
