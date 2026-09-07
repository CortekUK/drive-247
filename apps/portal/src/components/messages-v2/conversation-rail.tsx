"use client";

/**
 * The conversation rail — the left column of the Messages workspace.
 *
 * ── why this replaced a page ────────────────────────────────────────────────
 *
 * This was a full-width list page: you picked a person, navigated, and the list
 * disappeared. That is one step too many for a screen whose whole job is moving
 * between conversations, and it meant the list could never show you that
 * somebody else had just replied while you were reading.
 *
 * It is now a permanently mounted rail beside the thread — the layout owns it
 * (see `app/(dashboard)/messages/layout.tsx`), so switching conversations
 * swaps only the centre column and this list never unmounts, never refetches
 * and never loses its scroll position.
 *
 * ── compact on purpose ──────────────────────────────────────────────────────
 *
 * Rows are 3 lines in ~64px, not cards. A CRM inbox is read by scanning names
 * down an edge; padding that looks generous on five rows is a scroll wheel on
 * fifty.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Mail, MessageCircle, MessageSquare, Phone, Search, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Input } from "@/components/ui-v2/input";
import { Button } from "@/components/ui-v2/button";
import { useChatChannels, type ChatChannel } from "@/hooks/use-chat-channels";
import type { MessageChannel } from "@/contexts/RealtimeChatContext";
import { mockChannelDecoration, type MockChannelDecoration } from "@/components/messages-v2/mock-conversation";
import { readMessagesScenario, subscribeDevOverrides } from "@/lib/dev-overrides";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

const CHANNEL_MARK: Record<MessageChannel, { icon: typeof Mail; label: string }> = {
  in_app: { icon: MessageCircle, label: "In-app" },
  sms: { icon: MessageSquare, label: "SMS" },
  email: { icon: Mail, label: "Email" },
  voice: { icon: Phone, label: "Call" },
};

function Row({
  channel, mock, selected,
}: {
  channel: ChatChannel;
  mock?: MockChannelDecoration | null;
  selected: boolean;
}) {
  const name = channel.customer?.name || "Unknown customer";
  const unread = mock ? mock.unread : channel.unread_count || 0;
  const preview = mock ? mock.preview : channel.last_message_preview;
  const at = mock ? mock.at : channel.last_message_at;
  const mark =
    CHANNEL_MARK[mock ? mock.channel : channel.last_message_channel ?? channel.last_channel] ??
    CHANNEL_MARK.in_app;
  const MarkIcon = mark.icon;

  return (
    <Link
      href={`/messages/${channel.id}`}
      aria-current={selected ? "true" : undefined}
      className={`relative flex items-center gap-3 px-3 py-2.5 transition-colors ${
        selected ? "bg-primary/[0.07]" : "hover:bg-accent/50"
      }`}
    >
      {/* The selected marker is an edge, not a fill: a filled row would compete
          with the unread badge, which is the thing you are actually scanning
          for. */}
      {selected && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-primary" />}

      <div className="relative shrink-0">
        <Avatar className="h-9 w-9">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`truncate text-[13px] ${unread > 0 ? "font-semibold" : "font-medium"}`}>
            {name}
          </p>
          <span className="shrink-0 text-[10.5px] text-muted-foreground">
            {at ? formatDistanceToNow(new Date(at), { addSuffix: false }) : ""}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <MarkIcon className="h-3 w-3 shrink-0 text-muted-foreground/70" aria-label={mark.label} />
          <p className={`truncate text-[12px] ${unread > 0 ? "text-foreground/85" : "text-muted-foreground"}`}>
            {preview || <span className="italic text-muted-foreground/60">No messages yet</span>}
          </p>
          {unread > 0 && (
            <span className="ml-auto inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function ConversationRail({
  selectedId,
  onBulkMessage,
}: {
  selectedId: string | null;
  onBulkMessage?: () => void;
}) {
  const { channels, isLoading } = useChatChannels();
  const [query, setQuery] = useState("");

  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readMessagesScenario(),
    () => "off" as const,
  );
  const previewing = scenario !== "off";

  const decorationFor = (id: string): MockChannelDecoration | null =>
    previewing ? mockChannelDecoration(scenario, channels.findIndex((c) => c.id === id)) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c, i) => {
      const name = c.customer?.name?.toLowerCase() ?? "";
      const email = c.customer?.email?.toLowerCase() ?? "";
      const shown = previewing
        ? mockChannelDecoration(scenario, i)?.preview ?? ""
        : c.last_message_preview ?? "";
      return name.includes(q) || email.includes(q) || shown.toLowerCase().includes(q);
    });
  }, [channels, query, previewing, scenario]);

  return (
    /* min-h-0 is what stops this column growing past the shell and handing the
       page a second scrollbar. Only the row list scrolls; the search box does
       not move. */
    <div className="flex min-h-0 w-full flex-col border-r border-border/50">
      <div className="shrink-0 space-y-3 border-b border-border/50 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[15px] font-semibold tracking-tight">Messages</h1>
          {onBulkMessage && (
            <Button
              variant="ghost" size="icon" onClick={onBulkMessage}
              title="Bulk message" aria-label="Bulk message"
              className="h-8 w-8 rounded-full text-muted-foreground"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-9 rounded-full pl-9 text-[13px]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 px-1 py-2">
                <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
                  <div className="h-2.5 w-40 animate-pulse rounded-full bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-[13px] font-medium">
              {query ? "No matches" : "No conversations yet"}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {query
                ? "Try another name, email address, or word."
                : "Conversations appear here as soon as somebody writes."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((c) => (
              <Row
                key={c.id}
                channel={c}
                mock={decorationFor(c.id)}
                selected={c.id === selectedId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
