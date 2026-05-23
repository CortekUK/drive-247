/**
 * LeadWorkspace — Spec Section 6.4.
 *
 * Full-page 3-column workspace:
 *   LEFT  (320px): Info / Docs / Notes / Activity (LeadInfoPanel)
 *   MIDDLE (flex): Unified conversation (LeadCommunicationPanel)
 *   RIGHT (360px): AI Next Action + Matching engine + Automations & Quick Actions
 *
 * Top action bar: breadcrumb, stage selector (constrained transitions),
 * score chip, action buttons (Convert to Rental, More).
 *
 * Below 1400px width: collapses to tabs (Info | Chat | AI). Default tab = Chat.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, MoreHorizontal, Loader2, XCircle, Ban, Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { supabase } from "@/integrations/supabase/client";

import { useLead } from "@/hooks/use-lead";
import { useLeadConversation } from "@/hooks/use-conversation";
import { useUpdateLeadStage } from "@/hooks/use-lead-mutations";
import {
  allowedTransitions,
  canTransition,
  stageLabel,
  type LeadStage,
} from "@/lib/lead-stage-machine";

import { LeadInfoPanel } from "./lead-info-panel";
import { LeadCommunicationPanel } from "./lead-communication-panel";
import { LeadAINextAction } from "./lead-ai-next-action";
import { LeadMatchingEngine } from "./lead-matching-engine";
import { OfferBuilderDialog } from "./offer-builder-dialog";
import { LeadAutomationsPanel } from "./lead-automations-panel";
import { ConvertToRentalDialog } from "./convert-to-rental-dialog";
import { BlacklistConfirmDialog } from "./blacklist-confirm-dialog";

interface Props {
  leadId: string;
}

export function LeadWorkspace({ leadId }: Props) {
  const router = useRouter();
  const { data: lead, isLoading, error } = useLead(leadId);
  const { data: conversation } = useLeadConversation(leadId);
  const updateStage = useUpdateLeadStage();
  const [composerChannel, setComposerChannel] = useState<"sms" | "email" | "whatsapp" | "note">("sms");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerVehicles, setOfferVehicles] = useState<string[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);

  const openOfferBuilder = (vehicleIds: string[]) => {
    setOfferVehicles(vehicleIds);
    setOfferOpen(true);
  };

  const markLost = async () => {
    if (!lead) return;
    if (!canTransition(lead.stage, "lost")) {
      toast.error(`Can't move from ${lead.stage} to lost`);
      return;
    }
    try {
      await updateStage.mutateAsync({ leadId: lead.id, currentStage: lead.stage, nextStage: "lost" });
      toast.success("Marked as lost");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const deleteLead = async () => {
    if (!lead) return;
    if (!confirm(`Delete ${lead.full_name}? This cannot be undone.`)) return;
    const { error } = await supabase.from("leads").delete().eq("id", lead.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Lead deleted");
    router.push("/leads");
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#737373]" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h2 className="mb-2 text-base font-medium text-[#080812]">Lead not found</h2>
        <p className="mb-4 text-sm text-[#737373]">It may have been deleted, or you don&rsquo;t have access.</p>
        <Button variant="outline" onClick={() => router.push("/leads")}>Back to Leads</Button>
      </div>
    );
  }

  const allowed = allowedTransitions(lead.stage);
  const canConvert = lead.stage === "deposit_paid" || lead.stage === "pickup_scheduled";

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-[#f8fafc]">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f5f9] bg-white px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-[#737373]">
          <Link href="/leads" className="flex items-center gap-1 hover:text-indigo-600">
            <ChevronLeft className="h-3.5 w-3.5" />
            Leads
          </Link>
          <span>/</span>
          <span className="font-medium text-[#080812]">{lead.full_name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={lead.stage}
            onValueChange={(next) => {
              updateStage.mutate({
                leadId: lead.id,
                currentStage: lead.stage,
                nextStage: next as LeadStage,
              });
            }}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue>{stageLabel(lead.stage)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={lead.stage} disabled>
                {stageLabel(lead.stage)} (current)
              </SelectItem>
              {allowed.map((s) => (
                <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" disabled={!canConvert} onClick={() => setConvertOpen(true)}>
            Convert to Rental
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={markLost} disabled={!canTransition(lead.stage, "lost")}>
                <XCircle className="mr-2 h-3.5 w-3.5" /> Mark as Lost
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setBlacklistOpen(true)}
                disabled={!canTransition(lead.stage, "blacklisted")}
              >
                <Ban className="mr-2 h-3.5 w-3.5" /> Add to Blacklist
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={deleteLead} className="text-red-600">
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Desktop: 3 columns ≥1400px */}
      <div className="hidden flex-1 overflow-hidden 2xl:flex">
        <LeadInfoPanel lead={lead} onFocusComposer={(c) => setComposerChannel(c)} />
        <LeadCommunicationPanel leadId={lead.id} conversation={conversation ?? null} composerChannel={composerChannel} />
        <aside className="flex h-full w-[360px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#f1f5f9] bg-[#f8fafc] p-3">
          <LeadAINextAction lead={lead} />
          <LeadMatchingEngine
            leadId={lead.id}
            lastActivityAt={lead.last_activity_at}
            onBuildOffer={openOfferBuilder}
          />
          <LeadAutomationsPanel lead={lead} />
        </aside>
      </div>

      {/* Tablet/Mobile: tabs <1400px */}
      <div className="flex flex-1 flex-col overflow-hidden 2xl:hidden">
        <Tabs defaultValue="chat" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-3 mt-2">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
          </TabsList>
          <TabsContent value="info" className="flex-1 overflow-hidden">
            <LeadInfoPanel lead={lead} onFocusComposer={(c) => setComposerChannel(c)} />
          </TabsContent>
          <TabsContent value="chat" className="flex-1 overflow-hidden">
            <LeadCommunicationPanel leadId={lead.id} conversation={conversation ?? null} composerChannel={composerChannel} />
          </TabsContent>
          <TabsContent value="ai" className="flex-1 space-y-3 overflow-y-auto p-3">
            <LeadAINextAction lead={lead} />
            <LeadMatchingEngine
              leadId={lead.id}
              lastActivityAt={lead.last_activity_at}
              onBuildOffer={openOfferBuilder}
            />
            <LeadAutomationsPanel lead={lead} />
          </TabsContent>
        </Tabs>
      </div>

      <OfferBuilderDialog
        open={offerOpen}
        onOpenChange={setOfferOpen}
        leadId={lead.id}
        defaultStartDate={lead.start_date ?? new Date().toISOString().slice(0, 10)}
        defaultEndDate={lead.end_date ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}
        selectedVehicleIds={offerVehicles}
      />

      <ConvertToRentalDialog open={convertOpen} onOpenChange={setConvertOpen} lead={lead} />
      <BlacklistConfirmDialog open={blacklistOpen} onOpenChange={setBlacklistOpen} lead={lead} />
    </div>
  );
}
