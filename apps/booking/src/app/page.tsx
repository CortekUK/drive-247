import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import BookingV2Landing from '@/components/booking-v2/landing';
import LegacyHome from '@/components/home/legacy-home';

/**
 * Tenant home page.
 *
 * Which design renders is decided HERE, on the server, from the tenant's
 * `booking_v2_enabled` flag — not in a client effect. Resolving it after
 * hydration would either blank the page for every tenant while the flag loads,
 * or paint the legacy home first and swap, which reads as a broken page on the
 * tenants that have v2 switched on.
 *
 * Same `x-tenant-slug` path the root layout already uses for metadata and
 * theme, so this adds one small query to a request that was never static
 * (the root layout is `force-dynamic`).
 *
 * The flag is scoped to this page only. /fleet, /booking, /about and the
 * customer portal are untouched by it.
 */
async function isBookingV2Enabled(): Promise<boolean> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get('x-tenant-slug');
    if (!tenantSlug || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return false;
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    const { data } = await supabase
      .from('tenants')
      .select('booking_v2_enabled')
      .eq('slug', tenantSlug)
      .maybeSingle();
    return data?.booking_v2_enabled === true;
  } catch {
    // Never let a flag lookup take the home page down — fall back to the
    // design every tenant already has.
    return false;
  }
}

export default async function Page() {
  return (await isBookingV2Enabled()) ? <BookingV2Landing /> : <LegacyHome />;
}
