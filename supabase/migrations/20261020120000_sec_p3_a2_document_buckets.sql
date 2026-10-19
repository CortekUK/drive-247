-- Platform security P3, option A2 (docs/security/01-platform-findings.md):
-- stop anyone listing the customer-documents and rental-handover-photos buckets.
--
-- WHAT WAS OPEN (verified 2026-10-20 with the public anon key): both buckets carried
-- SELECT policies with no role and only a bucket check, so anyone could LIST every
-- file — 3,222 customer documents (1,964 of them ID-document photos and selfies
-- under ai-verification/) and 2,490 handover photos — and, through equally open
-- UPDATE/DELETE policies, overwrite or delete them.
--
-- ┌─ WHAT A2 LEAVES OPEN — READ THIS ─────────────────────────────────────────┐
-- │ Both buckets STAY PUBLIC. Every file is still downloadable by anyone who has │
-- │ its exact URL (/storage/v1/object/public/<bucket>/<path>) — public buckets │
-- │ serve objects without consulting any policy. v1 renders those stored public │
-- │ URLs directly, so making the buckets private needs v1 code changes: that is │
-- │ option B, scoped separately. Until P2 locks customer_documents and          │
-- │ rental_handover_photos, those exact URLs can still be read out of the       │
-- │ tables themselves. Anonymous INSERT (upload) stays open too, because v1's   │
-- │ booking and /verify flows upload without a login.                           │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- WHAT CHANGES. Reading an object through the API (list, download, and the
-- SELECT that remove and upsert need) is now allowed only for:
--   * staff — objects a row of THEIR tenant points at (customer_documents.file_url,
--     rental_handover_photos.file_path); super admins everywhere;
--   * customers — objects their own customer_documents rows point at;
--   * anyone (anon or signed in) — ai-verification/<session>/… while that session
--     is in progress: an identity_verifications row with that session_id, status
--     init/pending, created in the last 24 hours. That is what v1's /verify page
--     needs for its `upsert: true` uploads (an anonymous upsert is refused
--     without SELECT — tested 2026-10-20).
-- UPDATE and DELETE use the same predicates. INSERT policies are untouched.
--
-- WHY v1 KEEPS WORKING, path by path (inventory taken 2026-10-20):
--   views          stored public URLs → no policy involved
--   uploads        plain upload needs only INSERT (tested) → unchanged
--   staff download portal use-customer-documents → its tenant's customer_documents row
--   staff remove   rentals/[id], add-customer-document-dialog, use-customer-documents
--                  (customer_documents row still exists at that moment);
--                  use-key-handover (rental_handover_photos row, by file_path)
--   customer download/remove  booking use-customer-documents, use-customer-agreements
--                  (their own customer_documents row)
--   /verify upsert ai-verification/<open session>
--   edge functions service_role, bypasses RLS
-- No v1 file is changed.
--
-- Rollback: 20261020120000_sec_p3_a2_document_buckets.rollback.sql.txt
-- APPLIED to production 2026-10-20.

BEGIN;

-- Does a customer_documents.file_url point at this object? It is stored as a bare
-- path, as 'customer-documents/<path>', or as the full public URL.
CREATE OR REPLACE FUNCTION public.storage_cd_file_matches(p_file_url text, p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_file_url = p_name
      OR p_file_url = 'customer-documents/' || p_name
      OR right(p_file_url, length(p_name) + 20) = '/customer-documents/' || p_name;
$$;

CREATE OR REPLACE FUNCTION public.storage_cd_staff_can_access(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
     WHERE au.auth_user_id = auth.uid() AND au.is_active
       AND (au.is_super_admin OR EXISTS (
         SELECT 1 FROM public.customer_documents d
           LEFT JOIN public.customers c ON c.id = d.customer_id
          WHERE COALESCE(d.tenant_id, c.tenant_id) = au.tenant_id
            AND d.file_url IS NOT NULL
            AND public.storage_cd_file_matches(d.file_url, p_name)))
  );
$$;

CREATE OR REPLACE FUNCTION public.storage_cd_customer_can_access(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_documents d
      JOIN public.customer_users cu ON cu.customer_id = d.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND d.file_url IS NOT NULL
       AND public.storage_cd_file_matches(d.file_url, p_name)
  );
$$;

-- ai-verification/<session_id>/<file> while that verification session is open.
CREATE OR REPLACE FUNCTION public.storage_verify_session_open(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT split_part(p_name, '/', 1) = 'ai-verification'
     AND split_part(p_name, '/', 2) <> ''
     AND EXISTS (
       SELECT 1 FROM public.identity_verifications iv
        WHERE iv.session_id = split_part(p_name, '/', 2)
          AND iv.status IN ('init', 'pending')
          AND iv.created_at > now() - interval '24 hours'
     );
$$;

CREATE OR REPLACE FUNCTION public.storage_ho_staff_can_access(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
     WHERE au.auth_user_id = auth.uid() AND au.is_active
       AND (au.is_super_admin OR EXISTS (
         SELECT 1 FROM public.rental_handover_photos p
          WHERE p.file_path = p_name AND p.tenant_id = au.tenant_id))
  );
$$;

REVOKE ALL ON FUNCTION public.storage_cd_staff_can_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_cd_customer_can_access(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.storage_ho_staff_can_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_cd_staff_can_access(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_cd_customer_can_access(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_ho_staff_can_access(text) TO authenticated, service_role;
-- The verify predicate must be callable by anon: the /verify page has no login.
GRANT EXECUTE ON FUNCTION public.storage_verify_session_open(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_cd_file_matches(text, text) TO anon, authenticated, service_role;

-- ── customer-documents ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view customer documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update customer documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete customer documents" ON storage.objects;
-- Kept: "Allow public uploads", "Authenticated users can upload customer documents"
-- (INSERT) and "Allow service role full access".

CREATE POLICY cd_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_staff_can_access(name));
CREATE POLICY cd_staff_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_staff_can_access(name));
CREATE POLICY cd_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_staff_can_access(name));

CREATE POLICY cd_customer_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_customer_can_access(name));
CREATE POLICY cd_customer_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_customer_can_access(name));
CREATE POLICY cd_customer_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_cd_customer_can_access(name));

CREATE POLICY cd_verify_select ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_verify_session_open(name));
CREATE POLICY cd_verify_update ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_verify_session_open(name))
  WITH CHECK (bucket_id = 'customer-documents' AND public.storage_verify_session_open(name));

-- ── rental-handover-photos ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public reads from rental-handover-photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from rental-handover-photos" ON storage.objects;
-- Kept: "Allow authenticated uploads to rental-handover-photos" (INSERT).

CREATE POLICY ho_staff_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'rental-handover-photos' AND public.storage_ho_staff_can_access(name));
CREATE POLICY ho_staff_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'rental-handover-photos' AND public.storage_ho_staff_can_access(name));

COMMIT;
