# Fleet Health — production hotfix, 2026-08-20

## Why this file exists

The Fleet Health schema (tables, 7 trigger functions, `evaluate_vehicle_health`,
`evaluate_fleet_health`, cron jobid 66) was applied **directly to production**
around 16 Aug. There is no migration file for it anywhere, and the branch that
carries its UI — `feature/vehicle-maitainance` — contains 29 files, **all
TypeScript, no SQL**. So the DDL exists only inside the live database and was
never code-reviewed. That is how the bug below shipped.

This file is the record. It is deliberately *not* in `supabase/migrations/` —
schema changes on this project are applied through the Supabase MCP tools, not
by `db push`.

## The incident

Chris (tenant `globalmotiontransport`) could not dispose or un-dispose vehicles.
Last successful disposal: 13 Aug.

`dispose_vehicle` / `undo_vehicle_disposal` UPDATE `public.vehicles`, which fires:

    trg_fh_vehicle_compliance
      AFTER UPDATE ON public.vehicles FOR EACH ROW
      WHEN (old.mot_due_date IS DISTINCT FROM new.mot_due_date
         OR old.tax_due_date IS DISTINCT FROM new.tax_due_date
         OR old.is_disposed  IS DISTINCT FROM new.is_disposed)
      EXECUTE FUNCTION fleet_health_recompute()

`fleet_health_recompute()` is shared by six tables and dispatched on
`TG_TABLE_NAME` with a **CASE expression**:

    v_vehicle := CASE TG_TABLE_NAME
      WHEN 'vehicles' THEN COALESCE(NEW.id, OLD.id)
      ELSE COALESCE(NEW.vehicle_id, OLD.vehicle_id)
    END;

PL/pgSQL resolves **every** field reference in an expression before evaluating
it — not just the branch that will be taken. `vehicles` has no `vehicle_id`
column, so:

    ERROR: 42703: record "new" has no field "vehicle_id"
    CONTEXT: PL/pgSQL assignment "v_vehicle := CASE TG_TABLE_NAME ..."
             PL/pgSQL function fleet_health_recompute() line 4

The trigger is AFTER ROW inside the RPC's own UPDATE, so the caller's whole
transaction aborted. Platform-wide: 26 tenants, 451 vehicles. It also broke
**every MOT and tax due-date edit**, which nobody reported.

A DB trigger fires regardless of any front-end feature flag — which is why a
feature that is "off" and unmerged took down a live operation.

## The fix (APPLIED to prod 2026-08-20)

Two changes to `fleet_health_recompute()` only. No trigger, table, or other
function was modified.

1. **IF/ELSE instead of the CASE expression**, so `vehicle_id` is only ever
   resolved for the five tables that actually have it.
2. **`evaluate_vehicle_health()` wrapped in `BEGIN/EXCEPTION WHEN OTHERS/RAISE
   WARNING`** — refreshing a derived health cache must never abort the
   business write that triggered it.

Current live definition and the rollback are in
`/tmp/fleet-fix/ROLLBACK-fleet_health_recompute.sql`; fetch the live one with:

    select pg_get_functiondef(p.oid) from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fleet_health_recompute';

## Verification

Four independent adversarial agents (correctness / blast-radius / side-effects /
completeness) plus an adjudicator, 123 tool calls, every write inside a
`DO $$ ... RAISE EXCEPTION 'ROLLBACK_OK' $$` block. **Verdict: KEEP.** None of
them broke the fix on its own terms.

- All six attached tables x every declared TG_OP: no 42703, either plan order,
  NULL `vehicle_id`, through the disposal cascade, and at depth.
- Real `globalmotiontransport` vehicle disposed successfully (rolled back).
- Single-row MOT edit measured at **71ms** (GMT) — ~1% of the 8s
  `statement_timeout`.
- Outstanding DB damage from the outage is **provably zero**: the 42703 fired in
  an AFTER-ROW trigger inside the RPC's UPDATE, so every failed attempt aborted
  atomically before any pnl or event row was written. Post-fix sweep:
  `vehicles=451, disposed=8, cache=253, cache_on_disposed=0, blocks=217,
  negative_readings=0, open_jobs=0`.

## Follow-up applied 2026-08-20 (same session)

