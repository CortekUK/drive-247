'use client';

import { useSidebar } from '@/components/admin/SidebarContext';
import { TicketList } from '../../../../shared/trax-support/inbox-ui';
import { useSupportRail } from '../../../../shared/trax-support/support-rail';

/**
 * The platform Support rail: on `/admin/support` it takes the navigation
 * sidebar's slot, as the portal's Support rail does for tenants, so the page is
 * tickets | conversation | details rather than four columns. The navigation comes
 * back on every other admin route.
 *
 * The inbox belongs to the page (SupportInbox), which lends it here; this rail
 * only renders the list and says whether it is on screen. On a phone it is not
 * mounted (the navigation stays a sheet behind the header's menu button) and the
 * page shows the list itself.
 */
export function AdminSupportRail() {
  const { isMobile } = useSidebar();
  const inbox = useSupportRail(!isMobile);
  if (isMobile) return null;

  return (
    <aside aria-label="Support" className="flex h-screen w-[340px] shrink-0 flex-col">
      {/* Support opens in its own browser tab, so there is no way "back" here. No
          visible heading: the rail starts with the search. */}
      <h1 className="sr-only">Support</h1>
      <div aria-hidden className="h-4 shrink-0" />
      {inbox ? (
        <TicketList inbox={inbox} admin />
      ) : (
        <p className="px-4 py-6 text-[12px] leading-relaxed text-muted-foreground">Tickets appear here once your support access is confirmed.</p>
      )}
    </aside>
  );
}
