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
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import {
  ArrowLeft, Car, Mail, MessageCircle, MessageSquare, Phone,
  PhoneCall, Send, Loader2, Info, Paperclip, X, AlertTriangle, ChevronDown, Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { useToast } from "@/hooks/use-toast";
import { useChatMessages, type ChatMessage } from "@/hooks/use-chat-messages";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import { VoiceCallBar } from "@/components/chat";
import { TimelineItem } from "@/components/messages-v2/timeline-item";
import { mockMessages } from "@/components/messages-v2/mock-conversation";
import { readMessagesScenario, subscribeDevOverrides } from "@/lib/dev-overrides";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { useTwilioVoice } from "@/hooks/use-twilio-voice";
import { PhoneCallPreview } from "@/components/messages-v2/phone-call-preview";
import { CallRecordCard, useCallRecords } from "@/components/messages-v2/call-record";
import { useV2 } from "@/lib/v2-context";
import { useContactOverride } from "@/components/messages-v2/contact-override";
import { supabase } from "@/integrations/supabase/client";
import type { BookingReference } from "@/components/chat/BookingPicker";
import { AttachMenu } from "@/components/messages-v2/attach-menu";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import { useChatAttachments } from "@/components/messages-v2/use-chat-attachments";
import type { SuggestInput } from "@/components/messages-v2/trax-reply-suggestions";
import { STYLE_LABEL, useTraxReplies } from "@/components/messages-v2/use-trax-replies";
import { useBulkSelect } from "@/components/messages-v2/bulk-select";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { TraxGhostText, TraxGutterMark, useTraxGhost } from "@/components/messages-v2/trax-ghost-reply";
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

/**
 * The composer surface. The one deliberately DEFINED thing in this workspace:
 * everything else is flat and borderless, so the box gets a clear indigo rim
 * (a touch heavier along the bottom, for thickness) plus a layered 3D lift — a
 * lift alone blended into the page's light gradient. The
 * rim strengthens while you are typing in it. (Dark: a plain-slash rim on
 * `--v2-link`, since v2 dark `--border` already carries an alpha.)
 */
const COMPOSER =
  "rounded-3xl border border-primary/30 border-b-primary/45 bg-card " +
  "dark:border-[hsl(var(--v2-link,var(--primary))_/_0.35)] " +
  "focus-within:border-primary/55 dark:focus-within:border-[hsl(var(--v2-link,var(--primary))_/_0.6)] " +
  /* Depth, in layers: a white inner highlight along the top edge (the lit
     face), a tight contact shadow, and two wider indigo shadows falling below
     — together they read as a slab sitting ON the page, not printed on it. */
  "shadow-[inset_0_1px_0_hsl(0_0%_100%/0.9),0_1px_2px_hsl(var(--foreground)/0.08),0_4px_8px_-2px_hsl(var(--primary)/0.14),0_16px_32px_-12px_hsl(var(--primary)/0.38),0_28px_56px_-28px_hsl(var(--primary)/0.3)] " +
  "dark:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),0_1px_2px_hsl(0_0%_0%/0.4),0_16px_32px_-12px_hsl(0_0%_0%/0.6)] " +
  "transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none";

/** A field that is part of the composer surface, not a box inside it. */
const BARE_FIELD =
  "rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

/**
 * The day label between messages — a quiet word, no rules either side. The
 * shared `DateSeparator` (still used by v1's ChatWindow) draws a hairline to
 * each edge; in this borderless workspace the label alone is the divider.
 */
function DayLabel({ date }: { date: string }) {
  const d = new Date(date);
  const label = Number.isNaN(d.getTime())
    ? ""
    : isToday(d)
      ? "Today"
      : isYesterday(d)
        ? "Yesterday"
        : format(d, "MMMM d, yyyy");
  if (!label) return null;
  return (
    <div className="my-6 flex justify-center">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function ChannelSwitcher({
  mode, setMode, disabled,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  disabled: Partial<Record<Mode, string>>;
}) {
  return (
    /* Sits INSIDE the composer's bottom row now, on its white surface — so no
       grey track, and the active channel takes the sidebar's active tint
       rather than a white chip that would vanish against white. */
    <div className="flex min-w-0 flex-wrap items-center gap-0.5">
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
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none ${
              active
                ? "bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]"
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
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-[12px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
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
            className="rounded-full p-0.5 hover:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))]">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

    </div>
  );
}

/** Placeholder history for the thread's skeleton: one day, turns alternating. */
const SKELETON_MESSAGES: ChatMessage[] = skeletonRows(6, (f, i) => ({
  id: -(i + 1),
  channel_id: "skeleton",
  sender_type: i % 3 === 1 ? ("customer" as const) : ("tenant" as const),
  sender_id: "skeleton",
  content: f.text(4, 16),
  is_read: true,
  read_at: null,
  metadata: {},
  created_at: f.date(1),
  channel: "in_app" as const,
  external_id: null,
  external_status: null,
  from_number: null,
}));

export function ConversationView({ channel }: { channel: ChatChannel }) {
  const customerId = channel.customer_id;
  const name = channel.customer?.name || "Customer";
  /* The contact IN USE for this conversation: a one-off override set in the
     right rail (this chat only — the customer record is never changed), else
     what is on file. Everything below — the email "To", the call, the
     disabled-channel checks — reads these. */
  const { override: contactOverride } = useContactOverride(channel.id);
  const email = contactOverride.email || channel.customer?.email || null;
  const phone = contactOverride.phone || channel.customer?.phone || null;

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
  const isLoading = useSkeletonLoading(previewing ? false : realLoading);
  // While the history loads, placeholder messages render through the real
  // timeline and <AutoSkeleton> draws the bones over them.
  const messages = previewing ? mockMessages(scenario) : isLoading ? SKELETON_MESSAGES : realMessages;
  const { sendMessage, markRead, joinRoom, onNewMessage } = useSocket();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>(contactOverride.channel || channel.last_channel || "in_app");
  /* A "usual channel" chosen for this chat in the right rail's edit dialog
     switches the composer to it straight away. */
  useEffect(() => {
    if (contactOverride.channel) setMode(contactOverride.channel);
  }, [contactOverride.channel]);
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
  /* No Twilio Voice on this tenant (northwind has none): Start call opens the
     iPhone call preview instead of failing with "Voice is not enabled", so the
     flow can be shown end to end. A tenant with voice set up never sees it. */
  const { status: voiceSetup } = useTwilioVoice();
  const voiceLive = !!voiceSetup?.isEnabled;
  /* The preview is a demo surface, so it is v2-only: a real tenant without
     voice must never be shown a call that did not happen. */
  const previewCalls = useV2("chrome") && !voiceLive;
  const [phonePreview, setPhonePreview] = useState(false);
  const callRecords = useCallRecords(channel.id);
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

  /* Trax's suggested reply, typed as ghost text into the EMPTY chat box. It
     reads the real thread (or the preview's), and steps aside the moment the
     operator types, sends, or switches to email or call. Tab takes the whole
     suggestion, even half-typed. */
  const chatMode = mode === "in_app" || mode === "sms";
  const lastMessage = isLoading ? null : messages[messages.length - 1] ?? null;
  const { replies } = useTraxReplies({
    channelId: channel.id,
    lastMessageId: lastMessage?.id ?? null,
    mode: mode === "sms" ? "sms" : "in_app",
    enabled: chatMode && !isLoading,
    fallback: {
      messages: messages as SuggestInput["messages"],
      customerFirstName: name.split(" ")[0],
      mode: mode === "sms" ? "sms" : "in_app",
    },
  });
  const suggestions = useMemo(() => replies.map((r) => r.text), [replies]);
  const ghostOn = chatMode && !disabled[mode] && !sending && body === "" && suggestions.length > 0;
  const ghost = useTraxGhost(suggestions, ghostOn);

  /* Bulk, in place: the text written here goes to whoever the operator ticks
     in the rail. Text only — files and booking cards stay with the one
     conversation they were attached in. */
  const bulk = useBulkSelect();
  const { canEdit } = useManagerPermissions();
  const canBulk = !!bulk && chatMode && !disabled[mode] && canEdit("messages");
  const ghostStyle = replies.find((r) => r.text === ghost.current)?.style;

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

    /* An override on the channel being sent: the v1 senders only deliver to
       the details on file, so this one send goes through the v2 function with
       the destination in hand. In-app is unaffected — it has no address. */
    const overrideTo =
      mode === "sms" ? contactOverride.phone : mode === "email" ? contactOverride.email : undefined;
    if (overrideTo) {
      try {
        const { data, error } = await supabase.functions.invoke("send-conversation-message-v2", {
          body: {
            channelId: channel.id,
            channel: mode,
            content,
            to: overrideTo,
            subject: mode === "email" ? held.subject.trim() : undefined,
            metadata: Object.keys(metadata).length ? metadata : undefined,
          },
        });
        if (error || data?.success === false) throw new Error(data?.error || error?.message);
        if (mode === "email") toast({ title: "Email sent", description: `Sent to ${overrideTo}.` });
      } catch (e) {
        setBody(held.body); setSubject(held.subject);
        setBooking(held.booking); setFiles(held.files);
        setSendError(
          `The ${mode === "sms" ? "text" : "email"} to ${overrideTo} could not be sent.` +
            (e instanceof Error && e.message ? ` ${e.message}` : ""),
        );
      } finally {
        setSending(false);
      }
      return;
    }

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
    <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
      {/* A faint line grid behind the conversation, so the middle column has a
          surface rather than reading as empty page. Its own layer under
          everything (`isolate` + `-z-10` keeps it beneath the history and the
          composer without touching their stacking), fixed while the history
          scrolls over it, and faded out toward the edges by a radial mask so
          it never meets a column edge as a hard line. Dark uses the v2 link
          tint, since `--primary` at 7% vanishes on the dark surface. */}
      <div
        aria-hidden
        className={
          "pointer-events-none absolute inset-0 -z-10 bg-[size:32px_32px] " +
          "bg-[linear-gradient(to_right,hsl(var(--primary)/0.07)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--primary)/0.07)_1px,transparent_1px)] " +
          "dark:bg-[linear-gradient(to_right,hsl(var(--v2-link,var(--primary))/0.06)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--v2-link,var(--primary))/0.06)_1px,transparent_1px)] " +
          "[mask-image:radial-gradient(ellipse_75%_70%_at_50%_45%,black_35%,transparent_100%)]"
        }
      />
      {/* ── header ─────────────────────────────────────────────────────── */}
      {/* `shrink-0`: the history between these two is the only thing that gives
          way. Without it a flex column will compress the header and composer
          before it shrinks the scroll region.
          `xl:hidden`: from xl up the customer rail sits beside the thread and
          already carries the avatar, name, email and phone, and calling is the
          composer's Call channel, so this header only repeated both. Below xl
          that rail is hidden, so the header stays — it is then the only place
          the identity and the mobile Back control live. */}
      <header className="flex shrink-0 items-center gap-4 px-6 py-4 xl:hidden">
        {/* The sidebar becomes a Back rail on this route, but a Back control
            has to exist inside the view too: the rail collapses to an icon on
            narrow screens and disappears entirely on mobile. */}
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full lg:hidden">
          <a href="/messages" aria-label="Back to messages"><ArrowLeft className="h-4 w-4" /></a>
        </Button>
        <Avatar className="h-11 w-11">
          <AvatarImage src={channel.customer?.profile_photo_url || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[13px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
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
        className={`relative min-h-0 flex-1 overflow-y-auto no-scrollbar px-6 pb-8 pt-4 lg:px-10 ${NO_SCROLLBAR}`}
      >
        {!isLoading && messages.length === 0 && callRecords.records.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <MessageCircle className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">No messages yet</h3>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Say hello to {name.split(" ")[0]}. Pick a channel below — they will get it wherever
              they are.
            </p>
          </div>
        ) : (
          <AutoSkeleton loading={isLoading} className="mx-auto w-full max-w-5xl">
            {hasMore && !previewing && !isLoading && (
              <div className="mb-4 flex justify-center">
                <Button variant="ghost" size="sm" className="rounded-full" onClick={handleLoadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load earlier messages"}
                </Button>
              </div>
            )}
            {/* The history starts at the top. The first day divider drops the
                day label's `my-6` top margin — together with the old `py-8` it
                left ~56px of nothing above the first message. */}
            {rows.map(({ message, newDay, isFirstInGroup, isLastInGroup }, i) => (
              <div key={message.id} className={i === 0 ? "[&>div:first-child]:mt-0" : undefined}>
                {newDay && <DayLabel date={message.created_at} />}
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
            {/* Calls made from the preview phone, newest last — they happened
                after everything above. */}
            {callRecords.records.map((r) => (
              <CallRecordCard key={r.id} record={r} customerName={name} />
            ))}
            <div ref={endRef} />
          </AutoSkeleton>
        )}
      </div>

      {/* ── composer ───────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 py-4 lg:px-10">
        {/* `max-w-5xl` here is the SAME cap the history uses, which is what
            makes the column width independent of the composer mode: Email
            swaps a one-line box for a subject + body and grows DOWNWARDS, and
            the thread above never moves a pixel sideways. */}
        <div className="mx-auto w-full max-w-5xl space-y-3">
          {/* ONE raised surface: what you write on top, how it is sent along
              its bottom edge — the channel, attachments and the send action
              live inside the box rather than as a separate strip above it. */}
          <div className={COMPOSER}>
            {disabled[mode] ? (
              <p className="mx-3 mt-3 rounded-2xl bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-300">
                {disabled[mode]}. Add one on the customer record to use this channel.
              </p>
            ) : mode === "call" ? (
              /* A call is not a message, so this is an action rather than a
                 text box. It drives the SAME integration ChatWindow uses —
                 useVoiceCall, a Twilio Voice device in the browser — not a tel:
                 link, which would hand the call to the operating system and
                 lose the status, duration and hangup this UI can show. */
              <div className="px-5 pb-2 pt-4">
                <p className="text-[14px] font-medium">Call {name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {voiceCall.status === "idle"
                    ? phone
                    : voiceCall.status === "connecting"
                      ? "Connecting…"
                      : `In call · ${phone}`}
                </p>
              </div>
            ) : mode === "email" ? (
              /* Email gets a real composer. A subject squeezed into a chat
                 input is how subject-less email gets sent. */
              <div className="space-y-1 px-5 pt-4">
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="w-14 shrink-0 text-muted-foreground">To</span>
                  <span className="truncate font-medium">{email}</span>
                  {contactOverride.email && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                      This chat
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[13px] text-muted-foreground">Subject</span>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="What is this about?"
                    className={`h-9 px-0 font-medium ${BARE_FIELD}`}
                  />
                </div>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={`Write to ${name.split(" ")[0]}…`}
                  className={`min-h-[160px] resize-y px-0 text-[14px] ${BARE_FIELD} ${NO_SCROLLBAR}`}
                />
              </div>
            ) : (
              <div className="relative">
                {/* Same padding, size and leading as the textarea, so the ghost's
                    letters sit exactly where typed ones would. */}
                {/* Text starts at 50px (20 padding + the 20px mark + 10 gap) in all
                  three — ghost, caret and typed text — so nothing shifts when
                  the operator starts typing over a suggestion. */}
              <TraxGutterMark />
              {ghostOn && <TraxGhostText text={ghost.shown} done={ghost.shown === ghost.current} label={ghostStyle ? STYLE_LABEL[ghostStyle] : undefined} className="pl-[50px] pr-5 pt-4 text-[14px] leading-5" />}
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && !e.shiftKey && ghostOn && ghost.current) {
                      e.preventDefault();
                      setBody(ghost.current);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                  }}
                  /* No native placeholder while Trax is suggesting — the two
                     would sit on top of each other. */
                  placeholder={ghostOn ? "" : mode === "sms" ? `Text ${name.split(" ")[0]}…` : `Message ${name.split(" ")[0]}…`}
                  className={`max-h-48 min-h-[76px] pb-1 pl-[50px] pr-5 pt-4 text-[14px] leading-5 ${BARE_FIELD} ${NO_SCROLLBAR}`}
                />
              </div>
            )}

            {/* The bottom row: channel on the left, the mode's own actions on
                the right. */}
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1.5">
              <ChannelSwitcher mode={mode} setMode={setMode} disabled={disabled} />
              {!disabled[mode] && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {mode === "call" ? (
                    <Button
                      className="h-9 gap-2 rounded-full"
                      disabled={voiceCall.status !== "idle"}
                      onClick={() => {
                        if (!phone) return;
                        if (previewCalls) { setPhonePreview(true); return; }
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
                  ) : (
                    <>
                      {canBulk && (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={!body.trim() || sending}
                          title={body.trim() ? "Send this message to several customers" : "Write a message first"}
                          onClick={() => {
                            /* Starts with this conversation's customer ticked —
                               they are who the message was written to. */
                            bulk!.start(body.trim(), mode as "in_app" | "sms", () => setBody(""));
                            bulk!.toggle(customerId);
                          }}
                          className="h-9 gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          <Users className="h-4 w-4" />
                          Bulk
                        </Button>
                      )}
                      <AttachMenu
                        compact
                        customerId={customerId}
                        onFiles={(f) => setFiles((p) => [...p, ...f])}
                        onBooking={setBooking}
                      />
                      {mode === "email" ? (
                        <Button onClick={handleSend} disabled={sending} className="h-9 gap-2 rounded-full">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          {uploading
                            ? `Uploading ${progress.done + 1} of ${progress.total}…`
                            : sending
                              ? "Sending…"
                              : "Send email"}
                        </Button>
                      ) : (
                        <Button
                          onClick={handleSend}
                          aria-label="Send"
                          title={uploading ? `Uploading ${progress.done + 1} of ${progress.total}` : "Send"}
                          disabled={sending || (!body.trim() && !booking && !files.length)}
                          size="icon"
                          className="h-9 w-9 shrink-0 rounded-full"
                        >
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

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

      <PhoneCallPreview
        open={phonePreview}
        onOpenChange={setPhonePreview}
        name={name}
        phone={phone ?? ""}
        avatarUrl={channel.customer?.profile_photo_url}
        onEnded={() => {
          /* The record is scripted from what the customer has been writing
             about, so the demo call reads as THIS conversation's call. */
          const context = messages
            .filter((m) => m.sender_type === "customer")
            .slice(-4)
            .map((m) => m.content)
            .join(" ");
          callRecords.add(context);
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
        }}
      />
    </div>
  );
}
