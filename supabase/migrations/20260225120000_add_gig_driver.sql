-- Add gig driver support to customers and rentals
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_gig_driver BOOLEAN DEFAULT false;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS is_gig_driver BOOLEAN DEFAULT false;

-- Gig driver proof images table
CREATE TABLE IF NOT EXISTS gig_driver_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  image_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gig_driver_images_customer_id ON gig_driver_images(customer_id);
CREATE INDEX IF NOT EXISTS idx_gig_driver_images_tenant_id ON gig_driver_images(tenant_id);

-- RLS on gig_driver_images
ALTER TABLE gig_driver_images ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: authenticated users see their tenant's data
DROP POLICY IF EXISTS "Tenant users can view gig driver images" ON gig_driver_images;
CREATE POLICY "Tenant users can view gig driver images"
  ON gig_driver_images FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can insert gig driver images" ON gig_driver_images;
CREATE POLICY "Tenant users can insert gig driver images"
  ON gig_driver_images FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can delete gig driver images" ON gig_driver_images;
CREATE POLICY "Tenant users can delete gig driver images"
  ON gig_driver_images FOR DELETE
  TO authenticated
  USING (tenant_id = get_user_tenant_id() OR is_super_admin());

-- Anon access for guest checkout flow
DROP POLICY IF EXISTS "Anon can insert gig driver images" ON gig_driver_images;
CREATE POLICY "Anon can insert gig driver images"
  ON gig_driver_images FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can view gig driver images" ON gig_driver_images;
CREATE POLICY "Anon can view gig driver images"
  ON gig_driver_images FOR SELECT
  TO anon
  USING (true);

-- Service role full access
DROP POLICY IF EXISTS "Service role full access on gig driver images" ON gig_driver_images;
CREATE POLICY "Service role full access on gig driver images"
  ON gig_driver_images FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Storage bucket for gig driver images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gig-driver-images',
  'gig-driver-images',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png'];

-- Storage policies for gig-driver-images bucket
DROP POLICY IF EXISTS "Allow public uploads to gig-driver-images" ON storage.objects;
CREATE POLICY "Allow public uploads to gig-driver-images"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'gig-driver-images');

DROP POLICY IF EXISTS "Allow public reads from gig-driver-images" ON storage.objects;
CREATE POLICY "Allow public reads from gig-driver-images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'gig-driver-images');

DROP POLICY IF EXISTS "Allow service role full access to gig-driver-images" ON storage.objects;
CREATE POLICY "Allow service role full access to gig-driver-images"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'gig-driver-images');

DROP POLICY IF EXISTS "Allow public deletes from gig-driver-images" ON storage.objects;
CREATE POLICY "Allow public deletes from gig-driver-images"
  ON storage.objects FOR DELETE
  TO public
  USING (bucket_id = 'gig-driver-images');
