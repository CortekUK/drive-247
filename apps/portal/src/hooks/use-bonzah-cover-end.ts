import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getTodayInZone } from "@/lib/bonzah-dates";

/**
 * How far a rental's live Bonzah cover reaches, for Bonzah's rule that
 * insurance can never be added after a rental starts: an extension may only
 * continue cover that has not lapsed. bonzah-create-quote enforces the same.
 *
 * `coverEnd`: last covered date (YYYY-MM-DD), null when there is no live
 * policy, undefined while loading. `lapsed` stays false while loading so the
 * UI does not flash a refusal; the server is the backstop.
 */
export function useBonzahCoverEnd(
  rentalId: string | null | undefined,
  timeZone: string | null | undefined,
  enabled = true
) {
  const { data } = useQuery({
    queryKey: ["bonzah-cover-end", rentalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bonzah_insurance_policies")
        .select("trip_end_date")
        .eq("rental_id", rentalId!)
        .in("status", ["active", "payment_confirmed"])
        .order("trip_end_date", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.trip_end_date ? String(data[0].trip_end_date).slice(0, 10) : null;
    },
    enabled: enabled && !!rentalId,
  });
  const coverEnd: string | null | undefined = data;
  const lapsed = coverEnd !== undefined && (!coverEnd || coverEnd < getTodayInZone(timeZone));
  const lapsedReason = !lapsed
    ? null
    : coverEnd
      ? `Bonzah cover on this rental ended on ${coverEnd}. Bonzah only sells an extension before the current policy runs out, and insurance can never be added after a rental has started.`
      : "This rental has no Bonzah policy to extend, and Bonzah insurance can never be added after a rental has started.";
  return { coverEnd, lapsed, lapsedReason };
}
