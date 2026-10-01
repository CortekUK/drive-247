"use client";

import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * The tenant's dark-mode square icon (`tenants.dark_favicon_url`, v2 Branding).
 *
 * Its own query rather than a column in `useTenantBranding`, which v1 shares:
 * adding a column to that select would put v1's branding at the mercy of this
 * one. Here a failed read is simply `null`, which every reader treats as "not
 * uploaded" — the square icon then stands in, with the automatic dark-mode
 * backing from lib/appearance/logo-tone.ts.
 */
export const tenantDarkIconKey = (tenantId: string | null | undefined) => ["tenant-dark-icon", tenantId] as const;

export function useTenantDarkIcon() {
  const { tenant } = useTenant();
  const query = useQuery({
    queryKey: tenantDarkIconKey(tenant?.id),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabaseUntyped
        .from("tenants")
        .select("dark_favicon_url")
        .eq("id", tenant!.id)
        .single();
      if (error) return null;
      return (data as { dark_favicon_url?: string | null } | null)?.dark_favicon_url ?? null;
    },
    enabled: !!tenant?.id,
    staleTime: 30 * 1000,
  });
  return {
    darkIconUrl: query.data ?? null,
    /** True once the value is known (or there is no tenant to ask about). */
    isLoaded: !tenant?.id || !query.isLoading,
  };
}
