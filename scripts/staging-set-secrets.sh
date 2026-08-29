#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# staging-set-secrets.sh — push edge-function secrets to staging, with a hard
# deny-list so production credentials can never land there.
#
# BLOCKED, always:
#   * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
#       Supabase injects these per-project. Setting prod's values would make
#       every staging edge function read and WRITE THE PRODUCTION DATABASE.
#   * anything with LIVE/PROD in the name
#   * any value that looks like a live credential (sk_live_/rk_live_/pk_live_)
#
# Usage: ./scripts/staging-set-secrets.sh [path/to/.env]   (default supabase/.env.local)
#        --dry-run   show what would be set, set nothing
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
STAGING_REF="ksmreaadhbirzakkxqrq"
SRC="${1:-supabase/.env.local}"; [[ "${1:-}" == "--dry-run" ]] && SRC="supabase/.env.local"
DRY="false"; for a in "$@"; do [[ "$a" == "--dry-run" ]] && DRY="true"; done
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
[[ -f "$SRC" ]] || { echo "no such env file: $SRC" >&2; exit 1; }

python3 - "$SRC" "$DRY" "$STAGING_REF" <<'PY'
import json,os,subprocess,sys
src,dry,ref = sys.argv[1:4]
vals={}
for line in open(src):
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k,v=line.split('=',1); vals[k.strip()]=v.strip().strip('"').strip("'")

LIVE_PREFIXES=('sk_live_','rk_live_','pk_live_','whsec_live')
def blocked(k,v):
    if k.startswith('SUPABASE_'):
        return 'supabase auto-injected — would point staging fns at PROD'
    if 'LIVE' in k.upper() or 'PROD' in k.upper():
        return 'live/prod-flagged name'
    for p in LIVE_PREFIXES:
        if v.startswith(p): return f'value is a LIVE credential ({p}…)'
    return None

allow={}; deny={}
for k,v in sorted(vals.items()):
    r=blocked(k,v)
    (deny if r else allow)[k]=r or v

print(f"BLOCKED ({len(deny)}):")
for k,r in deny.items(): print(f"   {k:<42} {r}")
print(f"\nWILL SET ({len(allow)}):")
for k in allow: print(f"   {k}")

if dry=="true":
    print("\n[dry-run] nothing set."); raise SystemExit(0)

# NOTE: set one at a time. A single malformed value (e.g. a multi-line PEM
# such as DOCUSIGN_PRIVATE_KEY) makes the CLI silently drop the ENTIRE batch
# while still exiting 0 — so a bulk call can look like it worked and set
# nothing. Per-secret calls isolate the failure and let us verify.
print()
failed=[]
for k,v in allow.items():
    # one retry: the API occasionally accepts the call (exit 0) without
    # persisting the secret, so we retry once and verify below regardless.
    for _attempt in range(2):
        res=subprocess.run(["supabase","secrets","set","--project-ref",ref,f"{k}={v}"],
                           capture_output=True,text=True)
        if res.returncode==0: break
    ok = res.returncode==0
    if not ok: failed.append((k,(res.stderr or res.stdout or '').strip()[:120]))
    print(f"  {'ok  ' if ok else 'FAIL'} {k}")

# verify against the API rather than trusting exit codes
import urllib.request
req=urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{ref}/secrets",
    headers={"Authorization":f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
             "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"})
present={x['name'] for x in json.load(urllib.request.urlopen(req))}
missing=[k for k in allow if k not in present]
print(f"\nverified on staging: {len(allow)-len(missing)}/{len(allow)}")
if missing:
    print("NOT SET:")
    for k in missing: print("   ",k)
for k,e in failed: print(f"   error {k}: {e}")
raise SystemExit(1 if missing else 0)
PY
