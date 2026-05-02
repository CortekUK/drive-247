"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChannelList, ChatWindow, BulkMessageModal } from "@/components/chat";
import { useChatChannels, type ChatChannel } from "@/hooks/use-chat-channels";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useTenant } from "@/contexts/TenantContext";
import { useSocket } from "@/contexts/RealtimeChatContext";
import { cn } from "@/lib/utils";

export default function MessagesPage() {
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const { canEdit } = useManagerPermissions();
  const { tenant } = useTenant();
  const { joinRoom } = useSocket();
  const { channels } = useChatChannels();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetCustomerId = searchParams?.get("customerId") ?? null;
  const joinedFor = useRef<string | null>(null);

  const smsEnabled = !!(tenant as any)?.integration_twilio_sms;
  const whatsappEnabled = !!(tenant as any)?.integration_twilio_whatsapp || !!(tenant as any)?.integration_whatsapp;

  const handleSelectChannel = (channel: ChatChannel) => {
    setSelectedChannel(channel);
  };

  // Auto-select the channel for ?customerId=… (e.g. coming from Enquiries detail).
  // If no channel exists yet, ask the realtime context to create one, then pick it
  // up the next time `channels` refreshes. Strip the query param once selected so
  // back/forward navigation doesn't keep re-applying it.
  useEffect(() => {
    if (!targetCustomerId || !tenant?.id) return;

    const existing = channels.find((c) => c.customer_id === targetCustomerId);
    if (existing) {
      if (selectedChannel?.id !== existing.id) {
        setSelectedChannel(existing);
      }
      const next = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      next.delete("customerId");
      const qs = next.toString();
      router.replace(qs ? `/messages?${qs}` : "/messages");
      return;
    }

    if (joinedFor.current !== targetCustomerId) {
      joinedFor.current = targetCustomerId;
      void joinRoom(targetCustomerId);
    }
  }, [targetCustomerId, channels, tenant?.id, joinRoom, router, searchParams, selectedChannel?.id]);

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Chat layout - full height */}
      <div className="flex-1 flex overflow-hidden">
        {/* Channel list - left panel: hidden on mobile when a chat is selected */}
        <div className={cn(
          "w-full md:w-[340px] shrink-0 border-r border-border/50 bg-card/30",
          selectedChannel ? "hidden md:block" : "block"
        )}>
          <ChannelList
            selectedChannelId={selectedChannel?.id || null}
            onSelectChannel={handleSelectChannel}
            onBulkMessage={canEdit('messages') ? () => setBulkMessageOpen(true) : undefined}
          />
        </div>

        {/* Chat window - right panel: hidden on mobile when no chat is selected */}
        <div className={cn(
          "flex-1 bg-background/50",
          selectedChannel ? "block" : "hidden md:block"
        )}>
          <ChatWindow
            channelId={selectedChannel?.id || null}
            customerId={selectedChannel?.customer_id || null}
            customerName={selectedChannel?.customer?.name || "Customer"}
            customerAvatar={selectedChannel?.customer?.profile_photo_url || null}
            customerEmail={selectedChannel?.customer?.email || null}
            customerPhone={selectedChannel?.customer?.phone || null}
            twilioPhoneNumber={(tenant as any)?.twilio_phone_number || null}
            onBack={() => setSelectedChannel(null)}
            lastChannel={selectedChannel?.last_channel || 'in_app'}
            smsEnabled={smsEnabled}
            whatsappEnabled={whatsappEnabled}
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
