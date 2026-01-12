-- Migration: Create promocodes table
CREATE TABLE IF NOT EXISTS public.promocodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    type text NOT NULL CHECK (type IN ('percentage', 'value')),
    value numeric(10,2) NOT NULL,
    created_at date NOT NULL DEFAULT CURRENT_DATE,
    expires_at date NOT NULL,
    max_users integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES auth.users(id),
    tenant_id uuid REFERENCES tenants(id),
    CONSTRAINT promocode_valid_value CHECK (
        (type = 'percentage' AND value > 0 AND value <= 100) OR
        (type = 'value' AND value > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_promocodes_tenant_id ON public.promocodes(tenant_id);
