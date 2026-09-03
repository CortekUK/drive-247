import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import {
  isRentalCreationBlocked,
  type StripeConnectTenant,
} from "@/lib/stripe-connect-status";

/**
 * Should the New Rental flow be blocked because Stripe Connect is not usable?
 *
 * Lean tenants only — see isRentalCreationBlocked for why this must not go
 * global. The query is skipped entirely for non-lean tenants, so the other ~35
 * production tenants pay nothing for this gate: no extra round trip, and
 * `blocked` is a constant false for them.
 *
 * The Connect columns are NOT on TenantContext (it carries branding and
 * operational config, not the Express/OAuth account fields), so they are read
 * here — the same columns, and the same rule, as use-setup-status.
 */
export function useRentalCreationGate() {
  const { tenant, tenantSlug } = useTenant();
  const lean = isLeanTenant(tenantSlug);

  const { data, isLoading } = useQuery({
    queryKey: ["rental-creation-gate", tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select(
          "stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id",
        )
        .eq("id", tenant!.id)
        .single();

      if (error) throw error;
      return data as StripeConnectTenant;
    },
    // Only lean tenants can be blocked, so only they need the lookup.
    enabled: !!tenant?.id && lean,
    staleTime: 15_000,
  });

  return {
    /** True only for a lean tenant whose Connect account cannot take money. */
    blocked: isRentalCreationBlocked(data, tenantSlug),
    /** True while the lookup is in flight; callers must not block on unknown. */
    isLoading: lean && isLoading,
  };
}
