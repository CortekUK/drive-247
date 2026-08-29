-- Proves the migration is a no-op for every existing row.
select
  (select count(*) from public.tenants  where payment_provider <> 'stripe') as tenants_not_stripe,   -- expect 0
  (select count(*) from public.payments where payment_provider <> 'stripe') as payments_not_stripe,  -- expect 0
  (select count(*) from public.tenants)  as tenants_total,                                           -- expect 52
  (select count(*) from public.payments) as payments_total,                                          -- expect 1026
  (select count(*) from information_schema.column_privileges
     where table_schema='public' and table_name='tenants' and grantee='anon'
       and privilege_type='SELECT'
       and column_name in ('payment_provider','square_mode','country'))     as anon_grants_added;    -- expect 3
