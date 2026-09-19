# Recovery plan for the isolation stages

Companion to [`containment-review.md`](containment-review.md) and [`db-isolation-remediation.md`](db-isolation-remediation.md). Nothing here has been applied or executed.

The point of this document: the rollback files in `docs/trax/remediation/` restore the **exposed** state. That is correct for isolated testing and wrong as a production reflex. This is what to do instead.

## 1. The backup position, verified

Read from the Supabase Management API on 2026-09-18 (read-only):

| | |
|---|---|
| Project | `hviqoaokxvlancmftwuo`, region `eu-west-2` |
| **Point-in-time recovery** | **disabled** (`pitr_enabled: false`) |
| Physical backups | daily, 8 retained; most recent `2026-09-17T02:37:43Z` |
| WAL archiving | `walg_enabled: true`, but without PITR there is no restore-to-timestamp |

**Consequence:** restoring from backup loses every booking, payment, message and ledger entry since the last nightly snapshot — up to ~24 hours. A restore is therefore a last resort for data loss, never a way to undo a privilege change. A privilege change needs a privilege fix.

If the administrator wants a real safety net before applying anything, enabling PITR is the single highest-value preparatory step, and it is an operational setting rather than a schema change.

## 2. Recovery options, in the order to reach for them

### a. Roll forward — the default
Every stage is a set of grants and policies. If a stage breaks something, the fix is almost always one more statement in the same direction.

| Symptom | Roll-forward fix |
|---|---|
| A staff page returns no rows after stage 1/3 | the table is missing a staff policy: add `<table>_staff` for `authenticated` with `tenant_id = public.get_user_tenant_id() or public.is_super_admin()` |
| The customer portal lost a panel | add the `<table>_customer` policy using the `customer_users` link; if the table has no customer link column (`customer_notifications`, `rental_handover_photos`, `insurance_documents`), restrict the feature per (b) until a column exists |
| A reporting view returns nothing after stage 4 | a base table lacks a policy for that caller — fix the base table; do **not** turn `security_invoker` off again |
| Checkout fails after stage 1 | the insert policies are named in `02-…`; confirm `tenant_id is not null` is satisfied; do not re-grant broad anonymous access |
| An edge function or webhook fails | it is not using the service role; fix the client construction (see the `SUPABASE_SERVICE_ROLE_KEY || ANON_KEY` fallback in the esign routes) |
| One RPC breaks after stage 0a | re-grant **that one function**: `grant execute on function public.<name>(<args>) to anon;` and record which one, because it means a browser path depends on a `SECURITY DEFINER` function and needs to move server-side |

### b. Restrict the feature, not the boundary
If a feature cannot be made to work quickly under the corrected policies, take the feature out of service rather than restoring cross-tenant access: hide the page behind its existing feature flag or permission, or return a maintenance state from the route. A missing report for a day is recoverable; a day of cross-tenant exposure is not.

### c. Rollback by exception
One object, one statement, recorded in the incident note. The per-stage rollback files may be used to derive the exact statement for the affected object — copy the line, not the file.

### d. Whole-stage rollback
Only when many objects are affected at once and (a) cannot be done inside the window. It reopens the exposure, so it comes with an agreed re-application time and the Supabase logs preserved for the interval.

### e. Restore from backup
Only for data loss, never for a privilege problem, and never without the administrator accepting the loss of everything since the last nightly snapshot.

## 3. What each recovery action affects

| Action | Affects | Does not affect |
|---|---|---|
| Re-grant one function to `anon` | that RPC endpoint only | tables, policies, other functions |
| Re-grant `DELETE`/`TRUNCATE` to `anon` | that table's destructive privilege | reads, inserts, RLS |
| Drop a policy added by stages 1/3 | who may read/write that table | grants, other tables |
| `alter table … disable row level security` | **all** access control on that table; grants alone then decide | other tables |
| `alter view … reset (security_invoker)` | that view reads with owner rights again, bypassing every base-table policy | the base tables themselves |
| Whole-stage rollback | every object the stage named | other stages |
| Backup restore | the entire database, to the snapshot time | nothing outside the database (Stripe, storage objects, edge function code) |

## 4. Deployed state versus repository intent

These are two different things and must not be reconciled by replaying history.

Verified on 2026-09-18 against `supabase_migrations.schema_migrations`:

| | Count |
|---|---|
| Migration versions recorded as applied on the project | 393 |
| Migration files in `supabase/migrations/` | 400 |
| Local files **not** recorded as applied | **124** |
| Applied versions with **no** local file | **120** |

So the history has diverged in both directions. `supabase db push` would attempt 124 historical migrations, some of which predate the current schema by months — including files that create, alter and drop objects that have since changed by other means. **Do not run it against production.** There is no CI job that would: the repository has no `.github/workflows`, and no `supabase db push` in any script (verified).

Reconciliation, after the containment decision and as its own reviewed change:

1. Freeze new migrations on `main` until step 4.
2. Take a fresh schema dump of the deployed database as the authoritative baseline.
3. Diff it against the repository's intended schema, and review the differences as a list of decisions — not as a merge. The isolation findings are part of that list, and they are already written as explicit stage files.
4. Record the baseline as a single squashed migration and mark the 124 stragglers as applied (`supabase migration repair --status applied <version>`) or delete them, with the decision recorded per file.
5. Only then resume ordinary migration flow, with the rule that the deployed state is changed by reviewed migrations alone.

Until step 5, the isolation stages stay where they are — in `docs/trax/remediation/`, outside `supabase/migrations/`, so no migration tooling can pick them up by accident.

## 5. What is required before any of this touches production

- Separate, explicit approval for **each** stage, by the administrator, recorded.
- Staging first, with the regression list in `db-isolation-remediation.md` §4.
- A named window, with the Supabase logs retained for it.
- Approval for a code deployment is a **separate** decision from approval for a database change; see [`release-review.md`](release-review.md) for what a push would actually trigger.
