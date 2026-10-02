"use client";

/**
 * Messages — the second tab of the right rail. The Messages workspace, at 360px.
 *
 * Rebuilt Oct 2 2026 to carry what `/messages` carries, not a teaser of it:
 * the same thread, the same four channels (In-App, SMS, Email, Call), calls
 * placed from here with the live call bar, the call record that lands after a
 * call (recording, Trax summary, checkpoints, action items, transcript), Trax's
 * suggested reply typed as ghost text into the empty box (Tab takes it), files
 * and booking cards through the one attach menu, and the per-chat contact
 * override. An operator should never have to leave the rental to talk to the
 * person renting it.
 *
 * ── reused, never forked ────────────────────────────────────────────────────
 *
 * Every piece below is the workspace's own: `TimelineItem` (and through it
 * `ChatMessageBubble`), `CallRecordCard` + `useCallRecords`, `VoiceCallBar` +
 * `useVoiceCall`, `PhoneCallPreview`, `AttachMenu`, `useChatAttachments`,
 * `useTraxReplies` + the ghost-reply parts, `useContactOverride`, and the same
 * send path (`useSocket().sendMessage`, or `send-conversation-message-v2` when
 * this chat has an override). `messages-v2/conversation-view.tsx` is NOT
 * edited: it serves every tenant's /messages and is the workspace's file. What
 * is written here is only the SHELL — a compact header, a narrow thread and a
 * composer whose channel row folds to icons — plus the send/call logic that
 * conversation-view keeps inside its component and does not export.
 *
 * ── the channel ─────────────────────────────────────────────────────────────
 *
 * One `chat_channels` row, not `useChatChannels()` (which reads the tenant's
 * whole list and two more queries per row). RLS is off on `chat_channels`
 * (V2_PLAN §5), so the `tenant_id` filter is the only thing scoping it. A null
 * row is not an error — nobody has messaged this customer yet, and
 * `sendMessage` creates the channel on the first send.
 *
 * Opening this tab joins the customer's realtime room and marks their messages
 * read, which is why the rail mounts it only while it is the open tab.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, isSameDay, isToday, isYesterday } from "date-fns";
import {
  AlertTriangle, Car, ExternalLink, Loader2, Mail, MessageCircle, MessageSquare,
  Paperclip, PhoneCall, Send, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui-v2/avatar";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Textarea } from "@/components/ui-v2/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useChatMessages, type ChatMessage } from "@/hooks/use-chat-messages";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import { VoiceCallBar } from "@/components/chat";
import { useVoiceCall } from "@/hooks/use-voice-call";
import { useTwilioVoice } from "@/hooks/use-twilio-voice";
import { useV2 } from "@/lib/v2-context";
import type { BookingReference } from "@/components/chat/BookingPicker";
import { TimelineItem } from "@/components/messages-v2/timeline-item";
import { PhoneCallPreview } from "@/components/messages-v2/phone-call-preview";
import { CallRecordCard, useCallRecords } from "@/components/messages-v2/call-record";
import { AttachMenu } from "@/components/messages-v2/attach-menu";
import { useChatAttachments } from "@/components/messages-v2/use-chat-attachments";
import { useContactOverride } from "@/components/messages-v2/contact-override";
import type { SuggestInput } from "@/components/messages-v2/trax-reply-suggestions";
import { STYLE_LABEL, useTraxReplies } from "@/components/messages-v2/use-trax-replies";
import { TraxGhostText, TraxGutterMark, useTraxGhost } from "@/components/messages-v2/trax-ghost-reply";
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";
import type { RentalDetailV2 } from "./use-rental-detail-v2";

type Mode = MessageChannel | "call";

const initials = (name?: string | null) =>
  (name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

const MODES: { key: Mode; label: string; icon: typeof Mail }[] = [
  { key: "in_app", label: "In-App", icon: MessageCircle },
  { key: "sms", label: "SMS", icon: MessageSquare },
  { key: "email", label: "Email", icon: Mail },
];

/** The composer surface: the workspace's rounded white box and indigo rim,
 *  without its layered indigo glow — flat in the rail (Oct 2 2026). */
const COMPOSER =
  "rounded-3xl border border-primary/25 bg-card " +
  "dark:border-[hsl(var(--v2-link,var(--primary))_/_0.3)] " +
  "focus-within:border-primary/50 dark:focus-within:border-[hsl(var(--v2-link,var(--primary))_/_0.55)] " +
  "transition-[border-color] duration-200 ease-out motion-reduce:transition-none";

