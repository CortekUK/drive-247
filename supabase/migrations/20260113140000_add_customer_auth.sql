-- Customer Authentication Tables and RLS Policies
-- This migration adds customer authentication support for the booking app

-- Create customer_users table (links Supabase Auth to customers)
CREATE TABLE IF NOT EXISTS customer_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT customer_users_auth_user_unique UNIQUE(auth_user_id),
  CONSTRAINT customer_users_customer_tenant_unique UNIQUE(customer_id, tenant_id)
);

-- Create indexes for customer_users
CREATE INDEX IF NOT EXISTS idx_customer_users_auth_user ON customer_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_users_customer ON customer_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_users_tenant ON customer_users(tenant_id);

-- Create customer_notifications table
CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50) DEFAULT 'info',
  link VARCHAR(500),
  is_read BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for customer_notifications
CREATE INDEX IF NOT EXISTS idx_customer_notifications_user ON customer_notifications(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_customer_notifications_unread ON customer_notifications(customer_user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_customer_notifications_tenant ON customer_notifications(tenant_id);

-- Enable RLS on new tables
ALTER TABLE customer_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for customer_users

-- Customers can read their own link
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_users' AND policyname = 'Customers can read own customer_user link') THEN
    CREATE POLICY "Customers can read own customer_user link" ON customer_users FOR SELECT USING (auth.uid() = auth_user_id);
  END IF;
END $$;

-- Service role can insert (for signup edge function)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_users' AND policyname = 'Service role can insert customer_users') THEN
    CREATE POLICY "Service role can insert customer_users" ON customer_users FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Customers can update their own link
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_users' AND policyname = 'Customers can update own customer_user link') THEN
    CREATE POLICY "Customers can update own customer_user link" ON customer_users FOR UPDATE USING (auth.uid() = auth_user_id);
  END IF;
END $$;

-- RLS Policies for customer_notifications

-- Customers can read their own notifications
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_notifications' AND policyname = 'Customers can read own notifications') THEN
    CREATE POLICY "Customers can read own notifications" ON customer_notifications FOR SELECT USING (
      EXISTS (SELECT 1 FROM customer_users cu WHERE cu.id = customer_notifications.customer_user_id AND cu.auth_user_id = auth.uid())
    );
  END IF;
END $$;

-- Customers can update their own notifications (mark as read)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_notifications' AND policyname = 'Customers can update own notifications') THEN
    CREATE POLICY "Customers can update own notifications" ON customer_notifications FOR UPDATE USING (
      EXISTS (SELECT 1 FROM customer_users cu WHERE cu.id = customer_notifications.customer_user_id AND cu.auth_user_id = auth.uid())
    );
  END IF;
END $$;

-- Customers can delete their own notifications
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_notifications' AND policyname = 'Customers can delete own notifications') THEN
    CREATE POLICY "Customers can delete own notifications" ON customer_notifications FOR DELETE USING (
      EXISTS (SELECT 1 FROM customer_users cu WHERE cu.id = customer_notifications.customer_user_id AND cu.auth_user_id = auth.uid())
    );
  END IF;
END $$;

-- Service role can insert notifications
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_notifications' AND policyname = 'Service role can insert customer_notifications') THEN
    CREATE POLICY "Service role can insert customer_notifications" ON customer_notifications FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Add RLS policy for customers to read their own rentals
-- First check if policy exists before creating
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rentals'
    AND policyname = 'Customers can read own rentals'
  ) THEN
    CREATE POLICY "Customers can read own rentals" ON rentals
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM customer_users cu
          WHERE cu.customer_id = rentals.customer_id
          AND cu.auth_user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Add RLS policy for customers to read their own identity verifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'identity_verifications'
    AND policyname = 'Customers can read own verifications'
  ) THEN
    CREATE POLICY "Customers can read own verifications" ON identity_verifications
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM customer_users cu
          WHERE cu.customer_id = identity_verifications.customer_id
          AND cu.auth_user_id = auth.uid()
        )
      );
  END IF;
END
$$;

-- Add trigger to update updated_at on customer_users
CREATE OR REPLACE FUNCTION update_customer_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customer_users_updated_at ON customer_users;
CREATE TRIGGER customer_users_updated_at
  BEFORE UPDATE ON customer_users
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_users_updated_at();

-- Grant necessary permissions to authenticated users
GRANT SELECT, UPDATE ON customer_users TO authenticated;
GRANT SELECT, UPDATE, DELETE ON customer_notifications TO authenticated;

-- Grant insert to service role for edge functions
GRANT INSERT ON customer_users TO service_role;
GRANT INSERT ON customer_notifications TO service_role;
