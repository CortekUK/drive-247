/**
 * Status chips for a booking (customer portal v2 — forked from components/portal/status-chip.tsx).
 *
 * Two independent facts, two chips, never merged. A booking can be confirmed
 * and unpaid, or cancelled and refunded; collapsing them into one label loses
 * exactly the combination the customer needs to act on.
 *
 * Drawn as the operator ui-v2 Badge: a 20px pill, 12px medium text, the
 * status colour at 10% behind it. `plain` gives the text-only form the
 * operator tables use in their status columns.
 */

import { cn } from '@nw/lib/utils';
import { V2_LIST_TONES } from '@portal-v2-shared/list-styles';

import type { RentalLifecycle, RentalPaymentState } from '@nw/hooks/use-customer-rentals';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** The operator ui-v2 Badge tones: the colour at 10% behind the colour. */
const TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-pv-muted text-pv-muted-fg',
  success: 'bg-pv-success/10 text-pv-success',
  warning: 'bg-pv-warning/10 text-pv-warning',
  danger: 'bg-pv-danger/10 text-pv-danger',
  info: 'bg-pv-primary/10 text-pv-primary',
};

/**
 * Text-only, for a table's status column: the operator lists' own palette
 * (shared/portal-v2/list-styles.ts), so On rent and Paid read in the green
 * the operator's Available does, and so on. `info` (Upcoming, Refunded) is the
 * portal purple rather than the operator's blue.
 */
const PLAIN_CLASS: Record<ChipTone, string> = {
  neutral: V2_LIST_TONES.muted,
  success: V2_LIST_TONES.success,
  warning: V2_LIST_TONES.warning,
  danger: V2_LIST_TONES.danger,
  info: V2_LIST_TONES.brand,
};

export function StatusChip({
  tone = 'neutral',
  plain = false,
  children,
  className,
}: {
  tone?: ChipTone;
  /** Coloured text with no fill — use inside table rows. */
  plain?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        plain
          ? 'inline-flex items-center text-[13px] font-medium whitespace-nowrap'
          : 'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap [&>svg]:size-3',
        plain ? PLAIN_CLASS[tone] : TONE_CLASS[tone],
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
  plain,
  className,
}: {
  lifecycle: RentalLifecycle;
  plain?: boolean;
  className?: string;
}) {
  const chip = LIFECYCLE_CHIP[lifecycle];
  return (
    <StatusChip tone={chip.tone} plain={plain} className={className}>
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
  plain,
  className,
}: {
  state: RentalPaymentState;
  plain?: boolean;
  className?: string;
}) {
  const chip = PAYMENT_CHIP[state];
  if (!chip) return null;
  return (
    <StatusChip tone={chip.tone} plain={plain} className={className}>
      {chip.label}
    </StatusChip>
  );
}
