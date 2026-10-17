'use client';

import Link from 'next/link';
import { AutoSkeleton } from '@/components/skeleton-v2/auto-skeleton';
import { SupportEmptyArt } from '@/components/illustrations-v2/scenes/support';
import { SearchEmptyArt } from '@/components/illustrations-v2/empty-scenes';
import { useSkeletonLoading } from '@/hooks/use-skeleton-loading';
import { skeletonRows } from '@/lib/skeleton-data';
import { SupportWorkspace } from '../../../../../shared/trax-support/support-workspace';
import type { RecordLink } from '../../../../../shared/trax-support/ticket-info';
import type { SupportStates } from '../../../../../shared/trax-support/inbox-ui';
import type { SupportInboxState } from '../../../../../shared/trax-support/use-support-inbox';

/** The tenant's own record pages. A reference to anything else stays plain text. */
const RECORD_ROUTES: Record<string, string> = { rental: '/rentals/', vehicle: '/vehicles/', customer: '/customers/' };

const recordLink: RecordLink = ({ kind, id, children, className }) =>
  RECORD_ROUTES[kind] ? <Link href={RECORD_ROUTES[kind] + encodeURIComponent(id)} className={className}>{children}</Link> : null;

/** Placeholder rows and messages the skeleton draws the real list and bubbles from. */
const PLACEHOLDER_TICKETS = skeletonRows(6, (f) => ({
  id: f.id, reference: f.word(8, 10), summary: f.text(3, 8), preview: f.text(5, 10), status: 'open' as const,
  tenant_name: '', requester: '', updated_at: f.date(), created_at: f.date(),
}));
const PLACEHOLDER_MESSAGES = skeletonRows(7, (f, i) => ({ seq: i + 1, body: f.text(4, 16), created_at: f.date() }));

/** Support's loading and empty states, drawn the way every v2 page draws them. */
export function useSupportStates(): SupportStates {
  const hold = useSkeletonLoading(false);
  return {
    Skeleton: AutoSkeleton, hold, placeholders: PLACEHOLDER_TICKETS, placeholderMessages: PLACEHOLDER_MESSAGES,
    emptyArt: <SupportEmptyArt className="w-full" />, noMatchArt: <SearchEmptyArt className="w-full" />,
  };
}

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
export function SupportInboxView({ inbox, listInRail = false, listHeader, compact = false }: { inbox: SupportInboxState; listInRail?: boolean; listHeader?: React.ReactNode; compact?: boolean }) {
  const states = useSupportStates();
  return (
    <SupportWorkspace
      inbox={inbox}
      viewer="tenant"
      listInRail={listInRail}
      listHeader={listHeader}
      compact={compact}
      states={states}
      recordLink={recordLink}
      newTicketNote="Your message is shared with the Drive247 support team. Do not include credentials, card details or identity documents."
    />
  );
}
