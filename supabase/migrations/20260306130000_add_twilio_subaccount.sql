-- Add Twilio subaccount columns for per-tenant SMS
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_subaccount_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_subaccount_auth_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_phone_number_sid TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integration_twilio_sms BOOLEAN DEFAULT false;
