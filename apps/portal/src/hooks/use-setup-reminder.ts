import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

interface TenantReminderFields {
  logo_url: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  integration_bonzah: boolean | null;
  bonzah_username: string | null;
}

export interface SetupReminderState {
  needsLogo: boolean;
  needsStripe: boolean;
  needsBonzah: boolean;
  allDone: boolean;
  isLoading: boolean;
}

/**
 * Tracks the three post-subscription setup tasks a new tenant still needs to
 * finish (logo, Stripe Connect, Bonzah insurance). Drives the recurring
 * setup-reminder dialog. Reads fresh values from the DB rather than the cached
 * tenant context so a task flips to "done" as soon as the tenant completes it.
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
            "logo_url, stripe_onboarding_complete, stripe_account_status, integration_bonzah, bonzah_username"
          )
          .eq("id", tenant!.id)
          .single(),
        (supabase as any)
          .from("bonzah_onboarding_submissions")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant!.id),
      ]);

      if (tenantRes.error) throw tenantRes.error;

      return {
        tenantFields: tenantRes.data as TenantReminderFields,
        bonzahSubmissionCount: (bonzahRes.count as number | null) ?? 0,
      };
    },
    enabled: !!tenant?.id,
    staleTime: 30_000,
  });

  const fields = query.data?.tenantFields;
  const bonzahSubmissionCount = query.data?.bonzahSubmissionCount ?? 0;

  const needsLogo = !fields?.logo_url;
  const needsStripe = !(
    fields?.stripe_onboarding_complete === true &&
    fields?.stripe_account_status === "active"
  );
  const bonzahConnected = !!fields?.integration_bonzah && !!fields?.bonzah_username;
  const needsBonzah = bonzahSubmissionCount === 0 && !bonzahConnected;

  const allDone = !needsLogo && !needsStripe && !needsBonzah;

  return {
    needsLogo,
    needsStripe,
    needsBonzah,
    allDone,
    isLoading: query.isLoading,
  };
}
