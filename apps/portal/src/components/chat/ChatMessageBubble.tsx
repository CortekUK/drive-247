'use client';

import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { Check, CheckCheck, MessageSquare, Mail, AlertCircle, Phone as PhoneIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { ChatMessage, MessageChannel } from '@/hooks/use-chat-messages';
import { BookingReferenceCard } from './BookingReferenceCard';
import type { BookingReference } from './BookingPicker';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/* Brand icons for channel indicators */
function TwilioIconSmall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 30" className={className} fill="currentColor">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 8.284 6.716 15 15 15 8.284 0 15-6.716 15-15 0-8.284-6.716-15-15-15zm0 26.25c-6.213 0-11.25-5.037-11.25-11.25S8.787 3.75 15 3.75 26.25 8.787 26.25 15 21.213 26.25 15 26.25zm6.036-14.786a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm0 7.072a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm-7.072 0a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0zm0-7.072a2.536 2.536 0 1 1-5.072 0 2.536 2.536 0 0 1 5.072 0z" />
    </svg>
  );
}

function WhatsAppIconSmall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

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
        isFirstInGroup ? 'mt-4' : 'mt-3'
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
        {/* Message bubble — tinted by channel */}
        <div
          className={cn(
            'px-4 py-2.5 shadow-sm transition-all',
            isOwnMessage
              ? message.channel === 'sms'
                ? 'bg-[#F22F46]/15 text-foreground border border-[#F22F46]/25'
                : message.channel === 'email'
                ? 'bg-blue-500/15 text-foreground border border-blue-500/25'
                : message.channel === 'whatsapp'
                ? 'bg-[#25D366]/15 text-foreground border border-[#25D366]/25'
                : message.channel === 'voice'
                ? 'bg-amber-500/15 text-foreground border border-amber-500/25'
                : 'bg-indigo-500/15 text-foreground border border-indigo-500/25'
              : message.channel === 'sms'
              ? 'bg-[#F22F46]/5 border border-[#F22F46]/15'
              : message.channel === 'email'
              ? 'bg-blue-500/5 border border-blue-500/15'
              : message.channel === 'whatsapp'
              ? 'bg-[#25D366]/5 border border-[#25D366]/15'
              : message.channel === 'voice'
              ? 'bg-amber-500/5 border border-amber-500/15'
              : 'bg-indigo-500/5 border border-indigo-500/15',
            // WhatsApp-style rounded rectangle
            'rounded-lg'
          )}
        >
          {/* Booking reference card */}
          {hasBookingReference && metadata?.booking && (
            <BookingReferenceCard booking={metadata.booking} isOwnMessage={isOwnMessage} />
          )}

          {/* Message content */}
          {displayContent && (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
              {displayContent}
            </p>
          )}

          {/* Channel icon + time — bottom right */}
          <div className="flex items-center gap-1 justify-end mt-0.5">
            {message.channel && (
              <ChannelIndicator
                channel={message.channel}
                externalStatus={message.external_status}
                isOwnMessage={isOwnMessage}
              />
            )}
            <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">
              {formattedTime}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Channel indicator component with brand icons and colors
function ChannelIndicator({
  channel,
  externalStatus,
  isOwnMessage,
}: {
  channel: MessageChannel;
  externalStatus?: string | null;
  isOwnMessage: boolean;
}) {
  const channelMap: Record<string, { icon: React.ReactNode; label: string; color: string; ownColor: string }> = {
    in_app: {
      icon: <MessageSquare className="h-3 w-3" />,
      label: 'In-App',
      color: 'text-indigo-500',
      ownColor: 'text-indigo-500',
    },
    sms: {
      icon: <TwilioIconSmall className="h-3 w-3" />,
      label: 'SMS',
      color: 'text-[#F22F46]',
      ownColor: 'text-[#F22F46]',
    },
    whatsapp: {
      icon: <WhatsAppIconSmall className="h-3 w-3" />,
      label: 'WhatsApp',
      color: 'text-[#25D366]',
      ownColor: 'text-[#25D366]',
    },
    email: {
      icon: <Mail className="h-3 w-3" />,
      label: 'Email',
      color: 'text-blue-500',
      ownColor: 'text-blue-500',
    },
    voice: {
      icon: <PhoneIcon className="h-3 w-3" />,
      label: 'Call',
      color: 'text-amber-500',
      ownColor: 'text-amber-500',
    },
  };

  const config = channelMap[channel];
  if (!config) return null;

  const colorClass = isOwnMessage ? config.ownColor : config.color;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center', colorClass)}>
            {config.icon}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Sent via {config.label}{externalStatus ? ` — ${externalStatus}` : ''}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// SMS delivery status icon
function SmsDeliveryStatus({ status, isOwnMessage }: { status?: string | null; isOwnMessage: boolean }) {
  const colorClass = isOwnMessage ? 'text-white/70' : 'text-muted-foreground';
  const dimClass = isOwnMessage ? 'text-white/50' : 'text-muted-foreground/50';

  switch (status) {
    case 'delivered':
      return <CheckCheck className={cn('h-4 w-4', colorClass)} />;
    case 'sent':
      return <Check className={cn('h-4 w-4', colorClass)} />;
    case 'failed':
    case 'undelivered':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertCircle className="h-4 w-4 text-red-400" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {status === 'failed' ? 'Failed to send' : 'Not delivered'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'queued':
    default:
      return <Check className={cn('h-4 w-4', dimClass)} />;
  }
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
