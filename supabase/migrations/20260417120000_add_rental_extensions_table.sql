-- ============================================================================
-- PHASE 1: Rental Extensions — Foundation
-- ----------------------------------------------------------------------------
-- Introduces `rental_extensions` as a first-class entity and stamps an
-- `extension_id` FK on ledger_entries, payments, and bonzah_insurance_policies
-- so everything joins cleanly instead of relying on reference-string parsing
-- and date-overlap heuristics.
--
-- This migration is purely ADDITIVE. It does not change any existing code
-- paths or behaviour. Later phases enforce server-side amount authority,
-- atomic webhook finalization, and unified reads via a totals view.
--
-- Backfill populates:
--   * One pending row per rental with is_extended = true + extension_checkout_url
--   * One row per historical "Extension #N" group parsed from ledger references
--   * extension_id on matching ledger_entries, payments, bonzah policies
-- Historical dates/breakdown are best-effort; columns are nullable to tolerate
-- incomplete legacy data. New rows created by Phase 3+ code will be complete.
-- ============================================================================

-- ============================================================================
-- 1. CREATE rental_extensions TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rental_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- 1, 2, 3… per rental. Unique per rental.
    sequence_number INTEGER NOT NULL,

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'cancelled', 'refunded')),

    -- Period delta. Nullable only to tolerate legacy backfill where exact dates
    -- are unknown. Phase 3 will enforce NOT NULL for new rows at the
    -- application layer.
    previous_end_date DATE,
    new_end_date DATE,
    extension_days INTEGER,

    -- Authoritative amount breakdown (server-computed going forward).
    rental_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    service_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    insurance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) GENERATED ALWAYS AS
        (rental_amount + tax_amount + service_fee_amount + insurance_amount) STORED,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

    -- Stripe linkage (own session per extension)
    stripe_checkout_session_id TEXT,
    checkout_url TEXT,
    stripe_payment_intent_id TEXT,

    -- Bonzah linkage (set by bonzah-confirm-payment in Phase 4)
    bonzah_policy_id UUID REFERENCES public.bonzah_insurance_policies(id) ON DELETE SET NULL,
    bonzah_confirmed_at TIMESTAMPTZ,

    -- Lifecycle timestamps
    requested_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (rental_id, sequence_number)
);

COMMENT ON TABLE public.rental_extensions IS
    'First-class record of each rental extension. One row per extension request/approval. Owned by rental_id; sequence_number is per-rental (1, 2, 3…).';
COMMENT ON COLUMN public.rental_extensions.status IS
    'pending=customer requested; approved=admin approved, awaiting payment; paid=Stripe webhook completed; cancelled=rejected or abandoned; refunded=paid then fully refunded.';
COMMENT ON COLUMN public.rental_extensions.previous_end_date IS
    'rentals.end_date as it stood BEFORE this extension was applied.';
COMMENT ON COLUMN public.rental_extensions.new_end_date IS
    'rentals.end_date as it becomes AFTER this extension is applied.';
COMMENT ON COLUMN public.rental_extensions.total_amount IS
    'Generated column: rental + tax + service_fee + insurance. Authoritative. Used for Stripe checkout amount in Phase 3.';

