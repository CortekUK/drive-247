-- Fix agreement_templates unique constraints to support multiple categories.
--
-- Problem 1: unique_active_template_per_tenant only allows ONE active template
-- per tenant across ALL categories. Should be per (tenant_id, template_category).
--
-- Problem 2: unique_tenant_template_name blocks having "Default Template" for
-- both standard and payg categories. Should include template_category.

-- Drop the broken constraints
DROP INDEX IF EXISTS "public"."unique_active_template_per_tenant";
DROP INDEX IF EXISTS "public"."unique_tenant_template_name";

-- Recreate with template_category included
-- Only one active template per tenant per category
CREATE UNIQUE INDEX "unique_active_template_per_tenant"
  ON "public"."agreement_templates" ("tenant_id", "template_category")
  WHERE "is_active" = true;

-- Only one template with a given name per tenant per category
CREATE UNIQUE INDEX "unique_tenant_template_name"
  ON "public"."agreement_templates" ("tenant_id", "template_name", "template_category");

COMMENT ON INDEX "public"."unique_active_template_per_tenant" IS
  'Ensures only one active template per tenant per category (standard, extension, payg)';
COMMENT ON INDEX "public"."unique_tenant_template_name" IS
  'Ensures template names are unique within a tenant and category';
