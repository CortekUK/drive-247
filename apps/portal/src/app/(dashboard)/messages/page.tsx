"use client";

/**
 * `/messages` — the centre column when nothing is selected yet.
 *
 * The rail and the customer overview are drawn by the layout, so this file is
 * only ever the middle. In practice it is rarely seen: as soon as the channel
 * list arrives it selects the most recent conversation and replaces the URL,
 * which is what makes clicking "Messages" land you in a working inbox rather
 * than on a screen asking which person you meant.
 *
 * `router.replace`, not `push` — the empty centre must not become a history
 * entry, or Back from the first conversation would land on it and immediately
 * bounce forward again.
 *
 * ⚠ `?customerId=` IS LOAD-BEARING. Enquiries and the customer detail screen
 * both deep-link here to open — or start — a conversation with one person, and
 * that resolution takes priority over the most-recent default. The
 * create-then-wait path is unchanged from the original page.
 */

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useChatChannels } from "@/hooks/use-chat-channels";
import { useTenant } from "@/contexts/TenantContext";
import { useSocket } from "@/contexts/RealtimeChatContext";

export default function MessagesIndexPage() {
  const { channels, isLoading } = useChatChannels();
  const { tenant } = useTenant();
  const { joinRoom } = useSocket();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetCustomerId = searchParams?.get("customerId") ?? null;
  const joinedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!tenant?.id || channels.length === 0) return;

    if (targetCustomerId) {
      const existing = channels.find((c) => c.customer_id === targetCustomerId);
      if (existing) {
        router.replace(`/messages/${existing.id}`);
        return;
      }
      if (joinedFor.current !== targetCustomerId) {
        joinedFor.current = targetCustomerId;
        void joinRoom(targetCustomerId);
      }
      return;
    }

    /* The most recent conversation. Sorted here rather than trusting the
       hook's order, because "most recent" is the promise being made. */
    const newest = [...channels].sort(
      (a, b) =>
        new Date(b.last_message_at ?? b.created_at).getTime() -
        new Date(a.last_message_at ?? a.created_at).getTime(),
    )[0];
    if (newest) router.replace(`/messages/${newest.id}`);
  }, [channels, tenant?.id, targetCustomerId, joinRoom, router]);

  if (isLoading || channels.length > 0) {
    /* Deliberately quiet. With conversations present this is a single frame
       before the redirect, and a spinner that flashes for 16ms reads as a
       glitch rather than as progress. */
    return <div className="flex-1" />;
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MessageSquare className="h-6 w-6" />
      </div>
      <h2 className="text-base font-semibold tracking-tight">No conversations yet</h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        When a customer messages you, or you message them from a rental or a customer record, the
        conversation appears here.
      </p>
    </div>
  );
}
