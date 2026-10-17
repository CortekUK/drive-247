-- TRAX in the platform support inbox: a read-only window on the database for
-- super admins working a ticket (edge fn trax-support-assist).
--
-- `trax_assist_query` runs ONE select as `trax_assist_reader`, inside a read-only
-- transaction with a short timeout, and returns at most 50 rows as JSON. The
-- reader holds SELECT on public relations only, column by column, and never on a
-- column that holds a secret (tokens, passwords, hashes, API keys, one-time codes,
-- lockbox codes). Only service_role may call it; the edge function checks the
-- caller is an active super admin first.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'trax_assist_reader') then
    create role trax_assist_reader nologin bypassrls;
  end if;
end $$;

grant usage on schema public to trax_assist_reader;
grant trax_assist_reader to service_role;

do $$
declare r record;
begin
  for r in
    select c.relname, string_agg(quote_ident(a.attname), ',' order by a.attnum) cols
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r','v','m','p')
      and a.attname !~* '(secret|password|api_key|apikey|private_key|_hash$|^code$|lockbox_code|2fa|access_token|refresh_token|^token$|_token$)'
    group by c.relname
  loop
    execute format('grant select (%s) on public.%I to trax_assist_reader', r.cols, r.relname);
  end loop;
end $$;

create or replace function public.trax_assist_query(p_sql text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_sql text := btrim(coalesce(p_sql, ''), E' \t\r\n;');
  v_rows jsonb;
begin
  if v_sql !~* '^(select|with)\s' or position(';' in v_sql) > 0 or length(v_sql) > 4000 then
    raise exception 'assist_query_rejected';
  end if;
  set local statement_timeout = '6s';
  set local transaction_read_only = on;
  set local role trax_assist_reader;
  execute format('select coalesce(jsonb_agg(q), ''[]''::jsonb) from (select * from (%s) s limit 50) q', v_sql) into v_rows;
  return v_rows;
end $$;

revoke all on function public.trax_assist_query(text) from public, anon, authenticated;
grant execute on function public.trax_assist_query(text) to service_role;
