'use client';

import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCustomerChat } from '@/hooks/use-customer-chat';
import { cn } from '@/lib/utils';

interface TraxChatButtonProps {
  onClick: () => void;
}

export function TraxChatButton({ onClick }: TraxChatButtonProps) {
  // Get unread count from admin chat
  const { messages } = useCustomerChat();
  const unreadCount = messages.filter(
    (msg) => msg.sender_type === 'tenant' && !msg.is_read
  ).length;

  return (
    <Button
      onClick={onClick}
      size="lg"
      className={cn(
        'fixed bottom-6 right-6 z-50',
        'h-14 w-14 rounded-full shadow-lg',
        'bg-primary hover:bg-primary/90',
        'transition-all duration-200 hover:scale-105'
      )}
    >
      <MessageCircle className="h-6 w-6" />
      {unreadCount > 0 && (
        <span
          className={cn(
            'absolute -top-1 -right-1',
            'flex h-5 min-w-5 items-center justify-center',
            'rounded-full bg-destructive px-1.5',
            'text-[11px] font-medium text-destructive-foreground'
          )}
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
      <span className="sr-only">Open chat</span>
    </Button>
  );
}
