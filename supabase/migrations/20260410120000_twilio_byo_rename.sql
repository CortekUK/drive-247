-- Twilio BYO (Bring Your Own) migration
-- Pivoting from managed subaccounts to tenants connecting their own Twilio account.
-- Clean cutover — no production tenants on subaccounts at time of migration.

-- Rename subaccount columns to reflect BYO semantics.
-- Under BYO, these hold the tenant's own Twilio Account SID + Auth Token.
ALTER TABLE tenants RENAME COLUMN twilio_subaccount_sid TO twilio_account_sid;
ALTER TABLE tenants RENAME COLUMN twilio_subaccount_auth_token TO twilio_auth_token;

-- Track when the tenant successfully verified their Twilio connection
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS twilio_connection_verified_at TIMESTAMPTZ;

-- Drop dead 10DLC columns — under BYO, tenants register their own 10DLC brand
-- and campaign directly in their own Twilio dashboard. We no longer track that state.
ALTER TABLE tenants DROP COLUMN IF EXISTS twilio_brand_sid;
ALTER TABLE tenants DROP COLUMN IF EXISTS twilio_brand_status;
ALTER TABLE tenants DROP COLUMN IF EXISTS twilio_campaign_sid;
ALTER TABLE tenants DROP COLUMN IF EXISTS twilio_campaign_status;

-- Keep twilio_messaging_service_sid as OPTIONAL — tenants with higher-volume setups
-- may paste their own Messaging Service SID instead of (or in addition to) a From number.
