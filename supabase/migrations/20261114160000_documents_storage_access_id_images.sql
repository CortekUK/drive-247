-- QA I4.13 prep (2026-11-14): the customer-documents bucket is PUBLIC, so anyone with a file's
-- address can download it (another customer's certificate, licence and selfie photos). It can only
-- go private once every reader uses signed links, and signing is governed by the storage policies
-- cd_staff_select / cd_customer_select, which call these two functions.
--
-- Until now they only recognised files listed in customer_documents. ID-check images
-- (identity_verifications: selfie, licence front/back, face) and insurance_verifications files live
-- in the same bucket, so after the switch staff could not open a licence photo. This adds them.
-- Harmless while the bucket is public (the public endpoint ignores these policies).

CREATE OR REPLACE FUNCTION public.storage_cd_staff_can_access(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
     WHERE au.auth_user_id = auth.uid() AND au.is_active
       AND (
         au.is_super_admin
         OR EXISTS (
           SELECT 1 FROM public.customer_documents d
             LEFT JOIN public.customers c ON c.id = d.customer_id
            WHERE COALESCE(d.tenant_id, c.tenant_id) = au.tenant_id
              AND d.file_url IS NOT NULL
              AND public.storage_cd_file_matches(d.file_url, p_name))
         OR EXISTS (
           SELECT 1 FROM public.identity_verifications v
             LEFT JOIN public.customers c ON c.id = v.customer_id
            WHERE COALESCE(v.tenant_id, c.tenant_id) = au.tenant_id
              AND (   (v.selfie_image_url IS NOT NULL AND public.storage_cd_file_matches(v.selfie_image_url, p_name))
                   OR (v.document_front_url IS NOT NULL AND public.storage_cd_file_matches(v.document_front_url, p_name))
                   OR (v.document_back_url IS NOT NULL AND public.storage_cd_file_matches(v.document_back_url, p_name))
                   OR (v.face_image_url IS NOT NULL AND public.storage_cd_file_matches(v.face_image_url, p_name))))
         OR EXISTS (
           SELECT 1 FROM public.insurance_verifications iv
            WHERE iv.tenant_id = au.tenant_id
              AND iv.file_url IS NOT NULL
              AND public.storage_cd_file_matches(iv.file_url, p_name))
       )
  );
$function$;

CREATE OR REPLACE FUNCTION public.storage_cd_customer_can_access(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_documents d
      JOIN public.customer_users cu ON cu.customer_id = d.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND d.file_url IS NOT NULL
       AND public.storage_cd_file_matches(d.file_url, p_name)
  ) OR EXISTS (
    SELECT 1 FROM public.identity_verifications v
      JOIN public.customer_users cu ON cu.customer_id = v.customer_id
     WHERE cu.auth_user_id = auth.uid()
       AND (   (v.selfie_image_url IS NOT NULL AND public.storage_cd_file_matches(v.selfie_image_url, p_name))
            OR (v.document_front_url IS NOT NULL AND public.storage_cd_file_matches(v.document_front_url, p_name))
            OR (v.document_back_url IS NOT NULL AND public.storage_cd_file_matches(v.document_back_url, p_name))
            OR (v.face_image_url IS NOT NULL AND public.storage_cd_file_matches(v.face_image_url, p_name)))
  );
$function$;
