import { notFound } from 'next/navigation';
import { isV2 } from '@/lib/v2';
import { tenantSlugFromHeaders } from '@/lib/tenant-server';
import { IntegrationsBoard } from './integrations-board';

/**
 * Integrations — a v2 route with no v1 counterpart.
 *
 * The gate is resolved HERE, on the server, once, before anything renders —
 * see V2_PLAN.md §3. This file is the entire branch; nothing below it knows a
 * gate exists. It copies `settings/appearance/page.tsx` exactly, because the
 * shape is the same: a brand-new route rather than a strangled screen.
 *
 * So the off state is `notFound()` rather than a legacy component — a tenant
 * that is not on v2 sees the portal's normal 404, exactly as it did yesterday
 * when this route did not exist at all. No v1 behaviour changes for anyone,
 * because there is no v1 behaviour here to change.
 *
 * `tenantSlugFromHeaders()` never throws and returns null on any failure, so an
 * unresolvable tenant falls through to `notFound()` too. The gate fails closed
 * onto the pre-existing behaviour, never open onto unfinished code.
 *
 * It rides the existing `appearance` area rather than adding one: this is the
 * same v2 look-and-feel work, gated to the same canary, and `lib/v2.ts` is
 * owned elsewhere right now.
 *
 * The board itself is a Client Component (dialog + switch state) and lives in
 * a sibling file, because a Server Component is what makes the gate resolvable
 * without a flash — the two cannot be the same file.
 */
export default async function IntegrationsPage() {
  const tenantSlug = await tenantSlugFromHeaders();

  if (!isV2('appearance', tenantSlug)) {
    notFound();
  }

  return <IntegrationsBoard />;
}
