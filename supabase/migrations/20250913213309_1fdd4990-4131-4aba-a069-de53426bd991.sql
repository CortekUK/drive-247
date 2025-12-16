-- Fix RLS policies to allow anonymous access for fleet management operations
-- This is temporary until authentication is implemented

-- Update RLS policy for fines table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.fines;
CREATE POLICY "Allow all operations for app users" ON public.fines
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for customers table to allow anon access  
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.customers;
CREATE POLICY "Allow all operations for app users" ON public.customers
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for vehicles table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.vehicles;
CREATE POLICY "Allow all operations for app users" ON public.vehicles
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for rentals table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.rentals;
CREATE POLICY "Allow all operations for app users" ON public.rentals
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for payments table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.payments;
CREATE POLICY "Allow all operations for app users" ON public.payments
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for ledger_entries table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.ledger_entries;
CREATE POLICY "Allow all operations for app users" ON public.ledger_entries
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for pnl_entries table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.pnl_entries;
CREATE POLICY "Allow all operations for app users" ON public.pnl_entries
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for fine_files table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.fine_files;
CREATE POLICY "Allow all operations for app users" ON public.fine_files
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for payment_applications table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.payment_applications;
CREATE POLICY "Allow all operations for app users" ON public.payment_applications
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for plates table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.plates;
CREATE POLICY "Allow all operations for app users" ON public.plates
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for customer_documents table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.customer_documents;
CREATE POLICY "Allow all operations for app users" ON public.customer_documents
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for reminder_events table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.reminder_events;
CREATE POLICY "Allow all operations for app users" ON public.reminder_events
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for reminder_logs table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.reminder_logs;
CREATE POLICY "Allow all operations for app users" ON public.reminder_logs
  FOR ALL USING (true) WITH CHECK (true);

-- Update RLS policy for reminder_settings table to allow anon access
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.reminder_settings;
CREATE POLICY "Allow all operations for app users" ON public.reminder_settings
  FOR ALL USING (true) WITH CHECK (true);

-- Keep the users table policies as they are for security (custom auth system)