CREATE INDEX IF NOT EXISTS idx_rental_extensions_rental_id ON public.rental_extensions(rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_extensions_tenant_id ON public.rental_extensions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_extensions_status ON public.rental_extensions(status);
CREATE INDEX IF NOT EXISTS idx_rental_extensions_checkout_session
    ON public.rental_extensions(stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL;

-- ============================================================================
-- 2. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS rental_extensions_set_updated_at ON public.rental_extensions;
CREATE TRIGGER rental_extensions_set_updated_at
    BEFORE UPDATE ON public.rental_extensions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.rental_extensions ENABLE ROW LEVEL SECURITY;

-- Service role: full access (edge functions)
DROP POLICY IF EXISTS "Service role full access to rental_extensions" ON public.rental_extensions;
CREATE POLICY "Service role full access to rental_extensions"
    ON public.rental_extensions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Tenant users: read their tenant's extensions
DROP POLICY IF EXISTS "Tenant users read own rental_extensions" ON public.rental_extensions;
CREATE POLICY "Tenant users read own rental_extensions"
    ON public.rental_extensions
    FOR SELECT
    TO authenticated
    USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());

-- Customer users: read extensions for their own rentals
-- (linked via rentals.customer_id → customers → customer_users.auth.uid())
DROP POLICY IF EXISTS "Customers read own rental_extensions" ON public.rental_extensions;
CREATE POLICY "Customers read own rental_extensions"
    ON public.rental_extensions
    FOR SELECT
    TO authenticated
    USING (
        rental_id IN (
            SELECT r.id
            FROM public.rentals r
            JOIN public.customer_users cu ON cu.customer_id = r.customer_id
            WHERE cu.auth_user_id = auth.uid()
        )
    );

-- ============================================================================
-- 4. ADD extension_id FK ON RELATED TABLES
-- ============================================================================

ALTER TABLE public.ledger_entries
    ADD COLUMN IF NOT EXISTS extension_id UUID
    REFERENCES public.rental_extensions(id) ON DELETE SET NULL;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS extension_id UUID
    REFERENCES public.rental_extensions(id) ON DELETE SET NULL;

ALTER TABLE public.bonzah_insurance_policies
    ADD COLUMN IF NOT EXISTS extension_id UUID
    REFERENCES public.rental_extensions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_extension_id
    ON public.ledger_entries(extension_id) WHERE extension_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_extension_id
    ON public.payments(extension_id) WHERE extension_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bonzah_policies_extension_id
    ON public.bonzah_insurance_policies(extension_id) WHERE extension_id IS NOT NULL;

COMMENT ON COLUMN public.ledger_entries.extension_id IS
    'If this ledger entry belongs to a rental extension, the extension ID. NULL for original-rental entries.';
COMMENT ON COLUMN public.payments.extension_id IS
    'If this payment funded a rental extension, the extension ID. NULL for original-rental payments.';
COMMENT ON COLUMN public.bonzah_insurance_policies.extension_id IS
    'If this policy covers an extension period, the extension ID. NULL for original-rental policies.';

-- ============================================================================
-- 5. BACKFILL
-- ----------------------------------------------------------------------------
-- Strategy:
--   A. Historical extensions: group ledger charges by parsed "Extension #N"
--      in reference text. One rental_extensions row per distinct (rental_id, N).
--   B. Currently-pending extensions: rentals with is_extended=true or a
--      non-null extension_checkout_url that didn't already get a row from A.
--   C. Stamp extension_id back onto ledger_entries and bonzah policies.
-- ============================================================================

-- --- A. Historical extensions from ledger references ------------------------
-- Example references: "Extension #1: 5 days", "Extension #2: 3 days"
-- Charges with Extension-prefixed categories but no parseable #N are collapsed
-- into sequence_number = 1 so no data is orphaned.

WITH extension_charges AS (
    SELECT
        le.id AS entry_id,
        le.rental_id,
        le.tenant_id,
        le.category,
        le.amount,
        le.remaining_amount,
        le.entry_date,
        le.reference,
        COALESCE(
            NULLIF(substring(le.reference from 'Extension #(\d+)'), '')::int,
            1
        ) AS seq
    FROM public.ledger_entries le
    WHERE le.type = 'Charge'
      AND le.category IN (
          'Extension', 'Extension Rental', 'Extension Tax',
          'Extension Service Fee', 'Extension Insurance'
      )
),
grouped AS (
    SELECT
        rental_id,
        tenant_id,
        seq,
        SUM(CASE WHEN category IN ('Extension', 'Extension Rental') THEN amount ELSE 0 END) AS rental_amount,
        SUM(CASE WHEN category = 'Extension Tax' THEN amount ELSE 0 END) AS tax_amount,
        SUM(CASE WHEN category = 'Extension Service Fee' THEN amount ELSE 0 END) AS service_fee_amount,
        SUM(CASE WHEN category = 'Extension Insurance' THEN amount ELSE 0 END) AS insurance_amount,
        SUM(amount) AS total_charged,
        SUM(remaining_amount) AS total_remaining,
        MIN(entry_date) AS first_entry_date
    FROM extension_charges
    GROUP BY rental_id, tenant_id, seq
)
INSERT INTO public.rental_extensions (
    rental_id, tenant_id, sequence_number, status,
    rental_amount, tax_amount, service_fee_amount, insurance_amount,
    paid_amount, approved_at, created_at
)
SELECT
    g.rental_id,
    g.tenant_id,
    g.seq,
    CASE
        WHEN g.total_remaining <= 0.01 THEN 'paid'
        ELSE 'approved'
    END AS status,
    g.rental_amount,
    g.tax_amount,
    g.service_fee_amount,
    g.insurance_amount,
    GREATEST(g.total_charged - g.total_remaining, 0) AS paid_amount,
    g.first_entry_date::timestamptz AS approved_at,
    g.first_entry_date::timestamptz AS created_at
FROM grouped g
ON CONFLICT (rental_id, sequence_number) DO NOTHING;

-- --- B. Currently-pending extensions ---------------------------------------
-- Rentals flagged pending (is_extended=true) or with a live extension checkout
-- URL but no historical extension row yet.

INSERT INTO public.rental_extensions (
    rental_id, tenant_id, sequence_number, status,
    previous_end_date, new_end_date,
    rental_amount,
    checkout_url,
    requested_at, created_at
)
SELECT
    r.id AS rental_id,
    r.tenant_id,
    -- Next sequence number after any existing rows for this rental
    COALESCE(
        (SELECT MAX(sequence_number) + 1 FROM public.rental_extensions WHERE rental_id = r.id),
        1
    ) AS sequence_number,
    'pending' AS status,
    -- For pending rentals, rentals.previous_end_date stores the REQUESTED new end date.
    -- So: previous_end_date (of extension) = current rental.end_date,
    --     new_end_date (of extension) = rental.previous_end_date (which is the requested date).
    r.end_date AS previous_end_date,
    r.previous_end_date AS new_end_date,
    COALESCE(r.extension_amount, 0) AS rental_amount,
    r.extension_checkout_url AS checkout_url,
    r.updated_at AS requested_at,
    r.updated_at AS created_at
FROM public.rentals r
WHERE (r.is_extended = true OR r.extension_checkout_url IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1 FROM public.rental_extensions re
      WHERE re.rental_id = r.id AND re.status = 'pending'
  )
ON CONFLICT (rental_id, sequence_number) DO NOTHING;

-- --- C. Stamp extension_id back onto related rows --------------------------

-- C1. ledger_entries: match by (rental_id, parsed #N)
WITH parsed AS (
    SELECT
        le.id AS entry_id,
        le.rental_id,
        COALESCE(
            NULLIF(substring(le.reference from 'Extension #(\d+)'), '')::int,
            1
        ) AS seq
    FROM public.ledger_entries le
    WHERE le.extension_id IS NULL
      AND le.category IN (
          'Extension', 'Extension Rental', 'Extension Tax',
          'Extension Service Fee', 'Extension Insurance'
      )
)
UPDATE public.ledger_entries le
SET extension_id = re.id
FROM parsed p
JOIN public.rental_extensions re
    ON re.rental_id = p.rental_id AND re.sequence_number = p.seq
WHERE le.id = p.entry_id;

-- C2. bonzah_insurance_policies: match extension-typed policies to extension
-- rows by rental + chronological order.
WITH ordered_policies AS (
    SELECT
        id,
        rental_id,
        ROW_NUMBER() OVER (PARTITION BY rental_id ORDER BY created_at ASC) AS rn
    FROM public.bonzah_insurance_policies
    WHERE policy_type = 'extension' AND extension_id IS NULL
),
ordered_extensions AS (
    SELECT
        id,
        rental_id,
        ROW_NUMBER() OVER (PARTITION BY rental_id ORDER BY sequence_number ASC) AS rn
    FROM public.rental_extensions
)
UPDATE public.bonzah_insurance_policies bip
SET extension_id = ext.id
FROM ordered_policies op
JOIN ordered_extensions ext
    ON ext.rental_id = op.rental_id AND ext.rn = op.rn
WHERE bip.id = op.id;

-- Also link back the bonzah_policy_id onto rental_extensions for the same
-- matched rows (so lookups work both directions).
UPDATE public.rental_extensions re
SET bonzah_policy_id = bip.id
FROM public.bonzah_insurance_policies bip
WHERE bip.extension_id = re.id
  AND re.bonzah_policy_id IS NULL;

-- C3. payments: for existing extension payments, match by
-- target_categories containing any 'Extension *' entry + rental_id +
-- chronological order within the rental.
WITH ext_payments AS (
    SELECT
        p.id,
        p.rental_id,
        ROW_NUMBER() OVER (PARTITION BY p.rental_id ORDER BY p.created_at ASC) AS rn
    FROM public.payments p
    WHERE p.extension_id IS NULL
      AND p.target_categories IS NOT NULL
      AND jsonb_typeof(p.target_categories) = 'array'
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p.target_categories) AS c(cat)
          WHERE c.cat LIKE 'Extension%'
      )
),
ordered_extensions AS (
    SELECT
        id,
        rental_id,
        ROW_NUMBER() OVER (PARTITION BY rental_id ORDER BY sequence_number ASC) AS rn
    FROM public.rental_extensions
)
UPDATE public.payments p
SET extension_id = ext.id
FROM ext_payments ep
JOIN ordered_extensions ext
    ON ext.rental_id = ep.rental_id AND ext.rn = ep.rn
WHERE p.id = ep.id;

-- ============================================================================
-- End of Phase 1 foundation migration.
-- Next (Phase 2): enforce target_categories in webhook, add idempotency guards.
-- ============================================================================
