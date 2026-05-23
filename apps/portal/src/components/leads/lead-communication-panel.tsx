/**
 * LeadCommunicationPanel — Spec Section 6.4 (Middle column).
 * The unified multi-channel inbox for a lead.
 */
"use client";

import { useEffect, useRef } from "react";
import type { ConversationRow } from "@/hooks/use-conversation";
import { useConversationMessages } from "@/hooks/use-conversation-messages";
import { LeadMessageBubble } from "./lead-message-bubble";
import { LeadComposer } from "./lead-composer";

interface Props {
  leadId: string;
  conversation: ConversationRow | null;
  composerChannel?: "sms" | "email" | "whatsapp" | "note";
}

export function LeadCommunicationPanel({ leadId, conversation, composerChannel }: Props) {
  const { data: messages = [], isLoading } = useConversationMessages(conversation?.id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && messages.length === 0 ? (
          <p className="text-center text-xs text-[#737373]">Loading conversation…</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-[#737373]">
              No messages yet. Start with a template or send a quick hello.
            </p>
          </div>
        ) : (
          messages.map((m) => <LeadMessageBubble key={m.id} message={m} />)
        )}
      </div>
      <LeadComposer
        leadId={leadId}
        conversationId={conversation?.id}
        initialChannel={composerChannel}
      />
    </div>
  );
}
