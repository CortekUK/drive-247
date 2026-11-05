-- APPLIED to production 2026-10-29
--
-- reminder_config carried UNIQUE (config_key) with no tenant in it, so only
-- one operator on the whole platform could ever save a given setting. Averys
-- Rental saved `bonzah_low_balance` in July 2026; every operator after them
-- (Moore Luxe, 2026-10-29) got 23505 "reminder_config_config_key_key" when
-- saving a Bonzah low-balance alert. The BoldSign low-credit alert shares the
-- table and had the same fault.
--
-- Every reader and writer already scopes by tenant_id + config_key, and no
-- code upserts ON CONFLICT (config_key), so the key becomes per-tenant.
-- Deliberate exception to the additive-only rule, approved by the user.

ALTER TABLE public.reminder_config
  DROP CONSTRAINT IF EXISTS reminder_config_config_key_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reminder_config'::regclass
      AND conname = 'reminder_config_tenant_id_config_key_key'
  ) THEN
    ALTER TABLE public.reminder_config
      ADD CONSTRAINT reminder_config_tenant_id_config_key_key UNIQUE (tenant_id, config_key);
  END IF;
END $$;
