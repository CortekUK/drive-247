'use client';

import { useSearchParams } from 'next/navigation';
import { PortalSupport } from '@/components/support/portal-support';

/**
 * Query parameters, both optional:
 *   ?ticket=<id>  open that existing conversation (TRAX uses it when the issue
 *                 already has a ticket, and the unread badge links here).
 *   ?issue=<id>   open the new-request composer for that TRAX issue, carrying
 *                 its authorized redacted context. Opening creates nothing.
 */
export function SupportView() {
  const query = useSearchParams();
  const ticket = query.get('ticket') ?? undefined;
  const issue = query.get('issue') ?? undefined;
  return <PortalSupport initialTicketId={ticket} composeIssueId={issue} />;
}
