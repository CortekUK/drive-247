-- ============================================================================
-- RENTAL EXTENSION FEATURE MIGRATION
-- Adds support for customers to request rental extensions
-- ============================================================================

-- ============================================================================
-- EXTEND RENTALS TABLE
-- Add extension tracking columns
-- ============================================================================

-- is_extended: indicates a pending extension request
ALTER TABLE public.rentals
ADD COLUMN IF NOT EXISTS is_extended BOOLEAN DEFAULT false;

-- previous_end_date: stores requested date during pending, original date after approval
ALTER TABLE public.rentals
ADD COLUMN IF NOT EXISTS previous_end_date DATE;

COMMENT ON COLUMN rentals.is_extended IS 'Indicates a pending extension request from customer';
COMMENT ON COLUMN rentals.previous_end_date IS 'During pending: requested new end date. After approval: original end date';

-- Index for efficient queries of pending extension requests
CREATE INDEX IF NOT EXISTS idx_rentals_is_extended
ON rentals(is_extended) WHERE is_extended = true;
