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
 *
 * Bookings normally arrive by themselves: LeadConnector calls the
 * `onboarding-call-booked` edge function, which marks the row booked with the
 * call's time. `poll` re-reads every few seconds while the calendar is open so
 * the card switches to the checklist as soon as that lands.
 */

/** Brian's live booking calendar (LeadConnector). */
export const ONBOARDING_CALL_BOOKING_URL =
  "https://api.leadconnectorhq.com/widget/bookings/drive247-onboarding-call";

/**
 * The calendar, pre-filled with who is booking. The email is what the webhook
 * matches the booking to a tenant by, so pre-filling it with the signed-in
 * login's address is what makes the match reliable.
 */
export function onboardingCallBookingUrl(person: { email?: string | null; name?: string | null }): string {
  const url = new URL(ONBOARDING_CALL_BOOKING_URL);
  const [first, ...rest] = (person.name ?? "").trim().split(/\s+/).filter(Boolean);
  if (person.email) url.searchParams.set("email", person.email);
  if (first) url.searchParams.set("first_name", first);
  if (rest.length) url.searchParams.set("last_name", rest.join(" "));
  return url.toString();
}

export interface OnboardingCallState {
  eligible: boolean;
  callBookedAt: string | null;
  /** When the call is, if the booking came from the calendar. */
  callScheduledFor: string | null;
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
    callScheduledFor: str(r.call_scheduled_for),
    callCompletedAt: str(r.call_completed_at),
    sitePreviewedAt: str(r.site_previewed_at),
    dismissedAt: str(r.dismissed_at),
    vehicleCount: Number(r.vehicle_count) || 0,
    hasLogo: r.has_logo === true,
  };
}

export function useOnboardingCall({ poll = false }: { poll?: boolean } = {}) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const queryKey = ["onboarding-call", tenant?.id];

  const query = useQuery({
    queryKey,
    enabled: !!tenant?.id,
    staleTime: 60 * 1000,
    // Coming back from adding a vehicle or a logo in another tab ticks the box.
    refetchOnWindowFocus: true,
    // ...and so does coming back in the SAME tab. With only the staleTime, an
    // operator who added their first car and returned to the dashboard saw
    // "Add your first vehicle" still undone for up to a minute (QA sheet 15.2).
    refetchOnMount: "always",
    refetchInterval: poll ? 4000 : false,
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
