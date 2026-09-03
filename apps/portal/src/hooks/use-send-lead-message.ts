/**
 * useSendLeadMessage — Spec Section 6.4.
 * Sends a message in a lead's conversation via the send-lead-message edge function.
 * Handles SMS / Email / WhatsApp / internal note.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { MessageChannel } from "./use-conversation-messages";

interface SendArgs {
  leadId: string;
  conversationId: string;
  channel: MessageChannel;
  body: string;
  subject?: string;
  templateId?: string;
  /** Variable map for {{var}} substitution */
  variables?: Record<string, string | number>;
}

export function useSendLeadMessage() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: SendArgs) => {
      const { data, error } = await supabase.functions.invoke("send-lead-message", {
        body: {
          tenantId: tenant?.id,
          ...args,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["conversation-messages", tenant?.id, args.conversationId] });
      qc.invalidateQueries({ queryKey: ["lead-activity", tenant?.id, args.leadId] });
      qc.invalidateQueries({ queryKey: ["lead", tenant?.id, args.leadId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to send message"),
  });
}
