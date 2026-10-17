-- platform_login_facts(): the live numbers behind the super-admin login hero.
--
-- The admin sign-in page is shown before anyone is signed in, so this is
-- called with the ANON key. That decides everything about what it may return:
--
--   * Aggregates only. Counts, averages, a most-common make, a busiest day.
--     Never a row, a name, an email, a tenant, or anything that identifies one.
--   * No money. Revenue, payment volume and premiums are business-sensitive
--     and stay behind sign-in.
--   * Real operators only: tenant_type = 'test' (Northwind and friends) is
--     excluded everywhere, so the canary's synthetic data never inflates a
--     number shown as a fact about the platform.
--
-- SECURITY DEFINER because anon cannot read these tables (and must not be
-- able to). It returns one jsonb object; it takes no arguments, so there is
-- nothing a caller can steer.
--
-- Additive (V2_PLAN §4): a new function that nothing else calls.

create or replace function public.platform_login_facts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select id from tenants where tenant_type is distinct from 'test'
  ),
  r as (
    select r.*
    from rentals r
    where r.tenant_id in (select id from live)
      and r.status not in ('Cancelled', 'Rejected')
  ),
  best_month as (
    select date_trunc('month', created_at) as m, count(*) as n
    from r
    group by 1
    order by 2 desc
    limit 1
  )
  select jsonb_build_object(
    'operators',          (select count(*) from tenants where tenant_type = 'production' and status = 'active'),
    'vehicles',           (select count(*) from vehicles where tenant_id in (select id from live)),
    'customers',          (select count(*) from customers where tenant_id in (select id from live)),
    'rentals',            (select count(*) from r),
    'rentals_30d',        (select count(*) from r where created_at > now() - interval '30 days'),
    'last_booking_at',    (select max(created_at) from r),
    'avg_rental_days',    (select round(avg(end_date::date - start_date::date)::numeric, 1)
                             from r where end_date is not null and end_date >= start_date),
    'longest_rental_days',(select max(end_date::date - start_date::date)
                             from r where end_date is not null and end_date >= start_date),
    'rental_days_total',  (select sum(greatest(end_date::date - start_date::date, 1))
                             from r where end_date is not null and end_date >= start_date),
    'top_make',           (select v.make from r join vehicles v on v.id = r.vehicle_id
                             where v.make is not null and v.make <> ''
                             group by v.make order by count(*) desc limit 1),
    'busiest_pickup_day', (select to_char(start_date, 'FMDay') from r
                             where start_date is not null
                             group by 1 order by count(*) desc limit 1),
    'agreements_signed',  (select count(*) from r where document_status in ('completed', 'signed')),
    'time_zones',         (select count(distinct timezone) from tenants
                             where tenant_type = 'production' and status = 'active' and timezone is not null),
    'best_month',         (select to_char(m, 'FMMonth YYYY') from best_month),
    'best_month_rentals', (select n from best_month),
    'turo_imports',       (select count(*) from r where source = 'turo_import'),
    'insured_at_checkout',(select count(*) from r where insurance_status = 'bonzah')
  );
$$;

revoke all on function public.platform_login_facts() from public;
grant execute on function public.platform_login_facts() to anon, authenticated;
