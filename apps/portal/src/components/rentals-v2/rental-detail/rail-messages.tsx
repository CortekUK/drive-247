"use client";

/**
 * Messages — the second tab of the right rail. REAL DATA, REAL SENDING.
 *
 * The design is the playground's `_right-sidebar.tsx` messages tab, which was
 * drawn against the real schema and documents the mapping field by field. What
 * changed on the way here is only the data source: `SEED` became
 * `useChatMessages`, and the fake optimistic flip became
 * `useSocket().sendMessage`, which is the portal's ONE send path.
 *
 * ── Why the whole thread, and not a preview ─────────────────────────────────
 *
 * The brief allowed showing a recent thread and linking out. That turned out
 * to be the more expensive option, not the cheaper one: `useChatMessages`
 * already returns the conversation paged and realtime-patched, and
 * `sendMessage` already takes a `customerId` and creates the channel if there
 * is none. So the rail carries a working conversation rather than a teaser,
 * and still links out — the full `/messages` surface adds voice calls,
 * per-channel phone/email editing and bulk send, none of which fit in 360px.
 *
 * ── What is real, and what it costs ─────────────────────────────────────────
 *
 *   thread   `chat_channel_messages` via `useChatMessages(channelId,
 *            customerId)`. Note it is not passive: mounting it joins the
 *            customer's realtime room AND marks their unread messages read.
 *            That is correct here — this tab is only mounted while an operator
 *            is looking at the thread — but it is the reason the tab is
 *            rendered conditionally rather than kept alive behind the others.
 *
 *   channel  resolved with a single `chat_channels` lookup rather than
 *            `useChatChannels()`, which fetches EVERY channel for the tenant
 *            and then fires two more queries per channel. One rental needs one
 *            row. RLS is off on `chat_channels` (V2_PLAN §5), so the
 *            `tenant_id` filter here is the only thing scoping it — it is not
 *            optional.
 *
 *   send     `useSocket().sendMessage(customerId, body, undefined, channel)`.
 *            In-app inserts directly; SMS and email go through the
 *            `send-sms-message` / `send-email-message` edge functions. A pipe
 *            with no address on file is disabled, because in the real product
 *            it fails silently.
 *
 * Tokens only. `components/chat/ChatMessageBubble.tsx` paints raw brand hexes
 * (Twilio red, blue-500, amber-500) and sets 15px text with a 75% max width —
 * it would read as v1 dropped into the canary, and it does not fit 360px. The
 * compact bubble below is the prototype's, which was drawn for this width.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  Smartphone,
  Mail,
  Send,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { Button } from "@/components/ui-v2/button";
import { useChatMessages, type ChatMessage } from "@/hooks/use-chat-messages";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import type { RentalDetailV2 } from "./use-rental-detail-v2";
import { textareaCls } from "./_kit";

/* ══════════════════════════════════════════════════════════════════════════
   Shape
   ══════════════════════════════════════════════════════════════════════════ */

/** The three pipes an operator can compose on. `voice` exists in the real enum
 *  but a call is not something you type into a textarea. */
type Pipe = Extract<MessageChannel, "in_app" | "sms" | "email">;

const PIPES: { id: Pipe; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "in_app", label: "Chat", icon: MessageSquare },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "email", label: "Email", icon: Mail },
];

const firstName = (name: string | null) => (name ? name.split(" ")[0] : "there");

/** A day label for the separator — "Today", "Yesterday", else the date. */
const dayLabel = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

const timeLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

/* ══════════════════════════════════════════════════════════════════════════
   The channel this customer's messages live in
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One row, not the tenant's whole channel list.
 *
 * A null result is not an error: it means nobody has ever messaged this
 * customer. `sendMessage` creates the channel on the first send, so the rail
 * can compose into a conversation that does not exist yet.
 */
