-- Fix submit-application 500: ensure_lead_conversation() trigger uses ON CONFLICT (lead_id)
-- but the unique index on conversations.lead_id is PARTIAL (WHERE lead_id IS NOT NULL).
-- Postgres ON CONFLICT inference on a partial index requires the predicate to be specified.
-- Without it, every leads INSERT raised: 42P10 "no unique or exclusion constraint matching
-- the ON CONFLICT specification".
CREATE OR REPLACE FUNCTION public.ensure_lead_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.conversations (tenant_id, lead_id)
  VALUES (NEW.tenant_id, NEW.id)
  ON CONFLICT (lead_id) WHERE (lead_id IS NOT NULL) DO NOTHING;
  RETURN NEW;
END;
$function$;
