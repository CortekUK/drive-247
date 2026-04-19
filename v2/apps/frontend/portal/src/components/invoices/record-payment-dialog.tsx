'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@drive247/ui';
import { PaymentMethod } from '@drive247/shared-types';
import { paymentsApi } from '@/lib/api';
import { centsToInputValue, parseToCents } from '@/lib/money';

interface Props {
  invoiceId: string;
  amountDue: number; // cents
  onClose: () => void;
  onRecorded: () => void;
}

export function RecordPaymentDialog({
  invoiceId,
  amountDue,
  onClose,
  onRecorded,
}: Props) {
  const [amount, setAmount] = useState(centsToInputValue(amountDue));
  // Keep the prefilled amount in sync when amountDue changes (e.g. after a
  // line-item edit while the dialog was closed and re-opened).
  useEffect(() => {
    setAmount(centsToInputValue(amountDue));
  }, [amountDue]);
  const [method, setMethod] = useState<string>(PaymentMethod.CARD);
  const [paidAt, setPaidAt] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cents = parseToCents(amount);
      if (cents <= 0) {
        toast.error('Enter a valid amount');
        return;
      }
      await paymentsApi.record(invoiceId, {
        amount: cents,
        paymentMethod: method as PaymentMethod,
        paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        notes: notes.trim() || null,
      });
      toast.success('Payment recorded');
      onRecorded();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>Record Payment</DialogTitle>
        <DialogDescription>
          Manual payment. For Stripe payments, use the integration flow.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="bg-white"
            />
          </div>
          <div className="space-y-2">
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PaymentMethod.CASH}>Cash</SelectItem>
                <SelectItem value={PaymentMethod.CARD}>Card</SelectItem>
                <SelectItem value={PaymentMethod.BANK_TRANSFER}>Bank Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paidAt">Date</Label>
            <Input
              id="paidAt"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="bg-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              className="bg-white"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Recording...' : 'Record Payment'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
