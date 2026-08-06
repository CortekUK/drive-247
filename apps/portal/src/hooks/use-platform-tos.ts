"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Whether this tenant has already accepted the Drive247 platform Terms of
 * Service, so consent surfaces can stop asking once they have.
 *
 * WHY A DEDICATED HOOK AND NOT TenantContext.
 * TenantContext's TENANT_CORE_COLUMNS select runs on the ANON key — it resolves
 * the tenant on the login page, where there is no session yet. `anon` holds
 * COLUMN-level grants on tenants (230 of them) and no table-level grant, and
 * Postgres refuses the WHOLE ROW when any selected column is ungranted rather
 * than returning null for it. So adding an ungranted column to that list takes
 * down login and branding for every tenant at once — which has already happened
 * once in this codebase, with customer_theme_mode.
 *
 * platform_tos_* is deliberately NOT granted to anon (it is an audit record, and
 * nothing pre-auth needs it). Reading it through this hook instead keeps it on
 * the `authenticated` role, which already holds a table-level SELECT, so no
 * grant is required and the login path is untouched.
 *
 * DO NOT "simplify" this by moving these columns into TENANT_CORE_COLUMNS.
 */
export function usePlatformTos() {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["platform-tos", tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("platform_tos_accepted_at, platform_tos_version")
        .eq("id", tenant!.id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!tenant?.id,
    staleTime: 5 * 60_000,
    // This hook fails CLOSED, so every retry is time the tenant spends looking
    // at a Buy Credits button that is disabled for reasons not yet on screen.
    // A single-row read by primary key either works or is failing for a reason
    // three exponential backoffs will not fix, so surface it immediately and
    // let the consent gate render.
    retry: false,
  });

  return {
    ...query,
    acceptedAt: query.data?.platform_tos_accepted_at ?? null,
    acceptedVersion: query.data?.platform_tos_version ?? null,
    hasAccepted: !!query.data?.platform_tos_accepted_at,
    /**
     * Fail CLOSED while unknown: until we have actually read the row, assume
     * consent is still needed. Showing the checkbox to someone who already
     * accepted is a minor annoyance; skipping it because a query was still in
     * flight would take money with no acceptance on record.
     */
    needsAcceptance: !query.data || !query.data.platform_tos_accepted_at,
  };
}
