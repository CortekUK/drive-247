-- Migration: Rename installment_config JSONB keys and add per-day amount thresholds
-- Old keys -> New keys:
--   min_days_for_weekly -> minimum_days_weekly
--   min_days_for_monthly -> minimum_days_monthly
--   max_installments_weekly -> weekly_installments_limit
--   max_installments_monthly -> monthly_installments_limit
-- New keys:
--   limiting_amount_per_day_weekly (default 0 = disabled)
--   limiting_amount_per_day_monthly (default 0 = disabled)
-- what_gets_split default changed from 'rental_tax' to 'rental_only'

-- Migrate existing tenant rows
UPDATE tenants
SET installment_config = (
  CASE
    WHEN installment_config IS NOT NULL THEN
      -- Build new config from old keys, preserving unchanged keys
      jsonb_build_object(
        'minimum_days_weekly', COALESCE((installment_config->>'min_days_for_weekly')::int, 7),
        'minimum_days_monthly', COALESCE((installment_config->>'min_days_for_monthly')::int, 30),
        'weekly_installments_limit', COALESCE((installment_config->>'max_installments_weekly')::int, 4),
        'monthly_installments_limit', COALESCE((installment_config->>'max_installments_monthly')::int, 6),
        'limiting_amount_per_day_weekly', 0,
        'limiting_amount_per_day_monthly', 0,
        'charge_first_upfront', COALESCE((installment_config->>'charge_first_upfront')::boolean, true),
        'what_gets_split', COALESCE(installment_config->>'what_gets_split', 'rental_only'),
        'grace_period_days', COALESCE((installment_config->>'grace_period_days')::int, 3),
        'max_retry_attempts', COALESCE((installment_config->>'max_retry_attempts')::int, 3),
        'retry_interval_days', COALESCE((installment_config->>'retry_interval_days')::int, 1)
      )
    ELSE NULL
  END
)
WHERE installment_config IS NOT NULL;

-- Update column default to new structure
ALTER TABLE tenants
ALTER COLUMN installment_config
SET DEFAULT jsonb_build_object(
  'minimum_days_weekly', 7,
  'minimum_days_monthly', 30,
  'weekly_installments_limit', 4,
  'monthly_installments_limit', 6,
  'limiting_amount_per_day_weekly', 0,
  'limiting_amount_per_day_monthly', 0,
  'charge_first_upfront', true,
  'what_gets_split', 'rental_only',
  'grace_period_days', 3,
  'max_retry_attempts', 3,
  'retry_interval_days', 1
);
