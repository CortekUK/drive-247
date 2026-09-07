"use client";

/**
 * Messages — one conversation, full width.
 *
 * ── what is reused, and why that is the point ───────────────────────────────
 *
 * The transport is untouched. `useChatMessages` still loads and pages the
 * history, `useSocket().sendMessage(customerId, content, metadata, channel)` is
 * still the only way a message leaves this screen, `markRead` still clears the
 * unread count, and `ChatMessageBubble` still draws every bubble — including
 * the booking-reference card, which already existed and already renders from
 * `metadata.booking`. `BookingPicker` is reused whole for the same reason: a
 * second rental selector would be a second thing to keep in step with the
 * shape `ChatMessageBubble` expects.
 *
 * What is new is the SHELL: a header, a channel switcher that makes the active
 * channel unmistakable, a composer per channel, and the spacing.
 *
 * ── four channels, three composers ──────────────────────────────────────────
 *
 * In-app and SMS are the same act — short text, send. Email is not: it needs a
 * subject and a body with room to write, and squeezing that into a chat input
 * is how people send subject-less email. Call is not a message at all, so it
 * gets an action rather than a text box.
 *
 * WhatsApp is deliberately absent. It was never in this surface —
 * `MessageChannel` is `in_app | sms | email | voice` — so there was nothing to
 * remove here. The WhatsApp settings elsewhere belong to lockbox notifications
 * and are a different feature.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import {
  ArrowLeft, Mail, MessageCircle, MessageSquare, Paperclip, Phone,
  PhoneCall, Send, Loader2, Info, X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { useToast } from "@/hooks/use-toast";
import { useChatMessages } from "@/hooks/use-chat-messages";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import { ChatMessageBubble, DateSeparator } from "@/components/chat";
import { BookingPicker, type BookingReference } from "@/components/chat/BookingPicker";
import type { ChatChannel } from "@/hooks/use-chat-channels";

type Mode = MessageChannel | "call";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

/* ── the channel switcher ─────────────────────────────────────────────────
   One accent, four states. The active channel is a filled pill; the rest are
   quiet. A channel the tenant cannot use is visibly unavailable rather than
   hidden — "why can I not text this person" is answerable, "where did SMS go"
   is not. */
