-- Add booking_lead_time_unit column to tenants table
-- This stores the display unit preference (hours/days) for the admin UI.
-- The actual lead time is always stored in hours in booking_lead_time_hours.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS booking_lead_time_unit TEXT DEFAULT 'hours';
