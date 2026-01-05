-- Add approval_status, payment_status, and cancellation_reason columns to rentals table
-- These fields determine the derived rental status

-- approval_status: tracks admin approval decision
ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'pending';

ALTER TABLE rentals
ADD CONSTRAINT rentals_approval_status_check
CHECK (approval_status IN ('pending', 'approved', 'rejected'));

COMMENT ON COLUMN rentals.approval_status IS 'Admin approval status: pending (awaiting review), approved (admin approved), rejected (admin denied)';

-- payment_status: tracks payment state
ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending';

ALTER TABLE rentals
ADD CONSTRAINT rentals_payment_status_check
CHECK (payment_status IN ('pending', 'fulfilled', 'failed', 'refunded'));

COMMENT ON COLUMN rentals.payment_status IS 'Payment status: pending (awaiting/held), fulfilled (captured), failed (payment failed), refunded (money returned)';

-- cancellation_reason: stores reason when rental is cancelled (via reject or cancel)
ALTER TABLE rentals
ADD COLUMN IF NOT EXISTS cancellation_reason text;

COMMENT ON COLUMN rentals.cancellation_reason IS 'Reason for cancellation/rejection: rejected_insurance, rejected_id, customer_requested, early_termination, breach_of_contract, etc.';

-- Create indexes for filtering
CREATE INDEX IF NOT EXISTS idx_rentals_approval_status ON rentals(approval_status);
CREATE INDEX IF NOT EXISTS idx_rentals_payment_status ON rentals(payment_status);

-- Update existing rentals to have sensible defaults based on current status
-- Active rentals: approved + fulfilled
UPDATE rentals
SET approval_status = 'approved', payment_status = 'fulfilled'
WHERE status = 'Active';

-- Closed rentals: approved + fulfilled
UPDATE rentals
SET approval_status = 'approved', payment_status = 'fulfilled'
WHERE status = 'Closed';

-- Pending rentals: keep defaults (pending + pending)
-- Cancelled rentals: we don't know why, leave as pending