const BARE_FIELD =
  "rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

/**
 * The thread's overrides for a 330px column, scoped to this tab:
 *  - bubbles may run to 85% (ChatMessageBubble caps them at 65% from `sm`,
 *    which is a viewport breakpoint and so always true here — 215px of text);
 *  - the call record stacks its checkpoints and action items (its two-column
 *    grid is also `sm:` and would put two 140px columns side by side), sits
 *    closer to its neighbours, and pads a little less.
 */
const THREAD_FIT =
  "[&_[class*='sm:max-w-']]:!max-w-[85%] " +
  "[&_[class*='sm:grid-cols-2']]:!grid-cols-1 [&_.my-6]:!my-3 [&_.p-5]:!p-4 " +
  /* Bubble text at the rail's size (13px, not the workspace's 15px), broken
     between words rather than mid-word, in a slightly tighter bubble. The
     message paragraph is the bubble's one `.break-all` element and the bubble
     its one `.shadow-sm` (see timeline-item.tsx). */
  "[&_.break-all]:!text-[13px] [&_.break-all]:!leading-[1.45] [&_.break-all]:![word-break:normal] [&_.break-all]:![overflow-wrap:anywhere] " +
  "[&_.shadow-sm]:!px-3 [&_.shadow-sm]:!py-2";

/**
 * The call record, toned down for the rail (Oct 2 2026): the workspace card at
 * 88% scale (every size inside it is fixed px, so `zoom` is the one lever that
 * shrinks them together), on a translucent ground with no shadow and a fainter
 * rim, so it reads as part of the thread rather than a slab dropped on it.
 * Scoped to its wrapper; call-record.tsx is untouched.
 */
const CALL_FIT =
  "[zoom:0.88] [&_.rounded-3xl.bg-card]:!bg-card/60 [&_.rounded-3xl.bg-card]:!shadow-none " +
  "[&_.rounded-3xl.bg-card]:!ring-foreground/[0.06] dark:[&_.rounded-3xl.bg-card]:!ring-foreground/10";

