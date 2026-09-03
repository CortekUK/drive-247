/**
 * LeadMessageBubble — Spec Section 6.4 (Communication panel — Visual).
 *
 *  outbound (right-aligned)  — channel-coloured background
 *  inbound  (left-aligned)   — grey background
 *  internal note             — centred yellow
 *  system event              — centred grey pill
 */
"use client";

import { Mail, Phone, MessageSquare, Bot, Check, CheckCheck, AlertTriangle, FileText, Clock } from "lucide-react";
import type { ConversationMessage } from "@/hooks/use-conversation-messages";
import { cn } from "@/lib/utils";

const CHANNEL_STYLES: Record<ConversationMessage["channel"], { Icon: typeof Phone; bg: string }> = {
  sms: { Icon: Phone, bg: "bg-emerald-50" },
  email: { Icon: Mail, bg: "bg-blue-50" },
  whatsapp: { Icon: MessageSquare, bg: "bg-green-50" },
  in_app: { Icon: MessageSquare, bg: "bg-indigo-50" },
  note: { Icon: FileText, bg: "bg-yellow-100" },
  system: { Icon: Bot, bg: "bg-zinc-100" },
  call_summary: { Icon: Phone, bg: "bg-zinc-100" },
};

function StatusBadge({ status }: { status: ConversationMessage["status"] }) {
  if (status === "queued") return <Clock className="h-3 w-3 text-[#737373]" aria-label="Queued" />;
  if (status === "sent") return <Check className="h-3 w-3 text-[#737373]" aria-label="Sent" />;
  if (status === "delivered") return <CheckCheck className="h-3 w-3 text-[#737373]" aria-label="Delivered" />;
  if (status === "read") return <CheckCheck className="h-3 w-3 text-indigo-600" aria-label="Read" />;
  if (status === "failed") return <AlertTriangle className="h-3 w-3 text-red-600" aria-label="Failed" />;
  return null;
}

export function LeadMessageBubble({ message }: { message: ConversationMessage }) {
  const meta = CHANNEL_STYLES[message.channel];
  const Icon = meta.Icon;
  const time = new Date(message.created_at).toLocaleString();

  // System events render as centred pill
  if (message.channel === "system") {
    return (
      <div className="my-2 flex justify-center">
        <div className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-[#737373]">
          {message.body}
        </div>
      </div>
    );
  }

  // Internal note — centred yellow
  if (message.channel === "note" || message.direction === "internal") {
    return (
      <div className="my-2 flex justify-center">
        <div className="max-w-[80%] rounded-md border border-yellow-200 bg-yellow-100 px-3 py-2 text-xs text-yellow-900">
          <div className="flex items-center gap-1 mb-1 text-[10px] uppercase tracking-wide text-yellow-800">
            <FileText className="h-3 w-3" /> Internal note
          </div>
          <p className="whitespace-pre-wrap">{message.body}</p>
          <div className="mt-1 text-[10px] text-yellow-700">{time}</div>
        </div>
      </div>
    );
  }

  const outbound = message.direction === "outbound";

  return (
    <div className={cn("my-1.5 flex", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] rounded-lg px-3 py-2 text-sm", meta.bg)}>
        <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#737373]">
          <Icon className="h-3 w-3" />
          {message.channel}
          {message.subject && (
            <span className="ml-1 normal-case text-[10px] text-[#404040]">· {message.subject}</span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-[#080812]">{message.body}</p>
        <div className={cn("mt-1 flex items-center gap-1 text-[10px] text-[#737373]", outbound && "justify-end")}>
          <span>{time}</span>
          {outbound && <StatusBadge status={message.status} />}
        </div>
        {message.error && <p className="mt-1 text-[10px] text-red-600">{message.error}</p>}
      </div>
    </div>
  );
}
