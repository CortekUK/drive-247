-- ============================================================================
-- sim_shift — STAGING-ONLY time-shift primitive for the cron simulation harness
-- ============================================================================
-- Apply to the STAGING project (ksmreaadhbirzakkxqrq) ONLY.
--
-- This function is INERT on any project that lacks the public.sim_meta staging
-- sentinel row. Production has no such row, so even if this SQL were applied to
-- production by mistake, sim_shift() would raise and refuse to run. It never
-- mutates production data.
--
-- Safety layers:
--   1. Staging sentinel   — refuses unless public.sim_meta has key='staging'.
--   2. Table allowlist    — only sim-fixture tables.
--   3. Column allowlist   — only known driving columns.
--   4. Bounded shift      — |days| <= 3650.
--   5. Row-count check    — errors on a 0-row (stale/missing id) update.
--   6. Locked-down EXECUTE — service_role only; revoked from PUBLIC/anon/authenticated.
-- ============================================================================

create table if not exists public.sim_meta (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

create or replace function public.sim_shift(
  p_table text,
  p_id    uuid,
  p_cols  text[],
  p_days  integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed jsonb := jsonb_build_object(
    'rentals', jsonb_build_array(
      'payg_next_accrual_at','payg_start_ts','payg_last_accrual_at','start_date','end_date',
      'auto_extend_next_charge_at','auto_extend_last_charge_at','auto_extend_last_reminder_at',
      'deposit_hold_expires_at','payg_last_reminder_sent_at'
    ),
    'scheduled_installments', jsonb_build_array('due_date'),
    'installment_plans',      jsonb_build_array('last_reminder_sent_at'),
    'ledger_entries',         jsonb_build_array('due_date')
  );
  v_col     text;
  v_setlist text := '';
  v_rows    integer;
begin
  -- 1. Staging sentinel — inert on production (no sim_meta staging row there).
  if to_regclass('public.sim_meta') is null
     or not exists (select 1 from public.sim_meta where key = 'staging') then
    raise exception 'sim_shift is staging-only (missing sim_meta staging sentinel)';
  end if;

  -- 2. Table allowlist.
  if not (v_allowed ? p_table) then
    raise exception 'sim_shift: table % is not allow-listed', p_table;
  end if;

  -- 4. Bounded shift.
  if p_days is null or abs(p_days) > 3650 then
    raise exception 'sim_shift: p_days % out of bounds (max +/-3650)', p_days;
  end if;

  -- 3. Column allowlist + build the SET list.
  if p_cols is null or array_length(p_cols, 1) is null then
    raise exception 'sim_shift: no columns supplied';
  end if;
  foreach v_col in array p_cols loop
    if not ((v_allowed -> p_table) ? v_col) then
      raise exception 'sim_shift: column % is not allow-listed for %', v_col, p_table;
    end if;
    v_setlist := v_setlist
      || case when v_setlist = '' then '' else ', ' end
      || format('%I = %I - ($1 || '' days'')::interval', v_col, v_col);
  end loop;

  -- Positive p_days shifts columns INTO THE PAST, i.e. simulates N days passing.
  execute format('update %I set %s where id = $2', p_table, v_setlist)
    using p_days::text, p_id;
  get diagnostics v_rows = row_count;

  -- 5. Row-count check — a stale/missing id must not silently no-op.
  if v_rows = 0 then
    raise exception 'sim_shift: no % row with id %', p_table, p_id;
  end if;

  return v_rows;
end;
$$;

-- 6. Lock down execution — service_role only.
revoke all on function public.sim_shift(text, uuid, text[], integer) from public;
revoke all on function public.sim_shift(text, uuid, text[], integer) from anon;
revoke all on function public.sim_shift(text, uuid, text[], integer) from authenticated;
grant execute on function public.sim_shift(text, uuid, text[], integer) to service_role;
