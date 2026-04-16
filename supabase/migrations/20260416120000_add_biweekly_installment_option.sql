-- Migration: Add semi-weekly (twice per week) installment plan option
-- Adds three new keys to the installment_config JSONB:
--   minimum_days_semiweekly (default 7)
--   semiweekly_installments_limit (default 8)
--   limiting_amount_per_day_semiweekly (default 0 = disabled)

-- Backfill existing tenants that have installment_config
UPDATE tenants
SET installment_config = installment_config
  || jsonb_build_object(
       'minimum_days_semiweekly', 7,
       'semiweekly_installments_limit', 8,
       'limiting_amount_per_day_semiweekly', 0
     )
WHERE installment_config IS NOT NULL
  AND NOT (installment_config ? 'minimum_days_semiweekly');

-- Update column default to include semiweekly keys
ALTER TABLE tenants
ALTER COLUMN installment_config
SET DEFAULT jsonb_build_object(
  'minimum_days_weekly', 7,
  'minimum_days_monthly', 30,
  'minimum_days_semiweekly', 7,
  'weekly_installments_limit', 4,
  'monthly_installments_limit', 6,
  'semiweekly_installments_limit', 8,
  'limiting_amount_per_day_weekly', 0,
  'limiting_amount_per_day_monthly', 0,
  'limiting_amount_per_day_semiweekly', 0,
  'charge_first_upfront', true,
  'what_gets_split', 'rental_only',
  'grace_period_days', 3,
  'max_retry_attempts', 3,
  'retry_interval_days', 1
);
