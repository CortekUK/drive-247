-- QA R13.1 (2026-11-14): the rental's Activity could not say who took a payment;
-- payments had nowhere to record it. Staff-recorded payments now store the
-- app_users id; card payments made by the customer leave it NULL.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.payments.created_by IS 'Staff member (app_users.id) who recorded the payment; NULL when the customer paid online.';
