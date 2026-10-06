-- APPLIED to production 2026-10-07 via the Management API.
-- The v2 cancel flow's "Book a call" issue types become reasons too:
-- setup_help, billing_question, integration_problems.
ALTER TABLE public.tenant_churn_reasons DROP CONSTRAINT IF EXISTS tenant_churn_reasons_reason_check;
ALTER TABLE public.tenant_churn_reasons ADD CONSTRAINT tenant_churn_reasons_reason_check CHECK (reason IN (
 'too_expensive','missing_features','switched_tools','not_using','closing_business','technical_problems',
 'never_finished_setup','setup_help','billing_question','integration_problems','payment_failed','other'));
