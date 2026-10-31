import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * The free 30-minute onboarding call (Nov 2026) — Portal V2 only.
 *
 * Reads `get_my_onboarding_call()`, which resolves the caller's own tenant on
 * the server and returns NULL for anyone without one (a super admin looking at
 * a tenant), so the card simply does not render for them. Writes go through
 * `mark_my_onboarding_call(step)` only: an operator can say they booked, that
 * they previewed their site, or hide the card — never that the call happened,
 * which is Brian's to record from the admin app.
 */

/** Brian's live booking calendar (LeadConnector). */
export const ONBOARDING_CALL_BOOKING_URL =
  "https://api.leadconnectorhq.com/widget/booking/WhGxejLXDJt4pN10JYUg";

export interface OnboardingCallState {
  eligible: boolean;
  callBookedAt: string | null;
  callCompletedAt: string | null;
  sitePreviewedAt: string | null;
  dismissedAt: string | null;
  vehicleCount: number;
  hasLogo: boolean;
}

export type OnboardingCallStep = "booked" | "unbooked" | "site_previewed" | "dismissed";

function parse(raw: unknown): OnboardingCallState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    eligible: r.eligible === true,
    callBookedAt: str(r.call_booked_at),
    callCompletedAt: str(r.call_completed_at),
    sitePreviewedAt: str(r.site_previewed_at),
    dismissedAt: str(r.dismissed_at),
    vehicleCount: Number(r.vehicle_count) || 0,
    hasLogo: r.has_logo === true,
  };
}

export function useOnboardingCall() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["onboarding-call", tenant?.id];

  const query = useQuery({
    queryKey,
    enabled: !!tenant?.id,
    staleTime: 60 * 1000,
    // Coming back from adding a vehicle or a logo in another tab ticks the box.
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabaseUntyped.rpc("get_my_onboarding_call");
      // A missing function (migration not applied) is "no card", never an error screen.
      if (error) return null;
      return parse(data);
    },
  });

  const mark = useMutation({
    mutationFn: async (step: OnboardingCallStep) => {
      const { error } = await supabaseUntyped.rpc("mark_my_onboarding_call", { p_step: step });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { state: query.data ?? null, isLoading: query.isLoading, mark };
}
