-- Add verification document type setting to tenants
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS verification_document_type TEXT NOT NULL DEFAULT 'driving_license';

-- Valid values: 'any', 'driving_license', 'passport', 'id_card', 'driving_license_or_passport'
COMMENT ON COLUMN tenants.verification_document_type IS 'Required document type for identity verification: any, driving_license, passport, id_card, driving_license_or_passport';
