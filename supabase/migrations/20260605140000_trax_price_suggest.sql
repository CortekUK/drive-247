-- Trax Pricing — cross-tenant comparable-based price suggestion.
--
-- One SECURITY DEFINER function. Two call modes:
--   1. Existing vehicle: pass p_vehicle_id. Reads its make/model/year + 90-day
--      utilisation, and authorises the caller owns it (or is super admin).
--   2. Draft (add-vehicle): pass p_make/p_model/p_year instead — no vehicle row
--      exists yet, so there's no utilisation factor; it's a comps-only suggestion.
--
-- Either way it looks at comparable vehicles across ALL tenants (the Drive247
-- network) to anchor a fair market price and returns ONLY aggregates
-- (median / percentiles / counts) — never another tenant's individual rows.
-- Math only. The friendly "Why?" narrative is generated separately (LLM).
--
-- Comp tiers (most → least specific), each needs a minimum sample:
--   A (high)   same make+model, year ±3,  >= 3 comps   (skipped if no year)
--   B (medium) same make+model, any year, >= 3 comps
--   C (low)    same make (brand) only,    >= 5 comps
--   none       below thresholds → no confident suggestion

DROP FUNCTION IF EXISTS public.trax_price_suggest(UUID, TEXT);
DROP FUNCTION IF EXISTS public.trax_price_suggest(UUID, TEXT, TEXT, TEXT, INT);

