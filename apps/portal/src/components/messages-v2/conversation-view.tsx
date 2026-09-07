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
 * `metadata.booking`. The rental selector reuses BookingPicker's DATA — the
 * same `useCustomerRentals` query and the same `BookingReference` shape — so
 * what this produces is byte-identical to what the bubble already renders, but
 * draws its own list: see attach-menu.tsx. BookingPicker itself is untouched
 * and still serves CustomerChatInput.
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
 * The composer has ONE attachment control. It briefly had two paperclips an
 * inch apart — this file's own file button and BookingPicker's, which draws a
 * paperclip of its own — doing different things with no way to tell which was
 * which. See attach-menu.tsx.
 *
 * WhatsApp is deliberately absent. It was never in this surface —
 * `MessageChannel` is `in_app | sms | email | voice` — so there was nothing to
 * remove here. The WhatsApp settings elsewhere belong to lockbox notifications
 * and are a different feature.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { format, isSameDay } from "date-fns";
import {
  ArrowLeft, Car, Mail, MessageCircle, MessageSquare, Phone,
  PhoneCall, Send, Loader2, Info, Paperclip, X, AlertTriangle, ChevronDown,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { useToast } from "@/hooks/use-toast";
import { useChatMessages } from "@/hooks/use-chat-messages";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import { DateSeparator, VoiceCallBar } from "@/components/chat";
import { TimelineItem } from "@/components/messages-v2/timeline-item";
import { mockMessages } from "@/components/messages-v2/mock-conversation";
import { readMessagesScenario, subscribeDevOverrides } from "@/lib/dev-overrides";
import { useVoiceCall } from "@/hooks/use-voice-call";
import type { BookingReference } from "@/components/chat/BookingPicker";
import { AttachMenu } from "@/components/messages-v2/attach-menu";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import { useChatAttachments } from "@/components/messages-v2/use-chat-attachments";
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

/* ── the pending attachments, above the composer ──────────────────────────
   One row for both kinds, because to the person sending they are one idea:
   things riding along with this message. The booking chip carries the rental
   number and car; a file chip carries its name. Files really upload now — to
   the private, tenant-scoped `chat-attachments` bucket — so the chip no longer
   carries the "not sent yet" caveat it needed while this was mocked. */
function PendingRow({
  files, booking, onRemoveFile, onRemoveBooking,
}: {
  files: File[];
  booking: BookingReference | null;
  onRemoveFile: (i: number) => void;
  onRemoveBooking: () => void;
}) {
  if (!files.length && !booking) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {booking && (
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-[12px] font-medium text-primary">
          <Car className="h-3.5 w-3.5" />
          {booking.rentalNumber || "Rental"} · {booking.vehicle.make} {booking.vehicle.model}
          <button type="button" onClick={onRemoveBooking} aria-label="Remove booking"
            className="rounded-full p-0.5 hover:bg-primary/15">
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`}
          className="inline-flex items-center gap-2 rounded-full bg-muted py-1 pl-2.5 pr-1.5 text-[12px] text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">{f.name}</span>
          <button type="button" onClick={() => onRemoveFile(i)} aria-label={`Remove ${f.name}`}
            className="rounded-full p-0.5 hover:bg-foreground/10">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

    </div>
  );
}

export function ConversationView({ channel }: { channel: ChatChannel }) {
  const customerId = channel.customer_id;
  const name = channel.customer?.name || "Customer";
  const email = channel.customer?.email || null;
  const phone = channel.customer?.phone || null;

  const { messages: realMessages, isLoading: realLoading, loadMore, hasMore, isLoadingMore } =
    useChatMessages(channel.id, customerId);

  /* ── THE REVIEW PREVIEW ────────────────────────────────────────────────────
     A developer-only, per-browser override for judging the timeline without
     writing rows anybody would have to clean up. It swaps the DATA and nothing
     else: every item still renders through TimelineItem, which keys on the
     same channel and metadata a real message carries. Reads "off" in any
     production build — `readMessagesScenario` returns "off" outside
     development regardless of what is in localStorage. */
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readMessagesScenario(),
    () => "off" as const,
  );
  const previewing = scenario !== "off";
  const messages = previewing ? mockMessages(scenario) : realMessages;
  const isLoading = previewing ? false : realLoading;
  const { sendMessage, markRead, joinRoom, onNewMessage } = useSocket();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>(channel.last_channel || "in_app");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [booking, setBooking] = useState<BookingReference | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  /* Set just before loadMore so the scroll effect can tell "older messages
     arrived above me" from "a new message arrived below me" — the two grow the
     same array and want opposite behaviour. */
  const restoreRef = useRef<number | null>(null);

  /* The real call integration, the same one ChatWindow drives: a Twilio Voice
     device in the browser with status, duration, mute and hold. Call mode does
     NOT send a message — it places a call. */
  const voiceCall = useVoiceCall();
  const { upload, uploading, progress } = useChatAttachments();

  /* Join and clear unread on open — the same two calls the old window made. */
  useEffect(() => {
    if (!customerId) return;
    void joinRoom(customerId);
    void markRead(customerId);
  }, [customerId, joinRoom, markRead]);

  /* AND AGAIN WHEN ONE ARRIVES WHILE YOU ARE LOOKING AT IT. Marking read only
     on mount leaves a conversation you are actively reading counting up in the
     dock badge, and the operator is then told to go and read something already
     on their screen. Only for THIS customer, and only for messages from them:
     marking our own sends read would be meaningless. */
  useEffect(() => {
    const unsub = onNewMessage((payload) => {
      if (payload.senderType !== "customer") return;
      if (payload.channelId !== channel.id) return;
      void markRead(customerId);
    });
    return unsub;
  }, [onNewMessage, markRead, customerId, channel.id]);

  /* ── SCROLLING, AND THE TWO THINGS IT MUST NOT DO ────────────────────────
     It must not yank you to the bottom while you are reading history, and it
     must not leave you stranded when you load older messages. Both come from
     the same array getting longer, so intent is recorded before the change
     rather than guessed after it. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreRef.current !== null) {
      // Older messages were prepended: keep the same message under the cursor
      // by restoring the distance from the BOTTOM, which is invariant.
      el.scrollTop = el.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      return;
    }
    // A new message: follow it only if they were already at the bottom.
    if (atBottom) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  function handleLoadMore() {
    const el = scrollRef.current;
    restoreRef.current = el ? el.scrollHeight - el.scrollTop : null;
    loadMore();
  }

  const disabled: Partial<Record<Mode, string>> = useMemo(
    () => ({
      ...(phone ? {} : { sms: "This customer has no phone number", call: "This customer has no phone number" }),
      ...(email ? {} : { email: "This customer has no email address" }),
    }),
    [phone, email],
  );

  async function handleSend() {
    const text = body.trim();
    if (disabled[mode] || mode === "call") return;
    /* An email needs both. The backend will happily send an empty body under a
       subject, and that is not a thing anybody meant to do. */
    if (mode === "email") {
      if (!subject.trim()) {
        toast({ title: "Subject required", description: "An email needs a subject line.", variant: "destructive" });
        return;
      }
      if (!text) {
        toast({ title: "Nothing to send", description: "Write something in the body first.", variant: "destructive" });
        return;
      }
    }
    if (!text && !booking) return;

    setSending(true);
    setSendError(null);
    const metadata: Record<string, unknown> = {};
    if (booking) { metadata.type = "booking_reference"; metadata.booking = booking; }
    if (mode === "email") metadata.subject = subject.trim();

    /* Upload BEFORE sending, and abandon the send if it fails. A message that
       arrives naming three files and carrying two is worse than one that did
       not send: nobody can tell which is missing. */
    if (files.length) {
      const up = await upload(channel.id, files);
      if (!up.ok) {
        setSending(false);
        setSendError(up.error ?? "The files could not be uploaded.");
        return;
      }
      if (up.attachments?.length) metadata.attachments = up.attachments;
    }

    const content = text || "Shared a booking";
    /* Held, not discarded. The composer clears optimistically so it feels
       immediate, but a failed send has to be able to give the text back —
       retyping a paragraph because the network blinked is unforgivable. */
    const held = { body, subject, booking, files };
    setBody(""); setSubject(""); setBooking(null); setFiles([]);

    try {
      const result = await sendMessage(
        customerId,
        content,
        Object.keys(metadata).length ? metadata : undefined,
        mode as MessageChannel,
      );
      if (result && result.ok === false) {
        setBody(held.body); setSubject(held.subject);
        setBooking(held.booking); setFiles(held.files);
        setSendError(result.error ?? "The message could not be sent.");
      } else if (mode === "email") {
        toast({ title: "Email sent", description: `Sent to ${email}.` });
      }
    } catch {
      setBody(held.body); setSubject(held.subject);
      setBooking(held.booking); setFiles(held.files);
      setSendError("The message could not be sent. Try again.");
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
    /* NO HEIGHT OF ITS OWN. The workspace layout owns the box; this fills it.
       Two components each claiming `h-[calc(100vh-4rem)]` is precisely how the
       nested scrollbars appeared — the inner one could not shrink, so it
       overflowed the outer one, and both drew a track. */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

      {/* ── the live call ──────────────────────────────────────────────────
          Between the header and the history, exactly where ChatWindow puts it,
          and only while a call exists. It owns mute, hold, accept, reject and
          hangup — which is the reason Call mode drives useVoiceCall instead of
          a tel: link that would hand all of that to the operating system. */}
      {voiceCall.status !== "idle" && (
        <VoiceCallBar
          status={voiceCall.status}
          duration={voiceCall.duration}
          isMuted={voiceCall.isMuted}
          isOnHold={voiceCall.isOnHold}
          callerNumber={voiceCall.callerNumber}
          callerName={voiceCall.incomingCall ? undefined : name}
          incomingCall={voiceCall.incomingCall ? { from: voiceCall.incomingCall.from } : null}
          onEndCall={voiceCall.endCall}
          onToggleMute={voiceCall.toggleMute}
          onToggleHold={voiceCall.toggleHold}
          onAcceptCall={voiceCall.acceptCall}
          onRejectCall={voiceCall.rejectCall}
        />
      )}

      {/* ── history ────────────────────────────────────────────────────── */}
      {/* The ONLY scroll region in this column — the header above and the
          composer below are siblings, so they hold their place without
          `sticky` and without a second scroll container between them. */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={`relative min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10 ${NO_SCROLLBAR}`}
      >
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
          <div className="mx-auto w-full max-w-5xl">
            {hasMore && !previewing && (
              <div className="mb-4 flex justify-center">
                <Button variant="ghost" size="sm" className="rounded-full" onClick={handleLoadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load earlier messages"}
                </Button>
              </div>
            )}
            {rows.map(({ message, newDay, isFirstInGroup, isLastInGroup }) => (
              <div key={message.id}>
                {newDay && <DateSeparator date={message.created_at} />}
                <TimelineItem
                  message={message}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  customerName={name}
                  customerAvatar={channel.customer?.profile_photo_url || undefined}
                  customerEmail={email}
                />
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ── composer ───────────────────────────────────────────────────── */}
      <div className="border-t border-border/50 px-6 py-4 lg:px-10">
        {/* `max-w-5xl` here is the SAME cap the history uses, which is what
            makes the column width independent of the composer mode: Email
            swaps a one-line box for a subject + body and grows DOWNWARDS, and
            the thread above never moves a pixel sideways. */}
        <div className="mx-auto w-full max-w-5xl space-y-3">
          <ChannelSwitcher mode={mode} setMode={setMode} disabled={disabled} />

          {disabled[mode] ? (
            <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700">
              {disabled[mode]}. Add one on the customer record to use this channel.
            </p>
          ) : mode === "call" ? (
            /* A call is not a message, so this is an action rather than a text
               box. It drives the SAME integration ChatWindow uses —
               useVoiceCall, a Twilio Voice device in the browser — not a tel:
               link, which would hand the call to the operating system and lose
               the status, duration and hangup this UI can show. */
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-muted/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">Call {name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {voiceCall.status === "idle"
                    ? phone
                    : voiceCall.status === "connecting"
                      ? "Connecting…"
                      : `In call · ${phone}`}
                </p>
              </div>
              <Button
                className="gap-2 rounded-full"
                disabled={voiceCall.status !== "idle"}
                onClick={() => {
                  if (!phone) return;
                  if (voiceCall.status !== "idle") {
                    toast({ title: "Call in progress", description: "End the current call first." });
                    return;
                  }
                  voiceCall.makeCall(phone);
                }}
              >
                {voiceCall.status === "connecting"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <PhoneCall className="h-4 w-4" />}
                {voiceCall.status === "idle" ? "Start call" : "On a call"}
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
                className={`min-h-[160px] resize-y rounded-2xl ${NO_SCROLLBAR}`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AttachMenu
                  customerId={customerId}
                  onFiles={(f) => setFiles((p) => [...p, ...f])}
                  onBooking={setBooking}
                />
                <Button onClick={handleSend} disabled={sending} className="gap-2 rounded-full">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {uploading
                    ? `Uploading ${progress.done + 1} of ${progress.total}…`
                    : sending
                      ? "Sending…"
                      : "Send email"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <AttachMenu
                customerId={customerId}
                onFiles={(f) => setFiles((p) => [...p, ...f])}
                onBooking={setBooking}
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                }}
                placeholder={mode === "sms" ? `Text ${name.split(" ")[0]}…` : `Message ${name.split(" ")[0]}…`}
                className={`max-h-40 min-h-[44px] flex-1 resize-none rounded-3xl py-3 ${NO_SCROLLBAR}`}
              />
              <Button
                onClick={handleSend}
                title={uploading ? `Uploading ${progress.done + 1} of ${progress.total}` : undefined}
                disabled={sending || (!body.trim() && !booking && !files.length)}
                size="icon"
                className="h-11 w-11 shrink-0 rounded-full"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}

          {sendError && (
            /* Tinted, specific, and dismissible — and the composer still holds
               what you wrote, so "try again" means pressing send again. */
            <div className="flex items-start gap-2.5 rounded-2xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1 leading-relaxed">{sendError}</p>
              <button type="button" onClick={() => setSendError(null)} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <PendingRow
            files={files}
            booking={booking}
            onRemoveFile={(i) => setFiles((p) => p.filter((_, x) => x !== i))}
            onRemoveBooking={() => setBooking(null)}
          />
        </div>
      </div>
    </div>
  );
}
