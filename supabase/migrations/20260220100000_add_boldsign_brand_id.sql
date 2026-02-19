-- Add BoldSign brand ID to tenants for branded signing emails
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS boldsign_brand_id TEXT;
