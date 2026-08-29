#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# staging-rebuild.sh — rebuild the Drive247 staging DB as an exact schema
# mirror of prod, with NO prod data.
#
# Design notes (why it looks like this):
#  * Triggers ARE included by `supabase db dump`, but written as
#    `CREATE OR REPLACE TRIGGER` (not `CREATE TRIGGER`) - easy to miss when
#    grepping. We still emit a generated trigger file from pg_get_triggerdef()
#    and apply it afterwards as an idempotent SAFETY NET: if a future CLI
#    version changes that behaviour, the rebuild stays correct instead of
#    silently producing a staging with no business logic. Re-applying is
#    harmless (every statement just reports "already exists").
#    NOTE: the old staging's 16-of-186 triggers was NOT a dump bug - the
#    triggers were deliberately stripped by the DB-logic-to-API experiment.
#  * btree_gist / pg_net / vector are installed INTO the public schema, so a
#    `DROP SCHEMA public CASCADE` removes them and the dump will not put them
#    back. We recreate them explicitly before restoring.
#  * A pg_dump-based clone restores schema but NOT role grants, which leaves
#    anon/authenticated/service_role with no privileges (every query -> 42501).
#    We re-apply grants + default privileges at the end.
#  * Rebuilds IN PLACE against the existing branch ref so the Vercel
#    branch-scoped env vars (URL + keys) stay valid. Do not swap the ref.
#
# Usage:  ./scripts/staging-rebuild.sh
# Requires: SUPABASE_ACCESS_TOKEN, Docker running, psql (PG17), python3
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_REF="hviqoaokxvlancmftwuo"
STAGING_REF="ksmreaadhbirzakkxqrq"
STAGING_DB_PASS="${STAGING_DB_PASS:?set STAGING_DB_PASS}"
STAGING_URI="postgresql://postgres.${STAGING_REF}:${STAGING_DB_PASS}@aws-1-eu-west-2.pooler.supabase.com:5432/postgres"

PSQL="${PSQL:-/opt/homebrew/opt/postgresql@17/bin/psql}"
WORK="${WORK:-/tmp/staging-rebuild}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
mkdir -p "$WORK"

# ── Guard: never, ever point the destructive half at prod ────────────────────
if [[ "$STAGING_REF" == "$PROD_REF" ]]; then
  echo "REFUSING: staging ref equals prod ref." >&2; exit 1
fi
if $PSQL "$STAGING_URI" -tAc "select current_setting('app.settings.is_prod', true)" 2>/dev/null | grep -qi true; then
  echo "REFUSING: target announces itself as prod." >&2; exit 1
fi

say(){ printf "\n\033[1m▸ %s\033[0m\n" "$*"; }

mgmt_sql(){ # $1=ref  $2=sql   -> JSON on stdout
  curl -s -X POST "https://api.supabase.com/v1/projects/$1/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -H "User-Agent: $UA" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'query':sys.argv[1]}))" "$2")"
}

# ── 1. Dump prod schema (read-only against prod) ─────────────────────────────
say "1/6  Dumping prod schema (public + private, no data)"
supabase db dump --linked --schema public,private -f "$WORK/prod_schema.sql" < /dev/null 2>&1 | tail -2
echo "    $(wc -l < "$WORK/prod_schema.sql") lines"

# ── 2. Generate the triggers the CLI dump omits ──────────────────────────────
say "2/6  Generating trigger DDL (idempotent safety net - see header)"
mgmt_sql "$PROD_REF" "select pg_get_triggerdef(t.oid) as ddl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','private')
  order by c.relname, t.tgname" > "$WORK/triggers.json"
python3 - "$WORK" <<'PY'
import json,sys
w=sys.argv[1]
d=json.load(open(f"{w}/triggers.json"))
if isinstance(d,dict): raise SystemExit(f"trigger fetch failed: {d}")
with open(f"{w}/prod_triggers.sql","w") as f:
    f.write("-- generated from pg_get_triggerdef()\n")
    for r in d: f.write(r['ddl'].rstrip().rstrip(';')+";\n")
print(f"    {len(d)} triggers")
PY

# ── 3. Wipe staging ──────────────────────────────────────────────────────────
say "3/6  Wiping staging schemas"
$PSQL "$STAGING_URI" -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public  cascade;
drop schema if exists private cascade;
create schema public;
create schema private;
alter schema public owner to pg_database_owner;
SQL

# ── 4. Extensions that live in public must be recreated before the restore ───
say "4/6  Recreating public-schema extensions (btree_gist, pg_net, vector)"
$PSQL "$STAGING_URI" -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists btree_gist schema public;
create extension if not exists pg_net     schema public;
create extension if not exists vector     schema public;
SQL

# ── 5. Restore schema, then triggers ─────────────────────────────────────────
say "5/6  Restoring schema + triggers"
$PSQL "$STAGING_URI" -v ON_ERROR_STOP=0 -f "$WORK/prod_schema.sql"   > "$WORK/restore.log" 2>&1 || true
$PSQL "$STAGING_URI" -v ON_ERROR_STOP=0 -f "$WORK/prod_triggers.sql" >> "$WORK/restore.log" 2>&1 || true
echo "    schema errors: $(grep '^psql:.*ERROR' "$WORK/restore.log" | grep -vc 'already exists' || true)"
echo "    ('already exists' on triggers is expected - safety net re-apply)"

# ── 6. Re-apply role grants (pg_dump does NOT carry these) ───────────────────
say "6/6  Re-applying role grants"
$PSQL "$STAGING_URI" -v ON_ERROR_STOP=1 <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines  to anon, authenticated, service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
SQL

say "Done. Run ./scripts/staging-verify.sh to confirm parity."
