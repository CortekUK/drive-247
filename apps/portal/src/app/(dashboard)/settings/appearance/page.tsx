import { notFound } from 'next/navigation';
import { isV2 } from '@/lib/v2';
import { tenantIdFromHeaders } from '@/lib/tenant-server';
import { AppearanceSettings } from '@/components/settings/appearance/appearance-settings';

/**
 * Settings → Appearance — the first v2 area in the portal.
 *
 * The gate is resolved HERE, on the server, once, before anything renders —
 * see V2_PLAN.md §3. This file is the entire branch; nothing below it knows a
 * gate exists.
 *
 * Unlike a strangled screen, this route has no v1 counterpart: Appearance is
 * new. So the off state is `notFound()` rather than a legacy component — a
 * tenant that is not on v2 sees the portal's normal 404, exactly as it did
 * yesterday when this route did not exist at all. No v1 behaviour changes for
 * anyone, because there is no v1 behaviour here to change.
 *
 * `tenantIdFromHeaders()` never throws and returns null on any failure, so an
 * unresolvable tenant falls through to `notFound()` too. The gate fails closed
 * onto the pre-existing behaviour, never open onto unfinished code.
 *
 * The screen itself reuses the EXISTING `settings.branding` manager-permission
 * key via `canEditSettings('branding')`, so this ships without touching
 * `lib/permissions.ts` — no new tab key, no fail-open path to get wrong.
 */
export default async function AppearancePage() {
  const tenantId = await tenantIdFromHeaders();

  if (!isV2('appearance', tenantId)) {
    notFound();
  }

  return <AppearanceSettings />;
}
