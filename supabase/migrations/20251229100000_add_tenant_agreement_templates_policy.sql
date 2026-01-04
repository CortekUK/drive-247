-- Add RLS policy for tenant users to manage their own agreement templates
-- Currently only super_admin can manage templates and tenant users can only read

-- Allow tenant users to insert their own templates
CREATE POLICY "tenant_users_insert_agreement_templates" ON "public"."agreement_templates"
FOR INSERT
WITH CHECK (
  "tenant_id" = "public"."get_user_tenant_id"()
);

-- Allow tenant users to update their own templates
CREATE POLICY "tenant_users_update_agreement_templates" ON "public"."agreement_templates"
FOR UPDATE
USING (
  "tenant_id" = "public"."get_user_tenant_id"()
)
WITH CHECK (
  "tenant_id" = "public"."get_user_tenant_id"()
);

-- Allow tenant users to delete their own templates
CREATE POLICY "tenant_users_delete_agreement_templates" ON "public"."agreement_templates"
FOR DELETE
USING (
  "tenant_id" = "public"."get_user_tenant_id"()
);
