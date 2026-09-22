-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║ NOT APPLIED — requires approval.                                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
--
-- Agreements v2 (docs/agreements-v2/build-spec.md): two NEW tables, nothing
-- else. Apply deliberately, with someone watching, and delete this note when it
-- lands. Re-running is harmless: everything is IF NOT EXISTS or DROP-then-CREATE.
--
--   individual_agreements_v2         agreements sent from the Agreements tab,
--                                    not linked to a rental (D4).
--   agreement_operator_signatures_v2 each staff member's own signature, for
--                                    "Save and use" in the editor (D9).
--
-- ADDITIVE ONLY (V2_PLAN §4). No existing table, column, constraint, trigger or
-- function is changed. In particular:
--   * NOT `rental_agreements`. Its `rental_id` is NOT NULL, its agreement_type
--     CHECK is (original, extension), the shared BoldSign webhook answers
--     'Rental not found' for anything without a rental, the retry cron runs
--     processRental() on every credit_failed row, and the table is in the
--     realtime publication with REPLICA IDENTITY FULL, so recipient emails, CC
--     and messages added there would stream to subscribers. A new table avoids
--     all of it, and v1 does not know it exists.
--   * NOT `agreement_templates`. Templates need no change: the default is
--     `is_active`, which is what /api/esign already sends.
--   * NOT `public.tenants` (anon holds column-level grants there; a grantless
--     new column takes every tenant's booking site down).
--
-- SHIPPING THE CODE FIRST IS SAFE. Until this runs:
--   * hooks/use-agreements-list-v2.ts treats a missing individual_agreements_v2
--     as "no individual agreements" and lists the rental agreements alone.
--   * hooks/use-operator-signature-v2.ts answers `signature: null`, and its
--     save() resolves { persisted: false }: "Save and use" still inserts the
--     signature into the document, and nothing is kept for next time.
--   * the individual send route cannot record a send, so it must refuse to send
--     (a document with no row is a paid, legally binding document nobody can
--     see). That is the send lane's responsibility; nothing here enforces it.
--
-- BEFORE YOU APPLY: read the live body of get_user_tenant_id(). This repo holds
-- two definitions of it, one of which honours a user-writable
-- `user_metadata.impersonated_tenant_id` claim. See the header of
-- ops/tenant_notes.sql for the full explanation and the check to run:
--
--   SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);
--
-- If the result mentions impersonated_tenant_id, the tenant policies below are
-- advisory rather than a boundary. The application layer holds either way:
-- every read and write in the v2 hooks and routes carries its own
-- `.eq('tenant_id', …)` (V2_PLAN §5), and the RLS policy is the second lock.
--
-- AFTER YOU APPLY: regenerate apps/portal/src/integrations/supabase/types.ts,
-- copy it to booking and admin, and re-baseline v1:check.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. individual_agreements_v2
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.individual_agreements_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NOT NULL and cascading: an agreement belongs to exactly one operator. A
  -- NULL tenant_id would be a row every tenant filter silently misses.
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Optional link to an existing customer. The recipient is free text (one
  -- name, one email, D12), so most rows carry NULL here. SET NULL on delete:
  -- the agreement outlives the customer record, as a signed contract must.
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,

  recipient_name  text NOT NULL
                  CHECK (btrim(recipient_name) <> '' AND char_length(recipient_name) <= 200),
  recipient_email text NOT NULL
                  CHECK (char_length(recipient_email) <= 320
                         AND recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Copied recipients. Delivered by the signing provider's own email (D13).
  cc_emails       text[] NOT NULL DEFAULT '{}'::text[]
                  CHECK (cardinality(cc_emails) <= 50),

  -- The document title (defaults to the template's name, editable) and the
  -- optional message. Stored so the message is never lost when the agreement
  -- is signed some other way than by email (D13). The caps here are generous
  -- ceilings; the send route applies its own, tighter ones.
  title           text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 500),
  message         text CHECK (message IS NULL OR char_length(message) <= 5000),

  -- The template the send started from, if any. A one-off edit or "Create new"
  -- sends a COPY and never touches the template (D12), so this is provenance,
  -- not the content: the content is `content_html` below.
  template_id     uuid REFERENCES public.agreement_templates(id) ON DELETE SET NULL,

  -- A snapshot of EXACTLY what was sent, after substitution. This is what View
  -- shows when no provider document exists (a failed send), and what a resend
  -- copies. NOT NULL and non-blank, so every row has one. The ceiling allows
  -- for an embedded operator signature image (itself capped at 500 kB).
  content_html    text NOT NULL
                  CHECK (btrim(content_html) <> '' AND char_length(content_html) <= 5000000),

  -- The signing provider's document id, and the mode it was created in, so a
  -- later status sync or download uses the matching API key.
  document_id     text,
  boldsign_mode   text CHECK (boldsign_mode IS NULL OR boldsign_mode IN ('test', 'live')),

  -- The rental_agreements vocabulary (pending, sent, delivered, signed,
  -- completed, declined, expired, voided, credit_failed, send_failed), so both
  -- kinds map through one status function (lib/agreements-v2/status.ts). No
  -- CHECK, exactly like rental_agreements.document_status.
  document_status text NOT NULL DEFAULT 'pending',
  -- Why a send failed, for the agreement's details. Never shown to a customer.
  error           text,

  sent_at         timestamptz,
  completed_at    timestamptz,

  -- A resend makes a NEW row pointing at the one it copied, and leaves that
  -- row alone (D17). SET NULL so deleting an old row never deletes its resends.
  resent_from_id  uuid REFERENCES public.individual_agreements_v2(id) ON DELETE SET NULL,

  -- Who sent it: an app_users row, i.e. portal staff. SET NULL so removing a
  -- staff member never removes the agreements they sent.
  created_by      uuid REFERENCES public.app_users(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The list's query: one tenant's rows, newest first.
CREATE INDEX IF NOT EXISTS individual_agreements_v2_tenant_created
  ON public.individual_agreements_v2 (tenant_id, created_at DESC);

-- Status sync and download look a row up by the provider's document id.
CREATE INDEX IF NOT EXISTS individual_agreements_v2_document_id
  ON public.individual_agreements_v2 (document_id)
  WHERE document_id IS NOT NULL;

-- A trigger on a NEW table is additive. update_updated_at_column() already
-- exists (it stamps app_users, among others).
DROP TRIGGER IF EXISTS individual_agreements_v2_updated_at ON public.individual_agreements_v2;
CREATE TRIGGER individual_agreements_v2_updated_at
  BEFORE UPDATE ON public.individual_agreements_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.individual_agreements_v2 ENABLE ROW LEVEL SECURITY;

-- FOR: portal STAFF of the tenant that owns the row, and super admins (whose
-- app_users.tenant_id is NULL, so the first arm alone would show them an empty
-- list). A renter has no app_users row: get_user_tenant_id() returns NULL,
-- `tenant_id = NULL` is never TRUE, and is_super_admin() is false, so every
-- attempt matches zero rows. Excluded by construction.
--
-- Select, insert and update only. Nothing in v2 deletes an agreement, so there
-- is no delete policy: a sent agreement is a record.
DROP POLICY IF EXISTS individual_agreements_v2_staff_select ON public.individual_agreements_v2;
CREATE POLICY individual_agreements_v2_staff_select
  ON public.individual_agreements_v2 FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS individual_agreements_v2_staff_insert ON public.individual_agreements_v2;
CREATE POLICY individual_agreements_v2_staff_insert
  ON public.individual_agreements_v2 FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

DROP POLICY IF EXISTS individual_agreements_v2_staff_update ON public.individual_agreements_v2;
CREATE POLICY individual_agreements_v2_staff_update
  ON public.individual_agreements_v2 FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- FOR: the send / sync / document routes when they hold the service key.
DROP POLICY IF EXISTS individual_agreements_v2_service ON public.individual_agreements_v2;
CREATE POLICY individual_agreements_v2_service
  ON public.individual_agreements_v2 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- RLS narrows a privilege; it does not grant one. Stated rather than inherited
-- from default privileges (see ops/tenant_notes.sql for why).
GRANT SELECT, INSERT, UPDATE ON public.individual_agreements_v2 TO authenticated;
GRANT ALL ON public.individual_agreements_v2 TO service_role;
-- The anon key ships in every tenant's public booking site.
REVOKE ALL ON public.individual_agreements_v2 FROM anon;

COMMENT ON TABLE public.individual_agreements_v2 IS
  'Agreements v2: agreements sent from the portal Agreements tab that are not linked to a rental. Never read by v1, the shared BoldSign webhook or the credit-failed retry cron. content_html is a snapshot of exactly what was sent.';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. agreement_operator_signatures_v2
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agreement_operator_signatures_v2 (
  -- One signature per staff member. CASCADE: the signature belongs to the
  -- person, and goes when their app_users row goes.
  app_user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,

  -- The tenant the signature was saved in. Super admins have no tenant of
  -- their own, so this is the portal they were in, not app_users.tenant_id.
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- A PNG or JPEG data URL, at most 500 kB (512000 characters). The same rule
  -- as isValidOperatorSignature() in hooks/use-operator-signature-v2.ts.
  image_data  text NOT NULL
              CHECK (char_length(image_data) <= 512000
                     AND image_data ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$'),

  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS agreement_operator_signatures_v2_updated_at ON public.agreement_operator_signatures_v2;
CREATE TRIGGER agreement_operator_signatures_v2_updated_at
  BEFORE UPDATE ON public.agreement_operator_signatures_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agreement_operator_signatures_v2 ENABLE ROW LEVEL SECURITY;

-- FOR: the OWNER, and nobody else, not even their tenant's admins. A signature
-- is the one thing here a colleague must never be able to place for someone
-- else. The owner is the app_users row whose auth_user_id is the caller's
-- auth.uid() (app_users_select_policy lets every user read their own row, so
-- the lookup works under the caller's privileges). Writes must also name a
-- tenant the caller belongs to, or be a super admin's.
DROP POLICY IF EXISTS agreement_operator_signatures_v2_owner ON public.agreement_operator_signatures_v2;
CREATE POLICY agreement_operator_signatures_v2_owner
  ON public.agreement_operator_signatures_v2 FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.id = agreement_operator_signatures_v2.app_user_id
        AND au.auth_user_id = auth.uid()
        AND au.is_active
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.id = agreement_operator_signatures_v2.app_user_id
        AND au.auth_user_id = auth.uid()
        AND au.is_active
    )
    AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  );

DROP POLICY IF EXISTS agreement_operator_signatures_v2_service ON public.agreement_operator_signatures_v2;
CREATE POLICY agreement_operator_signatures_v2_service
  ON public.agreement_operator_signatures_v2 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_operator_signatures_v2 TO authenticated;
GRANT ALL ON public.agreement_operator_signatures_v2 TO service_role;
REVOKE ALL ON public.agreement_operator_signatures_v2 FROM anon;

COMMENT ON TABLE public.agreement_operator_signatures_v2 IS
  'Agreements v2: each staff member''s own signature (PNG/JPEG data URL, <= 500 kB), readable and writable by its owner only. Inserted into documents as <img data-operator-signature="true">.';
