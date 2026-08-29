#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# staging-verify.sh — prove staging is still a faithful mirror of prod.
# Exits non-zero on ANY drift, so it can gate CI or a pre-release check.
# Usage: ./scripts/staging-verify.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
PROD_REF="hviqoaokxvlancmftwuo"
STAGING_REF="ksmreaadhbirzakkxqrq"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"

mgmt_sql(){
  curl -s -X POST "https://api.supabase.com/v1/projects/$1/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -H "User-Agent: $UA" \
    -d "$(python3 -c "import json,sys;print(json.dumps({'query':sys.argv[1]}))" "$2")"
}

COUNTS="select
  (select count(*) from pg_tables where schemaname='public')                       as tables,
  (select count(*) from information_schema.columns where table_schema='public')     as columns,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     join pg_namespace n on n.oid=c.relnamespace
     where not t.tgisinternal and n.nspname='public')                               as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     left join pg_depend d on d.objid=p.oid and d.deptype='e'
     where n.nspname in ('public','private') and d.objid is null)                   as functions,
  (select count(*) from pg_policies where schemaname='public')                      as policies,
  (select count(*) from pg_views where schemaname='public')                         as views,
  (select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
     where n.nspname='public' and t.typtype='e')                                    as enums,
  (select count(*) from pg_indexes where schemaname='public')                       as indexes"

mgmt_sql "$PROD_REF"    "$COUNTS" > /tmp/_vp.json
mgmt_sql "$STAGING_REF" "$COUNTS" > /tmp/_vs.json

OBJ_SQL="select table_name||'.'||column_name as o from information_schema.columns where table_schema='public'"
mgmt_sql "$PROD_REF"    "$OBJ_SQL" > /tmp/_op.json
mgmt_sql "$STAGING_REF" "$OBJ_SQL" > /tmp/_os.json

python3 - <<'PY'
import json,sys
p=json.load(open('/tmp/_vp.json'))[0]; s=json.load(open('/tmp/_vs.json'))[0]
print(f"{'object':<12}{'prod':>8}{'staging':>10}{'':>4}")
print("-"*36)
drift=False
for k in p:
    ok = p[k]==s[k]
    drift = drift or not ok
    print(f"{k:<12}{p[k]:>8}{s[k]:>10}   {'ok' if ok else 'DRIFT'}")
op={r['o'] for r in json.load(open('/tmp/_op.json'))}
os_={r['o'] for r in json.load(open('/tmp/_os.json'))}
missing, extra = op-os_, os_-op
if missing:
    drift=True
    print(f"\n{len(missing)} columns missing on staging:")
    bad={}
    for c in missing:
        t,col=c.split('.',1); bad.setdefault(t,[]).append(col)
    for t,cols in sorted(bad.items(), key=lambda x:-len(x[1]))[:15]:
        print(f"  {t}: {', '.join(sorted(cols)[:6])}{' …' if len(cols)>6 else ''}")
if extra:
    print(f"\n{len(extra)} columns only on staging (usually fine): {list(sorted(extra))[:5]}")
print("\n" + ("❌ DRIFT DETECTED — rebuild staging" if drift else "✅ staging matches prod"))
sys.exit(1 if drift else 0)
PY
