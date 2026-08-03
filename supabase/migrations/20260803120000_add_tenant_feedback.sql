-- ============================================
-- Portal Feedback Channel
-- Portal staff submit feedback about the Drive247 SOFTWARE.
-- Reviewed by Drive247 super admins in apps/admin.
--
-- NOT to be confused with:
--   * rental_reviews       — staff rating CUSTOMERS after a rental
--   * feedback_submissions — booking-site testimonials from renters
-- Everything here is prefixed `tenant_feedback_` to keep that boundary
-- obvious at a glance in the table list.
-- ============================================

-- ── 1. tenant_feedback ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Nullable + SET NULL: a staff member leaving must never delete the bug
  -- report they filed, and must never block their own account deletion.
  -- The snapshot columns below keep the row readable once the FK is gone.
  app_user_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitter_name TEXT,
  submitter_email TEXT,
  submitter_role TEXT,

  category TEXT NOT NULL CHECK (category IN ('bug', 'improvement', 'feature_request', 'note')),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  screenshot_path TEXT,

  -- Reproduction context. Cheap to capture now, impossible to recover later.
  page_path TEXT,
  user_agent TEXT,

  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,

  -- Set by notify-feedback-submission once the alert has gone out. Makes the
  -- notifier idempotent: a retry, a double-click or a replayed request cannot
  -- mail the whole recipient list a second time.
  notified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_feedback ENABLE ROW LEVEL SECURITY;

-- INSERT: you may only file feedback AS YOURSELF, FOR YOUR OWN TENANT, and
-- only in the `open` state. Without the status/resolved guards a portal user
-- could file a row pre-marked resolved (invisible in the admin's default
-- filter) or forge `resolved_by` to point at someone else.
DROP POLICY IF EXISTS "Staff can file feedback for their tenant" ON public.tenant_feedback;
CREATE POLICY "Staff can file feedback for their tenant"
  ON public.tenant_feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    (tenant_id = get_user_tenant_id() OR is_super_admin())
    AND app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
    AND status = 'open'
    AND resolved_at IS NULL
    AND resolved_by IS NULL
  );

-- SELECT: submitters see their OWN rows; super admins see everything.
-- Deliberately NOT the whole tenant — a `viewer` has no business reading the
-- head admin's complaint about the software, and nothing in the portal UI
-- needs tenant-wide reads.
DROP POLICY IF EXISTS "Submitters read own feedback, super admins read all" ON public.tenant_feedback;
CREATE POLICY "Submitters read own feedback, super admins read all"
  ON public.tenant_feedback FOR SELECT
  TO authenticated
  USING (
    app_user_id IN (SELECT id FROM public.app_users WHERE auth_user_id = auth.uid())
    OR is_super_admin()
  );

-- UPDATE: super admin only (triage). WITH CHECK as well as USING — USING alone
-- gates which rows you may touch, not what you may turn them into.
DROP POLICY IF EXISTS "Super admins triage feedback" ON public.tenant_feedback;
CREATE POLICY "Super admins triage feedback"
  ON public.tenant_feedback FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- No DELETE policy: feedback is an append-only record.

