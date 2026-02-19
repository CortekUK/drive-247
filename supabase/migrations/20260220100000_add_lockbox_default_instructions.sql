-- Add tenant-level default lockbox instructions
-- These are general "how to use the lockbox" instructions included in every lockbox notification
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS lockbox_default_instructions text;

COMMENT ON COLUMN public.tenants.lockbox_default_instructions IS 'Default instructions for how to use a lockbox, included in every lockbox email/SMS/WhatsApp notification';
