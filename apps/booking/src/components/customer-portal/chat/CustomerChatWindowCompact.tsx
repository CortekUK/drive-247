'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Circle } from 'lucide-react';
import { useCustomerChat, type ChatMessage } from '@/hooks/use-customer-chat';
import { CustomerChatMessage, DateSeparator, TypingIndicator } from './CustomerChatMessage';
import { CustomerChatInput } from './CustomerChatInput';
import { useCustomerSocket } from '@/contexts/CustomerRealtimeChatContext';
import { useTenant } from '@/contexts/TenantContext';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';

// Compact version of CustomerChatWindow for use in popups (no outer border/header)
export function CustomerChatWindowCompact() {
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact status bar */}
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isTyping ? (
            <span className="text-primary animate-pulse">{tenantName} is typing...</span>
          ) : isTenantOnline ? (
            <>
              <Circle className="h-2 w-2 fill-green-500 text-green-500" />
              <span>{tenantName} is online</span>
            </>
          ) : tenantLastSeen ? (
            <span>Last seen {formatDistanceToNow(new Date(tenantLastSeen), { addSuffix: true })}</span>
          ) : (
            <span>Chat with {tenantName}</span>
          )}
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
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="font-medium mb-1 text-sm">No messages yet</h3>
            <p className="text-xs text-muted-foreground">
              Send a message to start chatting with {tenantName}
            </p>
          </div>
        )}

        {/* Messages */}
        {groupedMessages.map((group) => (
          <div key={group.date}>
            <DateSeparator date={group.date} />
            {group.messages.map((message) => (
              <CustomerChatMessage
                key={`${group.date}-${message.id}`}
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
