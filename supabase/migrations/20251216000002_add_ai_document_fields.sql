-- ================================================
-- AI DOCUMENT SCANNING FIELDS
-- ================================================
-- Add AI-powered document scanning capabilities to customer_documents table
-- Stores extracted insurance policy data and validation scores

ALTER TABLE customer_documents
-- AI Scanning Status
ADD COLUMN IF NOT EXISTS ai_scan_status TEXT CHECK (ai_scan_status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',

-- Extracted Data (JSON structure)
-- Format: { policyNumber, provider, startDate, endDate, coverageAmount, isValid, validationNotes }
ADD COLUMN IF NOT EXISTS ai_extracted_data JSONB,

-- Confidence Score (0.00 to 1.00)
-- How confident the AI is about the extracted data
ADD COLUMN IF NOT EXISTS ai_confidence_score NUMERIC(3,2) CHECK (ai_confidence_score >= 0 AND ai_confidence_score <= 1),

-- Validation Score (0.00 to 1.00) - ADMIN ONLY
-- Overall document validity score based on completeness and data quality
ADD COLUMN IF NOT EXISTS ai_validation_score NUMERIC(3,2) CHECK (ai_validation_score >= 0 AND ai_validation_score <= 1),

-- Scan Errors
-- Array of error messages if scanning fails
ADD COLUMN IF NOT EXISTS ai_scan_errors TEXT[],

-- Timestamps
ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ,

-- Link to Rental
-- Associate document with specific rental during booking flow
ADD COLUMN IF NOT EXISTS rental_id UUID REFERENCES rentals(id) ON DELETE SET NULL;

-- ================================================
-- INDEXES FOR PERFORMANCE
-- ================================================

CREATE INDEX IF NOT EXISTS idx_customer_documents_rental_id
  ON customer_documents(rental_id) WHERE rental_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_documents_ai_scan_status
  ON customer_documents(ai_scan_status);

CREATE INDEX IF NOT EXISTS idx_customer_documents_scanned_at
  ON customer_documents(scanned_at DESC) WHERE scanned_at IS NOT NULL;

-- Composite index for admin queries
CREATE INDEX IF NOT EXISTS idx_customer_documents_rental_scan
  ON customer_documents(rental_id, ai_scan_status) WHERE rental_id IS NOT NULL;

-- ================================================
-- COMMENTS FOR DOCUMENTATION
-- ================================================

COMMENT ON COLUMN customer_documents.ai_scan_status IS 'Status of AI document scanning: pending, processing, completed, failed';
COMMENT ON COLUMN customer_documents.ai_extracted_data IS 'JSON object containing extracted insurance policy data (policyNumber, provider, dates, coverage)';
COMMENT ON COLUMN customer_documents.ai_confidence_score IS 'AI confidence in extracted data accuracy (0-1 scale)';
COMMENT ON COLUMN customer_documents.ai_validation_score IS 'Overall document validation score visible only to admins (0-1 scale)';
COMMENT ON COLUMN customer_documents.ai_scan_errors IS 'Array of error messages if AI scanning failed';
COMMENT ON COLUMN customer_documents.scanned_at IS 'Timestamp when AI scanning completed';
COMMENT ON COLUMN customer_documents.rental_id IS 'Associated rental ID if document uploaded during booking flow';

-- ================================================
-- HELPER FUNCTION: Get Insurance Documents for Rental
-- ================================================

CREATE OR REPLACE FUNCTION get_rental_insurance_documents(p_rental_id UUID)
RETURNS TABLE (
  id UUID,
  document_name TEXT,
  file_url TEXT,
  ai_scan_status TEXT,
  ai_extracted_data JSONB,
  ai_validation_score NUMERIC,
  scanned_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cd.id,
    cd.document_name,
    cd.file_url,
    cd.ai_scan_status,
    cd.ai_extracted_data,
    cd.ai_validation_score,
    cd.scanned_at,
    cd.uploaded_at
  FROM customer_documents cd
  WHERE cd.rental_id = p_rental_id
    AND cd.document_type ILIKE '%insurance%'
  ORDER BY cd.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- GRANT PERMISSIONS
-- ================================================

GRANT EXECUTE ON FUNCTION get_rental_insurance_documents(UUID) TO authenticated;