function DayLabel({ date, first }: { date: string; first?: boolean }) {
  const d = new Date(date);
  const label = Number.isNaN(d.getTime())
    ? ""
    : isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "MMMM d, yyyy");
  if (!label) return null;
  return (
    <div className={cn("flex justify-center", first ? "mb-3" : "my-4")}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * The four channels, folded to icons. At 330px the workspace's four labelled
 * pills plus attach and send do not fit one row, so only the ACTIVE channel
 * keeps its word; the rest say theirs on hover. An unusable channel stays
 * visible and says why — "why can I not text this person" is answerable,
 * "where did SMS go" is not.
 */
function ChannelSwitcher({
  mode, setMode, disabled,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  disabled: Partial<Record<Mode, string>>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {MODES.map(({ key, label, icon: Icon }) => {
        const why = disabled[key];
        const active = mode === key;
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={!!why}
                onClick={() => setMode(key)}
                aria-label={label}
                aria-pressed={active}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-full text-[12.5px] font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none",
                  active ? "px-3" : "w-8 justify-center",
                  active
                    ? "bg-primary/10 text-primary dark:bg-[hsl(var(--v2-hover,var(--muted)))] dark:text-[hsl(var(--v2-link,var(--primary)))]"
                    : why
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {active && label}
              </button>
            </TooltipTrigger>
            {!active && <TooltipContent side="top">{why ?? label}</TooltipContent>}
          </Tooltip>
        );
      })}
    </div>
  );
}

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
    <div className="flex flex-wrap items-center gap-1.5">
      {booking && (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
          <Car className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{booking.rentalNumber || "Rental"} · {booking.vehicle.make} {booking.vehicle.model}</span>
          <button type="button" onClick={onRemoveBooking} aria-label="Remove booking" className="rounded-full p-0.5 hover:bg-primary/15">
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {files.map((f, i) => (
        <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pl-2.5 pr-1.5 text-[11.5px] text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[160px] truncate">{f.name}</span>
          <button type="button" onClick={() => onRemoveFile(i)} aria-label={`Remove ${f.name}`} className="rounded-full p-0.5 hover:bg-[hsl(var(--v2-hover,var(--foreground)_/_0.1))]">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

const SKELETON_MESSAGES: ChatMessage[] = skeletonRows(5, (f, i) => ({
  id: -(i + 1),
  channel_id: "skeleton",
  sender_type: i % 3 === 1 ? ("customer" as const) : ("tenant" as const),
  sender_id: "skeleton",
  content: f.text(4, 12),
  is_read: true,
  read_at: null,
  metadata: {},
  created_at: f.date(1),
  channel: "in_app" as const,
  external_id: null,
  external_status: null,
  from_number: null,
}));

/** The customer's channel row (if any) and photo — two tenant-scoped reads. */
function useRailConversation(customerId: string | null, tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["rail-chat-channel", tenantId, customerId],
    queryFn: async () => {
      const [channel, photo] = await Promise.all([
        supabase
          .from("chat_channels")
          .select("id, last_channel")
          .eq("tenant_id", tenantId!)
          .eq("customer_id", customerId!)
          .maybeSingle(),
        supabase
          .from("customers")
          .select("profile_photo_url")
          .eq("tenant_id", tenantId!)
          .eq("id", customerId!)
          .maybeSingle(),
      ]);
      if (channel.error) throw channel.error;
      return {
        channelId: (channel.data?.id as string | undefined) ?? null,
        lastChannel: (channel.data?.last_channel as MessageChannel | undefined) ?? null,
        photo: ((photo.data as { profile_photo_url?: string | null } | null)?.profile_photo_url) ?? null,
      };
    },
    enabled: !!customerId && !!tenantId,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The tab
   ══════════════════════════════════════════════════════════════════════════ */

export function RailMessages({ detail }: { detail: RentalDetailV2 }) {
  const customer = detail.customer;
  if (!customer?.id) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="text-[13px] font-medium text-muted-foreground">No customer on this rental</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/80">
          A conversation opens here once the rental has someone attached to it.
        </p>
      </div>
    );
  }
  return <RailConversation customer={customer} />;
}

type RailCustomer = NonNullable<RentalDetailV2["customer"]>;

function RailConversation({ customer }: { customer: RailCustomer }) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const customerId = customer.id;
  const name = customer.name || "Customer";
  const first = name.split(" ")[0];

  const { data: convo, isLoading: convoLoading } = useRailConversation(customerId, tenant?.id);
  const channelId = convo?.channelId ?? null;
  /* Keys for the per-conversation browser stores (override, call records)
     before a channel exists: the customer stands in for it. */
  const convoKey = channelId ?? `customer:${customerId}`;

  const { override: contactOverride } = useContactOverride(convoKey);
  const email = contactOverride.email || customer.email || null;
  const phone = contactOverride.phone || customer.phone || null;

  const { messages: realMessages, isLoading: realLoading, loadMore, hasMore, isLoadingMore } =
    useChatMessages(channelId, customerId);
  const isLoading = useSkeletonLoading(convoLoading || (!!channelId && realLoading));
  const messages = isLoading ? SKELETON_MESSAGES : realMessages;

  const { sendMessage, markRead, joinRoom, onNewMessage } = useSocket();

  const [mode, setMode] = useState<Mode>("in_app");
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || convoLoading) return;
    seeded.current = true;
    const start = contactOverride.channel || convo?.lastChannel;
    // Calling is the header's button here, not a composer channel.
    if (start && start !== "call" && start !== "voice") setMode(start);
  }, [convoLoading, convo?.lastChannel, contactOverride.channel]);
  useEffect(() => {
    const c = contactOverride.channel;
    if (c && c !== "call") setMode(c);
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
  const restoreRef = useRef<number | null>(null);

  const voiceCall = useVoiceCall();
  const { status: voiceSetup } = useTwilioVoice();
  const voiceLive = !!voiceSetup?.isEnabled;
  /* No Twilio Voice on this tenant: Start call opens the iPhone call preview
     instead of failing — v2 only, so a real tenant is never shown a call that
     did not happen. Same rule as the workspace. */
  const previewCalls = useV2("chrome") && !voiceLive;
  const [phonePreview, setPhonePreview] = useState(false);
  const callRecords = useCallRecords(convoKey);
  const { upload, uploading, progress } = useChatAttachments();

  useEffect(() => {
    void joinRoom(customerId);
    void markRead(customerId);
  }, [customerId, joinRoom, markRead]);

  useEffect(() => {
    const unsub = onNewMessage((payload) => {
      if (payload.senderType !== "customer") return;
      if (channelId && payload.channelId !== channelId) return;
      void markRead(customerId);
    });
    return unsub;
  }, [onNewMessage, markRead, customerId, channelId]);

  /* Follow new messages only when already at the bottom; keep the reader's
     place when older ones are prepended. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreRef.current !== null) {
      el.scrollTop = el.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      return;
    }
    if (atBottom) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, callRecords.records.length, atBottom]);

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
      ...(phone ? {} : { sms: "No phone number on file", call: "No phone number on file" }),
      ...(email ? {} : { email: "No email address on file" }),
    }),
    [phone, email],
  );

  /* Trax's suggested reply, as ghost text in the empty chat box. */
  const chatMode = mode === "in_app" || mode === "sms";
  const lastMessage = isLoading ? null : messages[messages.length - 1] ?? null;
  const { replies } = useTraxReplies({
    channelId: channelId ?? "",
    lastMessageId: lastMessage?.id ?? null,
    mode: mode === "sms" ? "sms" : "in_app",
    enabled: chatMode && !isLoading,
    fallback: {
      messages: messages as SuggestInput["messages"],
      customerFirstName: first,
      mode: mode === "sms" ? "sms" : "in_app",
    },
  });
  const suggestions = useMemo(() => replies.map((r) => r.text), [replies]);
  const ghostOn = chatMode && !disabled[mode] && !sending && body === "" && suggestions.length > 0;
  const ghost = useTraxGhost(suggestions, ghostOn);
  const ghostStyle = replies.find((r) => r.text === ghost.current)?.style;

  function startCall() {
    if (!phone) return;
    if (previewCalls) { setPhonePreview(true); return; }
    if (voiceCall.status !== "idle") {
      toast({ title: "Call in progress", description: "End the current call first." });
      return;
    }
    voiceCall.makeCall(phone);
  }

  async function handleSend() {
    const text = body.trim();
    if (disabled[mode] || mode === "call") return;
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
    if (!text && !booking && !files.length) return;

    setSending(true);
    setSendError(null);
    const metadata: Record<string, unknown> = {};
    if (booking) { metadata.type = "booking_reference"; metadata.booking = booking; }
    if (mode === "email") metadata.subject = subject.trim();

    if (files.length) {
      if (!channelId) {
        setSending(false);
        setSendError("Send a first message before attaching files — the conversation does not exist yet.");
        return;
      }
      const up = await upload(channelId, files);
      if (!up.ok) {
        setSending(false);
        setSendError(up.error ?? "The files could not be uploaded.");
        return;
      }
      if (up.attachments?.length) metadata.attachments = up.attachments;
    }

    const content = text || (booking ? "Shared a booking" : "Shared a file");
    const held = { body, subject, booking, files };
    const restore = () => {
      setBody(held.body); setSubject(held.subject);
      setBooking(held.booking); setFiles(held.files);
    };
    setBody(""); setSubject(""); setBooking(null); setFiles([]);

    const overrideTo =
      mode === "sms" ? contactOverride.phone : mode === "email" ? contactOverride.email : undefined;
    if (overrideTo && channelId) {
      try {
        const { data, error } = await supabase.functions.invoke("send-conversation-message-v2", {
          body: {
            channelId,
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
        restore();
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
        restore();
        setSendError(result.error ?? "The message could not be sent.");
      } else if (mode === "email") {
        toast({ title: "Email sent", description: `Sent to ${email}.` });
      }
    } catch {
      restore();
      setSendError("The message could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  }

  const rows = useMemo(
    () =>
      messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const newDay = !prev || !isSameDay(new Date(prev.created_at), new Date(m.created_at));
        return {
          message: m,
          newDay,
          isFirstInGroup: newDay || prev?.sender_type !== m.sender_type,
          isLastInGroup: !next || next.sender_type !== m.sender_type,
        };
      }),
    [messages],
  );

  const empty = !isLoading && messages.length === 0 && callRecords.records.length === 0;
  const contactLine = phone || "No phone number on file";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── who ───────────────────────────────────────────────────────────
          Avatar, name and phone, then the two things you do to a person from
          here: ring them (the call record lands in the thread when it ends),
          or open the full conversation. */}
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={convo?.photo || undefined} alt={name} />
          <AvatarFallback className="bg-primary/10 text-[12px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{contactLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {phone && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={startCall}
                  disabled={voiceCall.status !== "idle"}
                  aria-label={`Call ${first}`}
                >
                  {voiceCall.status === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {voiceCall.status === "idle" ? `Call ${phone}` : "On a call"}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                <Link
                  href={channelId ? `/messages/${channelId}` : `/messages?customerId=${customerId}`}
                  aria-label="Open in Messages"
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in Messages</TooltipContent>
          </Tooltip>
        </div>
      </div>

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

      {/* ── history ─────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn("relative min-h-0 flex-1 overflow-y-auto no-scrollbar pb-4 pt-1", NO_SCROLLBAR, THREAD_FIT)}
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
              <MessageCircle className="h-5 w-5" />
            </div>
            <h3 className="text-[14px] font-semibold tracking-tight">No messages yet</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Say hello to {first}. Pick a channel below — they will get it wherever they are.
            </p>
          </div>
        ) : (
          <AutoSkeleton loading={isLoading} className="w-full">
            {hasMore && !isLoading && (
              <div className="mb-3 flex justify-center">
                <Button variant="ghost" size="sm" className="h-7 rounded-full text-[12px]" onClick={handleLoadMore} disabled={isLoadingMore}>
                  {isLoadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Load earlier messages"}
                </Button>
              </div>
            )}
            {rows.map(({ message, newDay, isFirstInGroup, isLastInGroup }, i) => (
              <div key={message.id}>
                {newDay && <DayLabel date={message.created_at} first={i === 0} />}
                <TimelineItem
                  message={message}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  customerName={name}
                  customerAvatar={convo?.photo || undefined}
                  customerEmail={email}
                />
              </div>
            ))}
            {callRecords.records.map((r) => (
              <div key={r.id} className={CALL_FIT}>
                <CallRecordCard record={r} customerName={name} />
              </div>
            ))}
            <div ref={endRef} />
          </AutoSkeleton>
        )}
      </div>

      {/* ── composer ──────────────────────────────────────────────────────
          The workspace's one raised surface: what you write on top, how it is
          sent along its bottom edge. */}
      <div className="shrink-0 space-y-2">
        <div className={COMPOSER}>
          {disabled[mode] ? (
            <p className="mx-2.5 mt-2.5 rounded-2xl bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-700 dark:text-amber-300">
              {disabled[mode]}. Add one on the customer record to use this channel.
            </p>
          ) : mode === "email" ? (
            <div className="space-y-0.5 px-4 pt-3">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="w-12 shrink-0 text-muted-foreground">To</span>
                <span className="truncate font-medium">{email}</span>
                {contactOverride.email && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]">
                    This chat
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-[12.5px] text-muted-foreground">Subject</span>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What is this about?"
                  className={`h-8 px-0 text-[13px] font-medium ${BARE_FIELD}`}
                />
              </div>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={`Write to ${first}…`}
                className={`min-h-[110px] resize-none px-0 text-[13px] ${BARE_FIELD} ${NO_SCROLLBAR}`}
              />
            </div>
          ) : (
            <div className="relative">
              <TraxGutterMark />
              {ghostOn && (
                <TraxGhostText
                  text={ghost.shown}
                  done={ghost.shown === ghost.current}
                  label={ghostStyle ? STYLE_LABEL[ghostStyle] : undefined}
                  className="pl-[50px] pr-4 pt-4 text-[12.5px] leading-5"
                />
              )}
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
                placeholder={ghostOn ? "" : mode === "sms" ? `Text ${first}…` : `Message ${first}…`}
                className={`max-h-40 min-h-[68px] pb-1 pl-[50px] pr-4 pt-4 text-[12.5px] leading-5 ${BARE_FIELD} ${NO_SCROLLBAR}`}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-1">
            <ChannelSwitcher mode={mode} setMode={setMode} disabled={disabled} />
            {!disabled[mode] && (
              <div className="flex shrink-0 items-center gap-1">
                <AttachMenu
                  compact
                  customerId={customerId}
                  onFiles={(f) => setFiles((p) => [...p, ...f])}
                  onBooking={setBooking}
                />
                <Button
                  onClick={handleSend}
                  aria-label={mode === "email" ? "Send email" : "Send"}
                  title={uploading ? `Uploading ${progress.done + 1} of ${progress.total}` : "Send"}
                  disabled={sending || (mode !== "email" && !body.trim() && !booking && !files.length)}
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>
        </div>

        {sendError && (
          <div className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive">
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

      <PhoneCallPreview
        open={phonePreview}
        onOpenChange={setPhonePreview}
        name={name}
        phone={phone ?? ""}
        avatarUrl={convo?.photo}
        onEnded={() => {
          const context = messages
            .filter((m) => m.sender_type === "customer")
            .slice(-4)
            .map((m) => m.content)
            .join(" ");
          callRecords.add(context);
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 80);
        }}
      />
    </div>
  );
}

export default RailMessages;
