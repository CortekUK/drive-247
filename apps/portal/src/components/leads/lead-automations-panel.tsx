/**
 * LeadAutomationsPanel — Spec Section 6.4 (Right column — Section 3).
 *
 * Phase 1: surfaces Quick Action buttons that fan out to existing edge functions.
 * Phase 2 adds: active automations on this lead, attach-automation dropdown,
 *   stage SLA chip, pause/resume per run.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  ShieldCheck,
  ShoppingBag,
  FileSignature,
  CreditCard,
  Calendar,
  CheckCircle2,
  Ban,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useUpdateLeadStage } from "@/hooks/use-lead-mutations";
import type { LeadRow } from "@/hooks/use-leads";
import { canTransition } from "@/lib/lead-stage-machine";
import { BlacklistConfirmDialog } from "./blacklist-confirm-dialog";
import { ConvertToRentalDialog } from "./convert-to-rental-dialog";
import { AttachAutomationDropdown } from "./attach-automation-dropdown";

interface Props {
  lead: LeadRow;
}

export function LeadAutomationsPanel({ lead }: Props) {
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const stageMut = useUpdateLeadStage();

  const canConvert = lead.stage === "deposit_paid" || lead.stage === "pickup_scheduled";
  const canMarkLost = canTransition(lead.stage, "lost");

  const invoke = async (fn: string, payload: Record<string, unknown>, successMsg: string) => {
    setBusy(fn);
    try {
      const { error } = await supabase.functions.invoke(fn, { body: payload });
      if (error) throw error;
      toast.success(successMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${fn} failed`);
    } finally {
      setBusy(null);
    }
  };

  const requestDocuments = async () => {
    // Move to docs_requested if not there; send default doc_request template via SMS.
    const { data: tpl } = await supabase
      .from("lead_message_templates")
      .select("id")
      .eq("tenant_id", lead.tenant_id)
      .eq("category", "doc_request")
      .eq("channel", "sms")
      .eq("is_default", true)
      .maybeSingle();
    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id)
      .maybeSingle();
    if (!conv?.id || !tpl?.id) {
      toast.error("Couldn't resolve template or conversation.");
      return;
    }
    setBusy("request_documents");
    try {
      const { error } = await supabase.functions.invoke("send-lead-message", {
        body: {
          tenantId: lead.tenant_id,
          leadId: lead.id,
          conversationId: conv.id,
          channel: "sms",
          body: "",
          templateId: tpl.id,
          variables: { doc_upload_link: `https://drive-247.com/lead-docs/${lead.id}` },
        },
      });
      if (error) throw error;
      if (canTransition(lead.stage, "docs_requested")) {
        await stageMut.mutateAsync({ leadId: lead.id, currentStage: lead.stage, nextStage: "docs_requested" });
      }
      toast.success("Document request sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const runVeriff = async () => {
    invoke(
      "create-veriff-session",
      {
        customerDetails: { name: lead.full_name, email: lead.email, phone: lead.phone },
        tenantId: lead.tenant_id,
        external_user_id: lead.id,
      },
      "Veriff session created",
    );
  };

  const checkBonzah = async () => {
    invoke(
      "bonzah-create-quote",
      {
        // Pre-rental quote: pass placeholder rental data; spec §6.5 notes the existing
        // function may need a quote_only flag — track as open question for Stage 10 QA.
        rental_id: lead.id,
        customer_id: lead.customer_id ?? lead.id,
        tenant_id: lead.tenant_id,
        trip_dates: {
          start: lead.start_date ?? new Date().toISOString().slice(0, 10),
          end: lead.end_date ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        },
        renter: {
          first_name: lead.full_name.split(" ")[0],
          last_name: lead.full_name.split(" ").slice(1).join(" "),
          email: lead.email,
          phone: lead.phone,
        },
      },
      "Bonzah quote requested",
    );
  };

  const markLost = async () => {
    try {
      await stageMut.mutateAsync({ leadId: lead.id, currentStage: lead.stage, nextStage: "lost" });
    } catch {
      // toast handled in mutation
    }
  };

  const sendAgreement = async () => {
    if (lead.stage !== "offer_accepted" && lead.stage !== "approved") {
      toast.error("Lead must be approved or have accepted an offer first.");
      return;
    }
    setBusy("send_agreement");
    try {
      // 1. Create the BoldSign document for this lead (uses existing tenant agreement template)
      const { data: doc, error: docErr } = await supabase.functions.invoke<{ documentId: string; signingLink?: string }>(
        "create-boldsign-document",
        {
          body: {
            tenantId: lead.tenant_id,
            leadId: lead.id,
            customerName: lead.full_name,
            customerEmail: lead.email,
            customerPhone: lead.phone,
            vehicleId: lead.vehicle_id,
            startDate: lead.start_date,
            endDate: lead.end_date,
          },
        },
      );
      if (docErr) throw docErr;
      // 2. Notify the lead via email + WhatsApp
      if (doc?.documentId) {
        await supabase.functions.invoke("send-signing-email", {
          body: {
            customerEmail: lead.email,
            customerName: lead.full_name,
            documentId: doc.documentId,
            tenantId: lead.tenant_id,
            signingLink: doc.signingLink,
          },
        });
      }
      // 3. Advance the stage
      if (canTransition(lead.stage, "agreement_sent")) {
        await stageMut.mutateAsync({ leadId: lead.id, currentStage: lead.stage, nextStage: "agreement_sent" });
      }
      toast.success("Agreement sent for signature");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send agreement failed");
    } finally {
      setBusy(null);
    }
  };

  const sendPaymentLink = async () => {
    setBusy("send_payment_link");
    try {
      const { data, error } = await supabase.functions.invoke<{ url?: string }>(
        "create-preauth-checkout",
        {
          body: {
            rentalId: lead.id, // pre-rental — passes lead.id; spec deviation noted (existing fn may need a quote-only flag)
            customerId: lead.customer_id ?? lead.id,
            customerEmail: lead.email,
            customerName: lead.full_name,
            customerPhone: lead.phone,
            vehicleId: lead.vehicle_id ?? "",
            vehicleName: lead.vehicle_class ?? "Vehicle",
            totalAmount: 300,
            pickupDate: lead.start_date ?? new Date().toISOString().slice(0, 10),
            returnDate: lead.end_date ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
            tenantId: lead.tenant_id,
          },
        },
      );
      if (error) throw error;
      // Send the link via SMS
      if (data?.url) {
        const { data: conv } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", lead.id)
          .maybeSingle();
        if (conv?.id) {
          await supabase.functions.invoke("send-lead-message", {
            body: {
              tenantId: lead.tenant_id,
              leadId: lead.id,
              conversationId: conv.id,
              channel: "sms",
              body: `Hi ${lead.full_name.split(" ")[0]}, here's your deposit link: ${data.url}`,
              variables: { deposit_link: data.url },
            },
          });
        }
      }
      toast.success("Payment link sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send payment link failed");
    } finally {
      setBusy(null);
    }
  };

  const schedulePickup = async () => {
    setBusy("schedule_pickup");
    try {
      // V1: send a hosted scheduler URL via SMS. The actual scheduler integrates with
      // existing rental_key_handovers infrastructure once the rental row exists.
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (!conv?.id) {
        toast.error("Conversation not ready.");
        return;
      }
      const pickupLink = `https://drive-247.com/pickup/${lead.id}`;
      await supabase.functions.invoke("send-lead-message", {
        body: {
          tenantId: lead.tenant_id,
          leadId: lead.id,
          conversationId: conv.id,
          channel: "sms",
          body: `Hi ${lead.full_name.split(" ")[0]}, pick a pickup time here: ${pickupLink}`,
          variables: { pickup_link: pickupLink },
        },
      });
      if (canTransition(lead.stage, "pickup_scheduled")) {
        await stageMut.mutateAsync({ leadId: lead.id, currentStage: lead.stage, nextStage: "pickup_scheduled" });
      }
      toast.success("Pickup scheduler sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schedule pickup failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-[#f1f5f9] bg-white p-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#737373]">
        Automations
      </h3>
      <AttachAutomationDropdown leadId={lead.id} tenantId={lead.tenant_id} />

      <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-[#737373]">
        Quick actions
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={requestDocuments} disabled={busy !== null}>
          <FileText className="mr-1.5 h-3.5 w-3.5" /> Request docs
        </Button>
        <Button size="sm" variant="outline" onClick={runVeriff} disabled={busy !== null}>
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Run Veriff
        </Button>
        <Button size="sm" variant="outline" onClick={checkBonzah} disabled={busy !== null}>
          <ShoppingBag className="mr-1.5 h-3.5 w-3.5" /> Bonzah quote
        </Button>
        <Button size="sm" variant="outline" onClick={sendAgreement} disabled={busy !== null}>
          <FileSignature className="mr-1.5 h-3.5 w-3.5" /> Send agreement
        </Button>
        <Button size="sm" variant="outline" onClick={sendPaymentLink} disabled={busy !== null}>
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Payment link
        </Button>
        <Button size="sm" variant="outline" onClick={schedulePickup} disabled={busy !== null}>
          <Calendar className="mr-1.5 h-3.5 w-3.5" /> Schedule pickup
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 border-t border-[#f1f5f9] pt-2">
        <Button
          size="sm"
          onClick={() => setConvertOpen(true)}
          disabled={!canConvert || busy !== null}
        >
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Convert to Rental
        </Button>
        <Button size="sm" variant="outline" onClick={markLost} disabled={!canMarkLost || busy !== null}>
          <XCircle className="mr-1.5 h-3.5 w-3.5" /> Mark as Lost
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setBlacklistOpen(true)}
          disabled={!canTransition(lead.stage, "blacklisted") || busy !== null}
        >
          <Ban className="mr-1.5 h-3.5 w-3.5" /> Add to Blacklist
        </Button>
      </div>

      <BlacklistConfirmDialog open={blacklistOpen} onOpenChange={setBlacklistOpen} lead={lead} />
      <ConvertToRentalDialog open={convertOpen} onOpenChange={setConvertOpen} lead={lead} />
    </section>
  );
}
