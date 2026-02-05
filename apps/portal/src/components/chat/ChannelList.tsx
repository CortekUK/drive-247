'use client';

import { useState, useMemo } from 'react';
import { Search, Loader2, MessageCircle, Sparkles, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UnreadBadge } from './UnreadBadge';
import { useChatChannels, type ChatChannel } from '@/hooks/use-chat-channels';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface ChannelListProps {
  selectedChannelId: string | null;
  onSelectChannel: (channel: ChatChannel) => void;
  onBulkMessage: () => void;
}

export function ChannelList({ selectedChannelId, onSelectChannel, onBulkMessage }: ChannelListProps) {
  const { channels, isLoading } = useChatChannels();
  const [searchQuery, setSearchQuery] = useState('');

  // Filter channels by search query - searches name, email, phone, and message content
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;

    const query = searchQuery.toLowerCase().trim();

    return channels.filter((channel) => {
      // Search customer name
      if (channel.customer?.name?.toLowerCase().includes(query)) return true;

      // Search customer email
      if (channel.customer?.email?.toLowerCase().includes(query)) return true;

      // Search customer phone
      if (channel.customer?.phone?.toLowerCase().includes(query)) return true;

      // Search message content preview
      if (channel.last_message_preview?.toLowerCase().includes(query)) return true;

      return false;
    });
  }, [channels, searchQuery]);

  // Count total unread
  const totalUnread = useMemo(() => {
    return channels.reduce((sum, ch) => sum + ch.unread_count, 0);
  }, [channels]);

  const clearSearch = () => {
    setSearchQuery('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-border/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <MessageCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Messages</h2>
              {totalUnread > 0 && (
                <p className="text-xs text-muted-foreground">
                  {totalUnread} unread message{totalUnread !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-9 bg-background/50 border-border/50 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search results count */}
        {searchQuery && (
          <p className="text-xs text-muted-foreground mt-2">
            {filteredChannels.length} result{filteredChannels.length !== 1 ? 's' : ''} found
          </p>
        )}
      </div>

      {/* Channel list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary/50 mb-3" />
              <p className="text-sm text-muted-foreground">Loading conversations...</p>
            </div>
          )}

          {!isLoading && filteredChannels.length === 0 && (
            <EmptyState hasSearch={!!searchQuery} searchQuery={searchQuery} />
          )}

          {!isLoading &&
            filteredChannels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                isSelected={channel.id === selectedChannelId}
                onClick={() => onSelectChannel(channel)}
                searchQuery={searchQuery}
              />
            ))}
        </div>
      </ScrollArea>

      {/* Bulk message button */}
      <div className="p-4 border-t border-border/50">
        <Button
          variant="outline"
          className="w-full gap-2 h-11 bg-background/50 hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all duration-200"
          onClick={onBulkMessage}
        >
          <Sparkles className="h-4 w-4" />
          Bulk Message
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ hasSearch, searchQuery }: { hasSearch: boolean; searchQuery: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        {hasSearch ? (
          <Search className="h-8 w-8 text-muted-foreground/50" />
        ) : (
          <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <h3 className="font-medium text-foreground mb-1">
        {hasSearch ? 'No results found' : 'No conversations yet'}
      </h3>
      <p className="text-sm text-muted-foreground max-w-[220px]">
        {hasSearch
          ? `No conversations matching "${searchQuery.slice(0, 20)}${searchQuery.length > 20 ? '...' : ''}"`
          : 'When customers message you, conversations will appear here'}
      </p>
    </div>
  );
}

interface ChannelItemProps {
  channel: ChatChannel;
  isSelected: boolean;
  onClick: () => void;
  searchQuery: string;
}

function ChannelItem({ channel, isSelected, onClick, searchQuery }: ChannelItemProps) {
  const customerName = channel.customer?.name || 'Unknown Customer';
  const initials = customerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const timeAgo = channel.last_message_at
    ? formatDistanceToNow(new Date(channel.last_message_at), { addSuffix: false })
    : '';

  const hasUnread = channel.unread_count > 0;

  // Highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));

    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-primary/20 text-foreground rounded px-0.5">
          {part}
        </mark>
      ) : part
    );
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all duration-200',
        'hover:bg-accent/50',
        isSelected && 'bg-primary/10 hover:bg-primary/15',
        hasUnread && !isSelected && 'bg-accent/30'
      )}
    >
      {/* Avatar with online indicator */}
      <div className="relative">
        <Avatar className={cn(
          'h-12 w-12 shrink-0 ring-2 ring-transparent transition-all',
          isSelected && 'ring-primary/20'
        )}>
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={customerName} />
          <AvatarFallback className={cn(
            'text-sm font-medium',
            isSelected ? 'bg-primary/20 text-primary' : 'bg-muted'
          )}>
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-0.5">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={cn(
            'font-medium truncate',
            hasUnread && 'text-foreground',
            !hasUnread && 'text-foreground/80'
          )}>
            {searchQuery ? highlightText(customerName, searchQuery) : customerName}
          </span>
          <span className={cn(
            'text-[11px] shrink-0',
            hasUnread ? 'text-primary font-medium' : 'text-muted-foreground'
          )}>
            {timeAgo}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className={cn(
            'text-sm truncate',
            hasUnread ? 'text-foreground/70 font-medium' : 'text-muted-foreground'
          )}>
            {searchQuery && channel.last_message_preview
              ? highlightText(channel.last_message_preview, searchQuery)
              : channel.last_message_preview || 'No messages yet'}
          </p>
          <UnreadBadge count={channel.unread_count} size="sm" />
        </div>
      </div>
    </button>
  );
}