Items 2 and 3 below are now **FIXED in production**. Both siblings were given the
same `BEGIN/EXCEPTION WHEN OTHERS/RAISE WARNING` guard, bodies otherwise
byte-identical:

- `fleet_health_on_disposal()` — 778 -> 964 bytes
- `handover_to_odometer_reading()` — 1288 -> 1486 bytes

Verified: all three functions now report `guarded = true`. Rollbacks for both are
at `/tmp/fleet-fix/ROLLBACK-<name>.sql`; the applied SQL is
`/tmp/fleet-fix/guards.sql`.

Item 1 (the trigger layer ignoring `tenants.fleet_health_enabled`) is **still
open** — it is a product decision, not a hotfix, because gating deletes cache
rows for 46 tenants.

## Still open (found during verification, NOT caused by this fix)

Ordered by value. None of these is caused by the hotfix; all are pre-existing
Fleet Health defects.

1. **The trigger layer ignores `tenants.fleet_health_enabled`.** `evaluate_fleet_health()`
   (cron 66) filters on the flag; **none of the 7 trigger functions do**. The flag
   is ON for 1 of 47 tenants, yet 4 flag-OFF tenants already hold
   `vehicle_health_cache` rows and 90 `vehicle_odometer_readings` rows. Because
   the nightly reconciler skips flag-off tenants, nothing ever repairs what the
   triggers write there. Gate the trigger layer on the same flag, or drop the
   `trg_fh_*` triggers until the branch merges.
2. **`fleet_health_on_disposal` is unguarded.** It fires on the *identical*
   `is_disposed` WHEN clause that caused this incident and does three destructive
   writes (cancels maintenance jobs, DELETEs `blocked_dates`, dismisses
   reminders). It cannot throw today (0 open jobs, 0 maintenance blocks), but it
   is one CHECK constraint away from re-breaking disposal the same way. Also:
   `undo_vehicle_disposal` reverses **none** of those three writes.
3. **`handover_to_odometer_reading` is unguarded** — a mistyped negative mileage
   fails `vehicle_odometer_readings_reading_check` (23514) and aborts the whole
   **key handover**. Reproduced live on a flag-OFF tenant, rolled back. The only
   front-end guard is `!isNaN()` at
   `apps/portal/src/components/rentals/key-handover-section.tsx:343`; there is no
   `min={0}`.
4. **`check_rental_overlap` raises `23P02`** on maintenance blocks. Dormant — all
   217 `blocked_dates` rows are `source_type='manual'` and there is no CHECK
   pinning that column. But grep for `23P01|23P02` across `apps/` and
   `supabase/functions/` returns nothing, so the first maintenance block makes a
   vehicle silently unbookable and shows a customer a raw Postgres string.
5. **`service_records` (41 rows) and `vehicle_events` (86 rows) carry RLS
   policies but have `relrowsecurity = false`** — real tenant data with no
   isolation enforced. This is the only *security* item here; it is independent
   of Fleet Health and should be fixed on its own.
6. **`evaluate_vehicle_health` is O(N) per row** — it calls
   `vehicle_daily_burn(v2.id)` for every sibling vehicle in the tenant to compute
   a median. Harmless at current fleet sizes (largest real tenant is 22
   vehicles), but a 242-row bulk update measured 2479ms vs 48ms without. Make it
   set-based before enabling Fleet Health on a large fleet.
