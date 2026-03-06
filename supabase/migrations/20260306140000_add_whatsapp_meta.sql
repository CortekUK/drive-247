-- Add Meta WhatsApp Business API columns to tenants for per-tenant WhatsApp
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_whatsapp_waba_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_whatsapp_phone_number_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_whatsapp_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS meta_whatsapp_phone_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integration_whatsapp BOOLEAN DEFAULT false;
