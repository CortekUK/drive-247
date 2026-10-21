-- Customer portal v2 Settings → Consent and Verification (Oct 21 2026).
--
-- 1. customer_consents: what a CUSTOMER agreed to, and to which version.
--    Account-level rows (rental_id null) record the tenant's privacy policy and
--    terms of service at the version current when the customer signed in.
--    Rental rows record what was agreed for one booking. Customers read their
--    own rows; staff read their tenant's. Nobody writes directly: the two
--    functions below resolve the customer from auth.uid() and write for them.
--
-- 2. identity_verifications.customer_corrections: the customer may correct the
--    OCR'd details on their own latest check. The originals are kept in this
--    column (first correction wins the "original" slot) so the operator can see
--    what the scan read and what the customer changed.

create table if not exists public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  rental_id uuid references public.rentals(id) on delete cascade,
  consent_type text not null check (consent_type in ('privacy_policy', 'terms', 'rental_terms', 'rental_charges', 'sms')),
  version text,
  source text not null default 'login' check (source in ('login', 'signup', 'booking', 'portal')),
  user_agent text,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists customer_consents_account_version_key
  on public.customer_consents (customer_id, consent_type, coalesce(version, ''))
  where rental_id is null;
create unique index if not exists customer_consents_rental_key
  on public.customer_consents (rental_id, consent_type)
  where rental_id is not null;
create index if not exists customer_consents_tenant_customer_idx
  on public.customer_consents (tenant_id, customer_id);

alter table public.customer_consents enable row level security;

drop policy if exists "Customers read own consents" on public.customer_consents;
create policy "Customers read own consents" on public.customer_consents
  for select to authenticated
  using (exists (
    select 1 from public.customer_users cu
    where cu.customer_id = customer_consents.customer_id and cu.auth_user_id = auth.uid()
  ));

drop policy if exists "Staff read tenant consents" on public.customer_consents;
create policy "Staff read tenant consents" on public.customer_consents
  for select to authenticated
  using (tenant_id = public.get_user_tenant_id() or public.is_super_admin());

grant select on public.customer_consents to authenticated;

-- The signed-in customer of p_tenant_id accepts the tenant's current privacy
-- policy and terms. Idempotent: a version already on file is left alone, so the
-- stored accepted_at is when that version was first accepted.
create or replace function public.record_customer_policy_consent(p_tenant_id uuid, p_source text default 'login', p_user_agent text default null)
returns setof public.customer_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
  v_privacy text;
  v_terms text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select cu.customer_id into v_customer
  from customer_users cu
  join customers c on c.id = cu.customer_id
  where cu.auth_user_id = auth.uid() and c.tenant_id = p_tenant_id
  limit 1;
  if v_customer is null then
    raise exception 'not a customer of this tenant' using errcode = '42501';
  end if;

  select coalesce(t.privacy_policy_version, '1.0'), coalesce(t.terms_version, '1.0')
    into v_privacy, v_terms
  from tenants t where t.id = p_tenant_id;

  insert into customer_consents (tenant_id, customer_id, auth_user_id, consent_type, version, source, user_agent)
  values
    (p_tenant_id, v_customer, auth.uid(), 'privacy_policy', v_privacy, coalesce(p_source, 'login'), left(p_user_agent, 400)),
    (p_tenant_id, v_customer, auth.uid(), 'terms', v_terms, coalesce(p_source, 'login'), left(p_user_agent, 400))
  on conflict do nothing;

  return query
    select * from customer_consents
    where customer_id = v_customer and rental_id is null
    order by accepted_at desc;
end;
$$;

revoke all on function public.record_customer_policy_consent(uuid, text, text) from public, anon;
grant execute on function public.record_customer_policy_consent(uuid, text, text) to authenticated;

-- The signed-in customer records what they agreed to for one of THEIR rentals.
create or replace function public.record_customer_rental_consent(p_rental_id uuid, p_types text[], p_user_agent text default null)
returns setof public.customer_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rental record;
  v_terms text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select r.id, r.customer_id, r.tenant_id into v_rental
  from rentals r
  join customer_users cu on cu.customer_id = r.customer_id and cu.auth_user_id = auth.uid()
  where r.id = p_rental_id;
  if v_rental.id is null then
    raise exception 'not your rental' using errcode = '42501';
  end if;

  select coalesce(t.terms_version, '1.0') into v_terms from tenants t where t.id = v_rental.tenant_id;

  insert into customer_consents (tenant_id, customer_id, auth_user_id, rental_id, consent_type, version, source, user_agent)
  select v_rental.tenant_id, v_rental.customer_id, auth.uid(), v_rental.id, t,
         case when t = 'rental_terms' then v_terms else null end, 'booking', left(p_user_agent, 400)
  from unnest(p_types) as t
  where t in ('rental_terms', 'rental_charges', 'sms')
  on conflict do nothing;

  return query select * from customer_consents where rental_id = v_rental.id;
