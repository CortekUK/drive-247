#!/bin/sh
#
# check-design-drift.sh — brand guardrail for v2/apps/web
#
# The shipped Drive247 site has a cream page, near-black text, dark-green pill
# buttons and amber accents. It has NO indigo, NO serif, and NO dark mode.
# The shadcn primitives were generated against a generic token set that has all
# three, so it is very easy to drift back toward stock shadcn without noticing.
#
# This script greps everything under v2/apps/web/src EXCEPT src/components/ui
# (the primitives legitimately keep their generated classes) and fails on:
#
#   1. indigo    — bg-/text-/border-/ring-primary, *-primary-foreground
#   2. font-serif
#   3. dark:     — dead code; no ThemeProvider is mounted, nothing sets .dark
#   4. hardcoded colour in a Tailwind arbitrary value — bg-[#…], fill-[#…], …
#
# Rule 4 is deliberately NARROWED to Tailwind arbitrary-value utilities rather
# than "any hex anywhere". A literal hex on an inline <svg> fill/stroke
# attribute (brand-mark.tsx, the BrandIcon set in fleet-section.tsx, the
# readiness-card chevrons) is logo/illustration artwork, not palette, and
# tokenising it would be wrong. Those are left alone by construction, not by
# allowlist.
#
# Genuine pre-existing violations are listed in ALLOWLIST below so this script
# exits 0 on today's tree. Fix one -> delete its line in the same commit.
#
# Usage:  ./scripts-v2-guard/check-design-drift.sh
# Exit:   0 = clean, 1 = drift found, 2 = could not run

set -u

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCAN_ROOT="$REPO_ROOT/v2/apps/web/src"

if [ ! -d "$SCAN_ROOT" ]; then
  echo "check-design-drift: cannot find $SCAN_ROOT" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Allowlist. One entry per line: <path-substring>|<offending-text-substring>
# A hit is suppressed when its file path AND its line content both match.
# Line numbers are deliberately NOT used - they churn on every edit.
# ---------------------------------------------------------------------------
ALLOWLIST=$(cat <<'ALLOW'
components/layout/mobile-nav.tsx|bg-primary font-button text-primary-foreground
app/(booking)/reviews/page.tsx|fill-[#00b67a] text-[#00b67a]
components/cards/readiness-card.tsx|bg-[#e1e3df]
components/sections/contact-map-section.tsx|bg-[linear-gradient(135deg,#3a4f6b,#1a2638)]
components/sections/real-stories-section.tsx|bg-[linear-gradient(135deg,#c8a07a,#8b6342)]
ALLOW
)

# ---------------------------------------------------------------------------
TMPDIR_GUARD=$(mktemp -d) || exit 2
trap 'rm -rf "$TMPDIR_GUARD"' EXIT
HITS="$TMPDIR_GUARD/hits"
: > "$HITS"

# Collect the files in scope once: .ts/.tsx under src, minus components/ui and
# minus the generated Supabase types.
FILES="$TMPDIR_GUARD/files"
find "$SCAN_ROOT" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  | grep -v '/components/ui/' \
  | grep -v '/integrations/supabase/types\.ts$' \
  | sort > "$FILES"

if [ ! -s "$FILES" ]; then
  echo "check-design-drift: no files in scope under $SCAN_ROOT" >&2
  exit 2
fi

# scan <rule-label> <extended-regex>
scan() {
  rule=$1
  pattern=$2
  # xargs -r keeps us safe if the file list is ever empty.
  xargs -r grep -nE "$pattern" < "$FILES" 2>/dev/null \
    | while IFS= read -r line; do
        printf '%s\t%s\n' "$rule" "$line"
      done >> "$HITS"
}

# Every alias below resolves to --main-primary (#6366f1) or its #e0e7ff tint:
#   primary, primary-subtle, on-surface-primary, accent, ring.
scan 'indigo token' \
  '(^|[^a-zA-Z0-9_-])(bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|divide|caret)-(primary|accent|ring)([^a-zA-Z0-9_-]|$)|primary-foreground|primary-subtle|accent-foreground|on-surface-primary'

scan 'font-serif' \
  '(^|[^a-zA-Z0-9_-])font-serif([^a-zA-Z0-9_-]|$)'

scan 'dark: utility' \
  'dark:[a-z[]'

scan 'hardcoded hex in class' \
  '[a-z][a-z0-9]*(-[a-z0-9]+)*-\[[^]]*#[0-9a-fA-F]{3}'

# ---------------------------------------------------------------------------
# Filter out allowlisted hits, print the rest.
# ---------------------------------------------------------------------------
ALLOW_USED="$TMPDIR_GUARD/allow_used"
: > "$ALLOW_USED"

while IFS= read -r hit; do
  [ -n "$hit" ] || continue

  rule=${hit%%	*}
  location=${hit#*	}
  file=${location%%:*}
  rest=${location#*:}
  lineno=${rest%%:*}
  content=${rest#*:}

  # Path relative to repo root, for readable output.
  relfile=${file#"$REPO_ROOT"/}

  suppressed=0
  # shellcheck disable=SC2030
  echo "$ALLOWLIST" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    a_path=${entry%%|*}
    a_text=${entry#*|}
    case "$relfile" in
      *"$a_path"*)
        case "$content" in
          *"$a_text"*) echo "$entry" >> "$ALLOW_USED"; exit 42 ;;
        esac
        ;;
    esac
  done
  [ $? -eq 42 ] && suppressed=1

  if [ "$suppressed" -eq 0 ]; then
    printf '%s:%s\n    [%s] %s\n' "$relfile" "$lineno" "$rule" \
      "$(printf '%s' "$content" | sed 's/^[[:space:]]*//' | cut -c1-140)"
  fi
done < "$HITS" > "$TMPDIR_GUARD/report"

# grep -c prints "0" and exits 1 when it matches nothing; `|| true` keeps the
# substitution to that single "0" instead of appending a second one.
REPORTED=$(grep -c '^v2/' "$TMPDIR_GUARD/report" 2>/dev/null || true)
[ -n "$REPORTED" ] || REPORTED=0

echo "check-design-drift — scanned $(wc -l < "$FILES" | tr -d ' ') file(s) under v2/apps/web/src (components/ui excluded)"

if [ "$REPORTED" -gt 0 ]; then
  echo
  echo "DESIGN DRIFT — $REPORTED offender(s):"
  echo
  cat "$TMPDIR_GUARD/report"
  echo
  echo "See v2/apps/web/src/lib/design-tokens.md for the tokens to use instead."
  echo "If a hit is genuinely unavoidable, add it to ALLOWLIST at the top of"
  echo "$0 with a reason in the commit message."
  exit 1
fi

SUPPRESSED=$(sort -u "$ALLOW_USED" 2>/dev/null | wc -l | tr -d ' ')
[ -n "$SUPPRESSED" ] || SUPPRESSED=0
echo "OK — no new design drift. ($SUPPRESSED pre-existing violation(s) allowlisted.)"
exit 0
