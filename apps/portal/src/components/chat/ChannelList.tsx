'use client';

import { useState, useMemo } from 'react';
import { Search, MessageSquarePlus, Loader2 } from 'lucide-react';
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

  // Filter channels by search query
  const filteredChannels = useMemo(() => {
    if (!searchQuery.trim()) return channels;

    const query = searchQuery.toLowerCase();
    return channels.filter((channel) =>
      channel.customer?.name?.toLowerCase().includes(query) ||
      channel.customer?.email?.toLowerCase().includes(query)
    );
  }, [channels, searchQuery]);

  return (
    <div className="flex flex-col h-full border-r">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg mb-3">Messages</h2>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Channel list */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && filteredChannels.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <p className="text-muted-foreground text-sm">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
          </div>
        )}

        {!isLoading &&
          filteredChannels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              isSelected={channel.id === selectedChannelId}
              onClick={() => onSelectChannel(channel)}
            />
          ))}
      </ScrollArea>

      {/* Bulk message button */}
      <div className="p-4 border-t">
        <Button
          variant="outline"
          className="w-full"
          onClick={onBulkMessage}
        >
          <MessageSquarePlus className="h-4 w-4 mr-2" />
          Bulk Message
        </Button>
      </div>
    </div>
  );
}

interface ChannelItemProps {
  channel: ChatChannel;
  isSelected: boolean;
  onClick: () => void;
}

function ChannelItem({ channel, isSelected, onClick }: ChannelItemProps) {
  const customerName = channel.customer?.name || 'Unknown Customer';
  const initials = customerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const timeAgo = channel.last_message_at
    ? formatDistanceToNow(new Date(channel.last_message_at), { addSuffix: true })
    : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50',
        isSelected && 'bg-muted'
      )}
    >
      {/* Avatar */}
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={customerName} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{customerName}</span>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-sm text-muted-foreground truncate">
            {channel.last_message_preview || 'No messages yet'}
          </p>
          <UnreadBadge count={channel.unread_count} size="sm" />
        </div>
      </div>
    </button>
  );
}
