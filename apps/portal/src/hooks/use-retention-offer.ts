import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { RetentionOffer } from "@/lib/price-trail";

/**
 * The "stay" offer a tenant accepted in v2 Billing's cancel flow, if any — so
 * the price breakdown can show it as its own step.
 *
 * The cancel flow files it as a request in the platform queue
 * (`go_live_requests`, type subscription_cancellation) whose note starts
 * "RETENTION OFFER ACCEPTED — 10% off the next 3 bills…". A rejected one never
 * happened. The canary's sample account files nothing, so the flow notes it
 * for this browser tab instead (SAMPLE_RETENTION_KEY) and it's read from there.
 */

export const SAMPLE_RETENTION_KEY = "d247:sample-retention-offer";

function parse(note: string | null | undefined, at: string): RetentionOffer | null {
  const m = (note ?? "").match(/RETENTION OFFER ACCEPTED\D*(\d+)% off the next (\d+) bills/i);
  return m ? { percent: Number(m[1]), bills: Number(m[2]), acceptedAt: at } : null;
}

export function useRetentionOffer(sample: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["retention-offer", tenant?.id, sample],
    enabled: !!tenant?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<RetentionOffer | null> => {
      if (sample) {
        try {
          const raw = window.sessionStorage.getItem(SAMPLE_RETENTION_KEY);
          return raw ? (JSON.parse(raw) as RetentionOffer) : null;
        } catch {
          return null;
        }
      }
      const { data, error } = await supabaseUntyped
        .from("go_live_requests")
        .select("note, status, created_at")
        .eq("tenant_id", tenant!.id)
        .eq("integration_type", "subscription_cancellation")
        .ilike("note", "RETENTION OFFER ACCEPTED%")
        .neq("status", "rejected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return parse((data as { note: string | null }).note, (data as { created_at: string }).created_at);
    },
  });
}
