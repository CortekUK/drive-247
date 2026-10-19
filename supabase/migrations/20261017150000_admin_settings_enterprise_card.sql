-- The Enterprise card on the pricing page (Oct 17 2026): always there, edited on
-- the admin Signup Plans page, and never bought online — its button links to a
-- contact page. Kept off signup_plans on purpose so it can never reach a checkout.
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS enterprise_card jsonb;

UPDATE public.admin_settings SET enterprise_card = jsonb_build_object(
  'name', 'Enterprise',
  'fleet_band', '40+ vehicles',
  'price_label', 'Let''s talk',
  'tagline', 'For large and multi-location fleets that need custom terms.',
  'cta_label', 'Contact us',
  'cta_href', '/strategy-call',
  'bullets', jsonb_build_array(
    'Sized for fleets of 40+ vehicles',
    'Custom pricing and contract terms',
    'Hands-on onboarding and data migration',
    'Priority support with a named contact'
  ),
  'is_visible', true
) WHERE enterprise_card IS NULL;

-- The public site reads only this one value, never the table (it holds staff emails).
CREATE OR REPLACE FUNCTION public.public_enterprise_card()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT enterprise_card FROM public.admin_settings ORDER BY created_at ASC LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.public_enterprise_card() TO anon, authenticated;
