import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { throwEdgeError } from "@/lib/edge-error";

/**
 * The operator's Drive247 referral programme — their code and link, their
 * reward on their OWN Drive247 bill, and who they referred. Served by the
 * `tenant-referrals` edge function, which checks the caller belongs to this
 * tenant and filters everything by it.
 *
 * Not the operator's renter promo codes (Settings → Promo codes): those give
 * THEIR customers money off bookings.
 */
export interface ReferralsData {
  enabled: boolean;
  subscribed: boolean;
  code: { code: string; link: string } | null;
  refereeOffer: { discountText: string; durationText: string } | null;
  standing: {
    activeReferrals: number;
    totalReferrals: number;
    reward: string | null;
    next: { needed: number; reward: string } | null;
    tiers: Array<{ min: number; reward: string }>;
    customTiers: boolean;
  };
  referrals: Array<{ id: string; name: string; counts: boolean; source: string; since: string }>;
  savedCents: number;
  joinedWith: {
    code: string | null;
    referrerName: string | null;
    discountText: string;
    durationText: string;
    endsAt: string | null;
    active: boolean;
    billsLeft: number | null;
  } | null;
  claims: Array<{ id: string; claimed_business_name: string; status: "pending" | "approved" | "rejected"; created_at: string }>;
}

export function useReferrals() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["tenant-referrals", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async (): Promise<ReferralsData> => {
      const { data, error } = await supabase.functions.invoke("tenant-referrals", {
        body: { tenantId: tenant!.id, action: "get" },
      });
      if (error) await throwEdgeError(error);
      return data as ReferralsData;
    },
  });
}

export function useReferralClaim() {
  const { tenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (claim: { businessName: string; contact?: string; note?: string }) => {
      const { data, error } = await supabase.functions.invoke("tenant-referrals", {
        body: { tenantId: tenant!.id, action: "claim", ...claim },
      });
      if (error) await throwEdgeError(error);
      return data as { success: true; claimId: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-referrals", tenant?.id] }),
  });
}
