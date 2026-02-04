'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Circle } from 'lucide-react';
import { useChatMessages, type ChatMessage } from '@/hooks/use-chat-messages';
import { ChatMessageBubble, DateSeparator } from './ChatMessageBubble';
import { CustomerChatInput } from './CustomerChatInput';
import { TypingIndicator } from './TypingIndicator';
import { useSocket } from '@/contexts/SocketContext';
import { useAuthStore } from '@/stores/auth-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ChatWindowProps {
  channelId: string | null;
  customerId: string | null;
  customerName: string;
}

export function ChatWindow({ channelId, customerId, customerName }: ChatWindowProps) {
  const { messages, isLoading, loadMore, hasMore, isLoadingMore } = useChatMessages(channelId, customerId);
  const { onTyping, onPresenceUpdate } = useSocket();
  const { appUser } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [isCustomerOnline, setIsCustomerOnline] = useState(false);
  const [customerLastSeen, setCustomerLastSeen] = useState<string | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Listen for typing events
  useEffect(() => {
    if (!customerId) return;

    const unsub = onTyping((payload) => {
      if (payload.customerId === customerId && payload.userType === 'customer') {
        setIsTyping(payload.isTyping);
        setTypingUserId(payload.userId);
      }
    });

    return unsub;
  }, [customerId, onTyping]);

  // Listen for presence updates
  useEffect(() => {
    if (!channelId) return;

    const unsub = onPresenceUpdate((payload) => {
      if (payload.channelId === channelId && payload.participantType === 'customer') {
        setIsCustomerOnline(payload.isOnline);
        setCustomerLastSeen(payload.lastSeenAt);
      }
    });

    return unsub;
  }, [channelId, onPresenceUpdate]);

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  if (!channelId || !customerId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Select a conversation to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-background">
        <h2 className="font-semibold text-lg">{customerName}</h2>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {isTyping ? (
            <span className="text-green-400 font-medium animate-pulse">typing...</span>
          ) : isCustomerOnline ? (
            <>
              <Circle className="h-2 w-2 fill-green-500 text-green-500" />
              <span>Active now</span>
            </>
          ) : customerLastSeen ? (
            <span>Active {formatDistanceToNow(new Date(customerLastSeen), { addSuffix: true })}</span>
          ) : null}
        </div>
      </div>

      {/* Messages area */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 px-4">
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

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Messages */}
        {!isLoading && messages.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <p>No messages yet. Start the conversation!</p>
          </div>
        )}

        {!isLoading &&
          groupedMessages.map((group, groupIndex) => (
            <div key={group.date}>
              <DateSeparator date={group.date} />
              {group.messages.map((message) => (
                <ChatMessageBubble
                  key={message.id}
                  message={message}
                  isOwnMessage={message.sender_type === 'tenant'}
                />
              ))}
            </div>
          ))}

        {/* Typing indicator */}
        {isTyping && <TypingIndicator name={customerName} />}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* Input */}
      <CustomerChatInput customerId={customerId} />
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
