-- Fix notification RLS policies to allow:
-- 1. Super admins to see all notifications (they bypass tenant context)
-- 2. Admins/head_admins to see all notifications for their tenant
-- 3. Regular users to see their own + broadcasts

-- Drop old SELECT policies
DROP POLICY IF EXISTS "Users can view notifications" ON "public"."notifications";
DROP POLICY IF EXISTS "Users can view their own notifications" ON "public"."notifications";

-- New SELECT policy: user's own notifications, broadcasts, tenant-wide for admins, all for super admins
CREATE POLICY "Users can view notifications" ON "public"."notifications"
FOR SELECT TO "authenticated"
USING (
  -- Super admins can see all notifications
  is_super_admin()
  OR
  -- Notification is addressed to this user
  user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
  OR
  -- Broadcast notifications (user_id IS NULL) for user's tenant
  (user_id IS NULL AND tenant_id = get_user_tenant_id())
  OR
  -- Admins/head_admins can see all notifications for their tenant
  (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'head_admin')
    )
  )
);

-- Drop old UPDATE policies
DROP POLICY IF EXISTS "Users can update notifications" ON "public"."notifications";
DROP POLICY IF EXISTS "Users can update their own notifications" ON "public"."notifications";

-- New UPDATE policy: same logic as SELECT
CREATE POLICY "Users can update notifications" ON "public"."notifications"
FOR UPDATE TO "authenticated"
USING (
  is_super_admin()
  OR
  user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
  OR
  (user_id IS NULL AND tenant_id = get_user_tenant_id())
  OR
  (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'head_admin')
    )
  )
);

-- Drop old DELETE policies
DROP POLICY IF EXISTS "Users can delete notifications" ON "public"."notifications";
DROP POLICY IF EXISTS "Users can delete their own notifications" ON "public"."notifications";

-- New DELETE policy: same logic as SELECT
CREATE POLICY "Users can delete notifications" ON "public"."notifications"
FOR DELETE TO "authenticated"
USING (
  is_super_admin()
  OR
  user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
  OR
  (user_id IS NULL AND tenant_id = get_user_tenant_id())
  OR
  (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE auth_user_id = auth.uid()
      AND role IN ('admin', 'head_admin')
    )
  )
);
