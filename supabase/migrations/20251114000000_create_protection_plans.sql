-- Protection Plans Table (Bonzah-style insurance/protection coverage)
-- This table stores different protection plan options for rental vehicles

CREATE TABLE IF NOT EXISTS public.protection_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  coverage_details JSONB, -- Store detailed coverage information
  price_per_day DECIMAL(10, 2) NOT NULL,
  price_per_week DECIMAL(10, 2),
  price_per_month DECIMAL(10, 2),
  deductible_amount DECIMAL(10, 2) DEFAULT 0,
  max_coverage_amount DECIMAL(12, 2),
  features JSONB, -- Array of features/benefits
  exclusions JSONB, -- What's not covered
  tier TEXT CHECK (tier IN ('basic', 'standard', 'premium', 'ultimate')) DEFAULT 'standard',
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  icon_name TEXT, -- For UI display
  color_theme TEXT, -- Hex color for UI theming
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for active plans
CREATE INDEX IF NOT EXISTS idx_protection_plans_active
ON public.protection_plans(is_active, display_order);

-- Enable RLS
ALTER TABLE public.protection_plans ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read access for active plans
CREATE POLICY "Public can view active protection plans"
ON public.protection_plans
FOR SELECT
TO public
USING (is_active = true);

-- Policy: Only authenticated users can manage protection plans
CREATE POLICY "Authenticated users can manage protection plans"
ON public.protection_plans
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_protection_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_protection_plans_updated_at
BEFORE UPDATE ON public.protection_plans
FOR EACH ROW
EXECUTE FUNCTION update_protection_plans_updated_at();

-- Insert default protection plans (Bonzah-style)
INSERT INTO public.protection_plans (
  name,
  display_name,
  description,
  price_per_day,
  price_per_week,
  price_per_month,
  deductible_amount,
  max_coverage_amount,
  tier,
  display_order,
  icon_name,
  color_theme,
  features,
  exclusions,
  coverage_details
) VALUES
(
  'basic_protection',
  'Basic Protection',
  'Essential coverage for peace of mind during your rental period',
  15.00,
  75.00,
  250.00,
  500.00,
  25000.00,
  'basic',
  1,
  'Shield',
  '#60A5FA',
  '["Collision Damage Waiver", "Theft Protection", "24/7 Roadside Assistance", "Basic Third-Party Liability"]'::jsonb,
  '["Personal belongings", "Interior damage", "Off-road use", "DUI incidents"]'::jsonb,
  '{
    "collision": "Covers vehicle damage up to $25,000",
    "theft": "Full theft protection with $500 deductible",
    "liability": "Third-party liability up to $100,000",
    "roadside": "24/7 emergency roadside assistance"
  }'::jsonb
),
(
  'standard_protection',
  'Standard Protection',
  'Comprehensive coverage with reduced deductible for worry-free travel',
  25.00,
  135.00,
  450.00,
  250.00,
  50000.00,
  'standard',
  2,
  'ShieldCheck',
  '#10B981',
  '["Zero Deductible Collision", "Comprehensive Theft Protection", "24/7 Premium Roadside Assistance", "Enhanced Third-Party Liability", "Windshield & Glass Coverage"]'::jsonb,
  '["Personal belongings", "Off-road use", "DUI incidents"]'::jsonb,
  '{
    "collision": "Full collision coverage up to $50,000 with $250 deductible",
    "theft": "Comprehensive theft protection with reduced deductible",
    "liability": "Third-party liability up to $250,000",
    "roadside": "24/7 premium roadside assistance with towing",
    "glass": "Windshield and glass damage coverage included"
  }'::jsonb
),
(
  'premium_protection',
  'Premium Protection',
  'Top-tier protection with zero deductible and maximum coverage limits',
  40.00,
  240.00,
  800.00,
  0.00,
  100000.00,
  'premium',
  3,
  'Crown',
  '#C5A572',
  '["Zero Deductible Coverage", "Unlimited Theft Protection", "VIP 24/7 Concierge Roadside", "Maximum Third-Party Liability", "Complete Glass Coverage", "Interior Protection", "Personal Effects Coverage"]'::jsonb,
  '["Off-road use", "DUI incidents", "Racing or competitive events"]'::jsonb,
  '{
    "collision": "Full collision coverage up to $100,000 with ZERO deductible",
    "theft": "Unlimited theft protection with no deductible",
    "liability": "Third-party liability up to $1,000,000",
    "roadside": "VIP concierge roadside assistance with priority service",
    "glass": "Complete windshield and glass coverage",
    "interior": "Interior damage protection included",
    "personal": "Personal effects coverage up to $1,000"
  }'::jsonb
);

-- Create rental_protection_selections table to link rentals with protection plans
CREATE TABLE IF NOT EXISTS public.rental_protection_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id UUID REFERENCES public.rentals(id) ON DELETE CASCADE,
  protection_plan_id UUID REFERENCES public.protection_plans(id),
  daily_rate DECIMAL(10, 2) NOT NULL, -- Rate at time of selection
  total_days INTEGER NOT NULL,
  total_cost DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(rental_id) -- One protection plan per rental
);

-- Enable RLS on rental_protection_selections
ALTER TABLE public.rental_protection_selections ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can manage their rental protections
CREATE POLICY "Authenticated users can manage rental protections"
ON public.rental_protection_selections
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Create index
CREATE INDEX IF NOT EXISTS idx_rental_protection_selections_rental
ON public.rental_protection_selections(rental_id);

-- Add updated_at trigger
CREATE TRIGGER trigger_update_rental_protection_selections_updated_at
BEFORE UPDATE ON public.rental_protection_selections
FOR EACH ROW
EXECUTE FUNCTION update_protection_plans_updated_at();

-- Grant permissions
GRANT SELECT ON public.protection_plans TO anon, authenticated;
GRANT ALL ON public.protection_plans TO authenticated;
GRANT ALL ON public.rental_protection_selections TO authenticated;

COMMENT ON TABLE public.protection_plans IS 'Protection/insurance plans available for rental vehicles';
COMMENT ON TABLE public.rental_protection_selections IS 'Links rentals to selected protection plans';
