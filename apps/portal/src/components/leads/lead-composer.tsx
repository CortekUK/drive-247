/**
 * LeadComposer — Spec Section 6.4 (Composer).
 *
 * Channel tabs (SMS / Email / WhatsApp / Note), template picker, variable
 * autocomplete, attachment shortcuts, send button + Cmd/Ctrl+Enter.
 */
"use client";

import { useEffect, useState } from "react";
import { Send, Loader2, Mail, Phone, MessageSquare, FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLeadTemplates } from "@/hooks/use-lead-templates";
import { useSendLeadMessage } from "@/hooks/use-send-lead-message";
import type { LeadRow } from "@/hooks/use-leads";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type ComposerChannel = "sms" | "email" | "whatsapp" | "note";

interface LeadComposerProps {
  leadId: string;
  lead: LeadRow;
  conversationId: string | undefined;
  initialChannel?: ComposerChannel;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function channelAvailable(channel: ComposerChannel, lead: LeadRow): boolean {
  if (channel === "note") return true;
  if (channel === "email") return !!lead.email && EMAIL_RE.test(lead.email.trim());
  // SMS + WhatsApp both rely on phone
  if (!lead.phone) return false;
  const digits = lead.phone.replace(/\D/g, "");
  return digits.length >= 7;
}
function channelDestinationLabel(channel: ComposerChannel, lead: LeadRow): string {
  if (channel === "note") return "Internal — only staff can see this";
  if (channel === "email") return lead.email ? `to ${lead.email}` : "no email on file";
  return lead.phone ? `to ${lead.phone}` : "no phone on file";
}

const CHANNEL_TABS: { value: ComposerChannel; label: string; Icon: typeof Phone }[] = [
  { value: "sms", label: "SMS", Icon: Phone },
  { value: "email", label: "Email", Icon: Mail },
  { value: "whatsapp", label: "WhatsApp", Icon: MessageSquare },
  { value: "note", label: "Note", Icon: FileText },
];

const KNOWN_VARIABLES = new Set([
  "first_name", "full_name", "vehicle", "start_date", "end_date",
  "tenant_name", "offer_link", "doc_upload_link", "agreement_link",
  "deposit_link", "pickup_link", "lockbox_code", "lockbox_instructions",
]);

/** Extract any {{var}} tokens in the body that we don't know how to substitute.
 *  Returned in source order, deduped. */
function findUnknownVariables(body: string): string[] {
  const matches = body.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) {
    const name = m[1];
    if (!KNOWN_VARIABLES.has(name)) seen.add(name);
  }
  return [...seen];
}

const VARIABLE_HINTS = [
  "first_name",
  "full_name",
  "vehicle",
  "start_date",
  "end_date",
  "tenant_name",
  "offer_link",
  "doc_upload_link",
  "agreement_link",
  "deposit_link",
  "pickup_link",
];

