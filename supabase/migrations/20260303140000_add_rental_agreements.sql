-- Create rental_agreements table for multi-agreement support (original + extensions)
CREATE TABLE IF NOT EXISTS rental_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agreement_type TEXT NOT NULL CHECK (agreement_type IN ('original', 'extension')),
  document_id TEXT,
  document_status TEXT DEFAULT 'pending',
  boldsign_mode TEXT,
  envelope_created_at TIMESTAMPTZ,
  envelope_sent_at TIMESTAMPTZ,
  envelope_completed_at TIMESTAMPTZ,
  signed_document_id UUID REFERENCES customer_documents(id) ON DELETE SET NULL,
  period_start_date DATE,
  period_end_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_rental_agreements_rental_id ON rental_agreements(rental_id);
CREATE INDEX idx_rental_agreements_document_id ON rental_agreements(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX idx_rental_agreements_tenant_id ON rental_agreements(tenant_id);

-- Updated_at trigger
CREATE TRIGGER set_rental_agreements_updated_at
  BEFORE UPDATE ON rental_agreements
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE rental_agreements ENABLE ROW LEVEL SECURITY;

-- Tenant users can read their own agreements
CREATE POLICY "rental_agreements_select_tenant"
  ON rental_agreements FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Service role can do everything (API routes + webhook use service role)
CREATE POLICY "rental_agreements_all_service_role"
  ON rental_agreements FOR ALL
  USING (auth.role() = 'service_role');

-- Backfill existing agreements from rentals table (idempotent)
INSERT INTO rental_agreements (
  rental_id,
  tenant_id,
  agreement_type,
  document_id,
  document_status,
  boldsign_mode,
  envelope_created_at,
  envelope_sent_at,
  envelope_completed_at,
  signed_document_id,
  period_start_date,
  period_end_date,
  created_at
)
SELECT
  r.id,
  r.tenant_id,
  'original',
  r.docusign_envelope_id,
  COALESCE(r.document_status, 'pending'),
  r.boldsign_mode,
  r.envelope_created_at,
  r.envelope_sent_at,
  r.envelope_completed_at,
  r.signed_document_id,
  r.start_date::date,
  r.end_date::date,
  COALESCE(r.envelope_created_at, r.created_at)
FROM rentals r
WHERE r.docusign_envelope_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM rental_agreements ra
    WHERE ra.rental_id = r.id AND ra.document_id = r.docusign_envelope_id
  );