7. **Tenant-default maintenance rules recompute nothing.** All 4 production rules
   have `vehicle_id IS NULL`, and the trigger's `IF v_vehicle IS NOT NULL` guard
   skips them — verified 0 of 242 vehicles refreshed. Fix at merge time with an
   enqueue, not an inline fan-out (an inline loop is ~4s on an operator's save).

## Operational note

MOT/tax edits attempted between ~16 Aug and 20 Aug rolled back leaving no trace,
so the affected tenants **cannot be identified by query**. They should be asked
to re-check their MOT and tax due dates. `reminders-generate` has meanwhile been
deriving compliance reminders from the un-corrected dates.

---

# Unrelated: `vehicles` pause columns, applied 2026-08-20

Recorded here for the same reason as the above — this project applies DDL through
the Supabase tooling and keeps no migration file for it.

```sql
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_paused    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_at    timestamptz,
  ADD COLUMN IF NOT EXISTS paused_by    uuid REFERENCES public.app_users(id);
```

No `GRANT` accompanies it: `public.vehicles` carries **table-level** grants to
`anon` (70/70 columns), unlike `public.tenants` which is column-granted (234/257)
and once 403'd every booking site when a column was added without a grant.

Post-apply check: 451 vehicles, all `is_paused = false`, zero NULLs — so
`.eq("is_paused", false)` matches every existing row and no fleet list empties.

**Caveat carried by this schema:** `public.vehicles` has RLS **disabled** with
full `arwdDxtm` to `anon`, so `paused_reason` is readable by anyone holding the
public anon key — as are `lockbox_code`, `lockbox_instructions` and
`purchase_price`. The portal UI therefore does **not** promise the reason is
private. Enabling RLS on this table is a separate ticket.

---

# Follow-up fixes, 2026-08-20 (four reported issues)

All applied directly to production. Rollbacks in `/tmp/fleet-fix/ROLLBACK-*.sql`.

### 1. `undo_vehicle_disposal` is now a true undo
New table `public.vehicle_disposal_restore` (RLS on, no policies, grants revoked
from anon/authenticated). `fleet_health_on_disposal` journals the maintenance
jobs, maintenance `blocked_dates` rows and FLEET_HEALTH reminders **before**
destroying them; `undo_vehicle_disposal` replays them.

**v1 of this was wrong and was replaced.** It restored everything inside ONE
subtransaction, so a single GiST conflict (`blocked_dates_no_overlapping_maintenance`)
rolled back the jobs and the *other* blocks too — while still returning
`{"success":true}`, because PL/pgSQL variables survive a subtransaction rollback.
It then deleted the journal row regardless, destroying its own retry data.

v2 restores each element in its own nested block, counts only actual successes,
keeps the journal when anything fails, and returns `restore_failed` +
`restore_sqlstate`. Verified on the exact failing case (two blocks, one
conflicting):

    v1: A=0 B=0 job=cancelled journal deleted  res={"success":true,"jobs":1}
    v2: A=0 B=1 job=scheduled journal kept     res={"restore_failed":true,"sqlstate":"23P01"}

`use-vehicle-disposal.ts` now reads the payload and shows a destructive toast
instead of "Disposal Undone" when the restore failed.

### 2. Negative mileage rejected at entry
    rental_key_handovers_mileage_non_negative  CHECK (mileage IS NULL OR mileage >= 0)
    vehicles_current_mileage_non_negative      CHECK (current_mileage IS NULL OR current_mileage >= 0)
0 violating rows existed. `use-key-handover.ts` changed `if (mileage)` to
`if (mileage != null && mileage >= 0)` — `-1` is truthy, so it used to propagate
into `vehicles.current_mileage`. `key-handover-section.tsx` now tests `>= 0`.

### 3. The guards are observable
`RAISE WARNING` went nowhere: `log_min_messages` is already `warning`, but
Supabase's `postgres_logs` surfaces only ERROR and LOG — zero WARNING rows exist.
New table `public.fleet_health_trigger_errors` (RLS on, grants revoked). Every
guard handler now also writes there, each INSERT itself nested-guarded.

**`evaluate_fleet_health` (cron jobid 66) was also unguarded** — a bare `PERFORM`
in the loop, so one bad vehicle aborted the whole nightly fleet pass and wrote
nothing. Now per-vehicle guarded and recorded.

### 4. `accept-offer` rejected every vehicle on the platform
    if (vehicleRow.status && !["Active","active","available"].includes(vehicleRow.status))
Production statuses are `Available` / `Rented` / `Disposed` — none match, so all
451 vehicles returned `vehicle_unavailable reason=retired`. Evidence it was real
and silent: 6 `lead_offers`, **0** with `accepted_vehicle_id`, 0 `offer_accepted`
activity rows. Now a denylist on `disposed|sold|retired` plus `is_paused`. Also
added the missing `blocked_dates` leg (it was the only write path in the repo
without one) and inverted the rentals allowlist — which contained `"Confirmed"`,
a status `rentals_status_check` does not permit.

**NOT DEPLOYED.** Edge function source changes are inert until
`supabase functions deploy`. The live bundle is v17 from 2026-05-23 and contains
zero occurrences of `is_paused`. Same applies to `submit-enquiry` and
`submit-application`.
