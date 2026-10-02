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
 * Rows are 2 lines in ~68px, not cards. A CRM inbox is read by scanning names
 * down an edge, so this stays a list — but at the rail's 360px the old ~58px
 * rows read cramped, so they were given a little more air.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Check, Loader2, Mail, MessageCircle, MessageSquare, Phone, Search, Send, Smartphone, X } from "lucide-react";
import { useBulkSelect } from "@/components/messages-v2/bulk-select";
import { useV2 } from "@/lib/v2-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { useChatChannels, type ChatChannel, type UnknownSmsThread } from "@/hooks/use-chat-channels";
import { LinkUnknownThreadDialog } from "@/components/chat/LinkUnknownThreadDialog";
import type { MessageChannel } from "@/contexts/RealtimeChatContext";
import { mockChannelDecoration, type MockChannelDecoration } from "@/components/messages-v2/mock-conversation";
import { readMessagesScenario, subscribeDevOverrides } from "@/lib/dev-overrides";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

const CHANNEL_MARK: Record<MessageChannel, { icon: typeof Mail; label: string }> = {
  in_app: { icon: MessageCircle, label: "In-app" },
  sms: { icon: MessageSquare, label: "SMS" },
  email: { icon: Mail, label: "Email" },
  voice: { icon: Phone, label: "Call" },
};

/** Placeholder conversations for the rail's skeleton: only their shapes are seen. */
const SKELETON_CHANNELS: ChatChannel[] = skeletonRows(8, (f) => ({
  id: f.id,
  tenant_id: "",
  customer_id: f.id,
  status: "active" as const,
  last_message_at: f.date(f.int(0, 20)),
  last_channel: "in_app" as const,
  created_at: f.date(60),
  updated_at: f.date(60),
  customer: { id: f.id, name: f.text(2, 3), email: "", phone: null, profile_photo_url: null },
  unread_count: 0,
  last_message_preview: f.text(4, 8),
  last_message_channel: null,
}));

