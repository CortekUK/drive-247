-- Fix duplicate agreement_templates rows that cause template save/fetch issues.
-- Duplicates were created by race conditions in the initialization logic.
-- This migration:
--   1. Deletes duplicate rows (keeps the most recently updated per tenant_id + template_name)
--   2. Adds a unique constraint to prevent future duplicates

-- Step 1: Delete duplicates, keeping the row with the latest updated_at per (tenant_id, template_name)
DELETE FROM agreement_templates
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, template_name) id
  FROM agreement_templates
  ORDER BY tenant_id, template_name, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
);

-- Step 2: Ensure each tenant has at least one active template.
-- For tenants where no template is active, activate the Default Template (or the most recent one).
UPDATE agreement_templates
SET is_active = true, updated_at = now()
WHERE id IN (
  SELECT at2.id FROM (
    -- Find tenants with no active template
    SELECT DISTINCT tenant_id
    FROM agreement_templates
    WHERE tenant_id NOT IN (
      SELECT tenant_id FROM agreement_templates WHERE is_active = true
    )
  ) orphans
  JOIN LATERAL (
    -- Pick the Default Template if it exists, otherwise the most recent template
    SELECT id FROM agreement_templates
    WHERE tenant_id = orphans.tenant_id
    ORDER BY
      CASE WHEN template_name = 'Default Template' THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST
    LIMIT 1
  ) at2 ON true
);

-- Step 3: Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS unique_tenant_template_name
  ON agreement_templates (tenant_id, template_name);
