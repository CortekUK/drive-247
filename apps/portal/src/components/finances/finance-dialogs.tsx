"use client";

/**
 * The Payments tab's three row dialogs, for Finances.
 *
 * NOT new money paths. Each calls exactly what the Payments tab calls, with
 * the same body and the same warnings, word for word where the words matter:
 *
 *   Reject   `usePaymentVerificationActions().rejectPayment` — which CLOSES THE
 *            RENTAL. The dialog says so before the button, as the tab's does.
 *   Remove   `useVoidPaymentLink` → `void-payment-link` (refuses anything that
 *            carries money, server-side).
 *   Reverse  the `reverse-payment` function, for a payment recorded by hand.
 *
 * The Payments tab keeps its own copies; on the canary it redirects here, so
 * these are the ones the canary sees. Each refreshes the Finances rows on
 * success (`["finances"]`) on top of what its hook already refreshes.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Link2Off, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import { Label } from "@/components/ui-v2/label";
import { Textarea } from "@/components/ui-v2/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePaymentVerificationActions } from "@/hooks/use-payment-verification";
import { useVoidPaymentLink } from "@/hooks/use-void-payment-link";
import { formatMoney } from "@/lib/payment-plans-ui/format";

export interface DialogPayment {
  paymentId: string;
  customerName: string;
  amountCents: number;
}

/** Everything the Finances screen reads is under this key. */
export const FINANCES_QUERY_KEY = ["finances"] as const;

export function RejectPaymentDialog({
  payment,
  onOpenChange,
  onDone,
}: {
  payment: DialogPayment | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { rejectPayment, isLoading } = usePaymentVerificationActions();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const close = (open: boolean) => {
    if (!open) setReason("");
    onOpenChange(open);
  };

  return (
    <Dialog open={!!payment} onOpenChange={close}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <XCircle className="h-5 w-5" />
            Reject payment &amp; close rental
          </DialogTitle>
          <DialogDescription>
            Heads up — this does more than reject the payment. It <strong className="text-destructive">closes the entire rental</strong>: ends
            it today, frees the vehicle back to Available, writes off any outstanding charges, and emails the customer. To remove a duplicate
            or unpaid payment link <em>without</em> cancelling the rental, use &ldquo;Remove payment link&rdquo; from the row&rsquo;s &#8943;
            menu instead.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="finances-reject-reason">
            Reason for rejection <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="finances-reject-reason"
            placeholder="Please provide a reason for rejecting this payment..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || isLoading || !payment}
            onClick={() => {
              if (!payment || !reason.trim()) return;
              rejectPayment.mutate(
                { paymentId: payment.paymentId, reason: reason.trim() },
                {
                  onSuccess: () => {
                    void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY });
                    close(false);
                    onDone?.();
                  },
                },
              );
            }}
          >
            {isLoading ? "Rejecting..." : "Reject & close rental"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveLinkDialog({
  payment,
  currency,
  onOpenChange,
  onDone,
}: {
  payment: DialogPayment | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const voidLink = useVoidPaymentLink();
  const qc = useQueryClient();
  const { toast } = useToast();

  const remove = async () => {
    if (!payment) return;
    try {
      await voidLink.mutateAsync({ paymentId: payment.paymentId, reason: "Duplicate/stale payment link removed from Finances" });
      void qc.invalidateQueries({ queryKey: FINANCES_QUERY_KEY });
      toast({ title: "Payment link removed", description: "The duplicate link was cancelled — the rental is unaffected." });
      onDone?.();
    } catch (e: any) {
      toast({ title: "Could not remove link", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2Off className="h-5 w-5 text-red-600" />
            Remove payment link
          </DialogTitle>
          <DialogDescription>
            This cancels only this one <strong>unpaid</strong> payment link
            {payment ? (
              <>
                {" "}
                for <span className="font-semibold">{payment.customerName}</span> ({formatMoney(payment.amountCents, currency)})
              </>
            ) : null}
            , so it can no longer be paid. The rental, the vehicle, and any payment the customer has already made are{" "}
            <strong>not affected</strong>. Nothing was charged on this link, so there is nothing to refund.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={() => void remove()} disabled={voidLink.isPending}>
            {voidLink.isPending ? "Removing..." : "Remove link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReversePaymentDialog({
  payment,
  currency,
  onOpenChange,
  onDone,
}: {
  payment: DialogPayment | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (open: boolean) => {
    if (busy) return;
    if (!open) setReason("");
    onOpenChange(open);
  };

  const reverse = async () => {
    if (!payment || !reason.trim()) return;
    setBusy(true);
    try {
      // The Payments tab's call, unchanged: the function checks the payment
      // was recorded by hand and undoes its allocations.
      const { data, error } = await supabase.functions.invoke("reverse-payment", {
        body: { paymentId: payment.paymentId, reason: reason.trim() },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to reverse payment");
      toast({
        title: "Payment reversed",
        description: `${formatMoney(payment.amountCents, currency)} has been reversed. ${data.details?.applicationsReversed || 0} allocations were undone.`,
      });
      for (const key of [
        FINANCES_QUERY_KEY,
        ["payments-data"],
        ["payment-summary"],
        ["ledger-entries"],
        ["rental-charges"],
        ["rental-payments"],
        ["rental-totals"],
        ["customer-balance"],
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
      setReason("");
      onOpenChange(false);
      onDone?.();
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to reverse payment", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!payment} onOpenChange={close}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-600">
            <AlertTriangle className="h-5 w-5" />
            Reverse payment
          </DialogTitle>
          <DialogDescription>
            This will reverse the payment of{" "}
            <span className="font-semibold">{payment ? formatMoney(payment.amountCents, currency) : ""}</span> for{" "}
            <span className="font-semibold">{payment?.customerName}</span>. All charge allocations will be undone and the charges will return
            to outstanding status.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-2xl bg-orange-500/10 p-3 text-sm text-orange-800 dark:text-orange-200">
            <p className="font-medium">This action cannot be undone.</p>
            <p className="mt-1">The payment will be marked as reversed and all allocations to charges will be removed.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="finances-reverse-reason">
              Reason for reversal <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="finances-reverse-reason"
              placeholder="e.g., Payment entered in error, duplicate payment, customer dispute..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void reverse()} disabled={!reason.trim() || busy} className="bg-orange-600 text-white hover:bg-orange-700">
            <Undo2 className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {busy ? "Reversing..." : "Reverse payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
