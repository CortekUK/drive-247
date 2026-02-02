-- Bonzah Insurance Integration
-- Stores insurance policies and links them to rentals

-- Table to store Bonzah insurance policies
CREATE TABLE public.bonzah_insurance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rental_id UUID REFERENCES rentals(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id),
    customer_id UUID NOT NULL REFERENCES customers(id),

    -- Bonzah References
    quote_id TEXT NOT NULL,
    quote_no TEXT,
    payment_id TEXT,
    policy_no TEXT,
    policy_id TEXT,

    -- Coverage
    coverage_types JSONB NOT NULL,  -- {cdw: true, rcli: true, sli: false, pai: false}
    trip_start_date DATE NOT NULL,
    trip_end_date DATE NOT NULL,
    pickup_state TEXT NOT NULL,

    -- Pricing
    premium_amount NUMERIC(12,2) NOT NULL,

    -- Renter Details
    renter_details JSONB NOT NULL,

    -- Status
    status TEXT NOT NULL DEFAULT 'quoted'
        CHECK (status IN ('quoted', 'payment_pending', 'active', 'cancelled', 'failed')),

    -- Timestamps
    policy_issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_bonzah_policies_rental_id ON bonzah_insurance_policies(rental_id);
CREATE INDEX idx_bonzah_policies_tenant_id ON bonzah_insurance_policies(tenant_id);
CREATE INDEX idx_bonzah_policies_customer_id ON bonzah_insurance_policies(customer_id);
CREATE INDEX idx_bonzah_policies_status ON bonzah_insurance_policies(status);
CREATE INDEX idx_bonzah_policies_quote_id ON bonzah_insurance_policies(quote_id);

-- Add insurance columns to rentals
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC(12,2) DEFAULT 0;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS bonzah_policy_id UUID REFERENCES bonzah_insurance_policies(id);

-- Enable RLS
ALTER TABLE bonzah_insurance_policies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bonzah_insurance_policies
-- Allow service role full access (for edge functions)
CREATE POLICY "Service role has full access to bonzah policies"
    ON bonzah_insurance_policies
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to read their tenant's policies
CREATE POLICY "Authenticated users can read tenant policies"
    ON bonzah_insurance_policies
    FOR SELECT
    TO authenticated
    USING (
        tenant_id IN (
            SELECT tenant_id FROM app_users WHERE auth_user_id = auth.uid()
        )
    );

-- Allow anonymous insert for booking flow (policy created before payment)
CREATE POLICY "Anonymous can insert bonzah policies"
    ON bonzah_insurance_policies
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Allow anonymous to read their own policy by ID (for checkout flow)
CREATE POLICY "Anonymous can read own policy"
    ON bonzah_insurance_policies
    FOR SELECT
    TO anon
    USING (true);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_bonzah_policy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bonzah_policy_updated_at
    BEFORE UPDATE ON bonzah_insurance_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_bonzah_policy_updated_at();

-- Add comment for documentation
COMMENT ON TABLE bonzah_insurance_policies IS 'Stores Bonzah insurance policies purchased through the booking flow';
COMMENT ON COLUMN bonzah_insurance_policies.coverage_types IS 'JSON object with coverage flags: {cdw: bool, rcli: bool, sli: bool, pai: bool}';
COMMENT ON COLUMN bonzah_insurance_policies.renter_details IS 'Renter information submitted to Bonzah API';
