-- Moore Luxe: LUXE and WEEK become fixed-length packages.
--
-- Requested 29 Sep 2026: "Yes only 4 days. And I need you to set WEEK to only
-- 7 days." Their agent had reported a 12.5% discount landing on a regular
-- five-day rental, because `min_duration_days` is only a floor and LUXE was
-- set to 4 — so every 4, 5 and 6-day booking collected it.
--
-- RUN THIS AFTER  supabase/migrations/PENDING_20260929_promo_max_duration_days.sql.txt
-- (it needs the max_duration_days column to exist).
--
-- Resulting ladder for tenant 1334709f-dba7-49bf-b1b9-d20dd1273a29:
--    1-3 days  -> nothing
--      4 days  -> LUXE 12.5%   (= half a day free)
--    5-6 days  -> nothing
--      7 days  -> WEEK 14.28%  (= exactly one day free)
--      8+ days -> nothing
--
-- Scoped by tenant_id as well as code: LUXE and WEEK are not reserved words and
-- another operator may well use them.

UPDATE public.promocodes
   SET max_duration_days = 4
 WHERE tenant_id = '1334709f-dba7-49bf-b1b9-d20dd1273a29'
   AND code = 'LUXE';

UPDATE public.promocodes
   SET max_duration_days = 7
 WHERE tenant_id = '1334709f-dba7-49bf-b1b9-d20dd1273a29'
   AND code = 'WEEK';

-- Check: expect LUXE 4-4 and WEEK 7-7, and nothing else changed.
SELECT code, value, min_duration_days, max_duration_days, expires_at
  FROM public.promocodes
 WHERE tenant_id = '1334709f-dba7-49bf-b1b9-d20dd1273a29'
 ORDER BY min_duration_days NULLS FIRST;
