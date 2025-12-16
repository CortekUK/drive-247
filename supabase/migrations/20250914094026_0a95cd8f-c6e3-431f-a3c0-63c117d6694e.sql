-- Phase 1: Create unique index for P&L reference if not exists (for idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS ux_pnl_reference 
ON pnl_entries(reference) WHERE reference IS NOT NULL;

-- Phase 2: Create authority_payments table for audit trail (optional but recommended)
CREATE TABLE IF NOT EXISTS authority_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id UUID NOT NULL REFERENCES fines(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(fine_id, payment_date, amount) -- Prevent duplicate payments for same fine on same date
);

-- Enable RLS on authority_payments
ALTER TABLE authority_payments ENABLE ROW LEVEL SECURITY;

-- Create policy for authority_payments
CREATE POLICY "Allow all operations for app users" ON authority_payments FOR ALL USING (true) WITH CHECK (true);