'use client';

import { useState } from 'react';
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
} from '@drive247/ui';
import { paymentsApi } from '@/lib/api';
import { centsToInputValue, formatCents, parseToCents } from '@/lib/money';

interface Props {
  invoiceId: string;
  paymentId: string;
  maxRefund: number; // cents
  onClose: () => void;
  onRefunded: () => void;
}

export function RefundPaymentDialog({
  invoiceId,
  paymentId,
  maxRefund,
  onClose,
  onRefunded,
}: Props) {
  const [amount, setAmount] = useState(centsToInputValue(maxRefund));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cents = parseToCents(amount);
      if (cents <= 0 || cents > maxRefund) {
        toast.error(`Refund must be between 0.01 and ${formatCents(maxRefund)}`);
        return;
      }
      await paymentsApi.refund(invoiceId, paymentId, {
        amount: cents,
        notes: notes.trim() || null,
      });
      toast.success('Refund recorded');
      onRefunded();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to refund');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>Refund Payment</DialogTitle>
        <DialogDescription>
          Max refundable: {formatCents(maxRefund)}.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="ramount">Refund amount</Label>
            <Input
              id="ramount"
              type="number"
              step="0.01"
              min={0}
              max={(maxRefund / 100).toFixed(2)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="bg-white"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rnotes">Reason / notes</Label>
            <Input
              id="rnotes"
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
          <Button
            type="submit"
            className="text-[#dc2626]"
            variant="outline"
            disabled={submitting}
          >
            {submitting ? 'Refunding...' : 'Refund'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
