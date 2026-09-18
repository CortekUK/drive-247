import { headers } from "next/headers";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { CBP_SEED_COLUMNS, toCbpSeed, type CbpSeed } from "@/components/custom-booking-page/seed";

/**
 * Resolve the operator's identity for the FIRST paint, from the same
 * `x-tenant-slug` header the root layout already uses for metadata and theme.
 *
 * Shared by every page of this site so each one is server-rendered as the
 * right operator; see `components/custom-booking-page/seed.ts` for why the
 * client-side tenant lookup is not enough on its own.
 */
export async function getCbpSeed(): Promise<CbpSeed | null> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");
    if (!tenantSlug) return null;
    // The app's own public client — see the note in tenant-site.ts. Reading
    // process.env here produced no config in a workspace with no .env, which
    // is every developer's checkout, so the seed silently never resolved.
    const supabase = supabaseUntyped;
    const { data } = await supabase
      .from("tenants")
      .select(CBP_SEED_COLUMNS)
      .eq("slug", tenantSlug)
      .maybeSingle();
    // The select list is a shared constant rather than a literal, so the typed
    // client cannot infer the row shape; `toCbpSeed` validates it instead.
    return toCbpSeed(data as Record<string, unknown> | null);
  } catch {
    // Never let the seed lookup take a page down — the client-side tenant
    // resolution still fills everything in a moment later.
    return null;
  }
}
