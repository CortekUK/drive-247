"use client";

/**
 * /messages — the conversation list.
 *
 * The conversation itself is a ROUTE now (`/messages/<channel id>`), not a pane
 * beside this one. See `components/messages-v2/conversation-list.tsx` for why,
 * and `app-sidebar-v2.tsx` for the Back rail that route gets.
 *
 * ⚠ `?customerId=` IS LOAD-BEARING AND MUST KEEP WORKING. Enquiries and the
 * customer detail screen both link here with it to open — or start — a
 * conversation with one person. The old page selected a channel in local state;
 * this one resolves the same thing to a channel id and navigates. When no
 * channel exists yet it asks the realtime context to create one and waits for
 * the list to refresh, exactly as before: the creation path is unchanged,
 * only where the result lands is.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BulkMessageModal } from "@/components/chat";
import { ConversationList } from "@/components/messages-v2/conversation-list";
import { useChatChannels } from "@/hooks/use-chat-channels";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useTenant } from "@/contexts/TenantContext";
import { useSocket } from "@/contexts/RealtimeChatContext";

export default function MessagesPage() {
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const { canEdit } = useManagerPermissions();
  const { tenant } = useTenant();
  const { joinRoom } = useSocket();
  const { channels } = useChatChannels();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetCustomerId = searchParams?.get("customerId") ?? null;
  const joinedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!targetCustomerId || !tenant?.id) return;

    const existing = channels.find((c) => c.customer_id === targetCustomerId);
    if (existing) {
      // replace, not push: the list is where Back should land, not this URL
      // with a query param that would re-fire this effect on the way out.
      router.replace(`/messages/${existing.id}`);
      return;
    }

    if (joinedFor.current !== targetCustomerId) {
      joinedFor.current = targetCustomerId;
      void joinRoom(targetCustomerId);
    }
  }, [targetCustomerId, channels, tenant?.id, joinRoom, router]);

  return (
    <>
      <ConversationList
        onBulkMessage={canEdit("messages") ? () => setBulkMessageOpen(true) : undefined}
      />
      <BulkMessageModal open={bulkMessageOpen} onOpenChange={setBulkMessageOpen} />
    </>
  );
}
