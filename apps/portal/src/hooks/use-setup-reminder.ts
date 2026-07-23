import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface TenantReminderFields {
  logo_url: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  // Own-Stripe (migration/OAuth) connection — the operator's own account.
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  integration_bonzah: boolean | null;
  bonzah_username: string | null;
}

export interface SetupReminderState {
  needsLogo: boolean;
  needsStripe: boolean;
  needsBonzah: boolean;
  allDone: boolean;
  /**
   * True only once the underlying query has resolved successfully. The dialog
   * must gate on this rather than `!isLoading`: an errored query leaves every
   * field undefined, which would otherwise read as "nothing is set up" and nag
   * the tenant about tasks they have already completed.
   */
  isReady: boolean;
  isLoading: boolean;
}

/**
 * Tracks the three post-subscription setup tasks a new tenant still needs to
 * finish (logo, Stripe Connect, Bonzah insurance). Drives the recurring
 * setup-reminder dialog. Reads fresh values from the DB rather than the cached
 * tenant context so a task flips to "done" as soon as the tenant completes it.
 *
 * Completion rules are deliberately kept in step with the dashboard's own
 * checklist so the two can never disagree:
 *  - Stripe   → `use-setup-status.ts` (`stripe_onboarding_complete` + status active)
 *  - Bonzah   → `use-bonzah-balance.ts` `hasOwnCredentials`, plus an in-flight
 *               onboarding submission (pending/approved) so we stop nagging the
 *               moment the tenant has applied and is waiting on review.
 *  - Logo     → `use-platform-status.ts` `hasLogo` (`tenants.logo_url`)
 */
export function useSetupReminder(): SetupReminderState {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["setup-reminder", tenant?.id],
    queryFn: async () => {
      const [tenantRes, bonzahRes] = await Promise.all([
        (supabase as any)
          .from("tenants")
          .select(
            "logo_url, stripe_onboarding_complete, stripe_account_status, own_stripe_account_id, own_stripe_test_account_id, integration_bonzah, bonzah_username"
          )
          .eq("id", tenant!.id)
          .single(),
        // A rejected application does not count — the tenant still has work to do.
        (supabase as any)
          .from("bonzah_onboarding_submissions")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant!.id)
          .in("status", ["pending", "approved"]),
      ]);

      if (tenantRes.error) throw tenantRes.error;

      return {
        tenantFields: tenantRes.data as TenantReminderFields,
        // `null` = we could not determine it (RLS/network). Treated as "assume
        // handled" below so we never nag about a task that may already be done.
        bonzahSubmissionCount: bonzahRes.error
          ? null
          : ((bonzahRes.count as number | null) ?? 0),
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const fields = query.data?.tenantFields;
  const bonzahSubmissionCount = query.data?.bonzahSubmissionCount;

  const needsLogo = !fields?.logo_url;
  // Mirror use-setup-status.ts: an operator who connected their OWN Stripe
  // account via the migration/OAuth flow leaves the legacy Express fields empty
  // forever, so checking only those would keep nagging "Connect Stripe" after
  // they have already connected. An own-account connection (either mode) OR a
  // completed legacy Express onboarding counts as done.
  const ownStripeConnected =
    !!fields?.own_stripe_account_id || !!fields?.own_stripe_test_account_id;
  const needsStripe = !(
    ownStripeConnected ||
    (fields?.stripe_onboarding_complete === true &&
      fields?.stripe_account_status === "active")
  );
  // Mirrors `hasOwnCredentials` in use-bonzah-balance.ts.
  const bonzahConnected = !!fields?.integration_bonzah && !!fields?.bonzah_username;
  const needsBonzah = bonzahSubmissionCount === 0 && !bonzahConnected;

  const allDone = !needsLogo && !needsStripe && !needsBonzah;

  return {
    needsLogo,
    needsStripe,
    needsBonzah,
    allDone,
    isReady: query.isSuccess,
    isLoading: query.isLoading,
  };
}
