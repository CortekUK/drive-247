import { notFound } from 'next/navigation';
import { serverIsV2 } from '@/lib/v2-server';
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
 * `serverIsV2()` never throws: an unresolvable tenant, a missing row, a read
 * error, an unknown `portal_experience` value or a missing column GRANT all
 * fall through to `notFound()`. The gate fails closed onto the pre-existing
 * behaviour, never open onto unfinished code.
 *
 * It resolves BOTH sources — the `V2_AREAS` slug list and the tenant's own
 * `portal_experience` column — from one cached read, which is why it replaced
 * the bare `isV2(area, await tenantSlugFromHeaders())` this file used to call.
 * A self-serve tenant is flagged on the row and is in no slug list; gating this
 * route on the list alone while the v2 Settings navigation (which HIDES the
 * Stripe, Square, Twilio, Bonzah and BoldSign tabs because this board replaces
 * them) moved to the column would have left a brand-new tenant with no route at
 * all to Stripe onboarding.
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
  if (!(await serverIsV2('appearance'))) {
    notFound();
  }

  return <IntegrationsBoard />;
}
