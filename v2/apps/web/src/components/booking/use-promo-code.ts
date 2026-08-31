"use client";

import { useCallback, useState } from "react";

import { useTenant } from "@/contexts/TenantContext";
import { supabase } from "@/integrations/supabase/client";
import type { QuotePromo } from "@/lib/quote/types";

/**
 * Applying a promo code.
 *
 * Ported from `validatePromoCode` in v1's MultiStepBookingWidget.tsx, with the
 * same four rejections in the same order. Two things are done differently and
 * both are deliberate:
 *
 *  - The table is queried through the generated types rather than v1's
 *    `(supabase as any)`. `promocodes` IS in the generated schema; the cast in
 *    v1 dates from before it was and now only hides typos.
 *
 *  - The customer's input is escaped before it reaches `ilike`. `%` and `_` are
 *    wildcards there, so v1's unescaped call means typing a bare `%` matches
 *    the tenant's first promo code and applies a discount nobody was given.
 */

const PROMO_SELECT = "id, code, type, value, expires_at, min_duration_days";

/** `%` and `_` are LIKE wildcards; a customer's literal input must not be one. */
function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface UsePromoCodeResult {
  /** The applied promo, in the shape `computeQuote` consumes. */
  promo: QuotePromo | null;
  /** Why the last attempt failed. Null when nothing has failed. */
  error: string | null;
  isValidating: boolean;
  apply: (code: string) => Promise<void>;
  clear: () => void;
}

export function usePromoCode(): UsePromoCodeResult {
  const { tenant } = useTenant();
  const [promo, setPromo] = useState<QuotePromo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const clear = useCallback(() => {
    setPromo(null);
    setError(null);
  }, []);

  const apply = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (code === "") {
        setPromo(null);
        setError("Enter a promo code first.");
        return;
      }
      if (!tenant?.id) {
        setError("Still loading this site's settings — try again in a moment.");
        return;
      }

      setIsValidating(true);
      setError(null);
      setPromo(null);

      try {
        const { data, error: queryError } = await supabase
          .from("promocodes")
          .select(PROMO_SELECT)
          .eq("tenant_id", tenant.id)
          .ilike("code", escapeLikePattern(code))
          .maybeSingle();

        if (queryError) {
          console.error("[usePromoCode] Lookup failed", {
            tenantId: tenant.id,
            message: queryError.message,
            details: queryError.details,
            hint: queryError.hint,
            code: queryError.code,
          });
          setError("We could not check that code. Please try again.");
          return;
        }

        if (!data) {
          setError("That promo code is not valid.");
          return;
        }

        // Duration codes are awarded by trip length and applied automatically.
        // Letting one be claimed by typing it would hand a two-day rental the
        // discount reserved for a month.
        if (data.min_duration_days !== null && data.min_duration_days > 0) {
          setError(
            "That discount is applied automatically based on how long you rent for — no code needed.",
          );
          return;
        }

        if (new Date(data.expires_at).getTime() < Date.now()) {
          setError("That promo code has expired.");
          return;
        }

        /*
         * `max_users` IS NOT CHECKED HERE, and that is not an omission.
         *
         * v1 counts prior uses with
         *   supabase.from('invoices').select('*', { count: 'exact', head: true })
         *          .eq('promo_code', code)
         * behind an `as any`. `invoices` HAS NO `promo_code` COLUMN — the
         * generated types reject that filter, and `invoiceUtils.ts:73` says the
         * field is "intentionally excluded from DB insert". So the call
         * 400s every time, v1 swallows the error, and the usage cap has never
         * once fired in production.
         *
         * Reproducing a check that cannot work would be worse than not having
         * one: it would read as enforced. A usage cap has to be counted where
         * the redemption is recorded, which is the server-side checkout — see
         * the handoff.
         */

        setPromo({
          id: data.id,
          code: data.code,
          // The column stores 'value' for a flat amount; anything else is a
          // percentage. Same mapping as v1.
          type: data.type === "value" ? "fixed_amount" : "percentage",
          value: Number(data.value) || 0,
          source: "manual",
        });
      } finally {
        setIsValidating(false);
      }
    },
    [tenant?.id],
  );

  return { promo, error, isValidating, apply, clear };
}
