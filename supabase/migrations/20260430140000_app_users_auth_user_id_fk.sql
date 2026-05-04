-- Production hardening: prevent app_users.auth_user_id from pointing at a
-- deleted auth.users row. The "operator-side rental_agreements silently
-- empty" bug traced to a stale auth_user_id link — RLS via
-- get_user_tenant_id() returned NULL because the SELECT against auth.users
-- failed, and every tenant-gated SELECT silently returned 0 rows.
-- customer_users already had this FK; app_users was missing it.
--
-- Step 1: allow auth_user_id to be NULL (so unsalvageable orphans can be
--          retained without breaking the column constraint — and so future
--          ON DELETE SET NULL cascades have a target).
-- Step 2: reconcile salvageable orphans where the auth user still exists
--          under the same email but with a new id.
-- Step 3: NULL the auth_user_id for unsalvageable orphans (no matching auth
--          user). The row is preserved for an admin to reconcile or remove
--          via the user-management UI; the user just can't authenticate
--          until re-linked.
-- Step 4: add the FK with ON DELETE SET NULL — losing an auth.users row
--          unlinks the app_users row instead of cascading the delete, which
--          gives a head admin a chance to reconcile a re-created auth user
--          rather than losing the tenant/role/permissions assignment.

ALTER TABLE public.app_users
  ALTER COLUMN auth_user_id DROP NOT NULL;

UPDATE app_users au
SET auth_user_id = u.id, updated_at = now()
FROM auth.users u
WHERE u.email = au.email
  AND au.auth_user_id IS NOT NULL
  AND au.auth_user_id <> u.id
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = au.auth_user_id);

UPDATE app_users
SET auth_user_id = NULL, updated_at = now()
WHERE auth_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = app_users.auth_user_id);

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT app_users_auth_user_id_fkey ON public.app_users IS
  'Keeps app_users.auth_user_id in sync with auth.users. SET NULL on delete preserves tenant/role/permissions for admin reconciliation. Without this, a recreated auth user leaves app_users pointing at a tombstone, breaking get_user_tenant_id() and silently emptying every RLS-gated query.';
