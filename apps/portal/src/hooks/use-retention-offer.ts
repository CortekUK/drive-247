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
  const m = (note ?? "").match(/RETENTION OFFER ACCEPTED\D*(\d+)% off the next (\d+) bills?/i);
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

/**
 * What the cancel flow's "The price is too high" offer is for THIS tenant, set
 * by a super admin (Customer management → Tiered retention offers): a default
 * for everyone or a per-tenant override. One per tenant, ever — once used,
 * `available` is false for good and `redemption` says what they had.
 */
export interface RetentionOfferTerms {
  available: boolean;
  percent: number;
  months: number;
  redemption: { percent: number; months: number; accepted_at: string; ends_at: string | null } | null;
}

/** The platform default, for the canary's sample account and a failed read. */
export const DEFAULT_RETENTION_TERMS: RetentionOfferTerms = { available: true, percent: 10, months: 1, redemption: null };

export function useRetentionOfferTerms(sample: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["retention-offer-terms", tenant?.id, sample],
    enabled: !!tenant?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<RetentionOfferTerms> => {
      if (sample) {
        try {
          const raw = window.sessionStorage.getItem(SAMPLE_RETENTION_KEY);
          if (raw) {
            const used = JSON.parse(raw) as RetentionOffer;
            return {
              ...DEFAULT_RETENTION_TERMS,
              available: false,
              redemption: { percent: used.percent, months: used.bills, accepted_at: used.acceptedAt, ends_at: null },
            };
          }
        } catch {
          /* fall through to the default */
        }
        return DEFAULT_RETENTION_TERMS;
      }
      const { data, error } = await supabaseUntyped.rpc("get_my_retention_offer");
      if (error || !data) throw error ?? new Error("No offer");
      const d = data as Partial<RetentionOfferTerms>;
      return {
        available: d.available === true,
        percent: Number(d.percent) || DEFAULT_RETENTION_TERMS.percent,
        months: Number(d.months) || DEFAULT_RETENTION_TERMS.months,
        redemption: d.redemption ?? null,
      };
    },
  });
}