export function LeadComposer({ leadId, lead, conversationId, initialChannel = "sms" }: LeadComposerProps) {
  // Default to the first channel the lead can actually receive — prevents the
  // user opening the workspace and immediately seeing SMS tab active when there's
  // no phone on file (or vice versa).
  const initialResolved: ComposerChannel = channelAvailable(initialChannel, lead)
    ? initialChannel
    : (["sms", "email", "whatsapp", "note"] as ComposerChannel[]).find((c) => channelAvailable(c, lead)) ?? "note";
  const [channel, setChannel] = useState<ComposerChannel>(initialResolved);
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);

  const send = useSendLeadMessage();
  const templates = useLeadTemplates(
    channel === "note" ? undefined : (channel as "sms" | "email" | "whatsapp"),
  );
  const [drafting, setDrafting] = useState<string | null>(null);

  const draftWithAI = async (intent: "welcome" | "doc_request" | "approval" | "offer" | "followup" | "decline") => {
    // Prevent destructive overwrite — if the operator already typed something,
    // confirm before nuking it. window.confirm is intentional: a Radix modal here
    // would add 3 round-trips of UX state for a one-time guard.
    if (body.trim().length > 0) {
      const ok = window.confirm(
        `Replace your current ${channel === "email" ? "draft" : "message"} with an AI draft?`,
      );
      if (!ok) return;
    }
    setDrafting(intent);
    try {
      const { data, error } = await supabase.functions.invoke<{ subject?: string; body: string; channelHint?: string }>(
        "ai-draft-message",
        { body: { leadId, intent, channelHint: channel === "note" ? "sms" : channel } },
      );
      if (error) throw error;
      if (data?.body) setBody(data.body);
      if (data?.subject && channel === "email") setSubject(data.subject);
      toast.success("Draft inserted — review before sending");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI draft failed");
    } finally {
      setDrafting(null);
    }
  };

  useEffect(() => {
    setChannel(initialChannel);
  }, [initialChannel]);

  const handleSend = () => {
    if (!conversationId) {
      toast.error("Conversation not ready yet.");
      return;
    }
    if (!body.trim()) {
      toast.error("Type a message first.");
      return;
    }
    // Block before the network call — otherwise send-lead-message would either
    // 500 (no destination) or silently drop the message.
    if (!channelAvailable(channel, lead)) {
      const what =
        channel === "email" ? "an email address" :
        channel === "whatsapp" ? "a phone number for WhatsApp" : "a phone number";
      toast.error(`This lead has no ${what}. Update the lead or switch channel.`);
      return;
    }
    // Typo guard — {{first_nam}} would be sent literally to the customer otherwise.
    if (channel !== "note") {
      const unknown = findUnknownVariables(body);
      if (unknown.length > 0) {
        const ok = window.confirm(
          `These look like typos: ${unknown.map((v) => `{{${v}}}`).join(", ")}\n\nSend anyway? They'll appear literally in the message.`,
        );
        if (!ok) return;
      }
    }
    send.mutate(
      {
        leadId,
        conversationId,
        channel,
        body: body.trim(),
        subject: channel === "email" ? subject.trim() || undefined : undefined,
        templateId,
      },
      {
        onSuccess: () => {
          setBody("");
          setSubject("");
          setTemplateId(undefined);
        },
      },
    );
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const onTemplateSelect = (id: string) => {
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    if (t) {
      setBody(t.body);
      if (t.channel === "email" && t.subject) setSubject(t.subject);
    }
  };

  return (
    <div className="border-t border-[#f1f5f9] bg-white p-3">
      {/* Channel tabs — tabs whose destination is missing are disabled with a tooltip. */}
      <div className="mb-1.5 flex gap-1">
        {CHANNEL_TABS.map((t) => {
          const active = channel === t.value;
          const enabled = channelAvailable(t.value, lead);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => enabled && setChannel(t.value)}
              disabled={!enabled}
              title={
                enabled
                  ? `Send via ${t.label}`
                  : t.value === "email"
                    ? "No email on file"
                    : "No phone on file"
              }
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
                active ? "bg-[#eef2ff] text-indigo-700" : "text-[#737373] hover:bg-[#f1f5f9]",
                !enabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
            >
              <t.Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Destination preview — operator always knows where the message is going. */}
      <p className="mb-2 text-[10px] text-[#737373]">{channelDestinationLabel(channel, lead)}</p>

      {/* Template + subject */}
      {channel !== "note" && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select value={templateId ?? ""} onValueChange={onTemplateSelect}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Pick a template…" />
            </SelectTrigger>
            <SelectContent>
              {templates.data?.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name} · {t.category}</SelectItem>
              )) ?? null}
              {templates.data?.length === 0 && (
                <SelectItem value="__none__" disabled>No templates configured</SelectItem>
              )}
            </SelectContent>
          </Select>

          {channel === "email" && (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="h-8 flex-1 text-xs"
            />
          )}
        </div>
      )}

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKey}
        placeholder={
          channel === "note"
            ? "Internal note — only staff can see this."
            : `Type your ${channel.toUpperCase()} message… (⌘/Ctrl+Enter to send)`
        }
        rows={3}
        className="text-sm"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-[#737373]">
          <span>Variables:</span>
          {VARIABLE_HINTS.slice(0, 6).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBody((b) => `${b}{{${v}}}`)}
              className="rounded bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] hover:bg-indigo-50"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {channel !== "note" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={drafting !== null || send.isPending}>
                  {drafting ? (
                    <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Drafting…</>
                  ) : (
                    <><Sparkles className="mr-1 h-3 w-3" /> Draft</>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => draftWithAI("welcome")}>Welcome</DropdownMenuItem>
                <DropdownMenuItem onClick={() => draftWithAI("doc_request")}>Request documents</DropdownMenuItem>
                <DropdownMenuItem onClick={() => draftWithAI("approval")}>Approval</DropdownMenuItem>
                <DropdownMenuItem onClick={() => draftWithAI("offer")}>Offer intro</DropdownMenuItem>
                <DropdownMenuItem onClick={() => draftWithAI("followup")}>Follow-up</DropdownMenuItem>
                <DropdownMenuItem onClick={() => draftWithAI("decline")}>Polite decline</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" onClick={handleSend} disabled={send.isPending || !body.trim()}>
            {send.isPending ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Sending…</>
            ) : (
              <><Send className="mr-1.5 h-3.5 w-3.5" /> Send</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
