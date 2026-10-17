'use client';

import { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui-v2/button';
import { useSupportInbox } from '../../../../../shared/trax-support/use-support-inbox';
import { useSupportRailHost } from '../../../../../shared/trax-support/support-rail';
import { SupportInboxView } from './support-inbox';
import { RetentionDialog } from './retention-dialog';
import { useSupportClient } from '@/hooks/use-support-messaging';
import { useTraxSupportOptional } from '@/components/trax/support/trax-support-context';
import { useIsLean } from '@/lib/lean-context';
import { useForcedEmptyState } from '@/hooks/use-forced-empty-state';
import { SupportTeachingEmptyState } from '@/components/empty-states/support-empty-state';

/**
 * The portal's Support section: tickets on the left, the human conversation in
 * the centre, and Details on the right.
 *
 * On a desktop the ticket list is in the Support RAIL — the sidebar's slot, which
 * on this route holds Back to portal, the tenant, New ticket and the tickets
 * instead of the portal navigation (support-rail.tsx, app-sidebar-v2.tsx). This
 * component owns the inbox and lends it to the rail; where the rail is not showing
 * the list (a phone, a collapsed sidebar) the page shows it, with its own heading.
 *
 * This is the ONE destination for support. The main sidebar's Support item and
 * TRAX's Support control both open it, so both entry points show the same
 * authorized tickets. TRAX itself is the AI conversation only — it renders no
 * tickets, and nothing here sends a tenant to the platform (super-admin) inbox
 * in the admin app.
 *
 * Tickets, messages, unread markers and permissions are the existing ones:
 * `useSupportInbox` over the `trax-messaging` endpoint. Nothing here creates a
 * ticket; the tenant's first Send does.
 *
 * TRAX does not raise tickets or hand issues over (removed 2026-10-16): a
 * ticket exists only because the tenant wrote one here.
 */
export function PortalSupport({ initialTicketId, embedded = false, newTicketRequest = 0, onNavChange, compact = embedded }: {
  initialTicketId?: string;
  /** Inside the Trax panel's Support tab: never the sidebar rail, and its own small header. */
  embedded?: boolean;
  /** The Trax panel's header Back: told what Back does now (null on the list) and whether a new ticket is open. */
  onNavChange?: (nav: { back: (() => void) | null; creating: boolean }) => void;
  /** Bumped by the Trax panel's header "New ticket" button: each new value opens the composer. */
  newTicketRequest?: number;
  /** One flat pane — the list or the open ticket. The panel turns it off when expanded. */
  compact?: boolean;
}) {
  const human = useSupportClient();
  const trax = useTraxSupportOptional();
  const support = trax?.support;
  const activate = trax?.activate;

  // Load the TRAX conversation: this section reads its capabilities (retention
  // management). Outside a Trax surface the
  // hook only fetches context once; it does not keep rechecking.
  useEffect(() => { activate?.(); }, [activate]);

  const inbox = useSupportInbox({ call: human.call, scope: human.scope, initialId: initialTicketId, uploadAttachment: human.uploadAttachment });
  const listInRail = useSupportRailHost(inbox, !embedded);

  /* Back lives in the panel's header: an open ticket goes back to the list, a
     new ticket cancels (its draft is kept by the inbox as before). */
  const { creating, id: openId, cancelNew, clearSelection } = inbox;
  useEffect(() => {
    onNavChange?.({ back: creating ? cancelNew : openId ? clearSelection : null, creating });
  }, [onNavChange, creating, openId, cancelNew, clearSelection]);
  useEffect(() => () => onNavChange?.({ back: null, creating: false }), [onNavChange]);

  /* The panel's header button. Only a NEW value acts, so remounting with the
     same count opens nothing, and a send in flight is never interrupted. */
  const beginNew = inbox.beginNew;
  const lastNewTicketRequest = useRef(newTicketRequest);
  useEffect(() => {
    if (newTicketRequest === lastNewTicketRequest.current) return;
    lastNewTicketRequest.current = newTicketRequest;
    if (!inbox.busy && !inbox.creating) beginNew();
  }, [newTicketRequest, beginNew, inbox.busy, inbox.creating]);

  /* No tickets at all (lean only): the workspace steps aside for the teaching
     empty state. "At all" means the unfiltered list came back empty and settled
     without an error, nothing is open or being written, and the tenant did not
     arrive with a ticket to open. Starting a ticket from
     the tile (or the rail) flips `creating`, which brings the composer back.
     `devForceEmpty` is the /dev preview switch, inert outside development and
     inside the lean gate. */
  const leanTenant = useIsLean();
  const devForceEmpty = useForcedEmptyState('support');
  const untouched = !inbox.id && !inbox.creating && !initialTicketId;
  const teachEmptySupport =
    leanTenant &&
    untouched &&
    ((!inbox.loading && !inbox.error && !inbox.search && !inbox.filter && inbox.tickets.length === 0) || devForceEmpty);

  if (teachEmptySupport) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {/* On a desktop the rail carries the Support heading and New ticket;
            where it is not showing, the page keeps its own heading. */}
        {!listInRail && (
          <header className="shrink-0 px-1 pb-2">
            <h1 className="text-base font-semibold tracking-tight">Support</h1>
            <p className="text-[12.5px] text-muted-foreground">Get help from the Drive247 support team.</p>
          </header>
        )}
        <div className="flex flex-1 items-center justify-center pb-6">
          <SupportTeachingEmptyState onNewTicket={inbox.beginNew} disabled={inbox.busy || inbox.creating} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">

      <SupportInboxView
        inbox={inbox}
        listInRail={listInRail}
        compact={compact}
        /* In the panel, New ticket sits in the panel's own header (newTicketRequest). */
        listHeader={embedded ? undefined : (
          /* Only where the page shows the list itself. Title and actions, no decorative icon. */
          <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight">Support</h1>
              <p className="truncate text-[11.5px] text-muted-foreground">Get help from the Drive247 support team.</p>
            </div>
            {support?.capabilities?.managePolicy && <RetentionDialog compact />}
            <Button size="sm" className="gap-1.5" disabled={inbox.busy || inbox.creating} onClick={inbox.beginNew}>
              <Plus className="size-4" aria-hidden />
              New ticket
            </Button>
          </header>
        )}
      />
    </div>
  );
}
