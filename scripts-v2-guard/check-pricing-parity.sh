#!/bin/sh
# ---------------------------------------------------------------------------
# check-pricing-parity.sh — the money-maths drift alarm.
#
# WHY THIS EXISTS
# The rental pricing engine is copy-pasted, not shared. calculate-rental-price.ts
# says so in its own header: "Any change to one MUST be mirrored to the other or
# the customer (booking) and staff (portal) prices will silently disagree."
# Silently is the operative word — nothing crashes when the copies drift. A
# customer is quoted $840 on the booking site while the operator's portal shows
# $910 for the same dates, and the first anyone hears about it is a chargeback.
#
# v2/apps/web now holds a THIRD copy of the same engines, so the blast radius
# grew. This script is the thing that makes drift loud.
#
# WHAT IT CHECKS  (two different, deliberate standards)
#
#   CHECK A — byte-identical, v1 pair only.
#     calculate-rental-price.ts and calculate-extras-total.ts each carry a
#     header promising booking's copy and portal's copy are byte-for-byte the
#     same. That promise is enforced here, unchanged, exactly as `diff` would.
#
#   CHECK B — logic-identical, across every copy including v2.
#     A full md5 match is impossible for the v2 copies and that is on purpose,
#     not a shortcut: the sync banners themselves have to name three locations
#     instead of two, so the v2 files differ from v1 by their comment header and
#     by nothing else. Hashing the raw bytes would therefore fail on day one and
#     get switched off within a week — a guard nobody can satisfy is a guard
#     nobody runs.
#     So CHECK B hashes the NUMERIC-LOGIC CORE: the file with every whole-line
#     comment and every blank line removed. Every statement, every constant,
#     every rounding call still has to match to the byte. Change `Math.round`
#     to `Math.floor`, reorder the tier thresholds, tweak a surcharge formula,
#     drop a `Number()` coercion — all of it fails here. Only prose moves free.
#
#     (Whole-line comments only. A trailing `// note` on a line of code is part
#     of that line and must still match — which is what you want, since those
#     are the comments that document units and gotchas.)
#
# USAGE
#   ./scripts-v2-guard/check-pricing-parity.sh      # exit 0 = in sync
# Wire it into CI or a pre-commit hook. It reads files and nothing else.
# ---------------------------------------------------------------------------

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

RED=''; GREEN=''; YELLOW=''; BOLD=''; RESET=''
if [ -t 1 ]; then
  RED=$(printf '\033[31m'); GREEN=$(printf '\033[32m')
  YELLOW=$(printf '\033[33m'); BOLD=$(printf '\033[1m'); RESET=$(printf '\033[0m')
fi

FAILURES=0

# md5sum (GNU) or md5 (BSD/macOS) — read stdin, print the bare hash.
hash_stdin() {
  if command -v md5sum >/dev/null 2>&1; then
    md5sum | cut -d' ' -f1
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q
  else
    echo "check-pricing-parity: neither md5sum nor md5 found" >&2
    exit 2
  fi
}

# The numeric-logic core of a TypeScript file: drop whole-line comments
# (// … , /* … , * … , */) and blank lines, and trim trailing whitespace.
core_hash() {
  grep -v -E '^[[:space:]]*(//|/\*|\*)' "$1" \
    | grep -v -E '^[[:space:]]*$' \
    | sed -e 's/[[:space:]]*$//' \
    | hash_stdin
}

require_file() {
  if [ ! -f "$1" ]; then
    printf '%s  MISSING %s%s\n' "$RED" "$1" "$RESET"
    printf '        A copy of a duplicated engine has been moved or deleted.\n'
    printf '        Update this script to match reality, or restore the file.\n'
    FAILURES=$((FAILURES + 1))
    return 1
  fi
  return 0
}

printf '%sPricing parity check%s  (repo: %s)\n\n' "$BOLD" "$RESET" "$ROOT"

# ---------------------------------------------------------------------------
# CHECK A — the v1 byte-identical contract these two files declare themselves.
# ---------------------------------------------------------------------------
printf '%sCHECK A%s  v1 booking <-> portal must be BYTE-identical\n' "$BOLD" "$RESET"

for NAME in calculate-rental-price.ts calculate-extras-total.ts; do
  A="apps/booking/src/lib/$NAME"
  B="apps/portal/src/lib/$NAME"
  if require_file "$A" && require_file "$B"; then
    if cmp -s "$A" "$B"; then
      printf '  %sok%s   %s\n' "$GREEN" "$RESET" "$NAME"
    else
      printf '  %sFAIL%s %s — booking and portal have DIVERGED\n' "$RED" "$RESET" "$NAME"
      printf '         diff %s %s\n' "$A" "$B"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

# ---------------------------------------------------------------------------
# CHECK B — logic core must match across every copy, v1 and v2.
#
# Table rows: <filename> <location> <location> [<location> ...]
# Locations are directories. mileage-utils.ts is in here even though its v1
# copies already differ in prose — that is precisely the case CHECK A cannot
# cover and CHECK B can.
# ---------------------------------------------------------------------------
printf '\n%sCHECK B%s  numeric-logic core must match in every copy\n' "$BOLD" "$RESET"

while IFS= read -r ROW; do
  [ -n "$ROW" ] || continue
  case "$ROW" in \#*) continue ;; esac

  NAME=${ROW%% *}
  DIRS=${ROW#* }

  REF_HASH=''
  REF_PATH=''
  ROW_FAILED=0
  MISSING=0

  for DIR in $DIRS; do
    P="$DIR/$NAME"
    if ! require_file "$P"; then MISSING=1; continue; fi
    H=$(core_hash "$P")
    if [ -z "$REF_HASH" ]; then
      REF_HASH=$H
      REF_PATH=$P
    elif [ "$H" != "$REF_HASH" ]; then
      if [ "$ROW_FAILED" -eq 0 ]; then
        printf '  %sFAIL%s %s — the maths has DIVERGED\n' "$RED" "$RESET" "$NAME"
        printf '         reference: %s (%s)\n' "$REF_PATH" "$REF_HASH"
        ROW_FAILED=1
        FAILURES=$((FAILURES + 1))
      fi
      printf '         differs:   %s (%s)\n' "$P" "$H"
      printf '         inspect:   diff %s %s\n' "$REF_PATH" "$P"
    fi
  done

  if [ "$ROW_FAILED" -eq 0 ] && [ "$MISSING" -eq 0 ]; then
    printf '  %sok%s   %-28s %s\n' "$GREEN" "$RESET" "$NAME" "$REF_HASH"
  fi
done <<'TABLE'
calculate-rental-price.ts apps/booking/src/lib apps/portal/src/lib v2/apps/web/src/lib/domain
calculate-extras-total.ts apps/booking/src/lib apps/portal/src/lib v2/apps/web/src/lib/domain
delivery-tiers.ts apps/booking/src/lib apps/portal/src/lib v2/apps/web/src/lib/domain
mileage-utils.ts apps/booking/src/lib apps/portal/src/lib v2/apps/web/src/lib/domain
vehicle-identity.ts apps/booking/src/lib v2/apps/web/src/lib/domain
TABLE

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '%sAll pricing engines are in sync.%s\n' "$GREEN" "$RESET"
  exit 0
fi

printf '%s%d parity check(s) failed.%s\n' "$RED" "$FAILURES" "$RESET"
printf '%sCustomer-facing and staff-facing prices can now disagree.%s\n' "$YELLOW" "$RESET"
printf 'Mirror the change into every copy listed above, then re-run this script.\n'
exit 1
