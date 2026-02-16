"use client";

import { useState } from "react";
import { ChannelList, ChatWindow, BulkMessageModal } from "@/components/chat";
import type { ChatChannel } from "@/hooks/use-chat-channels";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

export default function MessagesPage() {
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const { canEdit } = useManagerPermissions();

  const handleSelectChannel = (channel: ChatChannel) => {
    setSelectedChannel(channel);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Chat layout - full height */}
      <div className="flex-1 flex overflow-hidden">
        {/* Channel list - left panel */}
        <div className="w-[340px] shrink-0 border-r border-border/50 bg-card/30">
          <ChannelList
            selectedChannelId={selectedChannel?.id || null}
            onSelectChannel={handleSelectChannel}
            onBulkMessage={canEdit('messages') ? () => setBulkMessageOpen(true) : undefined}
          />
        </div>

        {/* Chat window - right panel */}
        <div className="flex-1 bg-background/50">
          <ChatWindow
            channelId={selectedChannel?.id || null}
            customerId={selectedChannel?.customer_id || null}
            customerName={selectedChannel?.customer?.name || "Customer"}
            customerAvatar={selectedChannel?.customer?.profile_photo_url || null}
            customerEmail={selectedChannel?.customer?.email || null}
          />
        </div>
      </div>

      {/* Bulk message modal */}
      <BulkMessageModal
        open={bulkMessageOpen}
        onOpenChange={setBulkMessageOpen}
      />
    </div>
  );
}
