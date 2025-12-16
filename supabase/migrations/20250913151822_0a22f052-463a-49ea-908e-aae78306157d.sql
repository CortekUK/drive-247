-- Add foreign key constraint between ledger_entries.payment_id and payments.id
ALTER TABLE public.ledger_entries 
ADD CONSTRAINT fk_ledger_entries_payment_id 
FOREIGN KEY (payment_id) REFERENCES public.payments(id);

-- Add performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ledger_entries_type ON public.ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_entry_date ON public.ledger_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_type_entry_date ON public.ledger_entries(type, entry_date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_customer_type ON public.ledger_entries(customer_id, type);

-- Add index for payment applications join performance
CREATE INDEX IF NOT EXISTS idx_payment_applications_payment_id ON public.payment_applications(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_applications_charge_entry_id ON public.payment_applications(charge_entry_id);