DROP TRIGGER IF EXISTS set_tenant_feedback_updated_at ON public.tenant_feedback;
CREATE TRIGGER set_tenant_feedback_updated_at
  BEFORE UPDATE ON public.tenant_feedback
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tenant_feedback_tenant_id ON public.tenant_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_app_user_id ON public.tenant_feedback(app_user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_status ON public.tenant_feedback(status);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_category ON public.tenant_feedback(category);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_created_at ON public.tenant_feedback(created_at DESC);
-- The admin list's default view: open items, newest first.
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_status_created_at
  ON public.tenant_feedback(status, created_at DESC);


-- ── 2. tenant_feedback_settings (singleton) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_feedback_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Structurally enforces "exactly one row" — a second INSERT hits the unique
  -- index rather than silently creating a config the app will never read.
  singleton BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  form_enabled BOOLEAN NOT NULL DEFAULT true,
  force_login_triggered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_feedback_settings ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in user: the portal has to know whether to render the
-- entry point at all. The row carries no tenant data and no PII — just two
-- platform flags.
DROP POLICY IF EXISTS "Authenticated users read feedback settings" ON public.tenant_feedback_settings;
CREATE POLICY "Authenticated users read feedback settings"
  ON public.tenant_feedback_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Super admins manage feedback settings" ON public.tenant_feedback_settings;
CREATE POLICY "Super admins manage feedback settings"
  ON public.tenant_feedback_settings FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

DROP TRIGGER IF EXISTS set_tenant_feedback_settings_updated_at ON public.tenant_feedback_settings;
CREATE TRIGGER set_tenant_feedback_settings_updated_at
  BEFORE UPDATE ON public.tenant_feedback_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO public.tenant_feedback_settings (form_enabled)
VALUES (true)
ON CONFLICT DO NOTHING;


-- ── 3. tenant_feedback_recipients ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_feedback_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness. A plain UNIQUE on `email` lets
-- Ops@drive-247.com and ops@drive-247.com both in, double-mailing one person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_feedback_recipients_email_lower
  ON public.tenant_feedback_recipients (lower(email));

ALTER TABLE public.tenant_feedback_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage feedback recipients" ON public.tenant_feedback_recipients;
CREATE POLICY "Super admins manage feedback recipients"
  ON public.tenant_feedback_recipients FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- ── 4. tenant_feedback_insights ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_feedback_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary TEXT NOT NULL,
  top_themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback_count INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  generated_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_feedback_insights ENABLE ROW LEVEL SECURITY;

-- Read-only to super admins. Rows are written exclusively by the
-- `feedback-insights` edge function on a service-role client, which bypasses
-- RLS — so no INSERT policy is needed, and its absence is what stops a browser
-- from forging an "AI summary".
DROP POLICY IF EXISTS "Super admins read feedback insights" ON public.tenant_feedback_insights;
CREATE POLICY "Super admins read feedback insights"
  ON public.tenant_feedback_insights FOR SELECT
  TO authenticated
  USING (is_super_admin());

CREATE INDEX IF NOT EXISTS idx_tenant_feedback_insights_generated_at
  ON public.tenant_feedback_insights(generated_at DESC);


-- ── 5. app_users.feedback_last_prompted_at ──────────────────────────────────
-- Drives both client-side throttles: the rental-completion cooldown and the
-- forced-next-login comparison.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS feedback_last_prompted_at TIMESTAMPTZ;


-- ── 6. Storage bucket: feedback-screenshots ─────────────────────────────────
-- PRIVATE, unlike the public `gig-driver-images` bucket this was modelled on.
-- A screenshot of a portal screen routinely contains customer PII — names,
-- addresses, licence images, card last4. A public bucket makes every one of
-- those a permanent unauthenticated URL. Reads go through signed URLs instead.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Upload: signed-in staff only, and only into their own tenant's folder.
-- Path convention: {tenant_id}/{uuid}.{ext}
DROP POLICY IF EXISTS "Staff upload feedback screenshots to own tenant folder" ON storage.objects;
CREATE POLICY "Staff upload feedback screenshots to own tenant folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (
      (storage.foldername(name))[1] = get_user_tenant_id()::text
      OR is_super_admin()
    )
  );

-- Read: the uploader's tenant (so the preview works right after upload) and
-- super admins (who need to actually look at the bug).
DROP POLICY IF EXISTS "Tenant staff and super admins read feedback screenshots" ON storage.objects;
CREATE POLICY "Tenant staff and super admins read feedback screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (
      (storage.foldername(name))[1] = get_user_tenant_id()::text
      OR is_super_admin()
    )
  );

-- No UPDATE/DELETE policy: service_role only.


COMMENT ON TABLE public.tenant_feedback IS
  'Portal staff feedback about the Drive247 software itself (bug/improvement/feature_request/note). Distinct from rental_reviews (staff rating customers) and feedback_submissions (renter testimonials on the booking site).';
COMMENT ON COLUMN public.tenant_feedback.app_user_id IS
  'Nullable by design: ON DELETE SET NULL so removing a staff account never deletes their reports. submitter_name/email/role preserve attribution.';
COMMENT ON COLUMN public.app_users.feedback_last_prompted_at IS
  'Last time this user was SHOWN the feedback dialog (not necessarily submitted). Drives the 7-day rental-completion cooldown and the force-show-on-next-login comparison.';
