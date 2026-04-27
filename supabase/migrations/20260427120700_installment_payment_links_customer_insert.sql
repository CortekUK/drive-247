-- Allow authenticated customers to create a magic-link payment token for their
-- own installment plans (used by the booking-app customer portal "Pay Now" button).
-- Operators / staff don't need this — they manage manual payments through
-- mark-installment-paid which runs as service_role.

CREATE POLICY installment_payment_links_customer_insert
  ON public.installment_payment_links
  FOR INSERT
  TO authenticated
  WITH CHECK (
    installment_plan_id IN (
      SELECT ip.id
      FROM public.installment_plans ip
      JOIN public.customer_users cu ON cu.customer_id = ip.customer_id
      WHERE cu.auth_user_id = auth.uid()
    )
  );

-- Customers should also be able to read their own plan's links so the redirect
-- page can verify the token client-side if it ever needs to. Extend the existing
-- read policy.
DROP POLICY IF EXISTS installment_payment_links_customer_read ON public.installment_payment_links;
CREATE POLICY installment_payment_links_customer_read
  ON public.installment_payment_links
  FOR SELECT
  TO authenticated
  USING (
    installment_plan_id IN (
      SELECT ip.id
      FROM public.installment_plans ip
      JOIN public.customer_users cu ON cu.customer_id = ip.customer_id
      WHERE cu.auth_user_id = auth.uid()
    )
  );
