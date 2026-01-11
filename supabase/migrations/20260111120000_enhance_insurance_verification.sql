-- Migration: Enhance Insurance Verification Fields
-- Adds new columns to support industry-standard AI insurance verification

-- Add verification_decision column to track auto/manual decisions
ALTER TABLE customer_documents
ADD COLUMN IF NOT EXISTS verification_decision text
  CHECK (verification_decision IN ('auto_approved', 'auto_rejected', 'pending_review', 'manually_approved', 'manually_rejected'));

-- Add review_reasons array to store why manual review is needed
ALTER TABLE customer_documents
ADD COLUMN IF NOT EXISTS review_reasons text[];

-- Add fraud_risk_score for fraud detection results
ALTER TABLE customer_documents
ADD COLUMN IF NOT EXISTS fraud_risk_score numeric(3,2)
  CHECK (fraud_risk_score >= 0 AND fraud_risk_score <= 1);

-- Add comments explaining new columns
COMMENT ON COLUMN customer_documents.verification_decision IS
'AI verification decision: auto_approved (85%+ score), auto_rejected (<60% score), pending_review (60-85%), manually_approved/rejected (admin action)';

COMMENT ON COLUMN customer_documents.review_reasons IS
'Array of reasons why manual review is required (fraud indicators, low confidence, missing data, etc.)';

COMMENT ON COLUMN customer_documents.fraud_risk_score IS
'Fraud risk score from 0 (no risk) to 1 (high risk). Calculated based on expired dates, inconsistent data, suspicious patterns.';

-- Create index for faster queries on verification status
CREATE INDEX IF NOT EXISTS idx_customer_documents_verification_decision
ON customer_documents (verification_decision)
WHERE document_type = 'Insurance Certificate';

-- Create index for fraud risk monitoring
CREATE INDEX IF NOT EXISTS idx_customer_documents_fraud_risk
ON customer_documents (fraud_risk_score)
WHERE fraud_risk_score IS NOT NULL AND fraud_risk_score >= 0.5;
