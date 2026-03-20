-- Tenant-specific review tags (replaces hardcoded positive/negative tags)
CREATE TABLE IF NOT EXISTS review_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- RLS
ALTER TABLE review_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their own tags"
  ON review_tags FOR SELECT
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

CREATE POLICY "Tenant users can create tags"
  ON review_tags FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Tenant users can delete their own tags"
  ON review_tags FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Index for fast lookup
CREATE INDEX idx_review_tags_tenant ON review_tags(tenant_id);
