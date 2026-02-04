'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Circle } from 'lucide-react';
import { useCustomerChat, type ChatMessage } from '@/hooks/use-customer-chat';
import { CustomerChatMessage, DateSeparator, TypingIndicator } from './CustomerChatMessage';
import { CustomerChatInput } from './CustomerChatInput';
import { useCustomerSocket } from '@/contexts/CustomerSocketContext';
import { useTenant } from '@/contexts/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

export function CustomerChatWindow() {
  const { channel, messages, isLoading, loadMore, hasMore, isLoadingMore } = useCustomerChat();
  const { onTyping, onPresenceUpdate } = useCustomerSocket();
  const { tenant } = useTenant();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isTenantOnline, setIsTenantOnline] = useState(false);
  const [tenantLastSeen, setTenantLastSeen] = useState<string | null>(null);

  const tenantName = tenant?.company_name || 'Support';

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Listen for typing events
  useEffect(() => {
    const unsub = onTyping((payload) => {
      if (payload.userType === 'tenant') {
        setIsTyping(payload.isTyping);
      }
    });

    return unsub;
  }, [onTyping]);

  // Listen for presence updates
  useEffect(() => {
    if (!channel?.id) return;

    const unsub = onPresenceUpdate((payload) => {
      if (payload.channelId === channel.id && payload.participantType === 'tenant') {
        setIsTenantOnline(payload.isOnline);
        setTenantLastSeen(payload.lastSeenAt);
      }
    });

    return unsub;
  }, [channel?.id, onPresenceUpdate]);

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-background flex items-center gap-3">
        <MessageSquare className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">Chat with {tenantName}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isTyping ? (
              <span className="text-primary animate-pulse">typing...</span>
            ) : isTenantOnline ? (
              <>
                <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                <span>Online</span>
              </>
            ) : tenantLastSeen ? (
              <span>Last seen {formatDistanceToNow(new Date(tenantLastSeen), { addSuffix: true })}</span>
            ) : (
              <span>{channel ? 'Send us a message anytime' : 'Start a conversation'}</span>
            )}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 px-4">
        {/* Load more button */}
        {hasMore && (
          <div className="flex justify-center py-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Load earlier messages'
              )}
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MessageSquare className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="font-medium mb-1">No messages yet</h3>
            <p className="text-sm text-muted-foreground">
              Send a message to start the conversation
            </p>
          </div>
        )}

        {/* Messages */}
        {groupedMessages.map((group) => (
          <div key={group.date}>
            <DateSeparator date={group.date} />
            {group.messages.map((message) => (
              <CustomerChatMessage
                key={message.id}
                message={message}
                isOwnMessage={message.sender_type === 'customer'}
                tenantName={tenantName}
              />
            ))}
          </div>
        ))}

        {/* Typing indicator */}
        {isTyping && <TypingIndicator name={tenantName} />}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <CustomerChatInput />
    </div>
  );
}

// Helper function to group messages by date
function groupMessagesByDate(messages: ChatMessage[]): { date: string; messages: ChatMessage[] }[] {
  const groups: { date: string; messages: ChatMessage[] }[] = [];
  let currentDate: string | null = null;
  let currentGroup: ChatMessage[] = [];

  for (const message of messages) {
    const messageDate = new Date(message.created_at).toDateString();

    if (messageDate !== currentDate) {
      if (currentDate && currentGroup.length > 0) {
        groups.push({ date: currentDate, messages: currentGroup });
      }
      currentDate = messageDate;
      currentGroup = [message];
    } else {
      currentGroup.push(message);
    }
  }

  // Push the last group
  if (currentDate && currentGroup.length > 0) {
    groups.push({ date: currentDate, messages: currentGroup });
  }

  return groups;
}
