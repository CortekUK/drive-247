import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * The free 30-minute onboarding call: the card's state (feat-001 spec 04.27).
 *
 * Reads `get_my_onboarding_call()`, which finds the caller's own company on the
 * server and returns NULL for anyone without one (a super admin looking at a
 * company), so the card does not render for them. `mark_my_onboarding_call`
 * lets an owner say they previewed their site or hide the card, never that the
 * call happened: that is Bryan's to record.
 */

/** offer: not booked. booked: booked, in the future. waiting: its time passed, Bryan has not marked it. none: done, hidden or not on offer. */
export type CallState = "offer" | "booked" | "waiting" | "none";

export interface CallBookingSummary {
  id: string;
  startsAt: string;
  endsAt: string;
  customerTimezone: string | null;
  icsToken: string | null;
  meetingUrl: string | null;
}

export interface OnboardingCallState {
  eligible: boolean;
  callState: CallState;
  callBookedAt: string | null;
  /** When the call is. */
  callScheduledFor: string | null;
  callCompletedAt: string | null;
  sitePreviewedAt: string | null;
  dismissedAt: string | null;
  booking: CallBookingSummary | null;
  vehicleCount: number;
  hasLogo: boolean;
}

export type OnboardingCallStep = "booked" | "unbooked" | "site_previewed" | "dismissed";

function parse(raw: unknown): OnboardingCallState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const b = r.booking && typeof r.booking === "object" ? (r.booking as Record<string, unknown>) : null;
  const state = str(r.call_state);
  return {
    eligible: r.eligible === true,
    callState: state === "offer" || state === "booked" || state === "waiting" ? state : "none",
    callBookedAt: str(r.call_booked_at),
    callScheduledFor: str(r.call_scheduled_for),
    callCompletedAt: str(r.call_completed_at),
    sitePreviewedAt: str(r.site_previewed_at),
    dismissedAt: str(r.dismissed_at),
    booking: b
      ? {
          id: String(b.id),
          startsAt: String(b.starts_at),
          endsAt: String(b.ends_at),
          customerTimezone: str(b.customer_timezone),
          icsToken: str(b.ics_token),
          meetingUrl: str(b.meeting_url),
        }
      : null,
    vehicleCount: Number(r.vehicle_count) || 0,
    hasLogo: r.has_logo === true,
  };
}

export function useOnboardingCall({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["onboarding-call", tenant?.id];

  const query = useQuery({
    queryKey,
    // `enabled` lets a caller mounted for every tenant (the tour, in the
    // dashboard layout) keep this off outside the canary.
    enabled: !!tenant?.id && enabled,
    staleTime: 60 * 1000,
    // Coming back from adding a vehicle or a logo in another tab ticks the box,
    // and a move or cancel by Bryan shows on return.
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    // A booked call turns into "waiting" when its time comes: read again each minute.
    refetchInterval: poll ? 4000 : 60_000,
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
