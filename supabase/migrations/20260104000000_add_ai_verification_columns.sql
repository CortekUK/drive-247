-- Add AI verification columns to identity_verifications table
ALTER TABLE identity_verifications
ADD COLUMN IF NOT EXISTS verification_provider TEXT DEFAULT 'veriff'
  CHECK (verification_provider IN ('veriff', 'ai')),
ADD COLUMN IF NOT EXISTS ai_face_match_score DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS ai_face_match_result TEXT
  CHECK (ai_face_match_result IN ('match', 'no_match', 'error', 'pending') OR ai_face_match_result IS NULL),
ADD COLUMN IF NOT EXISTS ai_ocr_data JSONB,
ADD COLUMN IF NOT EXISTS selfie_image_url TEXT,
ADD COLUMN IF NOT EXISTS qr_session_token TEXT,
ADD COLUMN IF NOT EXISTS qr_session_expires_at TIMESTAMPTZ;

-- Create index for QR token lookups
CREATE INDEX IF NOT EXISTS idx_identity_verifications_qr_token
ON identity_verifications(qr_session_token) WHERE qr_session_token IS NOT NULL;

-- Comment on columns
COMMENT ON COLUMN identity_verifications.verification_provider IS 'Provider used: veriff or ai';
COMMENT ON COLUMN identity_verifications.ai_face_match_score IS 'Face match similarity score from AI (0.0-1.0)';
COMMENT ON COLUMN identity_verifications.ai_face_match_result IS 'AI face match result: match, no_match, error, pending';
COMMENT ON COLUMN identity_verifications.ai_ocr_data IS 'JSON data extracted by AI OCR from document';
COMMENT ON COLUMN identity_verifications.selfie_image_url IS 'URL to selfie image for AI verification';
COMMENT ON COLUMN identity_verifications.qr_session_token IS 'Token for QR code mobile verification';
COMMENT ON COLUMN identity_verifications.qr_session_expires_at IS 'Expiry time for QR session';
