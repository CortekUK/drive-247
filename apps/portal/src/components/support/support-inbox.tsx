'use client';

import Link from 'next/link';
import { SupportWorkspace } from '../../../../../shared/trax-support/support-workspace';
import type { RecordLink } from '../../../../../shared/trax-support/ticket-info';
import type { SupportInboxState } from '../../../../../shared/trax-support/use-support-inbox';

/** The tenant's own record pages. A reference to anything else stays plain text. */
const RECORD_ROUTES: Record<string, string> = { rental: '/rentals/', vehicle: '/vehicles/', customer: '/customers/' };

const recordLink: RecordLink = ({ kind, id, children, className }) =>
  RECORD_ROUTES[kind] ? <Link href={RECORD_ROUTES[kind] + encodeURIComponent(id)} className={className}>{children}</Link> : null;

/**
 * The tenant's Support workspace: the shared three-area layout (see
 * `shared/trax-support/support-workspace.tsx`) with the tenant's side of it — their
 * own tickets, "You" on the right, a read-only status, and linked records that
 * open the portal's own pages. The platform inbox renders the same workspace, so
 * the two read as one support system.
 *
 * All of the behaviour is `useSupportInbox`; the page owns the hook
 * (portal-support.tsx) because the Support rail reads it too.
 */
export function SupportInboxView({ inbox, listInRail = false, listHeader }: { inbox: SupportInboxState; listInRail?: boolean; listHeader?: React.ReactNode }) {
  return (
    <SupportWorkspace
      inbox={inbox}
      viewer="tenant"
      listInRail={listInRail}
      listHeader={listHeader}
      recordLink={recordLink}
      newTicketNote="Your message, and the TRAX troubleshooting context for this issue when there is one, are shared with support. Do not include credentials, card details or identity documents."
    />
  );
}
