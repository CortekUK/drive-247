/**
 * How an agreement's state reads on screen, in one place — the list row and the
 * dialog both read from here so they cannot call one state two things.
 */

import type { AgreementState, CustomerAgreement } from '@nw/hooks/use-customer-agreements';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * BoldSign's vocabulary, translated.
 *
 * "delivered" in BoldSign means the recipient OPENED the document — the exact
 * opposite of what the word means about an email — so it is never shown raw.
 */
export const STATE_CHIP: Record<AgreementState, { label: string; tone: ChipTone }> = {
  preparing: { label: 'Being prepared', tone: 'neutral' },
  awaiting_signature: { label: 'Needs your signature', tone: 'warning' },
  opened: { label: 'Not signed yet', tone: 'warning' },
  signed: { label: 'Signed', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Link expired', tone: 'danger' },
};

/**
 * What the customer should do, in one sentence.
 *
 * Returns null when the state speaks for itself and the actions below are the
 * whole answer — a signed agreement with its PDF filed needs no instructions.
 */
export function guidance(agreement: CustomerAgreement, email: string | null): string | null {
  const inbox = email ? ` to ${email}` : '';

  switch (agreement.state) {
    case 'preparing':
      return 'This document is still being prepared. There is nothing for you to do yet.';
    case 'awaiting_signature':
      return `We have emailed you a signing link${inbox}. Open it to sign — this page updates on its own once you are done.`;
    case 'opened':
      return `You have opened this but not finished signing. Use the link we emailed${inbox} to complete it.`;
    case 'declined':
      return 'This agreement was declined, so it is not in force. Tell us if that was not intended.';
    case 'cancelled':
      return 'This agreement was cancelled and has been replaced or withdrawn.';
    case 'expired':
      return 'The signing link has expired. We can send you a new one.';
    case 'signed':
      return agreement.signedDocument
        ? null
        : 'Signed. Your copy is being filed and will appear here shortly.';
  }
}

/** States where a "Get in touch" link is the genuine next step. */
export const NEEDS_CONTACT: ReadonlySet<AgreementState> = new Set<AgreementState>([
  'declined',
  'expired',
]);
