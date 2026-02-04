"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { ChannelList, ChatWindow, BulkMessageModal } from "@/components/chat";
import type { ChatChannel } from "@/hooks/use-chat-channels";

export default function MessagesPage() {
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);

  const handleSelectChannel = (channel: ChatChannel) => {
    setSelectedChannel(channel);
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Messages</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Chat with your customers in real-time
        </p>
      </div>

      {/* Chat layout */}
      <div className="border rounded-lg bg-card overflow-hidden h-[calc(100vh-220px)]">
        <div className="flex h-full">
          {/* Channel list - left panel */}
          <div className="w-80 shrink-0">
            <ChannelList
              selectedChannelId={selectedChannel?.id || null}
              onSelectChannel={handleSelectChannel}
              onBulkMessage={() => setBulkMessageOpen(true)}
            />
          </div>

          {/* Chat window - right panel */}
          <div className="flex-1">
            <ChatWindow
              channelId={selectedChannel?.id || null}
              customerId={selectedChannel?.customer_id || null}
              customerName={selectedChannel?.customer?.name || "Customer"}
            />
          </div>
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
