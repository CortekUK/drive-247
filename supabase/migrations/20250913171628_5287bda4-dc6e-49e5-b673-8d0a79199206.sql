-- Disable conflicting triggers that interfere with edge function payment processing
DROP TRIGGER IF EXISTS trigger_auto_apply_credit ON public.ledger_entries;
DROP TRIGGER IF EXISTS trigger_charges_auto_apply ON public.ledger_entries;