CREATE FUNCTION public.trax_price_suggest(
  p_vehicle_id UUID DEFAULT NULL,
  p_tier TEXT DEFAULT 'daily',
  p_make TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL,
  p_year INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant UUID;
  v_is_super      BOOLEAN;
  v               RECORD;
  v_current       NUMERIC;
  v_make          TEXT;
  v_model         TEXT;
  v_year          INT;
  v_disp_make     TEXT;
  v_disp_model    TEXT;
  v_draft         BOOLEAN := p_vehicle_id IS NULL;
  v_tier_used     TEXT;
  v_confidence    TEXT;
  v_n             INT := 0;
  v_p10 NUMERIC; v_p25 NUMERIC; v_p50 NUMERIC; v_p75 NUMERIC; v_p90 NUMERIC;
  v_booked_days   INT := 0;
  v_util_ratio    NUMERIC := 0;
  v_util_level    TEXT;
  v_has_history   BOOLEAN := FALSE;
  v_target        NUMERIC;
  v_suggested     NUMERIC;
  v_round         NUMERIC;
  v_direction     TEXT;
  v_delta_pct     NUMERIC;
BEGIN
  IF p_tier NOT IN ('daily','weekly','monthly') THEN
    RAISE EXCEPTION 'invalid tier: %', p_tier;
  END IF;

  IF v_draft THEN
    -- ---- draft mode: a vehicle being added; identify it by the typed fields ----
    IF p_make IS NULL OR btrim(p_make) = '' OR p_model IS NULL OR btrim(p_model) = '' THEN
      RETURN jsonb_build_object('error','missing_vehicle_info');
    END IF;
    v_make := lower(trim(p_make));
    v_model := lower(trim(p_model));
    v_year := p_year;
    v_disp_make := p_make;
    v_disp_model := p_model;
    v_current := NULL;
  ELSE
    -- ---- existing vehicle: authorise + read from the row ----
    v_caller_tenant := public.get_user_tenant_id();
    v_is_super      := public.is_super_admin();

    SELECT id, tenant_id, make, model, year,
           CASE p_tier WHEN 'daily' THEN daily_rent
                       WHEN 'weekly' THEN weekly_rent
                       ELSE monthly_rent END AS rate
    INTO v
    FROM public.vehicles
    WHERE id = p_vehicle_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('error','vehicle_not_found');
    END IF;
    IF NOT v_is_super AND v.tenant_id IS DISTINCT FROM v_caller_tenant THEN
      RETURN jsonb_build_object('error','forbidden');
    END IF;

    v_current := v.rate;
    v_make := lower(trim(v.make));
    v_model := lower(trim(v.model));
    v_year := v.year;
    v_disp_make := v.make;
    v_disp_model := v.model;
  END IF;

  -- ---- comp matching: try A → B → C ----
  -- Tier A: same make+model, year within ±3 (only when a year is known)
  IF v_year IS NOT NULL THEN
    SELECT count(*) ,
           percentile_cont(0.10) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.25) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.50) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.75) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.90) WITHIN GROUP (ORDER BY r)
    INTO v_n, v_p10, v_p25, v_p50, v_p75, v_p90
    FROM (
      SELECT (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) AS r
      FROM public.vehicles
      WHERE (p_vehicle_id IS NULL OR id <> p_vehicle_id)
        AND is_disposed IS NOT TRUE
        AND lower(trim(make)) = v_make AND lower(trim(model)) = v_model
        AND year BETWEEN v_year - 3 AND v_year + 3
        AND (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) > 0
    ) s;
  END IF;

  IF v_n >= 3 THEN
    v_tier_used := 'make_model_year'; v_confidence := 'high';
  ELSE
    -- Tier B: same make+model, any year
    SELECT count(*),
           percentile_cont(0.10) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.25) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.50) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.75) WITHIN GROUP (ORDER BY r),
           percentile_cont(0.90) WITHIN GROUP (ORDER BY r)
    INTO v_n, v_p10, v_p25, v_p50, v_p75, v_p90
    FROM (
      SELECT (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) AS r
      FROM public.vehicles
      WHERE (p_vehicle_id IS NULL OR id <> p_vehicle_id)
        AND is_disposed IS NOT TRUE
        AND lower(trim(make)) = v_make AND lower(trim(model)) = v_model
        AND (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) > 0
    ) s;

    IF v_n >= 3 THEN
      v_tier_used := 'make_model'; v_confidence := 'medium';
    ELSE
      -- Tier C: same make (brand) only
      SELECT count(*),
             percentile_cont(0.10) WITHIN GROUP (ORDER BY r),
             percentile_cont(0.25) WITHIN GROUP (ORDER BY r),
             percentile_cont(0.50) WITHIN GROUP (ORDER BY r),
             percentile_cont(0.75) WITHIN GROUP (ORDER BY r),
             percentile_cont(0.90) WITHIN GROUP (ORDER BY r)
      INTO v_n, v_p10, v_p25, v_p50, v_p75, v_p90
      FROM (
        SELECT (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) AS r
        FROM public.vehicles
        WHERE (p_vehicle_id IS NULL OR id <> p_vehicle_id)
          AND is_disposed IS NOT TRUE
          AND lower(trim(make)) = v_make
          AND (CASE p_tier WHEN 'daily' THEN daily_rent WHEN 'weekly' THEN weekly_rent ELSE monthly_rent END) > 0
      ) s;

      IF v_n >= 5 THEN
        v_tier_used := 'make'; v_confidence := 'low';
      ELSE
        v_tier_used := 'none'; v_confidence := 'none';
      END IF;
    END IF;
  END IF;

  IF v_confidence = 'none' THEN
    RETURN jsonb_build_object(
      'vehicle_id', p_vehicle_id, 'tier', p_tier,
      'current_price', v_current, 'confidence', 'none', 'tier_used', 'none',
      'comp_count', v_n, 'make', v_disp_make, 'model', v_disp_model, 'year', v_year
    );
  END IF;

  -- ---- utilisation (existing vehicles only) ----
  IF NOT v_draft THEN
    SELECT COALESCE(SUM(
             GREATEST(0, (LEAST(end_date, CURRENT_DATE) - GREATEST(start_date, CURRENT_DATE - 90)) + 1)
           ), 0)
    INTO v_booked_days
    FROM public.rentals
    WHERE vehicle_id = p_vehicle_id AND status IN ('Active','Closed')
      AND end_date >= CURRENT_DATE - 90 AND start_date <= CURRENT_DATE;

    v_booked_days := LEAST(v_booked_days, 90);
    v_util_ratio  := round(v_booked_days::NUMERIC / 90, 3);

    SELECT EXISTS (
      SELECT 1 FROM public.rentals
      WHERE vehicle_id = p_vehicle_id AND status IN ('Active','Closed')
    ) INTO v_has_history;
  END IF;

  v_util_level := CASE
                    WHEN v_draft OR NOT v_has_history THEN 'unknown'
                    WHEN v_util_ratio >= 0.55 THEN 'high'
                    WHEN v_util_ratio < 0.25  THEN 'low'
                    ELSE 'normal'
                  END;

  -- ---- anchor on median, nudge by utilisation (unknown → median) ----
  v_target := CASE v_util_level
                WHEN 'high' THEN v_p50 + (v_p75 - v_p50) * 0.6
                WHEN 'low'  THEN v_p50 - (v_p50 - v_p25) * 0.6
                ELSE v_p50
              END;

  v_suggested := LEAST(GREATEST(v_target, v_p10), v_p90);
  v_round := CASE WHEN p_tier = 'daily' THEN 5 ELSE 10 END;
  v_suggested := round(v_suggested / v_round) * v_round;

  v_delta_pct := CASE WHEN v_current > 0
                      THEN round((v_suggested - v_current) / v_current * 100, 1)
                      ELSE NULL END;
  v_direction := CASE
                   WHEN v_current IS NULL OR v_current = 0 OR v_delta_pct IS NULL THEN 'set'
                   WHEN abs(v_delta_pct) < 3 THEN 'hold'
                   WHEN v_suggested > v_current THEN 'up'
                   ELSE 'down'
                 END;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'tier', p_tier,
    'make', v_disp_make, 'model', v_disp_model, 'year', v_year,
    'current_price', v_current, 'suggested_price', v_suggested,
    'direction', v_direction, 'delta_pct', v_delta_pct,
    'confidence', v_confidence, 'tier_used', v_tier_used,
    'comps', jsonb_build_object(
      'count', v_n, 'p10', round(v_p10), 'p25', round(v_p25),
      'median', round(v_p50), 'p75', round(v_p75), 'p90', round(v_p90)
    ),
    'utilization', jsonb_build_object(
      'booked_days_90d', v_booked_days, 'ratio', v_util_ratio, 'level', v_util_level
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trax_price_suggest(UUID, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trax_price_suggest(UUID, TEXT, TEXT, TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.trax_price_suggest(UUID, TEXT, TEXT, TEXT, INT) IS
  'Trax Pricing: cross-tenant comparable-based price suggestion. Existing vehicle (p_vehicle_id) or draft (p_make/p_model/p_year). Aggregates only; LLM narrates separately.';
