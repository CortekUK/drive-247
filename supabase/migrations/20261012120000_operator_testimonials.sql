-- APPLIED to production 2026-10-12
--
-- Operator testimonials — the "Operators building on Drive247" quotes on the
-- drive-247.com landing page. Super Admin → Customer management → Testimonials
-- creates, edits and deletes them; the landing page reads the published ones
-- on every request (apps/web/src/lib/testimonials-server.ts).
--
--   operator_testimonials   one row per quote. The first by sort_order is the
--                           full-width featured card; the rest sit two-up.
--
-- `highlight` is an optional phrase from inside `quote` that the site renders
-- in bold (the old hard-coded before/bold/after split). If it does not appear
-- in the quote the whole quote renders plain.
--
-- Anyone (anon included) may read PUBLISHED rows — they are public marketing
-- copy. Only super admins can see drafts or write.

CREATE TABLE IF NOT EXISTS public.operator_testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_name text NOT NULL CHECK (char_length(btrim(operator_name)) BETWEEN 1 AND 120),
  role text CHECK (role IS NULL OR char_length(role) <= 120),
  fleet_size integer CHECK (fleet_size IS NULL OR fleet_size BETWEEN 1 AND 100000),
  location text CHECK (location IS NULL OR char_length(location) <= 120),
  rating smallint NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  quote text NOT NULL CHECK (char_length(btrim(quote)) BETWEEN 1 AND 1000),
  highlight text CHECK (highlight IS NULL OR char_length(highlight) <= 300),
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS operator_testimonials_published_order_idx
  ON public.operator_testimonials (sort_order, created_at) WHERE is_published;

CREATE OR REPLACE FUNCTION public.operator_testimonials_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operator_testimonials_touch ON public.operator_testimonials;
CREATE TRIGGER operator_testimonials_touch
  BEFORE UPDATE ON public.operator_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.operator_testimonials_touch();

ALTER TABLE public.operator_testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public reads published testimonials" ON public.operator_testimonials;
CREATE POLICY "public reads published testimonials" ON public.operator_testimonials
  FOR SELECT TO anon, authenticated USING (is_published);

DROP POLICY IF EXISTS "super admins manage testimonials" ON public.operator_testimonials;
CREATE POLICY "super admins manage testimonials" ON public.operator_testimonials
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

GRANT SELECT ON public.operator_testimonials TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_testimonials TO authenticated;

-- Seed with the three quotes the landing page shipped with, so applying this
-- changes nothing a visitor sees. Only when the table is empty.
INSERT INTO public.operator_testimonials
  (operator_name, role, fleet_size, location, rating, quote, highlight, sort_order)
SELECT * FROM (VALUES
  ('Marcus Thompson', 'Owner', 12, 'Atlanta', 5::smallint,
   'We went from juggling spreadsheets and three different apps to running everything from one dashboard. We finally have a system that matches how we actually operate. Bookings doubled within the first quarter.',
   'Bookings doubled within the first quarter.', 0),
  ('Sarah Alvarez', 'Operations Manager', 28, 'Miami', 5::smallint,
   'The branded website alone paid for itself. Customers trust us more when they book on our own site instead of a marketplace listing.',
   'The branded website alone paid for itself.', 1),
  ('James Reilly', 'Founder', 8, 'Phoenix', 5::smallint,
   'Setup was painless — we were live in five days. The team actually understands what independent operators need.',
   'we were live in five days.', 2)
) AS seed(operator_name, role, fleet_size, location, rating, quote, highlight, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.operator_testimonials);
