-- Add profile_photo column to customers table
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT DEFAULT NULL;

-- Add email_verified column to customer_users table for tracking email verification
ALTER TABLE public.customer_users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_email TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_email_token TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pending_email_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Create storage bucket for customer profile photos if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-photos', 'customer-photos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policy for customer photos bucket
DO $$
BEGIN
  -- Allow authenticated users to upload their own photos
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Customers can upload own profile photos'
  ) THEN
    CREATE POLICY "Customers can upload own profile photos" ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'customer-photos' AND
        auth.role() = 'authenticated'
      );
  END IF;

  -- Allow authenticated users to update their own photos
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Customers can update own profile photos'
  ) THEN
    CREATE POLICY "Customers can update own profile photos" ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'customer-photos' AND
        auth.role() = 'authenticated'
      );
  END IF;

  -- Allow authenticated users to delete their own photos
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Customers can delete own profile photos'
  ) THEN
    CREATE POLICY "Customers can delete own profile photos" ON storage.objects
      FOR DELETE
      USING (
        bucket_id = 'customer-photos' AND
        auth.role() = 'authenticated'
      );
  END IF;

  -- Allow public read access to profile photos
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for customer photos'
  ) THEN
    CREATE POLICY "Public read access for customer photos" ON storage.objects
      FOR SELECT
      USING (bucket_id = 'customer-photos');
  END IF;
END $$;

-- Add RLS policy for customers to update their own profile
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customers' AND policyname = 'Customers can update own profile'
  ) THEN
    CREATE POLICY "Customers can update own profile" ON customers
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM customer_users cu
          WHERE cu.customer_id = customers.id
          AND cu.auth_user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM customer_users cu
          WHERE cu.customer_id = customers.id
          AND cu.auth_user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Comments
COMMENT ON COLUMN public.customers.profile_photo_url IS 'URL to customer profile photo in storage';
COMMENT ON COLUMN public.customer_users.email_verified IS 'Whether customer email has been verified';
COMMENT ON COLUMN public.customer_users.pending_email IS 'New email pending verification';
COMMENT ON COLUMN public.customer_users.pending_email_token IS 'Token for email change verification';
COMMENT ON COLUMN public.customer_users.pending_email_expires_at IS 'Expiry time for pending email change';
