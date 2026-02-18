-- Add policy version tracking to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_policy_version TEXT DEFAULT '1.0';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS terms_version TEXT DEFAULT '1.0';

-- Create policy acceptances table
CREATE TABLE policy_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('privacy_policy', 'terms_and_conditions')),
  version TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(app_user_id, policy_type, version)
);

CREATE INDEX idx_policy_acceptances_lookup ON policy_acceptances(app_user_id, policy_type, version);
ALTER TABLE policy_acceptances ENABLE ROW LEVEL SECURITY;

-- Users can read their own acceptances
CREATE POLICY "Users can read own acceptances" ON policy_acceptances
  FOR SELECT USING (app_user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid()));

-- Users can insert their own acceptances
CREATE POLICY "Users can insert own acceptances" ON policy_acceptances
  FOR INSERT WITH CHECK (app_user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid()));

-- Admins can read tenant acceptances
CREATE POLICY "Admins can read tenant acceptances" ON policy_acceptances
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid() AND role IN ('head_admin', 'admin'))
    OR EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = auth.uid() AND is_super_admin = true)
  );

-- Service role full access (for edge functions)
CREATE POLICY "Service role full access" ON policy_acceptances
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
