import LegacyHome from '@/components/home/legacy-home';
import { SiteShell } from '@/components/custom-booking-page/site-shell';
import { HomeView } from '@/components/custom-booking-page/views';
import { getCbpSiteState } from './custom-booking-page/tenant-site';

/**
 * Tenant home page.
 *
 * Two designs share this route. Which one a visitor gets is the super admin's
 * `booking_v2_enabled` switch, resolved server-side per request so the correct
 * site is in the first response rather than swapped in after hydration.
 *
 * Off — and off is the default for every tenant — is the legacy home, byte for
 * byte what it has always been.
 */
export default async function Page() {
  const { enabled, seed } = await getCbpSiteState();

  if (!enabled) return <LegacyHome />;

  return (
    <SiteShell seed={seed}>
      <HomeView />
    </SiteShell>
  );
}
