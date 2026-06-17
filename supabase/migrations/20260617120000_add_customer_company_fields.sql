-- Company/corporate customer capture.
-- `customers.customer_type` already exists ('Individual' | 'Company'); add the
-- business detail fields so an operator can save a company once and reuse it on
-- future rentals (select the customer → company info auto-loads).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_registration text;