const MODES: { key: Mode; label: string; icon: typeof Mail }[] = [
  { key: "in_app", label: "In-App", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
  { key: "call", label: "Call", icon: Phone },
];

function ChannelSwitcher({
  mode, setMode, disabled,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  disabled: Partial<Record<Mode, string>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-muted/60 p-1.5">
      {MODES.map(({ key, label, icon: Icon }) => {
        const why = disabled[key];
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            disabled={!!why}
            title={why}
            onClick={() => setMode(key)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
              active
                ? "bg-card text-primary shadow-sm"
                : why
                  ? "cursor-not-allowed text-muted-foreground/40"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── attachments ──────────────────────────────────────────────────────────
   THIS IS A MOCK AND SAYS SO. There is no file-upload path in the chat
   backend — the only paperclip in the old UI opened the booking picker. The
   button therefore collects a file and shows it, so the flow is testable end
   to end, and states plainly that it will not be delivered. A button that
   looked real and silently dropped the file would be worse than no button. */
function AttachmentRow({
  files, onAdd, onRemove,
}: {
  files: File[];
  onAdd: (f: File[]) => void;
  onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onAdd(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full text-muted-foreground"
        title="Attach a file (not delivered yet)"
        onClick={() => ref.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      {files.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-2 px-1 pb-1">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[12px] text-muted-foreground"
            >
              {f.name}
              <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
            <Info className="h-3 w-3" />
            Attachments are not sent yet
          </span>
        </div>
      )}
    </>
  );
}

export function ConversationView({ channel }: { channel: ChatChannel }) {
  const customerId = channel.customer_id;
  const name = channel.customer?.name || "Customer";
  const email = channel.customer?.email || null;
  const phone = channel.customer?.phone || null;

  const { messages, isLoading, loadMore, hasMore, isLoadingMore } = useChatMessages(
    channel.id,
    customerId,
  );
  const { sendMessage, markRead, joinRoom } = useSocket();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>(channel.last_channel || "in_app");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [booking, setBooking] = useState<BookingReference | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  /* Join and clear unread on open — the same two calls the old window made. */
  useEffect(() => {
    if (!customerId) return;
    void joinRoom(customerId);
    void markRead(customerId);
  }, [customerId, joinRoom, markRead]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const disabled: Partial<Record<Mode, string>> = useMemo(
    () => ({
      ...(phone ? {} : { sms: "This customer has no phone number", call: "This customer has no phone number" }),
      ...(email ? {} : { email: "This customer has no email address" }),
    }),
    [phone, email],
  );

  async function handleSend() {
    const text = body.trim();
    if (mode === "email" && !subject.trim()) {
      toast({ title: "Subject required", description: "An email needs a subject line.", variant: "destructive" });
      return;
    }
    if (!text && !booking) return;
    if (disabled[mode]) return;

    setSending(true);
    const metadata: Record<string, unknown> = {};
    if (booking) { metadata.type = "booking_reference"; metadata.booking = booking; }
    if (mode === "email") metadata.subject = subject.trim();

    const content = text || "Shared a booking";
    setBody(""); setSubject(""); setBooking(null); setFiles([]);
    try {
      await sendMessage(customerId, content, Object.keys(metadata).length ? metadata : undefined,
        mode === "call" ? "voice" : (mode as MessageChannel));
    } finally {
      setSending(false);
    }
  }

  /* Grouping: consecutive messages from the same sender share an avatar, and a
     date separator lands whenever the day changes. */
  const rows = useMemo(() => {
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const newDay = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
      return {
        message: m,
        newDay,
        isFirstInGroup: newDay || prev?.sender_type !== m.sender_type,
        isLastInGroup: !next || next.sender_type !== m.sender_type,
      };
    });
  }, [messages]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-border/50 px-6 py-4">
        {/* The sidebar becomes a Back rail on this route, but a Back control
            has to exist inside the view too: the rail collapses to an icon on
            narrow screens and disappears entirely on mobile. */}
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full lg:hidden">
          <a href="/messages" aria-label="Back to messages"><ArrowLeft className="h-4 w-4" /></a>
        </Button>
        <Avatar className="h-11 w-11">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">{name}</h1>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {[email, phone].filter(Boolean).join(" · ") || "No contact details"}
          </p>
        </div>
        {phone && (
          <Button variant="outline" size="sm" className="hidden gap-2 rounded-full sm:flex" asChild>
            <a href={`tel:${phone}`}><PhoneCall className="h-3.5 w-3.5" />Call</a>
          </Button>
        )}
      </header>

      {/* ── history ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                <div className="h-12 w-2/3 max-w-sm animate-pulse rounded-2xl bg-muted" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MessageCircle className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">No messages yet</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Say hello to {name.split(" ")[0]}. Pick a channel below — they will get it wherever
              they are.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {hasMore && (
              <div className="mb-4 flex justify-center">
                <Button variant="ghost" size="sm" className="rounded-full" onClick={loadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load earlier messages"}
                </Button>
              </div>
            )}
            {rows.map(({ message, newDay, isFirstInGroup, isLastInGroup }) => (
              <div key={message.id}>
                {newDay && <DateSeparator date={message.created_at} />}
                <ChatMessageBubble
                  message={message}
                  isOwnMessage={message.sender_type === "tenant"}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  customerName={name}
                  customerAvatar={channel.customer?.profile_photo_url || undefined}
                />
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ── composer ───────────────────────────────────────────────────── */}
      <div className="border-t border-border/50 px-6 py-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <ChannelSwitcher mode={mode} setMode={setMode} disabled={disabled} />

          {disabled[mode] ? (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700">
              {disabled[mode]}. Add one on the customer record to use this channel.
            </p>
          ) : mode === "call" ? (
            /* A call is not a message. It gets an action and a record of one,
               rather than a text box that would send the word "call". */
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-muted/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-medium">Call {name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{phone}</p>
              </div>
              <Button asChild className="gap-2 rounded-full">
                <a href={`tel:${phone}`}><PhoneCall className="h-4 w-4" />Start call</a>
              </Button>
            </div>
          ) : mode === "email" ? (
            /* Email gets a real composer. A subject squeezed into a chat input
               is how subject-less email gets sent. */
            <div className="space-y-3 rounded-2xl bg-muted/40 p-4">
              <div className="flex items-center gap-3 text-[13px]">
                <span className="w-16 shrink-0 text-muted-foreground">To</span>
                <span className="truncate font-medium">{email}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[13px] text-muted-foreground">Subject</span>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What is this about?"
                  className="h-10 rounded-full"
                />
              </div>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Write to ${name.split(" ")[0]}…`}
                className="min-h-[160px] resize-y rounded-2xl"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <AttachmentRow
                    files={files}
                    onAdd={(f) => setFiles((p) => [...p, ...f])}
                    onRemove={(i) => setFiles((p) => p.filter((_, x) => x !== i))}
                  />
                  <BookingPicker customerId={customerId} onSelect={setBooking} />
                </div>
                <Button onClick={handleSend} disabled={sending} className="gap-2 rounded-full">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send email
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <AttachmentRow
                files={files}
                onAdd={(f) => setFiles((p) => [...p, ...f])}
                onRemove={(i) => setFiles((p) => p.filter((_, x) => x !== i))}
              />
              <BookingPicker customerId={customerId} onSelect={setBooking} />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                }}
                placeholder={mode === "sms" ? `Text ${name.split(" ")[0]}…` : `Message ${name.split(" ")[0]}…`}
                className="max-h-40 min-h-[44px] flex-1 resize-none rounded-3xl py-3"
              />
              <Button
                onClick={handleSend}
                disabled={sending || (!body.trim() && !booking)}
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {booking && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
                {booking.rentalNumber || "Rental"} · {booking.vehicle.make} {booking.vehicle.model}
              </span>
              <button type="button" onClick={() => setBooking(null)} className="hover:text-foreground">
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
