#!/usr/bin/env bash
# Square workstream — run every guardrail. Wire this into CI and pre-push.
#
# Exit non-zero if the Stripe path could have regressed.
set -uo pipefail
cd "$(dirname "$0")/../.."

DENO="${DENO:-$HOME/.supabase/deno}"
fail=0

echo "==> 1/5  Stripe freeze gate"
node scripts/square-guardrails/check-frozen.mjs     || fail=1

echo; echo "==> 2/5  banned predicates & resolver aliases"
node scripts/square-guardrails/check-predicates.mjs || fail=1

echo; echo "==> 3/5  typecheck the provider seam"
"$DENO" check supabase/functions/_shared/payments/*.ts 2>&1 | grep -vE '^Download' | grep -E 'error|TS[0-9]+' && fail=1
[ $fail -eq 0 ] && echo "    ok"

echo; echo "==> 4/5  typecheck square edge functions"
# --unstable is REQUIRED locally: the pinned Deno (1.30.3) predates stable
# Deno.serve, which the Supabase edge runtime has. Without it every edge
# function in this repo -- including long-deployed Stripe ones -- reports
# TS2339 and the check looks broken when it is not.
for d in supabase/functions/square-*/; do
  [ -f "$d/index.ts" ] || continue
  if "$DENO" check --unstable "$d/index.ts" 2>&1 | grep -qE "^error"; then
    echo "    FAIL $d"; fail=1
  else
    echo "    ok   $d"
  fi
done

echo; echo "==> 5/5  seam contract tests"
"$DENO" test --allow-net --allow-env supabase/functions/_shared/payments/__tests__/ 2>&1 \
  | grep -vE '^Download' | tail -3 || fail=1

echo
if [ $fail -eq 0 ]; then
  echo "ALL GUARDRAILS GREEN — the Stripe path is provably untouched."
else
  echo "GUARDRAIL FAILURE — do not merge."
fi
exit $fail
