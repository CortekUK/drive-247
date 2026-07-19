-- Point 5: Turo-style per-day, per-vehicle manual pricing.
-- One row = an operator-set price for a specific vehicle on a specific calendar
-- day. When present it overrides the base/tier rate AND all weekend/holiday
-- surcharges for that day (see lib/calculate-rental-price.ts `dailyPrices`).
-- Modeled on vehicle_pricing_overrides (RLS joins through vehicles; no tenant_id).
-- (Already applied live via the Management API this session — this file captures
--  it idempotently for repo parity / from-scratch rebuilds.)

CREATE TABLE IF NOT EXISTS public.vehicle_daily_prices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  date        date NOT NULL,
  price       numeric NOT NULL CHECK (price >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, date)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_daily_prices_vehicle_id
  ON public.vehicle_daily_prices (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_daily_prices_vehicle_date
  ON public.vehicle_daily_prices (vehicle_id, date);

ALTER TABLE public.vehicle_daily_prices ENABLE ROW LEVEL SECURITY;

-- Customers (anon/customer client) must READ per-day prices so manual pricing
-- applies at booking checkout — mirrors tenant_holidays / vehicle_pricing_overrides.
DROP POLICY IF EXISTS "Public can view vehicle daily prices for booking" ON public.vehicle_daily_prices;
CREATE POLICY "Public can view vehicle daily prices for booking"
  ON public.vehicle_daily_prices FOR SELECT USING (true);

-- Redundant staff-scoped SELECT (kept to mirror sibling tables).
DROP POLICY IF EXISTS "vehicle_daily_prices_select" ON public.vehicle_daily_prices;
CREATE POLICY "vehicle_daily_prices_select" ON public.vehicle_daily_prices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_daily_prices.vehicle_id
        AND (v.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
    )
  );

-- Writes (INSERT/UPDATE/DELETE) stay staff-only.
DROP POLICY IF EXISTS "vehicle_daily_prices_manage" ON public.vehicle_daily_prices;
CREATE POLICY "vehicle_daily_prices_manage" ON public.vehicle_daily_prices
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_daily_prices.vehicle_id
        AND (v.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = vehicle_daily_prices.vehicle_id
        AND (v.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
    )
  );

DROP TRIGGER IF EXISTS trg_vehicle_daily_prices_updated_at ON public.vehicle_daily_prices;
CREATE TRIGGER trg_vehicle_daily_prices_updated_at
  BEFORE UPDATE ON public.vehicle_daily_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