end;
$$;

revoke all on function public.record_customer_rental_consent(uuid, text[], text) from public, anon;
grant execute on function public.record_customer_rental_consent(uuid, text[], text) to authenticated;

-- ── ID corrections ──────────────────────────────────────────────────────────

alter table public.identity_verifications
  add column if not exists customer_corrections jsonb,
  add column if not exists customer_corrected_at timestamptz;

-- The signed-in customer corrects the details read off their own LATEST
-- check. Only these fields; dates must parse; nothing else on the row moves.
-- The status is not touched, so no "verified" notification fires again.
create or replace function public.customer_correct_verification(p_verification_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row identity_verifications%rowtype;
  v_latest uuid;
  v_original jsonb;
  k text;
  allowed text[] := array['first_name', 'last_name', 'date_of_birth', 'document_number', 'document_country', 'document_issuing_date', 'document_expiry_date', 'address'];
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select iv.* into v_row
  from identity_verifications iv
  join customer_users cu on cu.customer_id = iv.customer_id and cu.auth_user_id = auth.uid()
  where iv.id = p_verification_id;
  if v_row.id is null then
    raise exception 'not your verification' using errcode = '42501';
  end if;

  select iv.id into v_latest from identity_verifications iv
  where iv.customer_id = v_row.customer_id and iv.tenant_id is not distinct from v_row.tenant_id
  order by iv.created_at desc nulls last limit 1;
  if v_latest <> v_row.id then
    raise exception 'only your latest check can be corrected' using errcode = '22023';
  end if;

  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any(allowed)) then
      raise exception 'field % cannot be corrected', k using errcode = '22023';
    end if;
  end loop;

  v_original := coalesce(v_row.customer_corrections -> 'original', jsonb_build_object(
    'first_name', v_row.first_name, 'last_name', v_row.last_name, 'date_of_birth', v_row.date_of_birth,
    'document_number', v_row.document_number, 'document_country', v_row.document_country,
    'document_issuing_date', v_row.document_issuing_date, 'document_expiry_date', v_row.document_expiry_date,
    'address', v_row.address));

  update identity_verifications set
    first_name = case when p_fields ? 'first_name' then nullif(btrim(p_fields->>'first_name'), '') else first_name end,
    last_name = case when p_fields ? 'last_name' then nullif(btrim(p_fields->>'last_name'), '') else last_name end,
    date_of_birth = case when p_fields ? 'date_of_birth' then nullif(p_fields->>'date_of_birth', '')::date else date_of_birth end,
    document_number = case when p_fields ? 'document_number' then nullif(btrim(p_fields->>'document_number'), '') else document_number end,
    document_country = case when p_fields ? 'document_country' then nullif(upper(btrim(p_fields->>'document_country')), '') else document_country end,
    document_issuing_date = case when p_fields ? 'document_issuing_date' then nullif(p_fields->>'document_issuing_date', '')::date else document_issuing_date end,
    document_expiry_date = case when p_fields ? 'document_expiry_date' then nullif(p_fields->>'document_expiry_date', '')::date else document_expiry_date end,
    address = case when p_fields ? 'address' then nullif(btrim(p_fields->>'address'), '') else address end,
    customer_corrections = jsonb_build_object('original', v_original, 'last', p_fields, 'by', auth.uid()),
    customer_corrected_at = now(),
    updated_at = now()
  where id = v_row.id;

  -- The customer record carries copies of two of these (process-ai-verification
  -- writes them); a correction reaches them too. A corrected name reaches
  -- `customers.name` through trigger_sync_verified_name on an approved check.
  update customers c set
    date_of_birth = case when p_fields ? 'date_of_birth' then nullif(p_fields->>'date_of_birth', '')::date else c.date_of_birth end,
    license_number = case when p_fields ? 'document_number' and lower(coalesce(v_row.document_type, '')) in ('drivers_license', 'driving_licence')
                          then nullif(btrim(p_fields->>'document_number'), '') else c.license_number end,
    id_number = case when p_fields ? 'document_number' and lower(coalesce(v_row.document_type, '')) not in ('drivers_license', 'driving_licence')
                     then nullif(btrim(p_fields->>'document_number'), '') else c.id_number end
  where c.id = v_row.customer_id
    and (p_fields ? 'date_of_birth' or p_fields ? 'document_number');
end;
$$;

revoke all on function public.customer_correct_verification(uuid, jsonb) from public, anon;
grant execute on function public.customer_correct_verification(uuid, jsonb) to authenticated;
