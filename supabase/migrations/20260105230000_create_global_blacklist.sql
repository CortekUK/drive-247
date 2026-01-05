-- Create global_blacklist table for customers blocked by 3+ tenants
CREATE TABLE IF NOT EXISTS global_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  blocked_tenant_count INTEGER NOT NULL DEFAULT 0,
  first_blocked_at TIMESTAMPTZ,
  last_blocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast email lookups
CREATE INDEX idx_global_blacklist_email ON global_blacklist(email);

-- Create a view to show which tenants blocked each email
CREATE OR REPLACE VIEW v_global_blacklist_details AS
SELECT
  gb.id,
  gb.email,
  gb.blocked_tenant_count,
  gb.first_blocked_at,
  gb.last_blocked_at,
  gb.created_at,
  COALESCE(
    json_agg(
      json_build_object(
        'tenant_id', bi.tenant_id,
        'tenant_name', t.company_name,
        'reason', bi.reason,
        'blocked_at', bi.created_at
      )
    ) FILTER (WHERE bi.id IS NOT NULL),
    '[]'::json
  ) as blocking_tenants
FROM global_blacklist gb
LEFT JOIN blocked_identities bi ON bi.identity_number = gb.email
  AND bi.identity_type = 'email'
  AND bi.is_active = true
LEFT JOIN tenants t ON t.id = bi.tenant_id
GROUP BY gb.id, gb.email, gb.blocked_tenant_count, gb.first_blocked_at, gb.last_blocked_at, gb.created_at;

-- Function to check and update global blacklist when a customer is blocked
CREATE OR REPLACE FUNCTION check_and_update_global_blacklist(p_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_tenant_count INTEGER;
  v_first_blocked TIMESTAMPTZ;
  v_last_blocked TIMESTAMPTZ;
BEGIN
  -- Count distinct tenants that have blocked this email
  SELECT
    COUNT(DISTINCT tenant_id),
    MIN(created_at),
    MAX(created_at)
  INTO v_tenant_count, v_first_blocked, v_last_blocked
  FROM blocked_identities
  WHERE identity_number = p_email
    AND identity_type = 'email'
    AND is_active = true;

  -- If blocked by 3+ tenants, add/update global blacklist
  IF v_tenant_count >= 3 THEN
    INSERT INTO global_blacklist (email, blocked_tenant_count, first_blocked_at, last_blocked_at, updated_at)
    VALUES (p_email, v_tenant_count, v_first_blocked, v_last_blocked, NOW())
    ON CONFLICT (email)
    DO UPDATE SET
      blocked_tenant_count = v_tenant_count,
      last_blocked_at = v_last_blocked,
      updated_at = NOW();
    RETURN TRUE;
  ELSE
    -- Remove from global blacklist if count drops below 3
    DELETE FROM global_blacklist WHERE email = p_email;
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if email is globally blacklisted
CREATE OR REPLACE FUNCTION is_globally_blacklisted(p_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM global_blacklist WHERE email = p_email);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for global_blacklist
ALTER TABLE global_blacklist ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view global blacklist (it's meant to be visible to all tenants)
CREATE POLICY "Authenticated users can view global blacklist"
  ON global_blacklist FOR SELECT
  TO authenticated
  USING (true);

-- Anonymous users can check global blacklist (needed for booking flow)
CREATE POLICY "Anonymous users can view global blacklist"
  ON global_blacklist FOR SELECT
  TO anon
  USING (true);

-- Only the system (via functions) can insert/update/delete
-- No direct INSERT/UPDATE/DELETE policies for regular users
