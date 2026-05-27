-- Per-rental override for the security deposit amount.
-- Until now the deposit amount was always read from tenants.global_deposit_amount,
-- so the override input on the new-rental page (the "$3" field next to
-- "Pre-Authorization (Auto: $3.00 (global))") was silently ignored — the value
-- never made it onto the rental row, and place-deposit-hold + UI everywhere
-- kept showing the global default. This column gives us a place to store the
-- override; readers should fall back to tenants.global_deposit_amount when this
-- is NULL.

ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS deposit_amount_override numeric;

COMMENT ON COLUMN public.rentals.deposit_amount_override IS
  'Per-rental override for the security deposit pre-auth amount. NULL means use tenants.global_deposit_amount. Set at rental creation when the operator changes the deposit input on the new-rental form.';
