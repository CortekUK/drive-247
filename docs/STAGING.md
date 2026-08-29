# Staging Environment

Staging is a **disposable mirror of production**, rebuilt from prod on demand.
It is deliberately *not* a long-lived environment that accumulates its own
history — that is what caused the previous one to rot (see "History" below).

| | |
|---|---|
| Supabase branch | `staging` — project ref `ksmreaadhbirzakkxqrq`, eu-west-2 |
| Git branch | `staging` — always a fast-forward of `main`, no unique commits |
| Worktree | `/Users/ghulam/projects/drive-247-staging`, dev ports **4000-4005** |
| Vercel | `staging.drive-247.com`, `admin.staging.…`, `{tenant}.staging.…`, `{tenant}.portal.staging.…` |
| Data | **synthetic only** — never copy production customer data here |

## The invariant

**`staging` must never diverge from `main`.** Feature work goes on feature
branches. To sync:

```bash
git branch -f staging main && git push --force origin staging
```

Reset rather than delete the branch: Vercel binds its staging preview domains to
the *branch name*, so the name must never disappear.

Likewise the Supabase branch is rebuilt **in place**. Deleting and recreating it
mints a new project ref and new API keys, which silently breaks the
branch-scoped Vercel env vars pointing at the old ref.

## Rebuilding

```bash
export SUPABASE_ACCESS_TOKEN=...          # Supabase Management API token
export STAGING_DB_PASS=...                # staging branch DB password

./scripts/staging-rebuild.sh              # schema mirror of prod, no data
./scripts/staging-verify.sh               # prove parity (exits non-zero on drift)
./scripts/staging-set-secrets.sh          # edge-function secrets, live keys blocked
./scripts/staging-install-crons.sh        # crons, rewritten to staging, INACTIVE
node scripts/staging-seed.mjs             # super admin + synthetic tenants
supabase functions deploy --project-ref ksmreaadhbirzakkxqrq
```

Docker must be running — `supabase db dump` runs `pg_dump` in a container.

## Drift detection

`./scripts/staging-verify.sh` compares prod and staging across tables, columns,
triggers, functions, policies, views, enums and indexes, and lists any missing
columns per table. It exits non-zero on drift, so it can gate CI.

**When it reports drift, rebuild — do not patch.** Patching is how the last
staging ended up 67 tables and 170 triggers behind prod.

## Things that will bite you

**Crons carry production credentials.** Every prod cron command hardcodes the
prod function URL *and* the prod `service_role` JWT:

```sql
net.http_post(url := 'https://<PROD_REF>.supabase.co/functions/v1/accrue-payg-charges',
              headers := '{"Authorization":"Bearer <PROD SERVICE JWT>"}')
```

Copied verbatim, **staging's crons fire at production** every 1-5 minutes —
accruing real PAYG charges, auto-extending real rentals, charging real cards.
`staging-install-crons.sh` rewrites both, refuses anything still referencing
prod, and skips jobs targeting foreign projects (`daily-reminders-job` points at
RTECHFINAL). Crons install **inactive**; enable only what you're testing:

```sql
select cron.alter_job((select jobid from cron.job where jobname='accrue-payg-charges'), active := true);
```

**`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` must never
be set as staging secrets.** Supabase injects them per project; setting prod's
values makes every staging edge function read and write the production
database. `staging-set-secrets.sh` blocks them, along with anything
`LIVE`/`PROD`-named or any `sk_live_`/`pk_live_`/`rk_live_` value.

**`supabase secrets set` can silently no-op.** A single malformed value (e.g.
the multi-line `DOCUSIGN_PRIVATE_KEY` PEM) makes the CLI drop the *entire batch*
while still exiting 0. The script therefore sets secrets one at a time and
verifies against the API rather than trusting exit codes.

**A pg_dump clone does not carry role grants.** Without them `anon`,
`authenticated` and `service_role` have no privileges and every request fails
with `42501 permission denied` — including login. The rebuild re-applies grants
and default privileges as its last step.

**`btree_gist`, `pg_net` and `vector` live in the `public` schema**, so
`DROP SCHEMA public CASCADE` removes them and the dump will not restore them.
They are recreated explicitly before the restore.

**Triggers are dumped as `CREATE OR REPLACE TRIGGER`**, not `CREATE TRIGGER` —
easy to miss when grepping, and easy to wrongly conclude they are absent.

## Local development

The staging worktree runs on ports **4000-4005**; the main worktree uses
3000-3005. `scripts/kill-dev-ports.mjs` picks its range from the worktree
directory name (anything containing `staging` → 4000), overridable with
`DEV_PORT_BASE` or `DEV_PORTS`. This keeps a `npm run dev` in one worktree from
killing the other's servers.

Point local apps at staging with `node scripts/db-switch.mjs staging`
(`prod` / `status` also available).

## Credentials

`node scripts/staging-seed.mjs` writes logins to `.staging-credentials.local`
(gitignored, mode 600). Re-running does not rotate existing passwords.

## History — why it was rebuilt (2026-08-29)

The previous staging was created 2026-06-06 and abandoned. By August it was:

- **537 commits** behind `main`
- missing **67 tables** and **98 columns** on shared tables (`rentals` -30,
  `tenants` -22, all of Square on `payments`)
- down to **16 of 186 triggers** and **1 of 22 views** — the DB-logic-to-API
  experiment had deliberately stripped them, so staging could never reproduce
  prod behaviour
- running **0 of 29 crons**, with **11 of 104** secrets
- flagged `MIGRATIONS_FAILED` and `persistent: false` by Supabase

It was reset rather than repaired, because the schema fork was intentional and
too deep to reconcile. The old branch tip is preserved at tag
`archive/staging-20260829`.
