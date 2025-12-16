-- Add MOT and TAX due date tracking to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN mot_due_date date,
ADD COLUMN tax_due_date date;