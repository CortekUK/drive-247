'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Circle, Phone, Video, MoreVertical, ChevronDown, MessageCircle, Send } from 'lucide-react';
import { useChatMessages, type ChatMessage } from '@/hooks/use-chat-messages';
import { ChatMessageBubble, DateSeparator } from './ChatMessageBubble';
import { CustomerChatInput } from './CustomerChatInput';
import { TypingIndicator } from './TypingIndicator';
import { useSocket } from '@/contexts/SocketContext';
import { useAuthStore } from '@/stores/auth-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ChatWindowProps {
  channelId: string | null;
  customerId: string | null;
  customerName: string;
  customerAvatar?: string | null;
  customerEmail?: string | null;
}

export function ChatWindow({ channelId, customerId, customerName, customerAvatar, customerEmail }: ChatWindowProps) {
  const { messages, isLoading, loadMore, hasMore, isLoadingMore } = useChatMessages(channelId, customerId);
  const { onTyping, onPresenceUpdate } = useSocket();
  const { appUser } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [isCustomerOnline, setIsCustomerOnline] = useState(false);
  const [customerLastSeen, setCustomerLastSeen] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

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

  // Get customer initials
  const initials = customerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  if (!channelId || !customerId) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/50 bg-card/50 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar with status */}
            <div className="relative">
              <Avatar className="h-11 w-11 ring-2 ring-background">
                <AvatarImage src={customerAvatar || undefined} alt={customerName} />
                <AvatarFallback className="bg-primary/10 text-primary font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {/* Online status dot */}
              <span
                className={cn(
                  'absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-background transition-colors',
                  isCustomerOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                )}
              />
            </div>

            {/* Customer info */}
            <div>
              <h2 className="font-semibold text-base">{customerName}</h2>
              <div className="flex items-center gap-1.5 text-sm">
                {isTyping ? (
                  <span className="text-primary font-medium flex items-center gap-1">
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    typing
                  </span>
                ) : isCustomerOnline ? (
                  <span className="text-emerald-600 dark:text-emerald-400">Online</span>
                ) : customerLastSeen ? (
                  <span className="text-muted-foreground">
                    Active {formatDistanceToNow(new Date(customerLastSeen), { addSuffix: true })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Offline</span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
              <Phone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
              <Video className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 relative overflow-hidden">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="px-6 py-4">
            {/* Load more button */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="text-muted-foreground hover:text-foreground"
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
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50 mb-3" />
                <p className="text-sm text-muted-foreground">Loading messages...</p>
              </div>
            )}

            {/* Empty messages state */}
            {!isLoading && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Send className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-1">Start the conversation</h3>
                <p className="text-sm text-muted-foreground max-w-[240px]">
                  Send a message to begin chatting with {customerName}
                </p>
              </div>
            )}

            {/* Messages */}
            {!isLoading &&
              groupedMessages.map((group) => (
                <div key={group.date}>
                  <DateSeparator date={group.date} />
                  {group.messages.map((message, index) => {
                    const prevMessage = group.messages[index - 1];
                    const nextMessage = group.messages[index + 1];
                    const isFirstInGroup = !prevMessage || prevMessage.sender_type !== message.sender_type;
                    const isLastInGroup = !nextMessage || nextMessage.sender_type !== message.sender_type;

                    return (
                      <ChatMessageBubble
                        key={message.id}
                        message={message}
                        isOwnMessage={message.sender_type === 'tenant'}
                        isFirstInGroup={isFirstInGroup}
                        isLastInGroup={isLastInGroup}
                        customerName={customerName}
                        customerAvatar={customerAvatar}
                      />
                    );
                  })}
                </div>
              ))}

            {/* Typing indicator */}
            {isTyping && <TypingIndicator name={customerName} avatar={customerAvatar} />}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </ScrollArea>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <Button
            size="icon"
            variant="secondary"
            className="absolute bottom-4 right-6 h-10 w-10 rounded-full shadow-lg"
            onClick={scrollToBottom}
          >
            <ChevronDown className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Input */}
      <CustomerChatInput customerId={customerId} />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-6">
        <MessageCircle className="h-12 w-12 text-primary/60" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">Select a conversation</h3>
      <p className="text-muted-foreground max-w-[280px]">
        Choose a conversation from the list to start messaging with your customers
      </p>
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
