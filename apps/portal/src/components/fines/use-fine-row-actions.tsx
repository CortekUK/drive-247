"use client";

/**
 * A fine's two row actions — Record Payment and Waive Fine — in ONE place.
 *
 * Lifted verbatim out of `app/(dashboard)/fines/page.tsx`, which used to hold
 * this code inline, so that the fines tab and the Finances Fines view run the
 * SAME code with the SAME request bodies rather than two copies that can drift:
 *
 *   waiveFineAction      delete the fine's `FINE-<id>` Charge row, then invoke
 *                        `apply-fine` with `{ fineId, action: 'waive' }`
 *   openPaymentDialog    stamp the rental on a `FINE-<id>` Charge row that has
 *                        none, then open the portal's own AddPaymentDialog for it
 *   syncFineStatusAfterPayment
 *                        after that dialog records a payment, move the fine to
 *                        Paid / Charged from its ledger row's remaining amount
 *
 * Nothing here is new: every statement, invalidation and toast is the fines
 * tab's, in the same order. `onChanged` is the one addition, and only a caller
 * that passes it sees any difference — Finances uses it to refresh its own
 * `["finances"]` read after a waive or a payment. The fines tab passes nothing.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import type { EnhancedFine } from "@/hooks/use-fines-data";


/** Record Payment and Waive Fine are offered only while the fine is Open — the fines tab's `canCharge` / `canWaive`. */
export const fineCanCharge = (fine: Pick<EnhancedFine, "status">) => fine.status === "Open";
export const fineCanWaive = (fine: Pick<EnhancedFine, "status">) => fine.status === "Open";

export function useFineRowActions(options: { onChanged?: () => void } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();
  const [paymentFine, setPaymentFine] = useState<EnhancedFine | null>(null);
  const onChanged = options.onChanged;

  const waiveFineAction = useMutation({
    mutationFn: async (fineId: string) => {
      // Client-side: delete ledger entry for Open fines before calling edge function
      // (the deployed edge function only handles Charged fines' ledger cleanup)
      await supabase
        .from('ledger_entries')
        .delete()
        .eq('reference', `FINE-${fineId}`)
        .eq('type', 'Charge');

      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId, action: 'waive' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to waive fine');
      return { ...data, fineId };
    },
    onSuccess: (data) => {
      toast({ title: "Fine waived successfully" });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });

      // Audit log
      logAction({
        action: "fine_waived",
        entityType: "fine",
        entityId: data.fineId,
        details: { amount: data.amount }
      });
      onChanged?.();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to waive fine",
        variant: "destructive",
      });
    },
  });

  // Ensure fine's ledger entry has rental_id before opening payment dialog
  const openPaymentDialog = async (fine: EnhancedFine) => {
    if (fine.rental_id) {
      // Ensure the ledger entry has the rental_id (may be missing for older fines)
      await supabase
        .from('ledger_entries')
        .update({ rental_id: fine.rental_id })
        .eq('reference', `FINE-${fine.id}`)
        .eq('type', 'Charge')
        .is('rental_id', null);
    }
    setPaymentFine(fine);
  };

  // After a payment is recorded, sync the fine status based on ledger entry remaining_amount
  const syncFineStatusAfterPayment = async (fine: EnhancedFine) => {
    try {
      // Check the ledger entry for this fine
      const { data: ledgerEntry } = await supabase
        .from('ledger_entries')
        .select('remaining_amount, amount')
        .eq('reference', `FINE-${fine.id}`)
        .eq('type', 'Charge')
        .maybeSingle();

      let newStatus: string | null = null;

      if (ledgerEntry) {
        if (ledgerEntry.remaining_amount <= 0) {
          newStatus = 'Paid';
        } else if (ledgerEntry.remaining_amount < ledgerEntry.amount) {
          newStatus = 'Charged';
        }
      } else {
        // No ledger entry found — fine was created before ledger integration
        // Mark as Paid since a payment was just successfully recorded for it
        newStatus = 'Paid';
      }

      if (newStatus && newStatus !== fine.status) {
        const updateData: any = { status: newStatus };
        const now = new Date().toISOString();
        if (newStatus === 'Paid') {
          updateData.charged_at = now;
          updateData.resolved_at = now;
        } else if (newStatus === 'Charged') {
          updateData.charged_at = now;
        }

        await supabase
          .from('fines')
          .update(updateData)
          .eq('id', fine.id);
      }

      // Always invalidate queries after payment success
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance"] });
      queryClient.invalidateQueries({ queryKey: ["customer-balance-status"] });
      queryClient.invalidateQueries({ queryKey: ["customer-fine-stats"] });
      queryClient.invalidateQueries({ queryKey: ["rental-fines"] });
      queryClient.invalidateQueries({ queryKey: ["rental-totals"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });
      onChanged?.();
    } catch (err) {
      console.error('Error syncing fine status after payment:', err);
    }
  };

  return { waiveFineAction, openPaymentDialog, paymentFine, setPaymentFine, syncFineStatusAfterPayment };
}

export type FineRowActions = ReturnType<typeof useFineRowActions>;

/**
 * The payment window for the fine `openPaymentDialog` chose — the fines tab's
 * own AddPaymentDialog call, prop for prop: aimed at the fine's customer,
 * vehicle and rental, the fine's amount, the `Fine` ledger category, and the
 * status sync once the payment lands.
 */
export function FinePaymentDialog({ actions }: { actions: Pick<FineRowActions, "paymentFine" | "setPaymentFine" | "syncFineStatusAfterPayment"> }) {
  const { paymentFine, setPaymentFine, syncFineStatusAfterPayment } = actions;
  if (!paymentFine) return null;
  return (
    <AddPaymentDialog
      open={!!paymentFine}
      onOpenChange={(open) => {
        if (!open) setPaymentFine(null);
      }}
      customer_id={paymentFine.customer_id || undefined}
      vehicle_id={paymentFine.vehicle_id}
      rental_id={paymentFine.rental_id || undefined}
      defaultAmount={Number(paymentFine.amount)}
      targetCategories={["Fine"]}
      onPaymentSuccess={() => {
        const fineToSync = paymentFine;
        if (fineToSync) syncFineStatusAfterPayment(fineToSync);
      }}
    />
  );
}
