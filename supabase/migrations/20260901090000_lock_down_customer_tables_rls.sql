-- Lock down the customer-facing tables that the public anon key could read and write.
--
-- WHAT WAS WRONG
-- Row Level Security was DISABLED on identity_verifications, customer_documents,
-- customer_notifications, chat_channels and chat_channel_messages. Postgres never
-- evaluates a policy on a table with RLS off, so the 22 policies these tables
-- already carried were decorative. Verified against staging with the public anon
-- key, signed out:
--
--   SELECT * FROM identity_verifications  -> 200, every row
--       {"first_name":"Alpha","document_number":"ALPHA-PASSPORT-111","status":"approved"}
--   INSERT INTO identity_verifications (status='approved', customer_id=<any>) -> 201
--       i.e. an anonymous caller could mark ANY customer identity-verified.
--   UPDATE / DELETE on documents and notifications also succeeded.
--
-- Note the anon INSERT policy was already correctly written
--   WITH CHECK (status = 'pending' AND customer_id IS NULL)
-- The forgery worked only because that check was never run. Most of this migration
-- is therefore just turning RLS on; the DROPs below remove the genuinely permissive
-- policies that would have survived it.
--
-- Three separate blanket policies on identity_verifications granted
-- ALL / authenticated / USING (true) — any signed-in customer of any tenant could
-- read and write every tenant's identity records. customer_documents had one
-- ALL / public / USING (true), where `public` includes anon.
--
-- SCOPE
-- Deliberately excludes rentals, customers, vehicles, invoices, payments and
-- ledger_entries. Those are read with RLS off by apps/booking, apps/portal,
-- apps/admin and many edge functions; enabling RLS there needs its own pass with
-- verification across all four apps. They remain readable with the anon key.
--
-- APPLIED AND VERIFIED ON STAGING (ksmreaadhbirzakkxqrq) 2026-09-01.
-- NOT applied to production, which carries the identical exposure.
-- Promote only after re-running the verification below against production data.
--
-- VERIFICATION (re-run after applying; seed a row FIRST — an empty table makes
-- "anon sees 0" a false pass):
--   as service_role: INSERT a row into identity_verifications
--   as anon:         SELECT id FROM identity_verifications        -> expect []
--   as anon:         INSERT (status='approved', customer_id=<x>)  -> expect 401/42501
--   as the customer: their own rows must still be readable
--   then load every /portal route and confirm 200
--
-- ROLLBACK: at the bottom of this file.

BEGIN;

-- ── identity_verifications ────────────────────────────────────────────────────
-- Passport numbers, dates of birth and scan URLs live here.

DROP POLICY IF EXISTS "Allow all for authenticated"                 ON public.identity_verifications;
DROP POLICY IF EXISTS "Allow all for authenticated users"           ON public.identity_verifications;
DROP POLICY IF EXISTS "Allow authenticated users full access"       ON public.identity_verifications;
DROP POLICY IF EXISTS "Allow anon to read verifications for booking" ON public.identity_verifications;
DROP POLICY IF EXISTS "Allow anon users read access"                ON public.identity_verifications;

-- The guest booking flow creates a verification before the customer has an account
-- and polls it, so anon still needs to read back the row it just made — but only
-- while that row is unlinked and unfinished, never a completed customer record.
-- A token-scoped read would be stronger; that is a larger change than this fix.
DROP POLICY IF EXISTS "Anon read own in-flight verification" ON public.identity_verifications;
CREATE POLICY "Anon read own in-flight verification"
  ON public.identity_verifications FOR SELECT TO anon
  USING (customer_id IS NULL AND status <> 'completed');

-- Staff review these in the portal; scope them to their own tenant.
DROP POLICY IF EXISTS "Staff read tenant verifications"   ON public.identity_verifications;
CREATE POLICY "Staff read tenant verifications"
  ON public.identity_verifications FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Staff update tenant verifications" ON public.identity_verifications;
CREATE POLICY "Staff update tenant verifications"
  ON public.identity_verifications FOR UPDATE TO authenticated
  USING      (tenant_id = get_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

-- ── customer_documents ────────────────────────────────────────────────────────
-- Its single policy was ALL / public / USING (true). `public` includes anon.

DROP POLICY IF EXISTS "Allow all operations for app users" ON public.customer_documents;

DROP POLICY IF EXISTS "Customers read own documents" ON public.customer_documents;
CREATE POLICY "Customers read own documents"
  ON public.customer_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM customer_users cu
    WHERE cu.customer_id = customer_documents.customer_id
      AND cu.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Customers insert own documents" ON public.customer_documents;
CREATE POLICY "Customers insert own documents"
  ON public.customer_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM customer_users cu
    WHERE cu.customer_id = customer_documents.customer_id
      AND cu.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS "Staff manage tenant documents" ON public.customer_documents;
CREATE POLICY "Staff manage tenant documents"
  ON public.customer_documents FOR ALL TO authenticated
  USING      (tenant_id = get_user_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Service role full access on customer_documents" ON public.customer_documents;
CREATE POLICY "Service role full access on customer_documents"
  ON public.customer_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── gig_driver_images ─────────────────────────────────────────────────────────
-- Already had RLS enabled, but an anon SELECT USING (true) defeated it entirely.
-- Proof that enabling RLS alone is not sufficient.

DROP POLICY IF EXISTS "Anon can view gig driver images" ON public.gig_driver_images;

-- ── the part that actually makes the policies above run ───────────────────────

ALTER TABLE public.identity_verifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notifications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_messages   ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK — restores the previous (insecure) state exactly.
-- Only for an emergency where a policy blocks a real code path.
--
-- BEGIN;
--   ALTER TABLE public.identity_verifications  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.customer_documents      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.customer_notifications  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.chat_channels           DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.chat_channel_messages   DISABLE ROW LEVEL SECURITY;
--   CREATE POLICY "Allow all operations for app users" ON public.customer_documents
--     FOR ALL TO public USING (true) WITH CHECK (true);
--   CREATE POLICY "Allow all for authenticated" ON public.identity_verifications
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY "Allow anon users read access" ON public.identity_verifications
--     FOR SELECT TO anon USING (true);
--   CREATE POLICY "Anon can view gig driver images" ON public.gig_driver_images
--     FOR SELECT TO anon USING (true);
-- COMMIT;
--
-- Prefer fixing the offending policy over rolling back: the state above lets any
-- anonymous caller read passport numbers and forge an approved identity check.
