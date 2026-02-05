'use client';

import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { Check, CheckCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ChatMessage } from '@/hooks/use-chat-messages';
import { BookingReferenceCard } from './BookingReferenceCard';
import type { BookingReference } from './BookingPicker';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean; // true if sent by tenant (current user)
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  customerName?: string;
  customerAvatar?: string | null;
}

export function ChatMessageBubble({
  message,
  isOwnMessage,
  isFirstInGroup = true,
  isLastInGroup = true,
  customerName,
  customerAvatar,
}: ChatMessageBubbleProps) {
  const formattedTime = format(new Date(message.created_at), 'h:mm a');

  // Get initials for avatar
  const initials = customerName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  // Check for booking reference in metadata
  const metadata = message.metadata as { type?: string; booking?: BookingReference } | undefined;
  const hasBookingReference = metadata?.type === 'booking_reference' && metadata?.booking;

  // Hide "Shared a booking" placeholder text when booking reference is present
  const displayContent =
    hasBookingReference && message.content === 'Shared a booking' ? '' : message.content;

  return (
    <div
      className={cn(
        'flex w-full group',
        isOwnMessage ? 'justify-end' : 'justify-start',
        isFirstInGroup ? 'mt-4' : 'mt-0.5'
      )}
    >
      {/* Customer avatar - only show for last message in group */}
      {!isOwnMessage && (
        <div className="w-8 mr-2 flex-shrink-0">
          {isLastInGroup && (
            <Avatar className="h-8 w-8">
              <AvatarImage src={customerAvatar || undefined} alt={customerName} />
              <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      <div
        className={cn(
          'max-w-[65%] relative',
          isOwnMessage ? 'mr-1' : 'ml-0'
        )}
      >
        {/* Message bubble */}
        <div
          className={cn(
            'px-4 py-2.5 shadow-sm transition-all',
            isOwnMessage
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-border/50',
            // Rounded corners based on position
            isOwnMessage
              ? cn(
                  'rounded-2xl',
                  isFirstInGroup && 'rounded-tr-lg',
                  isLastInGroup && 'rounded-br-lg',
                  !isFirstInGroup && !isLastInGroup && 'rounded-r-lg'
                )
              : cn(
                  'rounded-2xl',
                  isFirstInGroup && 'rounded-tl-lg',
                  isLastInGroup && 'rounded-bl-lg',
                  !isFirstInGroup && !isLastInGroup && 'rounded-l-lg'
                )
          )}
        >
          {/* Message content */}
          {displayContent && (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              {displayContent}
            </p>
          )}

          {/* Booking reference card */}
          {hasBookingReference && metadata?.booking && (
            <BookingReferenceCard booking={metadata.booking} isOwnMessage={isOwnMessage} />
          )}

          {/* Timestamp and read status */}
          <div
            className={cn(
              'flex items-center gap-1.5 mt-1',
              isOwnMessage ? 'justify-end' : 'justify-start'
            )}
          >
            <span
              className={cn(
                'text-[11px]',
                isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
            >
              {formattedTime}
            </span>

            {/* Read status indicator for own messages */}
            {isOwnMessage && (
              message.is_read ? (
                <CheckCheck className="h-4 w-4 text-primary-foreground/70" />
              ) : (
                <Check className="h-4 w-4 text-primary-foreground/50" />
              )
            )}
          </div>
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
  const messageDate = new Date(date);
  let displayDate: string;

  if (isToday(messageDate)) {
    displayDate = 'Today';
  } else if (isYesterday(messageDate)) {
    displayDate = 'Yesterday';
  } else {
    displayDate = format(messageDate, 'MMMM d, yyyy');
  }

  return (
    <div className="flex items-center justify-center my-6">
      <div className="flex items-center gap-4 w-full">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-xs text-muted-foreground font-medium px-2">
          {displayDate}
        </span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
    </div>
  );
}
