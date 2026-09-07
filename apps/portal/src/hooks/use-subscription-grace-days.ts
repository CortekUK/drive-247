import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped as supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";

/**
 * How long a tenant keeps working after a payment fails — SUPER ADMIN SETTING,
 * not a constant in the code.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 *
 * `use-tenant-subscription.ts` carried `const GRACE_DAYS = 7`. That number
 * decides when a paying business loses access to its own bookings, and changing
 * it meant a deploy. It now lives in `admin_settings.subscription_grace_days`
 * alongside the subscription kill-switch, so a super admin can set 3, 7, 10 or
 * 14 days from the admin dashboard and every tenant follows it.
 *
 * ── which row wins ──────────────────────────────────────────────────────────
 *
 * `admin_settings` has four rows. The admin settings page edits the OLDEST
 * (`created_at asc limit 1`) and mirrors the global flags across the rest, so
 * this reads that same row rather than inventing its own rule — a `max()` or an
 * "any row" reading could disagree with the number the super admin is looking
 * at while they change it.
 *
 * ── what happens when it cannot be read ─────────────────────────────────────
 *
 * DEFAULT_GRACE_DAYS, which is the value the column was created with and the
 * value the product had before it was configurable. Signed out, offline or
 * mid-flight, a tenant gets the historical behaviour rather than 0 — a config
 * read that fails must never be the thing that locks somebody out.
 */

/** The behaviour before this was configurable, and the column's own default. */
export const DEFAULT_GRACE_DAYS = 7;

/** The choices the admin dashboard offers. The column accepts 0–90. */
export const GRACE_DAYS_OPTIONS = [3, 7, 10, 14, 30] as const;

export function useSubscriptionGraceDays(): number {
  const { session, user } = useAuth();

  const { data } = useQuery({
    queryKey: ["subscription-grace-days", user?.id ?? "anon"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_settings")
        .select("subscription_grace_days")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const raw = (data as { subscription_grace_days?: number | null } | null)
        ?.subscription_grace_days;

      /* A null, a string, or something out of range is not a policy — it is a
         bad read, and a bad read must not shorten anybody's window. */
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 90) {
        return DEFAULT_GRACE_DAYS;
      }
      return Math.floor(raw);
    },
    /* Same gate the kill-switch uses: no identity, no request. */
    enabled: !!session,
    staleTime: 60_000,
    refetchInterval: 300_000,
  });

  return data ?? DEFAULT_GRACE_DAYS;
}
