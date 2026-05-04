-- Add forwarding_caller_id_mode to control which caller ID staff phones see
-- when an inbound call is forwarded.
--   'caller'        : pass through the original caller's number (default; current behaviour)
--   'business_line' : show the tenant's Twilio number so staff knows the call is a business call

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS forwarding_caller_id_mode text NOT NULL DEFAULT 'caller'
    CHECK (forwarding_caller_id_mode IN ('caller', 'business_line'));

COMMENT ON COLUMN public.tenants.forwarding_caller_id_mode IS
  'Controls callerId on forwarded inbound calls. caller = passthrough, business_line = show Twilio number.';
