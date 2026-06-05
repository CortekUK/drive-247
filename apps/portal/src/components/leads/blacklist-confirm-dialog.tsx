"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { supabase } from "@/integrations/supabase/client";
import { useAddToBlacklist } from "@/hooks/use-blacklist";
import { useUpdateLeadStage } from "@/hooks/use-lead-mutations";
import type { LeadRow } from "@/hooks/use-leads";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadRow;
}

export function BlacklistConfirmDialog({ open, onOpenChange, lead }: Props) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const addMutation = useAddToBlacklist();
  const stageMutation = useUpdateLeadStage();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast.error("Please add a reason.");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Add to blacklist
      await addMutation.mutateAsync({
        phone: lead.phone,
        email: lead.email,
        fullName: lead.full_name,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
        sourceLeadId: lead.id,
      });
      // 2. Move lead to blacklisted stage
      await stageMutation.mutateAsync({
        leadId: lead.id,
        currentStage: lead.stage,
        nextStage: "blacklisted",
      });
      // 3. Send polite decline SMS via default 'decline' template (never mentions blacklist)
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead.id)
        .maybeSingle();
      const { data: tpl } = await supabase
        .from("lead_message_templates")
        .select("id")
        .eq("tenant_id", lead.tenant_id)
        .eq("category", "decline")
        .eq("channel", "sms")
        .eq("is_default", true)
        .maybeSingle();
      if (conv?.id && tpl?.id) {
        await supabase.functions.invoke("send-lead-message", {
          body: {
            tenantId: lead.tenant_id,
            leadId: lead.id,
            conversationId: conv.id,
            channel: "sms",
            body: "",
            templateId: tpl.id,
            systemTriggered: true,
          },
        });
      }
      toast.success("Lead blacklisted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to blacklist");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to blacklist</DialogTitle>
          <DialogDescription>
            {lead.full_name} ({lead.phone}) will be blocked from future applications.
            A polite decline SMS will be sent — without ever mentioning the blacklist.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Repeat no-show, fraud risk."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Internal notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional context for the team."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Blacklisting…</>
            ) : (
              "Blacklist"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
