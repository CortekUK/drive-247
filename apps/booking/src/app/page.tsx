import LegacyHome from '@/components/home/legacy-home';

/**
 * Tenant home page.
 *
 * This page previously chose between two designs per tenant, from the
 * `booking_v2_enabled` flag. The alternate design has been removed, so every
 * tenant serves the one home page.
 */
export default function Page() {
  return <LegacyHome />;
}
