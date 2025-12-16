-- Add finance-related columns to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS monthly_payment numeric,
ADD COLUMN IF NOT EXISTS initial_payment numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS term_months integer,
ADD COLUMN IF NOT EXISTS balloon numeric,
ADD COLUMN IF NOT EXISTS finance_start_date date;