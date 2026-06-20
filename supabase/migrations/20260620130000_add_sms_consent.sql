-- SMS opt-in consent (A2P 10DLC compliance).
--
-- The booking form shows an SMS consent checkbox when the tenant has Twilio SMS
-- enabled (tenants.integration_twilio_sms). Until now that checkbox value was
-- collected but never persisted — so there was no record/proof of opt-in, which
-- A2P 10DLC requires. These columns store the consent state on the phone owner
-- (customers) and snapshot it on the booking it was captured with (rentals).

-- Current opt-in state of the phone owner. Mirrors the existing whatsapp_opt_in.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;

-- Point-in-time snapshot of the consent captured on this specific booking.
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;

COMMENT ON COLUMN public.customers.sms_consent IS
  'A2P 10DLC: customer opted in to receive SMS. Set true (never auto-revoked) when the booking-form consent box is ticked.';
COMMENT ON COLUMN public.customers.sms_consent_at IS
  'A2P 10DLC: UTC timestamp the SMS opt-in was given.';
COMMENT ON COLUMN public.rentals.sms_consent IS
  'A2P 10DLC: SMS opt-in state captured on this booking (proof tied to the rental).';
COMMENT ON COLUMN public.rentals.sms_consent_at IS
  'A2P 10DLC: UTC timestamp the SMS opt-in was given for this booking.';
