"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRecordPayoutPayment } from "@/hooks/use-owner-payouts";
import { PAYMENT_METHOD_OPTIONS, type OwnerPayout, type PaymentMethod } from "@/types/vehicle-owners";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/format-utils";

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payout: OwnerPayout;
}

export function RecordPaymentDialog({ open, onOpenChange, payout }: RecordPaymentDialogProps) {
  const { tenant } = useTenant();
  const currency = tenant?.currency_code || "USD";
  const record = useRecordPayoutPayment();

  const remaining = Math.max(0, Number(payout.net_owed) - Number(payout.amount_paid));

  const [amountPaid, setAmountPaid] = useState<string>(remaining.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmountPaid(remaining.toFixed(2));
    setMethod("bank_transfer");
    setReference("");
    setPaidAt(format(new Date(), "yyyy-MM-dd"));
    setNotes("");
    setError(null);
  }, [open, remaining]);

  const handleSubmit = async () => {
    setError(null);
    const amt = Number(amountPaid);
    if (Number.isNaN(amt) || amt <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (amt > remaining + 0.01) {
      setError(`Amount exceeds the remaining ${formatCurrency(remaining, currency)} owed.`);
      return;
    }
    try {
      await record.mutateAsync({
        payout_id: payout.id,
        amount_paid: amt,
        payment_method: method,
        payment_reference: reference.trim() || undefined,
        paid_at: new Date(paidAt).toISOString(),
        notes: notes.trim() || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      // toast in hook
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            Logging a payment marks the payout as paid (or partially paid if less than the remaining {formatCurrency(remaining, currency)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="amount-paid">Amount Paid ({currency})</Label>
              <Input
                id="amount-paid"
                type="number"
                step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
              <p className="text-xs text-[#737373] mt-1">Remaining: {formatCurrency(remaining, currency)}</p>
            </div>
            <div>
              <Label htmlFor="paid-at">Paid On</Label>
              <Input id="paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="reference">Reference</Label>
              <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref, cheque #, etc." />
            </div>
          </div>

          <div>
            <Label htmlFor="payment-notes">Notes</Label>
            <Textarea id="payment-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={record.isPending}>
            {record.isPending ? "Recording..." : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