function useCustomerChannel(customerId: string | null, tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["rail-chat-channel", tenantId, customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_channels")
        .select("id")
        .eq("tenant_id", tenantId!)
        .eq("customer_id", customerId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
    enabled: !!customerId && !!tenantId,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   One bubble
   ══════════════════════════════════════════════════════════════════════════ */

const PIPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  in_app: MessageSquare,
  sms: Smartphone,
  email: Mail,
  voice: Clock,
};

/**
 * Consecutive messages from the same sender on the same pipe are a RUN, and a
 * run carries one meta line, not one per message. The tail corner is squared
 * only on the last bubble of a run, which is what makes a run read as one
 * utterance rather than three.
 */
function Bubble({
  msg,
  prev,
  next,
}: {
  msg: ChatMessage;
  prev?: ChatMessage;
  next?: ChatMessage;
}) {
  const ours = msg.sender_type === "tenant";
  const day = dayLabel(msg.created_at);
  const newDay = !prev || dayLabel(prev.created_at) !== day;
  const startsRun = newDay || prev!.sender_type !== msg.sender_type || prev!.channel !== msg.channel;
  const endsRun =
    !next ||
    dayLabel(next.created_at) !== day ||
    next.sender_type !== msg.sender_type ||
    next.channel !== msg.channel;
  const PipeIcon = PIPE_ICON[msg.channel] ?? MessageSquare;

  return (
    <>
      {/* A day is a word and some air, not a rule across the rail. */}
      {newDay && (
        <p className={cn("mb-2 text-center text-[11px] text-muted-foreground/50", prev && "mt-4")}>{day}</p>
      )}

      <div
        className={cn(
          "flex flex-col",
          ours ? "items-end" : "items-start",
          !newDay && (startsRun ? "mt-2" : "mt-0.5")
        )}
      >
        {/* Three signals separate the directions, because one is not enough at
            this width: the side it hangs off, the fill, and the squared tail. */}
        <div
          className={cn(
            "max-w-[80%] whitespace-pre-wrap break-words rounded-xl px-3 py-1.5 text-[13px] leading-[1.4]",
            ours ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground",
            endsRun && (ours ? "rounded-br-sm" : "rounded-bl-sm")
          )}
        >
          {msg.content}
        </div>

        {endsRun && (
          <p className="mt-0.5 flex items-center gap-1 px-1 text-[11px] leading-none text-muted-foreground/60">
            <PipeIcon className="size-3" />
            <span>{timeLabel(msg.created_at)}</span>
            {/* Read is the customer having OPENED it, not us having sent it.
                The two are worth separating when you are deciding whether to
                chase someone. */}
            {ours && (msg.is_read ? <CheckCheck className="size-3 text-primary" /> : <Check className="size-3" />)}
          </p>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function RailMessages({ detail }: { detail: RentalDetailV2 }) {
  const { tenant } = useTenant();
  const { sendMessage } = useSocket();

  const customer = detail.customer;
  const customerId = customer?.id ?? null;

  const { data: channelId = null } = useCustomerChannel(customerId, tenant?.id);
  const { messages, isLoading, loadMore, hasMore, isLoadingMore } = useChatMessages(channelId, customerId);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  /** What the operator picked, which is not always what they get. */
  const [wanted, setWanted] = useState<Pipe>("in_app");
  const reach: Record<Pipe, boolean> = {
    in_app: true,
    sms: !!customer?.phone,
    email: !!customer?.email,
  };
  // A pipe with no address is not a choice. Fall back rather than let a
  // message be composed into a void.
  const pipe: Pipe = reach[wanted] ? wanted : "in_app";

  const placeholder: Record<Pipe, string> = {
    in_app: `Message ${firstName(customer?.name ?? null)}…`,
    sms: `Text ${customer?.phone ?? ""}…`,
    email: `Email ${customer?.email ?? ""}…`,
  };

  const pipeTitle = (p: Pipe) =>
    !reach[p]
      ? p === "sms"
        ? "No phone number on file"
        : "No email address on file"
      : p === "in_app"
        ? "In-app chat"
        : p === "sms"
          ? `SMS to ${customer?.phone}`
          : `Email to ${customer?.email}`;

  const scroller = useRef<HTMLDivElement | null>(null);

  // Newest message is the point of the panel — never open scrolled to history.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body || !customerId || sending) return;
    setSending(true);
    // Fire-and-forget by design: the context emits the confirmed row to its
    // listeners, and `useChatMessages` patches its own cache from that. An
    // await here would only delay clearing the box.
    sendMessage(customerId, body, undefined, pipe);
    setDraft("");
    setSending(false);
  };

  if (!customerId) {
    return (
      <div className="shrink-0 rounded-3xl bg-muted/40 px-4 py-5 text-center">
        <p className="text-[13px] font-medium text-muted-foreground">No customer on this rental</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
          A conversation opens here once the rental has someone attached to it.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Who, in one line. A full customer card here would spend 90px
          repeating what the stage rail and the page title already say. */}
      <div className="flex shrink-0 items-baseline gap-2 px-1 pb-1">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{customer?.name}</p>
        <Link
          href={`/messages?customerId=${customerId}`}
          className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/70 transition-colors hover:text-primary"
          title="Open the full conversation"
        >
          All messages
          <ExternalLink className="size-3" />
        </Link>
      </div>

      {/* The thread takes every pixel the composer does not. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <p className="px-1 text-[11px] text-muted-foreground">Reading the conversation…</p>
        ) : messages.length === 0 ? (
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            Nothing has been said to {firstName(customer?.name ?? null)} yet. The first message below starts the
            conversation.
          </p>
        ) : (
          <>
            {hasMore && (
              <div className="pb-2 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                >
                  {isLoadingMore ? "Loading…" : "Earlier messages"}
                </button>
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={m.id} msg={m} prev={messages[i - 1]} next={messages[i + 1]} />
            ))}
          </>
        )}
      </div>

      {/* ── send ─────────────────────────────────────────────────────────
          Three labelled chips fit on one row at 360px, so the pipe says its
          own name rather than making you hover an icon. */}
      <div className="shrink-0 pt-2">
        <div className="flex gap-1">
          {PIPES.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!reach[p.id]}
              title={pipeTitle(p.id)}
              onClick={() => setWanted(p.id)}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-3xl px-2 py-0.5 text-[11px] transition-colors",
                p.id === pipe
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:text-primary",
                !reach[p.id] && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
              )}
            >
              <p.icon className="size-3.5 shrink-0" />
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-end gap-1.5">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every
              // operator already has in their fingers.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder[pipe]}
            className={cn(textareaCls, "min-h-9 rounded-3xl px-3 py-2 text-[13px]")}
          />
          <Button
            size="icon"
            className="shrink-0"
            onClick={send}
            disabled={!draft.trim() || sending}
            title={`Send via ${PIPES.find((p) => p.id === pipe)?.label}`}
            aria-label="Send"
          >
            <Send />
          </Button>
        </div>
      </div>
    </>
  );
}

export default RailMessages;
