'use client';

import { useSearchParams } from 'next/navigation';
import { PortalSupport } from '@/components/support/portal-support';

/**
 * Query parameter, optional:
 *   ?ticket=<id>  open that existing conversation (the unread badge links here).
 */
export function SupportView() {
  const query = useSearchParams();
  const ticket = query.get('ticket') ?? undefined;
  return <PortalSupport initialTicketId={ticket} />;
}
