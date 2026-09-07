"use client";

/**
 * Messages — the conversation list.
 *
 * ── why this is a list and not a two-pane split ─────────────────────────────
 *
 * The old screen put a 340px channel rail next to a chat pane, inside a layout
 * that already draws a 280px app sidebar. Three columns on a 1440px screen left
 * the conversation about 700px wide, and the rail repeated information the
 * conversation header already showed.
 *
 * So the list is a PAGE, and opening a conversation is a NAVIGATION —
 * `/messages/<channel id>` — exactly as `/rentals/<id>` works. The sidebar
 * turns into a Back rail on that route (see app-sidebar-v2), which is where the
 * extra width comes from. No new pattern was invented for this.
 *
 * ── what it shows, and what it refuses to invent ────────────────────────────
 *
 * Every field here comes off `useChatChannels`, which already computes
 * `unread_count` and `last_message_preview` tenant-scoped. A conversation with
 * no messages yet says so rather than rendering an empty grey line, because a
 * blank preview and a lost preview look identical and only one of them is fine.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Search, Send, Mail, Phone, MessageCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Input } from "@/components/ui-v2/input";
import { Button } from "@/components/ui-v2/button";
import { useChatChannels, type ChatChannel } from "@/hooks/use-chat-channels";
import type { MessageChannel } from "@/contexts/RealtimeChatContext";
import { mockChannelDecoration, type MockChannelDecoration } from "@/components/messages-v2/mock-conversation";
import { readMessagesScenario, subscribeDevOverrides } from "@/lib/dev-overrides";

const initials = (name?: string | null) =>
  (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

/** The channel a conversation last moved on, as a small mark beside the time. */
const CHANNEL_MARK: Record<MessageChannel, { icon: typeof Mail; label: string }> = {
  in_app: { icon: MessageCircle, label: "In-app" },
  sms: { icon: MessageSquare, label: "SMS" },
  email: { icon: Mail, label: "Email" },
  voice: { icon: Phone, label: "Call" },
};

function Row({ channel, mock }: { channel: ChatChannel; mock?: MockChannelDecoration | null }) {
  const name = channel.customer?.name || "Unknown customer";
  /* A preview decoration replaces only what it covers, so a row still shows the
     real customer it belongs to — the point is to judge the LIST, not to invent
     people. */
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
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40"
    >
      <div className="relative shrink-0">
        <Avatar className="h-11 w-11">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p
            className={`truncate text-[14px] ${
              unread > 0 ? "font-semibold text-foreground" : "font-medium text-foreground"
            }`}
          >
            {name}
          </p>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <MarkIcon className="h-3 w-3" aria-label={mark.label} />
            {at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : "Not yet"}
          </span>
        </div>
        {/* An empty preview and a LOST preview render the same, so the empty
            case says what it is instead of leaving a blank line. */}
        <p
          className={`mt-1 truncate text-[13px] ${
            unread > 0 ? "text-foreground/80" : "text-muted-foreground"
          }`}
        >
          {preview || (
            <span className="italic text-muted-foreground/70">No messages yet</span>
          )}
        </p>
      </div>
    </Link>
  );
}

function Skeleton() {
  return (
    <div className="divide-y divide-border/40">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-64 max-w-full animate-pulse rounded-full bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({ onBulkMessage }: { onBulkMessage?: () => void }) {
  const { channels, isLoading } = useChatChannels();
  const [query, setQuery] = useState("");

  /* The same developer preview the conversation uses. Without it here the list
     kept reading its real (empty) data, so every row said "No messages yet"
     while the conversation behind it was full — which made the list impossible
     to judge and "open any conversation" read as broken. */
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readMessagesScenario(),
    () => "off" as const,
  );
  const previewing = scenario !== "off";

  /* Name, email, or message — the three things somebody actually remembers
     about a conversation they are trying to find again. Searches the PREVIEW
     TEXT ACTUALLY ON SCREEN, so under a scenario the message half of the search
     matches what the row is showing rather than the real row underneath it. */
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

  /* Decoration is keyed on the row's index in the FULL list, not the filtered
     one, so searching does not renumber every preview under the cursor. */
  const decorationFor = (id: string): MockChannelDecoration | null =>
    previewing ? mockChannelDecoration(scenario, channels.findIndex((c) => c.id === id)) : null;

  const totalUnread = previewing
    ? channels.reduce((n, c) => n + (decorationFor(c.id)?.unread ?? 0), 0)
    : channels.reduce((n, c) => n + (c.unread_count || 0), 0);

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 px-1 pb-10 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Messages</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {totalUnread > 0
              ? `${totalUnread} unread ${totalUnread === 1 ? "message" : "messages"} across ${channels.length} ${channels.length === 1 ? "conversation" : "conversations"}.`
              : "Every conversation with your customers, in one place."}
          </p>
        </div>
        {onBulkMessage && (
          <Button onClick={onBulkMessage} variant="outline" className="gap-2 rounded-full">
            <Send className="h-4 w-4" />
            Bulk message
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, or message"
          className="h-11 rounded-full pl-11"
        />
      </div>

      <div className="overflow-hidden rounded-3xl bg-card ring-1 ring-foreground/5">
        {isLoading ? (
          <Skeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessageSquare className="h-6 w-6" />
            </div>
            {/* Two different nothings. "No results" is a search that missed;
                "no conversations" is an account nobody has written to yet, and
                telling somebody to clear a filter they never set is worse than
                saying nothing. */}
            <h3 className="text-base font-semibold tracking-tight">
              {query ? "No conversations match that" : "No conversations yet"}
            </h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {query
                ? "Try a different name, email address, or word from the message."
                : "When a customer messages you, or you message them, the conversation appears here."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((c) => (
              <Row key={c.id} channel={c} mock={decorationFor(c.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
