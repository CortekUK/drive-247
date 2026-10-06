-- Northwind website: replace the values typed in during testing with the
-- sample content the site ships (northwind-site/lib/cms/defaults.ts).
-- Scoped to three section rows by id. Nothing else is touched.
-- Backup of the three rows before this ran: northwind-cms-backup-20261003-000257.json

BEGIN;

-- Home -> Hero
UPDATE public.cms_page_sections
SET content = content || jsonb_build_object(
      'headline',            'Rent a car in Springfield, without the runaround',
      'hero_image_alt',      'Black luxury SUV, three-quarter front view',
      'pickup_label',        'Pick-up Location',
      'dropoff_label',       'Drop-off Location',
      'address_placeholder', 'Enter Address',
      'readiness_status',    'Ready for Pickup',
      'readiness_metrics',   jsonb_build_array(
         jsonb_build_object('label','Pristine','value',90),
         jsonb_build_object('label','Mechanical Health','value',97),
         jsonb_build_object('label','Hygiene & Sanitization Score','value',99))),
    updated_at = now()
WHERE id = 'b2d64b47-7742-4bfe-8508-049e537600c6'
  AND tenant_id = '6e5c544f-b374-451f-a662-360a634bff15';

-- Site Settings -> Logo  (empty logo_url falls back to the "Northwind" wordmark)
UPDATE public.cms_page_sections
SET content = content || jsonb_build_object('logo_url', '', 'logo_alt', 'Northwind Rentals'),
    updated_at = now()
WHERE id = 'a799db20-6fd1-42bd-8817-c7a90987ddd8'
  AND tenant_id = '6e5c544f-b374-451f-a662-360a634bff15';

-- Site Settings -> Contact
UPDATE public.cms_page_sections
SET content = content || jsonb_build_object(
      'address_line1',   '1200 Market Street',
      'address_line2',   '',
      'city',            'Springfield',
      'state',           'IL',
      'zip',             '62701',
      'country',         'USA',
      'email',           'hello@northwindrentals.com',
      'google_maps_url', ''),
    updated_at = now()
WHERE id = '7cfe9ce2-4ef5-410b-baf8-b02700575b0e'
  AND tenant_id = '6e5c544f-b374-451f-a662-360a634bff15';

COMMIT;