function Row({
  channel, mock, selected, picking, checked, onPick,
}: {
  channel: ChatChannel;
  mock?: MockChannelDecoration | null;
  selected: boolean;
  /** Bulk selection is on: the row ticks instead of navigating. */
  picking?: boolean;
  checked?: boolean;
  onPick?: () => void;
}) {
  const name = channel.customer?.name || "Unknown customer";
  const unread = mock ? mock.unread : channel.unread_count || 0;
  const preview = mock ? mock.preview : channel.last_message_preview;
  const at = mock ? mock.at : channel.last_message_at;
  const mark =
    CHANNEL_MARK[mock ? mock.channel : channel.last_message_channel ?? channel.last_channel] ??
    CHANNEL_MARK.in_app;
  const MarkIcon = mark.icon;

  const tint = picking ? checked : selected;
  const rowClass = `relative flex w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-200 ease-out motion-reduce:transition-none ${
    tint
      ? "bg-primary/10 dark:bg-[hsl(var(--v2-hover,var(--muted)))]"
      : "hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.5))]"
  }`;

  const content = (
    <>
      {/* The round check, only while picking. It sits in front of the avatar
          and slides the row's content over rather than covering anything. */}
      {picking && (
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200 ease-out motion-reduce:transition-none ${
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/30 bg-card"
          }`}
        >
          {checked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      )}

      <div className="relative shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
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
        <div className="mt-1 flex items-center gap-1.5">
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
    </>
  );

  if (picking) {
    return (
      <button type="button" role="checkbox" aria-checked={!!checked} onClick={onPick} className={rowClass}>
        {content}
      </button>
    );
  }
  return (
    <Link
      href={`/messages/${channel.id}`}
      aria-current={selected ? "true" : undefined}
      className={rowClass}
    >
      {content}
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
  // unknownThreads was already being fetched here and thrown away: the only component
  // that rendered it, components/chat/ChannelList, has no importers, and this rail —
  // the one actually mounted by the Messages layout — never read it. So texts and
  // voicemails from anyone not already on a customer record reached the database and
  // were invisible to the operator.
  const { channels: loadedChannels, unknownThreads, isLoading: channelsLoading } = useChatChannels();
  const isLoading = useSkeletonLoading(channelsLoading);
  // While the list loads the rail renders placeholder rows through the real
  // <Row>, and <AutoSkeleton> turns them into the skeleton.
  const channels = isLoading ? SKELETON_CHANNELS : loadedChannels;
  const [query, setQuery] = useState("");
  const bulk = useBulkSelect();
  const v2Name = useV2("chrome");
  const picking = !!bulk?.active;
  const [linkThread, setLinkThread] = useState<UnknownSmsThread | null>(null);

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
    // A query typed before the list arrives must not filter the placeholders
    // down to "No matches".
    if (!q || isLoading) return channels;
    return channels.filter((c, i) => {
      const name = c.customer?.name?.toLowerCase() ?? "";
      const email = c.customer?.email?.toLowerCase() ?? "";
      const shown = previewing
        ? mockChannelDecoration(scenario, i)?.preview ?? ""
        : c.last_message_preview ?? "";
      return name.includes(q) || email.includes(q) || shown.toLowerCase().includes(q);
    });
  }, [channels, query, previewing, scenario, isLoading]);

  return (
    /* min-h-0 is what stops this column growing past the shell and handing the
       page a second scrollbar. Only the row list scrolls; the search box does
       not move. */
    /* Blended, like the main v2 sidebar: no column rule, no header rule, no
       row dividers. Rows are rounded pills inset from the edge, and the
       selected one is the sidebar's own active tint rather than a fill plus
       an edge bar. */
    <div className="flex min-h-0 w-full flex-col">
      <div className="shrink-0 space-y-3 px-3 py-3">
        {picking ? (
          /* Selecting recipients: the title row says what is happening and
             how many are in, with the way out first. */
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button
                variant="ghost" size="icon" onClick={bulk!.cancel} disabled={bulk!.sending}
                title="Cancel (Esc)" aria-label="Cancel bulk message"
                className="-ml-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
              <h1 className="truncate text-[15px] font-semibold tracking-tight">
                Choose recipients
              </h1>
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold tabular-nums text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                {bulk!.selected.size}
              </span>
            </div>
            {(() => {
              const ids = filtered.map((c) => c.customer_id);
              const all = ids.length > 0 && ids.every((id) => bulk!.selected.has(id));
              return (
                <button
                  type="button"
                  onClick={() => bulk!.setMany(ids, !all)}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-primary transition-colors duration-200 hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))]"
                >
                  {all ? "Clear" : query ? "Select shown" : "Select all"}
                </button>
              );
            })()}
          </div>
        ) : null}
        {/* Title row: the way out, then the heading. While picking bulk
            recipients the "Choose recipients" row above replaces it. */}
        {!picking && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Button
              asChild variant="ghost" size="icon"
              title="Back to the portal" aria-label="Back to the portal"
              className="-ml-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            {/* "Crossroads" on v2 — where every channel (in-app, SMS, email,
                calls) meets. This rail also serves v1 tenants, who keep
                "Messages" until the area is widened. */}
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{v2Name ? "Crossroads" : "Messages"}</h1>
          </div>
        )}
        {/* The search, on its own row underneath. */}
        <div className="flex items-center">
          {/* The top bar's search pill (TopBarV2 `FIELD`), as a real input: the
              same light-indigo tint, 25% indigo rim, indigo glass and 200ms
              fades, so the two searches read as one control. `focus-within`
              stands in for the pill's `focus-visible`, since here the focus
              lands on the input inside rather than on the pill itself. */}
          <label
            className={
              "flex h-9 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.07] px-3 " +
              "transition-colors duration-200 ease-out motion-reduce:transition-none " +
              "hover:border-primary/40 hover:bg-primary/10 " +
              "dark:hover:border-[hsl(var(--v2-link,var(--primary))_/_0.4)] dark:hover:bg-[hsl(var(--v2-hover,var(--muted)))] " +
              "focus-within:border-primary/50 focus-within:bg-primary/10 focus-within:ring-3 focus-within:ring-ring/30 " +
              "dark:focus-within:bg-[hsl(var(--v2-hover,var(--muted)))]"
            }
          >
            <Search className="size-4 shrink-0 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[hsl(var(--v2-muted-on-tint,var(--muted-foreground)))] [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
        </div>
      </div>

      {/* The one scroll region in this column. The search header above is a
          sibling, not a wrapper, so it stays put without `sticky`. */}
      <div className={`min-h-0 flex-1 overflow-y-auto no-scrollbar ${NO_SCROLLBAR}`}>
        {!isLoading && filtered.length === 0 ? (
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
          <AutoSkeleton loading={isLoading} className="space-y-0.5 px-2">
            {filtered.map((c) => (
              <Row
                key={c.id}
                channel={c}
                mock={isLoading ? null : decorationFor(c.id)}
                selected={!isLoading && c.id === selectedId}
                picking={picking && !isLoading}
                checked={!!bulk?.selected.has(c.customer_id)}
                onPick={() => bulk?.toggle(c.customer_id)}
              />
            ))}
          </AutoSkeleton>
        )}

        {/* Rendered outside the empty/loaded branch above, so an operator whose only
            contact is from unrecognised numbers still sees something. */}
        {!query && !picking && unknownThreads.length > 0 && (
          <div className="mt-2">
            <div className="px-4 pb-1 pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Unknown numbers
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                Not matched to a customer. Link one to reply and keep the history.
              </p>
            </div>
            <div className="space-y-0.5 px-2">
              {unknownThreads.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                    {/* One icon for both texts and voicemails: sms_unknown_threads has
                        no last_channel column, and adding one purely to pick an icon is
                        not worth a schema change — the content is visible once linked. */}
                    <Smartphone className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px]">{t.phone_number}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.message_count} message{t.message_count === 1 ? "" : "s"}
                      {t.last_message_at
                        ? ` · ${formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true })}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-[11px]"
                    onClick={() => setLinkThread(t)}
                  >
                    Link
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The send bar, only while picking: what is going out, on which
          channel, and the one action. Sits under the list as a sibling, so it
          never scrolls away. */}
      {picking && (
        <div className="shrink-0 space-y-2.5 px-3 pb-3 pt-2">
          <div className="rounded-2xl bg-primary/[0.06] px-3.5 py-2.5 dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {bulk!.mode === "sms" ? "SMS" : "In-app"} message
            </p>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-foreground/85">{bulk!.text}</p>
          </div>
          <Button
            onClick={() => void bulk!.send()}
            disabled={bulk!.selected.size === 0 || bulk!.sending}
            className="h-10 w-full gap-2 rounded-full"
          >
            {bulk!.sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {bulk!.sending
              ? "Sending…"
              : bulk!.selected.size === 0
                ? "Select customers"
                : `Send to ${bulk!.selected.size} customer${bulk!.selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}

      {linkThread && (
        <LinkUnknownThreadDialog
          open={!!linkThread}
          onOpenChange={(open) => !open && setLinkThread(null)}
          threadId={linkThread.id}
          phoneNumber={linkThread.phone_number}
        />
      )}
    </div>
  );
}
