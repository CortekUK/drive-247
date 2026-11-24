# Database evals

These prove the staging database is built and behaves the same as production.
They compare structure and settings only. No customer row is ever copied or compared.

Production is `hviqoaokxvlancmftwuo`. Staging is read from `STAGING_REF` in
`.staging-credentials.local` (or pass `--target <ref>`).

## Run

```bash
export SUPABASE_ACCESS_TOKEN=...
node docs/evals/environments/database/nightly.mjs        # everything, one report
node docs/evals/environments/database/db-eval.mjs        # just the main comparison
node docs/evals/environments/database/rebuild.mjs --yes  # staging drifted: rebuild it from prod
node docs/evals/environments/database/reseed.mjs         # after a rebuild: tenant, logins and demo data back
```

Exit code is 0 only when everything is identical. Every run writes a PDF to
`reports/` (`latest.pdf` is always the newest).

## Files

| File | Question it answers | Writes anywhere? |
|---|---|---|
| `db-eval.mjs` | Is staging built the same as prod? 38 checks: tables, columns, functions, policies, grants, crons and more. | No |
| `alarm-test.mjs` | Does each db-eval check really notice a break? Breaks one thing per check on staging, confirms it goes red, puts it back. | Staging only |
| `blind-spots.mjs` | Is there any kind of object db-eval never looks at? Counts every kind and fails on an uncovered one. | No |
| `blueprint-diff.mjs` | Does Postgres' own `pg_dump` agree? A second opinion that shares no code with db-eval. Needs `pg_dump` 17. | No |
| `door-test.mjs` | Does it behave the same from outside? Compares what the API offers and what each role may do. | No |
| `settings-check.mjs` | Are the project dials the same? API, auth, pooler, storage and Postgres settings. | No |
| `nightly.mjs` | Runs all of the above and writes one report. Add `--with-alarm` to include alarm-test. | Staging only, with `--with-alarm` |
| `rebuild.mjs` | Staging drifted, how do I fix it? Empties staging's own schemas, builds them again from prod's blueprint (about 10 minutes), then runs db-eval. Needs `--yes`; `--dry-run` shows the plan. | Staging only. Wipes staging rows, so run `reseed.mjs` after |
| `reseed.mjs` | Staging was rebuilt, how do I log in again? Puts back the northwind tenant (settings from prod, cleaned), its logo files, the two logins and the demo data. Safe to run again. | Staging only |
| `accepted-differences.json` | Every difference we decided is fine, each with a reason. | |
| `lib.mjs` | Shared plumbing: Supabase calls, exceptions, the report. | |

## Rules that keep it honest

- **Production is never written to.** `lib.mjs` refuses any write aimed at the prod ref.
- **Empty is not a pass.** Every check has a floor: the fewest objects prod must return.
- **No silent skips.** A difference is only ignored if it is in `accepted-differences.json`
  with a reason, one exact object per entry. A stale entry fails the run.
- **A new check needs a break.** `alarm-test.mjs` refuses to run if a db-eval check has no break defined.
- **A new kind of object needs a check.** `blind-spots.mjs` fails until one covers it.

## Accepted differences (10)

All 10 have one cause: staging was created in November 2026 on a newer Supabase
platform image than prod. Supabase owns these objects; we cannot change them on
either side. Each is one exact entry in `accepted-differences.json`. Status:
**approved by Ghulam on 24 Nov 2026.**

| # | Check | Object | What differs | Why it is fine |
|---|---|---|---|---|
| 1 | `database_settings` | `authenticator` preload libraries | Staging preloads `supautils` for this role | Set by the newer image |
| 2 | `database_settings` | `supabase_realtime_admin` search_path | Staging gives the role its own search_path | Set by the newer image |
| 3 | `extension_versions` | `pg_net` | 0.19.5 on prod, 0.20.4 on staging | Ships with the image, cannot be downgraded |
| 4 | `extension_versions` | `supabase_vault` | 0.3.1 on prod, 0.3.2 on staging | Ships with the image, cannot be downgraded |
| 5 | `extension_versions` | `vector` | 0.8.0 on prod, 0.8.2 on staging | Patch release; a downgrade means dropping every embedding column |
| 6 | `role_memberships` | `supabase_realtime_admin` in `anon` | Membership exists on staging only | Granted by the newer image |
| 7 | `role_memberships` | `supabase_realtime_admin` in `authenticated` | Same | Same |
| 8 | `role_memberships` | `supabase_realtime_admin` in `service_role` | Same | Same |
| 9 | `kind_counts_match` | role memberships | Count is off by three | Follows from 6, 7, 8 |
| 10 | `kind_counts_match` | database and role settings | Count is off by one | Follows from 2 |

Two earlier entries (Realtime's own publication) were removed on 2026-11-24: Realtime
created the publication on staging too, the difference disappeared, and the eval
flagged both entries as stale.

Worth a second look when we review: 6, 7 and 8. They let Supabase's Realtime
admin role act as our three API roles on staging, which prod does not allow.

Two more things are ignored in code, not in the list, because they touch every
object: the `pg_attver` stamp the newer image puts on every column, and the
order of GRANT lines inside a `pg_dump` permission block.

## Not covered yet

- Logged-in probes (operator A reading operator B, a customer reading another customer).
  They need seeded tenants and users on staging.
- Edge functions and their secrets. These evals are about the database only.
