import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { isLeanTenant } from "@/lib/lean-areas";
import {
  dismissRentalGate,
  getRentalGateDismissalServerVersion,
  getRentalGateDismissalVersion,
  isRentalGateDismissed,
  subscribeRentalGateDismissal,
} from "@/lib/rental-gate-dismissal";
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
 *
 * DISMISSAL IS FOLDED INTO `blocked` ON PURPOSE
 * ---------------------------------------------
 * The /rentals/new route does not merely render the dialog: it early-returns
 * the dialog INSTEAD of the form. So a dismissal held as local dialog state
 * would close the dialog and leave the operator staring at nothing — the route
 * would still be refusing to build the form behind it.
 *
 * Making the dismissal part of `blocked` itself means the single boolean the
 * route already branches on becomes false, and the form renders on the very
 * next paint. Every other consumer (the New Rental buttons on /rentals,
 * rentals/[id] and customers/[id]) reads the same boolean, so a dismissal is
 * consistent across the whole visit rather than per-component.
 */
export function useRentalCreationGate() {
  const { tenant, tenantSlug } = useTenant();
  const lean = isLeanTenant(tenantSlug);

  // Re-render this consumer when any component dismisses the gate. The version
  // is only a change signal; the actual answer is read below, per slug.
  useSyncExternalStore(
    subscribeRentalGateDismissal,
    getRentalGateDismissalVersion,
    getRentalGateDismissalServerVersion,
  );

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

  /**
   * May this tenant dismiss the gate at all?
   *
   * Lean tenants only, and `isLeanTenant` already fails closed on a null or
   * not-yet-resolved slug — so an unknown tenant gets no close control and the
   * hard block stands. The safe default is the blocking one.
   */
  const canDismiss = lean;

  // Guarded by `canDismiss` so a stray call from a non-lean surface cannot
  // record a dismissal that would later be honoured if the tenant list changed.
  const dismissed = canDismiss && isRentalGateDismissed(tenantSlug);

  const dismiss = useCallback(() => {
    if (!isLeanTenant(tenantSlug)) return;
    dismissRentalGate(tenantSlug);
  }, [tenantSlug]);

  return {
    /**
     * True only for a lean tenant whose Connect account cannot take money and
     * who has not waved the gate away during this visit.
     */
    blocked: isRentalCreationBlocked(data, tenantSlug) && !dismissed,
    /** True while the lookup is in flight; callers must not block on unknown. */
    isLoading: lean && isLoading,
    /** True only for the canary: drives whether a close control may exist. */
    canDismiss,
    /** Records the dismissal for the rest of this visit. No-op if !canDismiss. */
    dismiss,
  };
}
