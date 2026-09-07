"use client";

/**
 * One item in the conversation timeline.
 *
 * ── one timeline, four channels ─────────────────────────────────────────────
 *
 * In-app and SMS are chat: they keep `ChatMessageBubble` unchanged, with a
 * small channel chip so SMS is never mistaken for in-app. Email is not chat —
 * it has a subject and a recipient and wants room — so it gets a card. A call
 * is not a message at all, so it is a centred timeline event, the way a phone
 * app shows one.
 *
 * That is three treatments, not four unrelated designs: the same type scale,
 * the same muted secondary text, the same radii, the same one accent. What
 * changes between them is only the shape the CONTENT needs.
 *
 * ── these renderers are not mock-only ───────────────────────────────────────
 *
 * Every branch keys on data the backend already writes — `channel`,
 * `metadata.type === 'voice_call'`, `metadata.subject`, `metadata.attachments`,
 * and `external_status === 'failed'`, which the SMS edge function already sets.
 * The fixtures in `mock-conversation.ts` only supply values; they do not have a
 * rendering path of their own, so nothing here has to be rebuilt when the
 * backend starts producing these states for real.
 */

import { format } from "date-fns";
import {
  AlertTriangle, Mail, MessageSquare, PhoneIncoming, PhoneMissed, PhoneOutgoing, RotateCw,
} from "lucide-react";
import { ChatMessageBubble } from "@/components/chat";
import { AttachmentList } from "@/components/messages-v2/attachment-list";
import type { ChatMessage } from "@/hooks/use-chat-messages";
import type { ChatAttachment } from "@/components/messages-v2/use-chat-attachments";

function attachmentsOf(m: ChatMessage): ChatAttachment[] {
  const raw = (m.metadata as { attachments?: unknown } | undefined)?.attachments;
  return Array.isArray(raw) ? (raw as ChatAttachment[]) : [];
}

function callDuration(seconds?: number): string {
  if (!seconds || seconds < 1) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (!m) return `${s} sec`;
  return s ? `${m} min ${s} sec` : `${m} min`;
}

/* ── a call ───────────────────────────────────────────────────────────────
   Centred, quiet, and never a bubble: a call did not carry words, so drawing
   it as speech would be a lie about what happened. */
function CallEvent({ message }: { message: ChatMessage }) {
  const meta = (message.metadata ?? {}) as {
    direction?: string;
    outcome?: string;
    duration_seconds?: number;
  };
  const incoming = meta.direction === "incoming";
  const missed = meta.outcome === "missed";
  const Icon = missed ? PhoneMissed : incoming ? PhoneIncoming : PhoneOutgoing;
  const duration = callDuration(meta.duration_seconds);

  const label = missed
    ? incoming ? "Missed call" : "No answer"
    : incoming ? "Incoming call" : "Outgoing call";

  return (
    <div className="my-4 flex justify-center">
      <div
        className={`inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[12px] ${
          missed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{label}</span>
        {duration && <span className="opacity-70">· {duration}</span>}
        <span className="opacity-60">· {format(new Date(message.created_at), "h:mm a")}</span>
      </div>
    </div>
  );
}

/* ── an email ─────────────────────────────────────────────────────────────
   A card, because a subject and a recipient do not fit a speech bubble.
   Outbound sits right and tinted; inbound sits left on the plain surface —
   the same left/right language the bubbles use, so the eye does not have to
   learn a second rule. */
function EmailItem({
  message, customerName, customerEmail,
}: {
  message: ChatMessage;
  customerName: string;
  customerEmail: string | null;
}) {
  const own = message.sender_type === "tenant";
  const subject = (message.metadata as { subject?: string } | undefined)?.subject;
  const attachments = attachmentsOf(message);

  return (
    <div className={`mt-4 flex w-full ${own ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-full max-w-[min(30rem,85%)] overflow-hidden rounded-2xl ring-1 ${
          own ? "bg-primary/[0.06] ring-primary/15" : "bg-card ring-foreground/5"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Email
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {own ? `To ${customerEmail ?? customerName}` : `From ${customerName}`}
          </span>
        </div>

        <div className="px-4 py-3">
          {subject && (
            <p className="mb-1.5 text-[13px] font-semibold leading-snug text-foreground">{subject}</p>
          )}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
            {message.content}
          </p>
          {attachments.length > 0 && (
            <AttachmentList attachments={attachments} isOwnMessage={false} />
          )}
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            {format(new Date(message.created_at), "d MMM, h:mm a")}
            {own && message.external_status === "sent" && " · Sent"}
          </p>
        </div>
      </div>
    </div>
  );
}

/** SMS gets a chip; in-app does not need one, being the default. */
function ChannelChip({ channel }: { channel: string }) {
  if (channel !== "sms") return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      <MessageSquare className="h-2.5 w-2.5" />
      SMS
    </span>
  );
}

export function TimelineItem({
  message, isFirstInGroup, isLastInGroup, customerName, customerAvatar, customerEmail, onRetry,
}: {
  message: ChatMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  customerName: string;
  customerAvatar?: string;
  customerEmail: string | null;
  onRetry?: (m: ChatMessage) => void;
}) {
  const meta = (message.metadata ?? {}) as { type?: string };

  if (meta.type === "voice_call" || message.channel === "voice") {
    return <CallEvent message={message} />;
  }

  if (message.channel === "email") {
    return (
      <EmailItem message={message} customerName={customerName} customerEmail={customerEmail} />
    );
  }

  const failed = message.external_status === "failed";
  const own = message.sender_type === "tenant";

  return (
    <div>
      <ChatMessageBubble
        message={message}
        isOwnMessage={own}
        isFirstInGroup={isFirstInGroup}
        isLastInGroup={isLastInGroup}
        customerName={customerName}
        customerAvatar={customerAvatar}
      />
      {/* Channel and failure sit UNDER the bubble, aligned with it. Tinting the
          bubble itself would make a failed message harder to read at exactly
          the moment somebody needs to re-read it. */}
      {(failed || message.channel === "sms") && (
        <div className={`flex ${own ? "justify-end" : "justify-start"} px-1`}>
          {failed ? (
            <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" />
              Failed to send
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message)}
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
                >
                  <RotateCw className="h-2.5 w-2.5" />
                  Retry
                </button>
              )}
            </span>
          ) : (
            <ChannelChip channel={message.channel} />
          )}
        </div>
      )}
    </div>
  );
}
