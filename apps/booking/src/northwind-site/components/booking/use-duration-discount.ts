"use client";

import { useEffect, useState } from "react";

import { useTenant } from "@nw/contexts/TenantContext";
import { supabase } from "@nw/integrations/supabase/client";
import type { QuotePromo } from "@nw/lib/quote/types";

import {
  durationTierCovers,
  isPromoExpiredOn,
  isPromoOff,
  isPromoUsedUp,
  todayIsoIn,
  type PromoRuleRow,
} from "./promo-rules";

/**
 * The automatic long-rental discount for the v2 booking site.
 *
 * A promo code with `min_duration_days` set is applied by itself to a rental
 * that long (up to `max_duration_days` when it has one). The v2 site refused
 * such codes when typed ("applied automatically… no code needed") but never
 * applied them, so the discount the operator set up never reached anyone.
 * This is v1's `MultiStepBookingWidget` rule, ported: the longest qualifying
 * tier that is live, on, and under its use limit wins.
 *
 * `enabled` is false while the customer has a code of their own applied: a
 * typed code REPLACES the automatic discount (they never stack), as on v1.
 */
export interface DurationDiscount {
  promo: QuotePromo | null;
  /** The tier's minimum, for the wording ("7 days or more"). */
  minDays: number | null;
}

const NONE: DurationDiscount = { promo: null, minDays: null };

export function useDurationDiscount(rentalDays: number, enabled: boolean): DurationDiscount {
  const { tenant } = useTenant();
  const [result, setResult] = useState<DurationDiscount>(NONE);
  const tenantId = tenant?.id ?? null;
  const timeZone = (tenant as { timezone?: string | null } | null)?.timezone ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!tenantId || rentalDays <= 0) {
      setResult(NONE);
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("promocodes")
        .select("id, code, type, value, expires_at, max_users, is_active, min_duration_days, max_duration_days")
        .eq("tenant_id", tenantId)
        .gt("min_duration_days", 0)
        .lte("min_duration_days", rentalDays)
        .order("min_duration_days", { ascending: false });
      if (cancelled) return;
      if (error || !data) {
        setResult(NONE);
        return;
      }
      const today = todayIsoIn(timeZone);
      // `max_duration_days` is newer than the generated types; the select is checked at run time.
      for (const row of data as unknown as Array<PromoRuleRow & { id: string; type: string; value: number }>) {
        if (!durationTierCovers(row, rentalDays)) continue;
        if (isPromoOff(row) || isPromoExpiredOn(row.expires_at, today)) continue;
        if (row.max_users && row.max_users > 0) {
          const { data: uses } = await supabase.rpc("promo_code_use_count" as never, {
            p_tenant_id: tenantId,
            p_code: row.code,
          } as never);
          if (cancelled) return;
          if (isPromoUsedUp(row, typeof uses === "number" ? uses : null)) continue;
        }
        setResult({
          promo: {
            id: row.id,
            code: row.code,
            type: row.type === "value" ? "fixed_amount" : "percentage",
            value: Number(row.value) || 0,
            source: "duration",
          },
          minDays: row.min_duration_days ?? null,
        });
        return;
      }
      setResult(NONE);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, timeZone, rentalDays]);

  return enabled ? result : NONE;
}
