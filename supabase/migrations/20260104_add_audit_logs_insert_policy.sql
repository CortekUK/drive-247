-- Enable authenticated users to insert audit logs
-- This allows Edge Functions (running with service role) to create audit entries

CREATE POLICY "p_audit_insert" 
ON "public"."audit_logs" 
FOR INSERT 
WITH CHECK (true);

-- Optional: Also add policy for service role to bypass RLS
ALTER TABLE "public"."audit_logs" FORCE ROW LEVEL SECURITY;
