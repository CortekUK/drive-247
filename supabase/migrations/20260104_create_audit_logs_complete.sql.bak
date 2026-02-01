-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_audit_logs_tenant 
    FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) 
    ON DELETE CASCADE,
    
  CONSTRAINT fk_audit_logs_actor 
    FOREIGN KEY (actor_id) 
    REFERENCES app_users(id) 
    ON DELETE SET NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);

-- Enable Row Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view audit logs for their tenant
CREATE POLICY "Users can view their tenant audit logs"
ON audit_logs FOR SELECT TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
  )
);

-- Policy: Service role can insert audit logs (for Edge Functions)
CREATE POLICY "Service role can insert audit logs"
ON audit_logs FOR INSERT TO service_role
WITH CHECK (true);

-- Policy: Authenticated users can insert audit logs for their tenant
CREATE POLICY "Users can insert audit logs for their tenant"
ON audit_logs FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
  )
);

-- Add table comment
COMMENT ON TABLE audit_logs IS 'Tracks all user actions and system changes for compliance and debugging';
