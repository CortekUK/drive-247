-- Disable automatic payment processing trigger to prevent conflicts with manual edge function processing
DROP TRIGGER IF EXISTS trigger_apply_payments_on_insert ON public.payments;