#!/usr/bin/env bash
#
# Deploy the GMT chained-deposit-hold work.
#
#   ./scripts/deploy-gmt-deposit-holds.sh
#
# Requires SUPABASE_ACCESS_TOKEN in the environment (or a logged-in `supabase` CLI).
#
# ---------------------------------------------------------------------------
# STATE BEFORE YOU RUN THIS (all already done):
#   * Schema applied to prod: 32 deposit_hold_* / disclosed_hold_* columns on
#     rentals, widened status CHECK (11 values), 2 partial indexes, and 3 new
#     tables (deposit_hold_links, cron_runs, rental_card_mandates) each with RLS
#     enabled and a policy.
#   * pg_cron jobid 57 (refresh-deposit-holds) NOW SENDS x-platform-secret.
#   * pg_cron jobid 63 (reconcile-deposit-holds, "0 */6 * * *") SCHEDULED and
#     also sends x-platform-secret.
#   * All code is committed on main.
#
# WHY THE ORDER MATTERS
#   The cron headers were updated BEFORE deploy on purpose. The functions now
#   REQUIRE either x-platform-secret or a super-admin JWT, and they deliberately
#   no longer accept the service_role bearer (a valid prod service_role JWT is
#   committed in plaintext at
#   supabase/migrations/20260520170000_schedule_tesla_sync_cron.sql:14 and is
#   pending rotation).
#
#   Deploying the auth check BEFORE updating the cron header would have made the
#   nightly refresh 401 — and because net.http_post is asynchronous, that 401
#   lands in net._http_response, NOT cron.job_run_details. The job would report
#   'succeeded' forever while nothing actually refreshed. That is the exact
#   silent-failure mode this whole project exists to eliminate.
#
#   The safety net (verify-deposit-hold, reconcile-deposit-holds) deploys FIRST,
#   so if you stop half way the system is MORE reconciled, not less.
#
# URGENT: reconcile-deposit-holds is already scheduled but not yet deployed.
#   Until this script runs, that cron POSTs to a function that does not exist and
#   gets a 404. Harmless, but it means nothing is reconciling yet.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/.."

REF=hviqoaokxvlancmftwuo

FUNCS=(
  # 1. Safety net + operator escape hatch. verify-deposit-hold is the one that
  #    fixes GMT's reported "I cannot refresh the hold" dead end.
  verify-deposit-hold
  reconcile-deposit-holds

  # 2. Webhook guards: a cancelled deposit hold must never cancel a rental, and
  #    a hold checkout must never be booked as captured revenue.
  stripe-webhook-live
  stripe-webhook-test
  stripe-webhook

  # 3. The chain engine.
  refresh-deposit-holds
  sandbox-refresh-deposit-holds

  # 4. Paths that create or move authorizations (now behind the shared guard).
  place-deposit-hold
  create-hold-checkout
  capture-deposit-hold
  release-deposit-hold
  deduct-from-deposit
  sync-deposit-hold

  # 5. Supporting.
  charge-saved-card
  backfill-deposit-holds
  create-preauth-checkout
  check-migration-readiness
)

FAILED=()
for f in "${FUNCS[@]}"; do
  if [ ! -f "supabase/functions/$f/index.ts" ]; then
    echo "SKIP  $f (missing)"
    continue
  fi
  echo "=== deploying $f ==="
  if supabase functions deploy "$f" --project-ref "$REF"; then
    echo "  ok   $f"
  else
    echo "  FAIL $f"
    FAILED+=("$f")
  fi
done

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "ALL DEPLOYED"
else
  echo "FAILED: ${FAILED[*]}"
  exit 1
fi

cat <<'EOF'

---------------------------------------------------------------------------
VERIFY IMMEDIATELY AFTER DEPLOY
---------------------------------------------------------------------------
1. Confirm the refresh cron still authenticates. Run in the SQL editor:

     select cron.schedule('deposit-cron-smoke', '* * * * *',
       'SELECT net.http_post(
          url := ''https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/reconcile-deposit-holds'',
          headers := jsonb_build_object(''Content-Type'',''application/json'',
            ''x-platform-secret'',''022289f7ff784704bb31d7ed20a9f5173dca32abcdca4bf6b4c2c2270a32c82e''),
          body := ''{"dryRun": true}''::jsonb);');

   wait ~90s, then:

     select status_code, left(content,200) from net._http_response
      order by created desc limit 3;

   You want 200. A 401 means the secret path is broken — unschedule the smoke
   job and DO NOT leave the auth check deployed:

     select cron.unschedule('deposit-cron-smoke');

   NOTE: check net._http_response, NOT cron.job_run_details. pg_cron reports
   'succeeded' as soon as it dispatches, regardless of the HTTP status.

2. Run the backfill in DRY RUN first, scoped to GMT:

     supabase functions invoke backfill-deposit-holds \
       --project-ref hviqoaokxvlancmftwuo \
       --body '{"dryRun": true, "tenantId": "ada84c6f-eb17-43b6-a14d-d16518165349"}'

   Read the cohort counts before running it for real. On prod as of 2026-08-09,
   GMT had 10 Active rentals: 2 held, 1 expired on a LIVE rental, 6 with a NULL
   status (4 of those carrying a stale expiry = failed placements), 1 released.

3. Work through docs/GMT_GATE0_TEST_PLAN.md in Stripe TEST mode. This is the
   step no agent could do: force an authorization to expire and watch the chain
   recover. Nothing here is proven working until that passes.
EOF
