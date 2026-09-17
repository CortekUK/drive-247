import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
import { SupportView } from './support-view';

/**
 * Support — the portal's human-support section, and the only place tenants
 * manage tickets. The profile menu's Support item and TRAX's Support control
 * both open this route, so both show the same authorized records.
 *
 * Gated on the server like the other v2-only routes (see insights/page.tsx):
 * human support messaging follows the same `chrome` rollout the TRAX endpoints
 * enforce server-side, so a tenant outside it gets the portal's normal 404
 * rather than a screen whose every request would be refused. The gate fails
 * closed on an unresolvable tenant.
 *
 * The platform (super-admin) inbox stays in the admin app; nothing here sends a
 * tenant there.
 */
export default async function SupportPage() {
  if (!(await serverIsV2('chrome'))) {
    notFound();
  }

  /* The dashboard layout bounds this route's height (isSupportWorkspace) and
     drops main's padding, so the section supplies its own and fills what is
     left: the list and the conversation scroll, the page itself does not. */
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading Support…</p>}>
        <SupportView />
      </Suspense>
    </div>
  );
}
