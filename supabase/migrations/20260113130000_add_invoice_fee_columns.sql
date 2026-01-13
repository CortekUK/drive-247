-- Add service_fee and security_deposit columns to invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS service_fee numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_deposit numeric(10,2) DEFAULT 0;

COMMENT ON COLUMN public.invoices.service_fee IS 'Service fee amount charged on this invoice';
COMMENT ON COLUMN public.invoices.security_deposit IS 'Security deposit amount charged on this invoice';
