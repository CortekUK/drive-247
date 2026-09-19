import { headers } from "next/headers";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { CBP_SEED_COLUMNS, toCbpSeed, type CbpSeed } from "@/components/custom-booking-page/seed";

/**
 * Which site this tenant is on, resolved on the server for the request in hand.
 *
 * `booking_v2_enabled` is the switch a super admin flips in the platform's
 * back-office. It is read here rather than in the browser on purpose: the home
 * page must be the right site in the first response, not swap after hydration,
 * and a visitor must never be able to talk their way onto a site the operator
 * has not turned on.
 *
 * The database is the authority on both halves — who may turn the switch on
 * (super admins only) and which tenants may have it on at all (an eligibility
 * flag the tenant cannot write). Nothing here needs to know any tenant's name.
 */
export interface CbpSiteState {
  /** True when this tenant's custom site should serve the home page. */
  enabled: boolean;
  /** Identity for the first paint, when enabled. */
  seed: CbpSeed | null;
}

const OFF: CbpSiteState = { enabled: false, seed: null };

export async function getCbpSiteState(): Promise<CbpSiteState> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");
    if (!tenantSlug) return OFF;

    // The app's own public client, not a fresh one built from process.env.
    // This project runs without a workspace .env — the client module carries
    // the project's public URL and anon key as fallbacks, and a local
    // createClient reading process.env directly silently produced no config
    // and sent every tenant to the legacy site.
    const supabase = supabaseUntyped;

    // One round trip for the switch and the seed together — this runs on the
    // hot path of every home-page request.
    const { data } = await supabase
      .from("tenants")
      .select(`booking_v2_enabled, custom_site_eligible, ${CBP_SEED_COLUMNS}`)
      .eq("slug", tenantSlug)
      .maybeSingle();

    const row = data as Record<string, unknown> | null;
    // Eligibility is checked here as well as in the database. The trigger stops
    // the switch being turned on; this stops a row that predates the trigger,
    // or one restored from an old backup, from quietly serving the wrong site.
    const enabled = !!row?.booking_v2_enabled && !!row?.custom_site_eligible;

    return enabled ? { enabled, seed: toCbpSeed(row) } : OFF;
  } catch {
    // The legacy site is the safe answer: never take a tenant's home page down
    // because a flag could not be read.
    return OFF;
  }
}
