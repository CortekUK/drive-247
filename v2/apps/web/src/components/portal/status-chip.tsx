/**
 * Status chips for a booking.
 *
 * Two independent facts, two chips, never merged. A booking can be confirmed
 * and unpaid, or cancelled and refunded; collapsing them into one label loses
 * exactly the combination the customer needs to act on.
 *
 * Colour comes from the status tokens in globals.css (`success`, `warning`,
 * `danger`, `info`) — the only palette family outside the brand set that is
 * safe to use here. The tinted `*-light` backgrounds are deliberately quiet:
 * these sit inside cream cards and must not out-shout the dark-green CTA.
 */

import { cn } from '@/lib/utils';

import type { RentalLifecycle, RentalPaymentState } from '@/hooks/use-customer-rentals';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-brand-stone text-brand-text-soft',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  danger: 'bg-danger-light text-danger',
  info: 'bg-info-light text-info',
};

export function StatusChip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium leading-none whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const LIFECYCLE_CHIP: Record<RentalLifecycle, { label: string; tone: ChipTone }> = {
  // "Awaiting confirmation" rather than "Pending": pending is the operator's
  // word for a row state, and it reads to a customer as though they still have
  // something to do.
  pending: { label: 'Awaiting confirmation', tone: 'warning' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  on_rent: { label: 'On rent', tone: 'success' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export function RentalStatusChip({
  lifecycle,
  className,
}: {
  lifecycle: RentalLifecycle;
  className?: string;
}) {
  const chip = LIFECYCLE_CHIP[lifecycle];
  return (
    <StatusChip tone={chip.tone} className={className}>
      {chip.label}
    </StatusChip>
  );
}

const PAYMENT_CHIP: Record<RentalPaymentState, { label: string; tone: ChipTone } | null> =
  {
    paid: { label: 'Paid', tone: 'success' },
    refunded: { label: 'Refunded', tone: 'info' },
    // Not "Failed" — an unsettled booking is usually one the customer simply has
    // not paid for yet, and calling that a failure invents a problem.
    unpaid: { label: 'Payment due', tone: 'warning' },
    // The column was never written. Saying nothing beats guessing.
    unknown: null,
  };

export function PaymentStatusChip({
  state,
  className,
}: {
  state: RentalPaymentState;
  className?: string;
}) {
  const chip = PAYMENT_CHIP[state];
  if (!chip) return null;
  return (
    <StatusChip tone={chip.tone} className={className}>
      {chip.label}
    </StatusChip>
  );
}
