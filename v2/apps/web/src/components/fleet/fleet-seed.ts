/**
 * Server-side first paint for /fleet.
 *
 * `useVehicles()` is a client hook, so on its own the fleet page ships HTML that
 * contains a skeleton and nothing else: no car names for a crawler, a blank
 * frame for a slow connection, and nothing at all for anyone reading the
 * response with `curl`. This module fetches the same rows on the server so the
 * page arrives populated, and hands the list to the client component as a prop.
 *
 * The prop is used as the FIRST RENDER on both sides — server render and the
 * browser's hydration pass — so the two are identical by construction. It is
 * then replaced by the live React Query result the moment it lands, which is
 * what keeps this a first-paint optimisation rather than a second, divergent
 * source of truth.
 *
 * NOT a client module. It imports the Supabase client directly and must only
 * ever be called from a Server Component.
 */

import { supabase } from '@/integrations/supabase/client';
import { VEHICLE_PHOTO_COLUMNS, vehiclePublicColumns } from '@/lib/domain';
import type { PublicVehicleRowWithPhotos } from '@/lib/vehicles/types';

import { fleetVehicleFromRow, type FleetSeed } from './fleet-vehicle';

/**
 * The tenant fields the cards need, plus the plate flag the column allowlist
 * consults. Explicit list, never `select('*')`.
 */
const SEED_TENANT_SELECT = 'id, currency_code, distance_unit, hide_vehicle_registration';

interface SeedTenant {
  id: string;
  currency_code: string | null;
  distance_unit: string | null;
  hide_vehicle_registration: boolean | null;
}

/**
 * Bound on the seed payload. It travels inside the HTML document, so an
 * operator with a 400-car fleet must not push a megabyte of JSON into the first
 * response; the client query (which is unlimited) fills in the rest a moment
 * later.
 */
const SEED_LIMIT = 48;

/**
 * Load the fleet for a tenant slug, or null when there is nothing to seed.
 *
 * Never throws: a failure here must degrade the page to the client-side
 * loading state, not replace it with an error boundary.
 */
export async function loadFleetSeed(
  slug: string | null | undefined,
): Promise<FleetSeed | null> {
  const tenantSlug = typeof slug === 'string' ? slug.trim() : '';
  if (tenantSlug === '') return null;

  try {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(SEED_TENANT_SELECT)
      // Suspended tenants still resolve, matching TenantContext — the site says
      // "unavailable" rather than rendering as an untenanted shell.
      .in('status', ['active', 'suspended'])
      .eq('slug', tenantSlug)
      .maybeSingle()
      .overrideTypes<SeedTenant, { merge: false }>();

    if (tenantError || !tenant) {
      if (tenantError) {
        console.error('[fleet-seed] Failed to resolve tenant', {
          slug: tenantSlug,
          message: tenantError.message,
          code: tenantError.code,
        });
      }
      return null;
    }

    const { data, error } = await supabase
      .from('vehicles')
      // Allowlist, never `select('*')`: that table has RLS off and a
      // table-level anon grant, so `*` ships lockbox_code, purchase_price,
      // security_notes and owner_id to anyone holding the public key.
      .select(vehiclePublicColumns(tenant, VEHICLE_PHOTO_COLUMNS))
      // The isolation boundary, not an optimisation — see above.
      .eq('tenant_id', tenant.id)
      // Mirrors useVehicles: a rented car stays listed because it may be free
      // on other dates; anything else (Maintenance, Sold…) is off the market.
      .or('status.ilike.available,status.ilike.rented')
      .eq('is_paused', false)
      // `NOT TRUE`, not `= false`: the column is nullable and `= false` would
      // drop every row that never had it set.
      .not('is_disposed', 'is', true)
      .order('display_order', {
        referencedTable: 'vehicle_photos',
        ascending: true,
        nullsFirst: false,
      })
      .order('daily_rent', { ascending: true, nullsFirst: false })
      .order('make', { ascending: true, nullsFirst: false })
      .order('model', { ascending: true, nullsFirst: false })
      .limit(SEED_LIMIT)
      .overrideTypes<PublicVehicleRowWithPhotos[], { merge: false }>();

    if (error) {
      console.error('[fleet-seed] Failed to load vehicles', {
        tenantId: tenant.id,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return null;
    }

    return {
      currencyCode: tenant.currency_code,
      distanceUnit: tenant.distance_unit,
      vehicles: (data ?? []).map((row) => fleetVehicleFromRow(row, tenant)),
    };
  } catch (cause) {
    console.error('[fleet-seed] Unexpected failure', cause);
    return null;
  }
}
