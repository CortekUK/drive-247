-- APPLIED to production 2026-11-14 (QA I2, branch Insurance-testing)
--
-- The documents link page uploads the insurance certificate as a GUEST (anon)
-- into customer-documents under insurance/<tenant_id>/<rental_id>/, with
-- upsert: true (re-sending "policy.pdf" replaces it). An upsert needs SELECT and
-- UPDATE as well as INSERT; anon had INSERT on the bucket but SELECT/UPDATE
-- only for open ID-verification folders, so every certificate failed with
-- "new row violates row-level security policy" (QA I2.3).
--
-- Same pattern as storage_verify_session_open: anon may read/replace objects
-- ONLY under insurance/<tenant>/<rental>/ while that rental has an unexpired
-- booking_document_links row for that same tenant. booking-documents-link
-- still pins every submitted path to that prefix before filing anything.
--
-- Rollback: DROP POLICY cd_booking_docs_select ON storage.objects;
--           DROP POLICY cd_booking_docs_update ON storage.objects;
--           DROP FUNCTION public.storage_booking_docs_link_open(text);

CREATE OR REPLACE FUNCTION public.storage_booking_docs_link_open(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT split_part(p_name, '/', 1) = 'insurance'
     AND split_part(p_name, '/', 2) ~ '^[0-9a-f-]{36}$'
     AND split_part(p_name, '/', 3) ~ '^[0-9a-f-]{36}$'
     AND split_part(p_name, '/', 4) <> ''
     AND EXISTS (
       SELECT 1 FROM public.booking_document_links l
        WHERE l.tenant_id::text = split_part(p_name, '/', 2)
          AND l.rental_id::text = split_part(p_name, '/', 3)
          AND l.expires_at > now()
     );
$$;

DROP POLICY IF EXISTS cd_booking_docs_select ON storage.objects;
DROP POLICY IF EXISTS cd_booking_docs_update ON storage.objects;
CREATE POLICY cd_booking_docs_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_booking_docs_link_open(name));
CREATE POLICY cd_booking_docs_update ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'customer-documents' AND public.storage_booking_docs_link_open(name))
  WITH CHECK (bucket_id = 'customer-documents' AND public.storage_booking_docs_link_open(name));
