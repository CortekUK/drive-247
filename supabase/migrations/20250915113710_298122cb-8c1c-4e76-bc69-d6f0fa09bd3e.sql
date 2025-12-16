-- Add has_logbook column to vehicles table
ALTER TABLE public.vehicles 
ADD COLUMN has_logbook BOOLEAN NOT NULL DEFAULT false;