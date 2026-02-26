-- ============================================
-- Rental Reviews & Customer Review Summaries
-- Internal staff reviews of customers after completed rentals
-- ============================================

-- 1. rental_reviews table
CREATE TABLE IF NOT EXISTS public.rental_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  rating SMALLINT,
  comment TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  is_skipped BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One review per rental
  CONSTRAINT rental_reviews_rental_unique UNIQUE (rental_id),
  -- Rating required when not skipped
  CONSTRAINT rental_reviews_rating_check CHECK (is_skipped = true OR rating IS NOT NULL),
  -- Rating range 1-10
  CONSTRAINT rental_reviews_rating_range CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10))
);

ALTER TABLE public.rental_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view their own tenant reviews" ON public.rental_reviews;
CREATE POLICY "Tenant users can view their own tenant reviews"
  ON public.rental_reviews FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can insert reviews for their tenant" ON public.rental_reviews;
CREATE POLICY "Tenant users can insert reviews for their tenant"
  ON public.rental_reviews FOR INSERT
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can update reviews for their tenant" ON public.rental_reviews;
CREATE POLICY "Tenant users can update reviews for their tenant"
  ON public.rental_reviews FOR UPDATE
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Tenant users can delete reviews for their tenant" ON public.rental_reviews;
CREATE POLICY "Tenant users can delete reviews for their tenant"
  ON public.rental_reviews FOR DELETE
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP TRIGGER IF EXISTS set_rental_reviews_updated_at ON public.rental_reviews;
CREATE TRIGGER set_rental_reviews_updated_at
  BEFORE UPDATE ON public.rental_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_rental_reviews_tenant_id
  ON public.rental_reviews(tenant_id);

CREATE INDEX IF NOT EXISTS idx_rental_reviews_customer_id
  ON public.rental_reviews(customer_id);

CREATE INDEX IF NOT EXISTS idx_rental_reviews_rental_id
  ON public.rental_reviews(rental_id);

-- 2. customer_review_summaries table (AI-generated)
CREATE TABLE IF NOT EXISTS public.customer_review_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  summary TEXT,
  average_rating NUMERIC(3, 1),
  total_reviews INTEGER DEFAULT 0,
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One summary per customer per tenant
  CONSTRAINT customer_review_summaries_unique UNIQUE (customer_id, tenant_id)
);

ALTER TABLE public.customer_review_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant users can view their own tenant summaries" ON public.customer_review_summaries;
CREATE POLICY "Tenant users can view their own tenant summaries"
  ON public.customer_review_summaries FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    OR is_super_admin()
  );

DROP POLICY IF EXISTS "Service role can manage summaries" ON public.customer_review_summaries;
CREATE POLICY "Service role can manage summaries"
  ON public.customer_review_summaries FOR ALL
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_customer_review_summaries_updated_at ON public.customer_review_summaries;
CREATE TRIGGER set_customer_review_summaries_updated_at
  BEFORE UPDATE ON public.customer_review_summaries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_customer_review_summaries_tenant_id
  ON public.customer_review_summaries(tenant_id);

CREATE INDEX IF NOT EXISTS idx_customer_review_summaries_customer_id
  ON public.customer_review_summaries(customer_id);
