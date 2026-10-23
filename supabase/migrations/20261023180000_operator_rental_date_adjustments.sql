-- Operators change a rental's dates and take back extensions themselves.
--
-- Until now the portal could only ADD time: pickup/return dates are locked in
-- edit-pickup-return-dialog.tsx, and nothing could remove or shorten an
-- extension. A customer who brings the car back early, or an extension added by
-- mistake, meant a support ticket and a hand edit in the database (Moore Luxe,
-- Oct 23 2026: R-6cd43d ended early, R-4e1ccb needed a later return).
--
-- Two functions, both SECURITY DEFINER because `rental_extensions` is writable
-- by the service role only:
--
--   operator_adjust_extension(extension, new_end, drop_unpaid)
--     Shorten the LATEST live extension, or remove it (new_end = the day it
--     started from). Only the latest, so the chain never gets a hole in it.
--
--   operator_change_rental_end_date(rental, new_end)
--     Move the return date either way, Closed rentals included. Moving it
--     earlier shortens or removes any extension that ran past the new date.
--
-- MONEY. Paid money is never touched by either function: no refunds, and never
-- a credit/negative balance (the operator's explicit ask). The only money
-- option is on REMOVING an extension: `drop_unpaid` writes off the part of its
-- charges that was never paid, so the customer stops owing it. A refund for
-- money already paid stays the existing refund flow's job.
--
-- Who may call: an app user of the rental's tenant (or a super admin), not a
-- viewer, and a manager only with editor access to the rentals tab.

create or replace function public.operator_rental_editor()
returns public.app_users
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users;
begin
  select * into v_user from public.app_users where auth_user_id = auth.uid() limit 1;
  if v_user.id is null then
    raise exception 'Not signed in as a staff user' using errcode = '42501';
  end if;
  if coalesce(v_user.role, '') = 'viewer' then
    raise exception 'Your role can only view rentals' using errcode = '42501';
  end if;
  if v_user.role = 'manager' and not exists (
    select 1 from public.manager_permissions
     where app_user_id = v_user.id and tab_key = 'rentals' and access_level = 'editor'
  ) then
    raise exception 'You need editor access to rentals for this' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

revoke all on function public.operator_rental_editor() from public, anon;

create or replace function public.operator_adjust_extension(
  p_extension_id uuid,
  p_new_end_date date,
  p_drop_unpaid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users := public.operator_rental_editor();
  v_ext public.rental_extensions;
  v_rental public.rentals;
  v_removing boolean;
  v_dropped numeric := 0;
begin
  select * into v_ext from public.rental_extensions where id = p_extension_id for update;
  if v_ext.id is null then
    raise exception 'Extension not found';
  end if;
  if not (coalesce(v_user.is_super_admin, false) or v_user.tenant_id = v_ext.tenant_id) then
    raise exception 'Extension not found';
  end if;
  if v_ext.status in ('cancelled', 'refunded') then
    raise exception 'This extension has already been removed';
  end if;
  if v_ext.previous_end_date is null or v_ext.new_end_date is null then
    raise exception 'This extension has no dates to adjust';
  end if;
  if exists (
    select 1 from public.rental_extensions
     where rental_id = v_ext.rental_id
       and sequence_number > v_ext.sequence_number
       and status not in ('cancelled', 'refunded')
  ) then
    raise exception 'Only the latest extension can be changed. Remove the later ones first.';
  end if;
  if p_new_end_date is null or p_new_end_date < v_ext.previous_end_date or p_new_end_date >= v_ext.new_end_date then
    raise exception 'The new end must be from % up to the day before %', v_ext.previous_end_date, v_ext.new_end_date;
  end if;

  select * into v_rental from public.rentals where id = v_ext.rental_id for update;
  v_removing := p_new_end_date = v_ext.previous_end_date;

  if v_removing then
    update public.rental_extensions
       set status = 'cancelled', cancelled_at = now(), checkout_url = null
     where id = v_ext.id;

    if p_drop_unpaid then
      select coalesce(sum(remaining_amount), 0) into v_dropped
        from public.ledger_entries
       where extension_id = v_ext.id and type = 'Charge' and remaining_amount > 0;
      -- Write off only what was never paid: the charge shrinks to what was
      -- paid against it, so nothing paid moves and no credit appears.
      update public.ledger_entries
         set amount = amount - remaining_amount, remaining_amount = 0
       where extension_id = v_ext.id and type = 'Charge' and remaining_amount > 0;
    end if;
  else
    update public.rental_extensions
       set new_end_date = p_new_end_date,
           extension_days = p_new_end_date - v_ext.previous_end_date
     where id = v_ext.id;
  end if;

  update public.rentals
     set end_date = p_new_end_date,
         previous_end_date = v_rental.end_date,
         extension_checkout_url = case when v_removing then null else extension_checkout_url end,
         extension_amount = case when v_removing then null else extension_amount end
   where id = v_rental.id;

  insert into public.audit_logs (actor_id, action, details, entity_type, entity_id, tenant_id, is_super_admin_action, activity_source)
  values (
    v_user.id,
    case when v_removing then 'rental_extension_removed' else 'rental_extension_shortened' end,
    jsonb_build_object(
      'extension_number', v_ext.sequence_number,
      'was', jsonb_build_object('from', v_ext.previous_end_date, 'to', v_ext.new_end_date),
      'now_ends', p_new_end_date,
      'previous_rental_end_date', v_rental.end_date,
      'unpaid_written_off', v_dropped
    ),
    'rental', v_rental.id, v_rental.tenant_id,
    coalesce(v_user.is_super_admin, false),
    case when coalesce(v_user.is_super_admin, false) then 'super_admin' else 'tenant_user' end
  );

  return jsonb_build_object(
    'removed', v_removing,
    'end_date', p_new_end_date,
    'unpaid_written_off', v_dropped
  );
end;
$$;

create or replace function public.operator_change_rental_end_date(
  p_rental_id uuid,
  p_new_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.app_users := public.operator_rental_editor();
  v_rental public.rentals;
  v_ext public.rental_extensions;
  v_changed jsonb := '[]'::jsonb;
begin
  select * into v_rental from public.rentals where id = p_rental_id for update;
  if v_rental.id is null or not (coalesce(v_user.is_super_admin, false) or v_user.tenant_id = v_rental.tenant_id) then
    raise exception 'Rental not found';
  end if;
  if coalesce(v_rental.is_pay_as_you_go, false) then
    raise exception 'Pay-as-you-go rentals have no return date';
  end if;
  if p_new_end_date is null or p_new_end_date <= v_rental.start_date then
    raise exception 'The return date must be after the pickup date (%)', v_rental.start_date;
  end if;
  if p_new_end_date = v_rental.end_date then
    return jsonb_build_object('end_date', p_new_end_date, 'extensions_changed', v_changed);
  end if;

  -- Earlier return: take extensions back from the latest down, so none still
  -- claims days after the car came back. Dates only; money stays as it is.
  for v_ext in
    select * from public.rental_extensions
     where rental_id = v_rental.id
       and status not in ('cancelled', 'refunded')
       and new_end_date > p_new_end_date
     order by sequence_number desc
     for update
  loop
    if v_ext.previous_end_date is not null and v_ext.previous_end_date >= p_new_end_date then
      update public.rental_extensions
         set status = 'cancelled', cancelled_at = now(), checkout_url = null
       where id = v_ext.id;
      v_changed := v_changed || jsonb_build_object('extension_number', v_ext.sequence_number, 'removed', true);
    else
      update public.rental_extensions
         set new_end_date = p_new_end_date,
             extension_days = p_new_end_date - v_ext.previous_end_date
       where id = v_ext.id;
      v_changed := v_changed || jsonb_build_object('extension_number', v_ext.sequence_number, 'now_ends', p_new_end_date);
    end if;
  end loop;

  -- The overlap trigger still guards a later return on a live rental.
  update public.rentals
     set end_date = p_new_end_date,
         previous_end_date = v_rental.end_date
   where id = v_rental.id;

  insert into public.audit_logs (actor_id, action, details, entity_type, entity_id, tenant_id, is_super_admin_action, activity_source)
  values (
    v_user.id,
    'rental_end_date_changed',
    jsonb_build_object(
      'previous_end_date', v_rental.end_date,
      'end_date', p_new_end_date,
      'extensions_changed', v_changed,
      'note', 'Dates only; charges and payments unchanged'
    ),
    'rental', v_rental.id, v_rental.tenant_id,
    coalesce(v_user.is_super_admin, false),
    case when coalesce(v_user.is_super_admin, false) then 'super_admin' else 'tenant_user' end
  );

  return jsonb_build_object('end_date', p_new_end_date, 'extensions_changed', v_changed);
end;
$$;

revoke all on function public.operator_adjust_extension(uuid, date, boolean) from public, anon;
revoke all on function public.operator_change_rental_end_date(uuid, date) from public, anon;
grant execute on function public.operator_adjust_extension(uuid, date, boolean) to authenticated;
grant execute on function public.operator_change_rental_end_date(uuid, date) to authenticated;
