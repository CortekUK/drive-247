-- Allow authenticated customers to read their own Bonzah insurance policies
-- Customers authenticate via Supabase Auth but are linked through customer_users,
-- not app_users. This policy enables insurance visibility in the booking portal.

CREATE POLICY "Customers can read own insurance policies"
    ON bonzah_insurance_policies
    FOR SELECT
    TO authenticated
    USING (
        customer_id IN (
            SELECT cu.customer_id
            FROM customer_users cu
            WHERE cu.auth_user_id = auth.uid()
        )
    );
