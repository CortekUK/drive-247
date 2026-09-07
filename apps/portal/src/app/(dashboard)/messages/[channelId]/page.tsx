"use client";

/**
 * /messages/<channel id> — one conversation, full width.
 *
 * A ROUTE rather than a pane, so the sidebar can become a Back rail for it —
 * the same shape `/rentals/<id>` and `/settings` already use. See
 * `app-sidebar-v2.tsx` for that branch.
 *
 * The channel is resolved from the list this page already has in cache rather
 * than fetched again: `useChatChannels` is the same tenant-scoped query key the
 * list uses, so arriving here from a click costs no request, and arriving by
 * pasting the URL warms the same cache the list will read on the way back.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { ConversationView } from "@/components/messages-v2/conversation-view";
import { useChatChannels } from "@/hooks/use-chat-channels";

export default function ConversationPage() {
  const params = useParams();
  const channelId = typeof params?.channelId === "string" ? params.channelId : null;
  const { channels, isLoading } = useChatChannels();

  const channel = channels.find((c) => c.id === channelId) ?? null;

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-4 border-b border-border/50 px-6 py-4">
          <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-56 animate-pulse rounded-full bg-muted/70" />
          </div>
        </div>
        <div className="flex-1 space-y-4 px-6 py-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
              <div className="h-12 w-2/3 max-w-sm animate-pulse rounded-2xl bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* A conversation that does not exist is not an empty conversation. Rendering
     the normal view with no channel would show a composer that sends into
     nothing, so this is its own state with a way back. */
  if (!channel) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <MessageSquare className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold tracking-tight">Conversation not found</h2>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          It may have been archived, or it belongs to a different account.
        </p>
        <Button asChild variant="outline" className="mt-6 rounded-full">
          <Link href="/messages">Back to messages</Link>
        </Button>
      </div>
    );
  }

  return <ConversationView channel={channel} />;
}
