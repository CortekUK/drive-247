"use client";

import { useEffect } from "react";
import { supabaseUntyped } from "@/integrations/supabase/client";

/**
 * Long-rental discounts, applied where the staff create a booking.
 *
 * A promo code with `min_duration_days` set is not typed in — it is awarded by
 * how long the rental is. The customer booking site has done this since it was
 * built: it looks up the tenant's tiers, picks the best one the trip qualifies
 * for, and applies it with no code entered.
 *
 * THE PORTAL NEVER DID. It only ever carried the other half of the rule —
 * `/rentals/new` filters duration codes out of its promo picker and refuses
 * them if typed, on the grounds that they "apply automatically". Nothing in
 * the portal applied them. So on a booking taken over the phone the discount
 * was hidden, refused, and never granted.
 *
 * Found Sep 25 2026 from a support report: Moore Luxe's agent was with a
 * customer on a four-day rental, their LUXE code (12.5% at 4+ days) would not
 * go on, and the portal told her it applies automatically. It did not. Every
 * one of that tenant's bookings is made in the portal, and not one rental they
 * have ever taken carried a promo code — the deal had never once worked.
 *
 * Shared by both create screens rather than written twice, because the bug was
 * exactly that the two halves of one rule lived in different places.
 */

export interface AppliedPromo {
  code: string;
  type: "percentage" | "fixed_amount";
  value: number;
  id: string;
  /**
   * How it got here. A code the agent typed is `manual` and always wins — this
   * hook will never replace or clear one. `duration` is this hook's own, and
   * it withdraws it again when the booking stops qualifying.
   *
   * Optional because both screens had this shape before the field existed, and
   * a promo restored from a saved draft carries no source. Undefined is read as
   * "not ours", which is the safe way round: the worst case is that an
   * automatic discount is left alone, never that a typed one is overwritten.
   */
  source?: "manual" | "duration";
}

interface Options {
  tenantId: string | undefined | null;
  /** Nights, as the rest of the form counts them. 0/undefined while unset. */
  rentalDays: number | undefined | null;
  /**
   * False when an instalment plan is selected. Duration tiers are a
   * pay-in-full perk — the booking site withdraws them the same way, and the
   * two screens have to agree or the same rental prices differently depending
   * on who entered it.
   */
  payInFull: boolean;
  promo: AppliedPromo | null;
  setPromo: (next: AppliedPromo | null) => void;
}

interface TierRow {
  id: string;
  code: string;
  type: string;
  value: number | string;
  expires_at: string | null;
  min_duration_days: number | null;
  max_users: number | null;
}

export function useDurationPromo({
  tenantId,
  rentalDays,
  payInFull,
  promo,
  setPromo,
}: Options) {
  /*
   * Depends on the promo's source and id rather than on the object, and bails
   * out below when the winning tier is the one already applied. Both matter:
   * this effect sets the state it reads, and without either guard it re-runs
   * itself forever. The booking site carries the same note for the same reason.
   */
  const appliedSource = promo?.source;
  const appliedId = promo?.id;
  const hasPromo = promo !== null;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!tenantId) return;
      /*
       * Anything already applied that is not OURS is left exactly as it is: a
       * code the agent typed, or one restored from a draft with no source
       * recorded. Only a `duration` promo — one this hook put there — may be
       * replaced or withdrawn by it.
       *
       * The first version of this guarded on `source === "manual"` instead,
       * which left a sourceless promo to be silently overwritten. That
       * contradicted the note on `AppliedPromo.source` two files up, and the
       * test for it is what caught the disagreement.
       */
      if (hasPromo && appliedSource !== "duration") return;

      const days = rentalDays ?? 0;

      // No dates yet, or the plan is no longer pay-in-full: withdraw ours.
      if (!days || !payInFull) {
        if (appliedSource === "duration") setPromo(null);
        return;
      }

      const { data, error } = await supabaseUntyped
        .from("promocodes")
        .select("id, code, type, value, expires_at, min_duration_days, max_users")
        .eq("tenant_id", tenantId)
        .gt("min_duration_days", 0)
        .lte("min_duration_days", days)
        .order("min_duration_days", { ascending: false });

      if (cancelled || error) return;

      const now = new Date();
      let best: TierRow | null = null;

      // Best tier first, falling through to the next one down when a tier is
      // expired or has been fully claimed.
      for (const tier of (data ?? []) as TierRow[]) {
        if (tier.expires_at && new Date(tier.expires_at) < now) continue;

        if (tier.max_users && tier.max_users > 0) {
          /*
           * Counted on `rentals`, which is where a redemption is actually
           * recorded — `rentals.promo_code` is written by both create screens.
           *
           * The booking site counts `invoices.promo_code` instead, and that
           * column does not exist, so the query 400s and its cap has never
           * once fired. Copying that here would have given the portal a limit
           * that reads as enforced and is not.
           */
          const { count, error: countError } = await supabaseUntyped
            .from("rentals")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId)
            .eq("promo_code", tier.code);

          if (cancelled) return;
          // A failed count must not silently hand out a capped discount.
          if (countError) continue;
          if (count !== null && count >= tier.max_users) continue;
        }

        best = tier;
        break;
      }

      if (cancelled) return;

      if (!best) {
        // Nothing qualifies any more (dates shortened, tier expired).
        if (appliedSource === "duration") setPromo(null);
        return;
      }

      // Already on, and the same tier — leave it, or this never settles.
      if (appliedSource === "duration" && appliedId === best.id) return;

      setPromo({
        id: best.id,
        code: best.code,
        // `value` is the DB's word for a fixed amount; everything else is a
        // percentage. Same mapping both create screens already use.
        type: best.type === "value" ? "fixed_amount" : "percentage",
        value: Number(best.value) || 0,
        source: "duration",
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [tenantId, rentalDays, payInFull, hasPromo, appliedSource, appliedId, setPromo]);
}
