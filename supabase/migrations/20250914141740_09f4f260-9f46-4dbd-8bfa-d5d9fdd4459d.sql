-- Add new customer fields for enhanced customer management
ALTER TABLE public.customers 
  ADD COLUMN IF NOT EXISTS customer_type text CHECK (customer_type IN ('Individual','Company')) DEFAULT 'Individual',
  ADD COLUMN IF NOT EXISTS high_switcher boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS nok_full_name text,
  ADD COLUMN IF NOT EXISTS nok_relationship text,
  ADD COLUMN IF NOT EXISTS nok_phone text,
  ADD COLUMN IF NOT EXISTS nok_email text,
  ADD COLUMN IF NOT EXISTS nok_address text;

-- Update existing 'type' column data to 'customer_type' if needed
UPDATE public.customers 
SET customer_type = CASE 
  WHEN type = 'Individual' THEN 'Individual'
  WHEN type = 'Company' THEN 'Company' 
  ELSE 'Individual'
END
WHERE customer_type IS NULL OR customer_type = 'Individual';

-- Create indexes for filtering performance
CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON public.customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_high_switcher ON public.customers(high_switcher);

-- Create index for active rentals queries (performance optimization)
CREATE INDEX IF NOT EXISTS idx_rentals_active_lookup ON public.rentals(customer_id, status, start_date, end_date) 
WHERE status = 'Active';