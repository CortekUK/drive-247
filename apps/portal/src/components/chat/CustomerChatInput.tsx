'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, X, Car, Paperclip, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSocket, type MessageChannel } from '@/contexts/RealtimeChatContext';
import { cn } from '@/lib/utils';
import { BookingPicker, BookingReference } from './BookingPicker';
import { toast } from '@/hooks/use-toast';

interface ChannelConfig {
  key: MessageChannel | 'call';
  label: string;
  sendBg: string;
  sendHover: string;
}

interface CustomerChatInputProps {
  customerId: string;
  disabled?: boolean;
  onSend?: () => void;
  activeChannel: MessageChannel;
  channelConfig: ChannelConfig;
  customerPhone?: string | null;
}

export function CustomerChatInput({
  customerId,
  disabled,
  onSend,
  activeChannel,
  channelConfig,
  customerPhone,
}: CustomerChatInputProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingReference | null>(null);
  const { sendMessage, sendTyping } = useSocket();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }
  }, [message]);

  // Handle typing indicator
  const handleTyping = useCallback(() => {
    sendTyping(customerId, true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(customerId, false);
    }, 2000);
  }, [customerId, sendTyping]);

  // Cleanup typing timeout on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmedMessage = message.trim();
    if ((!trimmedMessage && !selectedBooking) || isSending) return;

    // Block SMS if no phone number
    if (activeChannel === 'sms' && !customerPhone) {
      toast({ title: 'No phone number', description: 'Add a phone number to send SMS.', variant: 'destructive' });
      return;
    }

    setIsSending(true);

    const metadata = selectedBooking
      ? { type: 'booking_reference', booking: selectedBooking }
      : undefined;

    // Clear input immediately for responsive feel
    const msgToSend = trimmedMessage || 'Shared a booking';
    setMessage('');
    setSelectedBooking(null);
    sendTyping(customerId, false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      await sendMessage(customerId, msgToSend, metadata, activeChannel);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
      onSend?.();
    }
  }, [message, selectedBooking, customerId, sendMessage, sendTyping, isSending, onSend, activeChannel, customerPhone]);

  const handleBookingSelect = useCallback((booking: BookingReference) => {
    setSelectedBooking(booking);
    textareaRef.current?.focus();
  }, []);

  const handleRemoveBooking = useCallback(() => {
    setSelectedBooking(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const canSend = (message.trim().length > 0 || selectedBooking) && !isSending && !disabled;

  const vehicleName = selectedBooking
    ? [selectedBooking.vehicle.make, selectedBooking.vehicle.model].filter(Boolean).join(' ')
    : '';

  const placeholderMap: Record<string, string> = {
    in_app: 'Type a message...',
    sms: 'Type an SMS...',
    whatsapp: 'Type a WhatsApp message...',
    email: 'Type an email...',
  };

  return (
    <div className="border-t border-border/50 bg-card/50 backdrop-blur-sm">
      {/* Selected booking preview */}
      {selectedBooking && (
        <div className="px-4 pt-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-muted rounded-full text-sm">
            <Car className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{vehicleName}</span>
            {selectedBooking.rentalNumber && (
              <>
                <span className="text-muted-foreground">-</span>
                <span className="text-muted-foreground">{selectedBooking.rentalNumber}</span>
              </>
            )}
            <Button variant="ghost" size="icon" className="h-5 w-5 ml-1 hover:bg-background/50" onClick={handleRemoveBooking}>
              <X className="h-3 w-3" />
              <span className="sr-only">Remove booking</span>
            </Button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-3 sm:p-4">
        <div
          className={cn(
            'flex items-end gap-2 rounded-2xl border bg-background p-2 transition-all duration-200',
            isFocused ? 'border-primary/50 ring-2 ring-primary/10' : 'border-border/50'
          )}
        >
          {/* Booking picker */}
          <div className="pb-1">
            <BookingPicker customerId={customerId} onSelect={handleBookingSelect} disabled={disabled} />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholderMap[activeChannel] || 'Type a message...'}
            disabled={disabled}
            className={cn(
              'flex-1 resize-none bg-transparent border-0 outline-none',
              'min-h-[40px] max-h-[150px] py-2 px-1',
              'text-sm placeholder:text-muted-foreground',
              'focus:ring-0 focus:outline-none',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
            rows={1}
          />

          {/* Send button — color matches active channel */}
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!canSend && !isSending}
            className={cn(
              'h-10 w-10 shrink-0 rounded-xl transition-all text-white',
              isSending
                ? cn(channelConfig.sendBg, 'opacity-70')
                : canSend
                ? cn(channelConfig.sendBg, channelConfig.sendHover)
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="sr-only">{isSending ? 'Sending...' : 'Send message'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
