'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, X, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSocket } from '@/contexts/SocketContext';
import { cn } from '@/lib/utils';
import { BookingPicker, BookingReference } from './BookingPicker';

interface CustomerChatInputProps {
  customerId: string;
  disabled?: boolean;
  onSend?: () => void;
}

export function CustomerChatInput({ customerId, disabled, onSend }: CustomerChatInputProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingReference | null>(null);
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
    // Allow sending if there's a message OR a booking attached
    if ((!trimmedMessage && !selectedBooking) || isSending) return;

    setIsSending(true);

    // Build metadata if booking is attached
    const metadata = selectedBooking
      ? {
          type: 'booking_reference',
          booking: selectedBooking,
        }
      : undefined;

    sendMessage(customerId, trimmedMessage || 'Shared a booking', metadata);
    setMessage('');
    setSelectedBooking(null);
    sendTyping(customerId, false);
    setIsSending(false);

    // Focus back on textarea
    textareaRef.current?.focus();

    // Callback for parent component
    onSend?.();
  }, [message, selectedBooking, customerId, sendMessage, sendTyping, isSending, onSend]);

  const handleBookingSelect = useCallback((booking: BookingReference) => {
    setSelectedBooking(booking);
    textareaRef.current?.focus();
  }, []);

  const handleRemoveBooking = useCallback(() => {
    setSelectedBooking(null);
  }, []);

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

  const isDisabled = disabled || (!message.trim() && !selectedBooking) || isSending;

  const vehicleName = selectedBooking
    ? [selectedBooking.vehicle.make, selectedBooking.vehicle.model].filter(Boolean).join(' ')
    : '';

  return (
    <div className="border-t bg-background">
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
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-1 hover:bg-background/50"
              onClick={handleRemoveBooking}
            >
              <X className="h-3 w-3" />
              <span className="sr-only">Remove booking</span>
            </Button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 p-4">
        <BookingPicker customerId={customerId} onSelect={handleBookingSelect} disabled={disabled} />
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
    </div>
  );
}
