-- Custom domain, self-serve (northwind first).
--
-- The portal's Custom Domain panel adds the operator's domain to our Vercel
-- projects through the `custom-domain` edge function, and `custom-domain-run`
-- keeps checking until DNS points at us and the certificate is issued. These
-- columns are what those two write; the routing columns
-- (custom_booking_domain / custom_portal_domain) are unchanged.
--
--   pending — added to Vercel, waiting on the operator's DNS records
--   active  — DNS points at us and the site answers over https
--   error   — Vercel refused the domain, or it never went live in time
--
-- Only the edge functions (service role) write these. A tenant reads them.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_status TEXT
  CHECK (custom_domain_status IN ('pending', 'active', 'error'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_detail TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_records JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_requested_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_checked_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_domain_live_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.custom_domain_status IS 'Self-serve custom domain: pending | active | error. Written by the custom-domain edge functions only.';
COMMENT ON COLUMN tenants.custom_domain_records IS 'The DNS records the operator must add, as returned by Vercel: [{type, name, value}].';

CREATE INDEX IF NOT EXISTS idx_tenants_custom_domain_pending
  ON tenants (custom_domain_requested_at) WHERE custom_domain_status = 'pending';

-- ── Runner ──────────────────────────────────────────────────────────────────
-- custom-domain-run every 5 minutes: checks every pending domain against
-- Vercel and emails the operator when it goes live. Built from the existing
-- customer-management-run job so the key never sits in the repo.

DO $$
DECLARE
  v_cmd text;
BEGIN
  SELECT replace(command, 'customer-management-run', 'custom-domain-run')
    INTO v_cmd FROM cron.job WHERE jobname = 'customer-management-run';
  IF v_cmd IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'custom-domain-run';
    PERFORM cron.schedule('custom-domain-run', '*/5 * * * *', v_cmd);
  END IF;
END $$;
