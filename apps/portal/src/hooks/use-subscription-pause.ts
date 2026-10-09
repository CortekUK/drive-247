import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/**
 * Subscription pausing (v2 Billing → Pause).
 *
 * `eligible` comes from Super Admin → Customer management → Pausing Accounts:
 * the pilot tenant only, or every v2 tenant. `pausedNow` is true while today
 * falls inside a booked pause — the same rule the database uses to refuse new
 * rentals, vehicles and customers.
 *
 * Every change goes through the `subscription-pause` edge function, which
 * checks the rules again and talks to Stripe.
 */

export interface SubscriptionPause {
  id: string;
  start_date: string;
  end_date: string;
  months: 1 | 2;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active";
  stripe_status: "pending" | "applied" | "failed" | "resumed" | "not_needed";
}

export interface SubscriptionPauseState {
  eligible: boolean;
  pausedNow: boolean;
  pause: SubscriptionPause | null;
}

const KEY = "subscription-pause";

export function useSubscriptionPause(enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: [KEY, tenant?.id],
    enabled: enabled && !!tenant?.id,
    // A pause starts and ends on a date, not on a row change.
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<SubscriptionPauseState> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_my_subscription_pause", { p_tenant_id: tenant!.id });
      if (error) throw error;
      return {
        eligible: !!data?.eligible,
        pausedNow: !!data?.paused_now,
        pause: (data?.pause as SubscriptionPause | null) ?? null,
      };
    },
  });
}

/** The edge function's own message, not supabase-js's "non-2xx status code". */
async function invokePause(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("subscription-pause", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      const parsed = await context.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useSubscriptionPauseActions() {
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [KEY, tenant?.id] });
    void queryClient.invalidateQueries({ queryKey: ["tenant-subscription"] });
  };

  const request = useMutation({
    mutationFn: (dates: { startDate: string; endDate: string }) => invokePause({ action: "request", ...dates }),
    onSuccess: refresh,
  });
  const end = useMutation({
    mutationFn: () => invokePause({ action: "end" }),
    onSuccess: refresh,
  });
  return { request, end };
}
