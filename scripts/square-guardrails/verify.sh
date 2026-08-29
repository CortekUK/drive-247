#!/usr/bin/env bash
# Square workstream — run every guardrail. Wire into CI and pre-push.
#
# Exit non-zero if the Stripe path could have regressed.
#
# NOTE ON HOW THIS SCRIPT DECIDES PASS/FAIL:
# An earlier version inferred failure by grepping a command's OUTPUT for the word
# "error". That gate was structurally incapable of failing — a non-zero exit with
# no matching text read as success, and it printed "provably untouched" anyway.
# Every step below now keys off the command's own EXIT STATUS. If you add a step,
# do the same; a guardrail that cannot fail is worse than no guardrail, because
# it manufactures confidence.
set -uo pipefail
cd "$(dirname "$0")/../.."

DENO="${DENO:-$HOME/.supabase/deno}"
BASELINE="docs/square-integration/BASELINE.sha256"
fail=0
step() { echo; echo "==> $1"; }

step "1/7  Stripe freeze gate"
if node scripts/square-guardrails/check-frozen.mjs; then echo "    ok"; else echo "    FAIL"; fail=1; fi

step "2/7  banned predicates & resolver aliases"
if node scripts/square-guardrails/check-predicates.mjs; then echo "    ok"; else echo "    FAIL"; fail=1; fi

step "3/7  typecheck the provider seam"
# --unstable matches the Supabase edge runtime; the pinned local Deno predates
# stable Deno.serve and would otherwise flag every edge function in the repo,
# including long-deployed Stripe ones.
if out=$("$DENO" check --unstable supabase/functions/_shared/payments/*.ts 2>&1); then
  echo "    ok"
else
  printf '%s\n' "$out" | grep -vE '^Download' | head -20; echo "    FAIL"; fail=1
fi

step "4/7  typecheck square edge functions"
shopt -s nullglob
sq_checked=0
for d in supabase/functions/square-*/ supabase/functions/refresh-square-tokens/; do
  [ -f "$d/index.ts" ] || continue
  if out=$("$DENO" check --unstable "$d/index.ts" 2>&1); then
    echo "    ok   $d"; sq_checked=$((sq_checked+1))
  else
    printf '%s\n' "$out" | grep -vE '^Download' | head -10; echo "    FAIL $d"; fail=1
  fi
done

step "5/7  seam contract tests"
if out=$("$DENO" test --allow-net --allow-env supabase/functions/_shared/payments/__tests__/ 2>&1); then
  printf '%s\n' "$out" | grep -E '^ok \||passed' | tail -1
  echo "    ok"
else
  printf '%s\n' "$out" | grep -vE '^Download' | tail -25; echo "    FAIL"; fail=1
fi

step "6/7  seam importers (re-checked every run, never cached)"
# The claim "the seam has no callers yet" goes stale the moment wiring lands.
# List them so a reviewer sees the real blast radius rather than a stale note.
importers=$(grep -rl "_shared/payments" supabase/functions apps --include=*.ts --include=*.tsx 2>/dev/null \
            | grep -v "_shared/payments/" | sort || true)
if [ -z "$importers" ]; then
  echo "    none yet"
else
  echo "$importers" | sed 's/^/    /'
  echo "    ^ these files carry the seam; each MUST keep its Stripe body byte-identical"
fi

step "7/7  meta: prove every gate above can actually fail"
# Mutation-tests the gates themselves: violate each rule in a throwaway tree and
# assert the gate reports it. Runs verify.sh against a stub `deno` to prove a
# failing typecheck still reaches this script's exit status. ~1.5s.
if node scripts/square-guardrails/check-meta.mjs; then echo "    ok"; else echo "    FAIL"; fail=1; fi

echo
if [ $fail -eq 0 ]; then
  # The old banner read "the Stripe path is provably untouched". It was not
  # provable and it was not true: the freeze gate covered one file out of the 56
  # that import stripe-client.ts. State the proven claims, then name the residue.
  frozen_n=$(grep -cvE '^[[:space:]]*(#|$)' "$BASELINE" 2>/dev/null || echo 0)
  echo "GUARDRAILS GREEN. Proven by this run, and nothing beyond it:"
  echo "  - $frozen_n frozen file(s) are byte-identical to $BASELINE"
  echo "  - no banned provider predicate, comparison spelling or resolver alias"
  echo "    anywhere in supabase/functions + apps (10 rules, every spelling probed)"
  echo "  - the provider seam and $sq_checked square edge function(s) typecheck (deno --unstable)"
  echo "  - the seam contract tests pass"
  echo "  - each gate above was deliberately violated this run and each one failed"
  echo
  echo "NOT proven: that Stripe behaviour is unchanged in any file outside the"
  echo "frozen set. Nothing here reads a diff for meaning. These files existed on"
  echo "main, were MODIFIED by this branch, mention Stripe, and are NOT frozen —"
  echo "review their diffs by hand:"
  frozen_paths=" $(grep -vE '^[[:space:]]*(#|$)' "$BASELINE" 2>/dev/null | awk '{print $2}' | tr '\n' ' ')"
  residual=0
  for f in $(git diff --name-only --diff-filter=M main...HEAD 2>/dev/null | grep -E '\.tsx?$' || true); do
    case "$frozen_paths" in *" $f "*) continue ;; esac
    [ -f "$f" ] || continue
    if grep -qi stripe "$f"; then echo "    $f"; residual=$((residual+1)); fi
  done
  [ $residual -eq 0 ] && echo "    (none)"
else
  echo "GUARDRAIL FAILURE — do not merge."
fi
exit $fail
