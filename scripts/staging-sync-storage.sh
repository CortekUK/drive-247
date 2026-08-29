#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# staging-sync-storage.sh — mirror prod's storage buckets + storage RLS policies.
#
# WHY: `supabase db dump --schema public,private` does NOT cover the `storage`
# schema, so a rebuild leaves buckets and their policies stale. Anything that
# uploads (vehicle photos, CMS media, receipts, ID cards) silently breaks or
# behaves differently from prod.
#
# Copies bucket DEFINITIONS only — never object contents.
# Usage: ./scripts/staging-sync-storage.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
PROD_REF="hviqoaokxvlancmftwuo"
STAGING_REF="ksmreaadhbirzakkxqrq"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
WORK="${WORK:-/tmp/staging-rebuild}"; mkdir -p "$WORK"

mgmt_sql(){
  curl -s -X POST "https://api.supabase.com/v1/projects/$1/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -H "User-Agent: $UA" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'query':sys.argv[1]}))" "$2")"
}

echo "▸ reading prod buckets + storage policies"
mgmt_sql "$PROD_REF" "select id, name, public, file_size_limit, allowed_mime_types, avif_autodetection from storage.buckets order by id" > "$WORK/buckets.json"
mgmt_sql "$PROD_REF" "select policyname, tablename, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname='storage' order by tablename, policyname" > "$WORK/storage_policies.json"

python3 - "$WORK" <<'PY' > "$WORK/sync_storage.sql"
import json, sys
w = sys.argv[1]
def lit(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

print("-- buckets")
for b in json.load(open(f"{w}/buckets.json")):
    mimes = b['allowed_mime_types']
    mlit = 'null' if mimes is None else "ARRAY[" + ",".join(lit(m) for m in mimes) + "]::text[]"
    print(f"insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types,avif_autodetection) "
          f"values ({lit(b['id'])},{lit(b['name'])},{lit(b['public'])},{lit(b['file_size_limit'])},{mlit},{lit(b['avif_autodetection'])}) "
          f"on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, "
          f"allowed_mime_types=excluded.allowed_mime_types, avif_autodetection=excluded.avif_autodetection;")

print("\n-- policies (drop+recreate so definitions match prod exactly)")
for p in json.load(open(f"{w}/storage_policies.json")):
    name = p['policyname'].replace('"', '""')
    tbl  = p['tablename']
    roles = p['roles'].strip('{}')
    roles = ", ".join(r.strip('" ') for r in roles.split(',') if r.strip())
    cmd = p['cmd'] if p['cmd'] != 'ALL' else 'ALL'
    stmt = f'drop policy if exists "{name}" on storage.{tbl};\n'
    stmt += f'create policy "{name}" on storage.{tbl} for {cmd}'
    if roles: stmt += f' to {roles}'
    if p['qual']:       stmt += f" using ({p['qual']})"
    if p['with_check']: stmt += f" with check ({p['with_check']})"
    print(stmt + ";")
PY

echo "▸ applying to staging"
mgmt_sql "$STAGING_REF" "$(cat "$WORK/sync_storage.sql")" | head -c 300
echo
echo "▸ result"
mgmt_sql "$STAGING_REF" "select (select count(*) from storage.buckets) buckets, (select count(*) from pg_policies where schemaname='storage') policies"
