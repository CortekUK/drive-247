'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { PaygTimeline } from './payg-timeline';

interface PaygDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rentalId: string;
  isPayg: boolean;
  rental: {
    payg_start_ts?: string | null;
    payg_next_accrual_at?: string | null;
    payg_last_reminder_sent_at?: string | null;
    payg_reminder_count?: number | null;
    payg_reminder_interval_days?: number | null;
    payg_paused?: boolean | null;
    payg_closed_at?: string | null;
  };
  currencyCode: string;
  onTakePayment?: (args: { categories: string[]; amount: number }) => void;
}

/**
 * Modal wrapper around the PAYG Activity Timeline. Triggered from the PAYG sub-section
 * of the rental's Payment Breakdown so operators can drill into per-day detail without
 * leaving the rental page.
 */
export function PaygDetailsDialog({
  open,
  onOpenChange,
  rentalId,
  isPayg,
  rental,
  currencyCode,
  onTakePayment,
}: PaygDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pay-As-You-Go Details</DialogTitle>
          <DialogDescription>
            Per-day accrual history, payment activity, and reminder schedule for this rental.
          </DialogDescription>
        </DialogHeader>
        <PaygTimeline
          rentalId={rentalId}
          isPayg={isPayg}
          rental={rental}
          currencyCode={currencyCode}
          onTakePayment={(args) => {
            onOpenChange(false);
            onTakePayment?.(args);
          }}
          asCard={false}
        />
      </DialogContent>
    </Dialog>
  );
}
