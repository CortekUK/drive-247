/**
 * How each derived state reads on screen, in one place.
 *
 * Kept out of the components so the list row, the detail sheet and the balance
 * panel cannot drift into calling the same state two different things — which
 * is exactly what happens when a `switch` is copied into a second file.
 */

import type { InvoiceState, PaymentState } from '@/hooks/use-customer-payments';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export const INVOICE_CHIP: Record<
  InvoiceState,
  { label: string; tone: ChipTone }
> = {
  paid: { label: 'Paid', tone: 'success' },
  part_paid: { label: 'Part paid', tone: 'info' },
  // "Due" rather than "Pending": pending is the operator's word for a row
  // state and reads to a customer as though something is stuck.
  due: { label: 'Due', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  // The booking was cancelled, so nothing is owed on this invoice. Not "Paid":
  // the money never moved and saying it did would be a lie in the customer's
  // favour today and an argument later.
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const PAYMENT_CHIP: Record<
  PaymentState,
  { label: string; tone: ChipTone }
> = {
  received: { label: 'Received', tone: 'success' },
  pending: { label: 'Processing', tone: 'warning' },
  // A pre-authorisation: reserved on the card, never taken. Calling this a
  // payment is the single most common way a rental portal misleads a customer
  // about their own bank statement.
  hold: { label: 'Card hold', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'info' },
  reversed: { label: 'Cancelled', tone: 'neutral' },
};
