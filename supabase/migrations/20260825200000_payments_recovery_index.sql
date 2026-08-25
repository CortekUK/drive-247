-- R-06 — index the every-minute Stripe recovery scan.
--
-- WHAT WAS WRONG
--
-- `recover-pending-stripe-payments` is pg_cron jobid 34 and runs `* * * * *`.
-- Both of its passes filter on `stripe_checkout_session_id IS NOT NULL`, and
-- there is NO index on that column — verified: zero matching rows in pg_indexes.
-- 907 of 1,026 payments carry a value, so every pass is a sequential scan of the
-- whole table, sixty times an hour, forever.
--
-- That was survivable while the table was small and every row was Stripe. It
-- becomes the starvation mechanism the risk register describes once Square rows
-- share the table: the scan is bounded by LIMIT 100, so unresolvable rows can
-- occupy the window and genuine Stripe recoveries silently stop happening. The
-- per-row try/catch in that function prevents an abort, but not starvation.
--
-- WHAT THIS DOES, AND HONESTLY WHAT IT DOES NOT
--
-- Partial indexes matching each pass's predicate, so the planner can find the
-- candidate rows instead of reading every payment. This is an improvement over a
-- sequential scan. It is NOT a claim of plan parity with anything, and it does
-- not change which rows the cron selects — only how fast it finds them.
--
-- The provider column is included because the fence added alongside this work
-- (`.eq('payment_provider','stripe')` on both passes) is now part of both
-- predicates, and an index that omits it would stop being usable the moment a
-- Square row exists.
--
-- SAFETY
-- Additive. No CONCURRENTLY: at 1,026 rows the build is milliseconds and the
-- brief lock is far cheaper than the transaction-splitting CONCURRENTLY requires.
-- Re-runnable via IF NOT EXISTS.

BEGIN;

-- Pass 1: Pending Stripe payments with a checkout session, newest first.
CREATE INDEX IF NOT EXISTS idx_payments_pending_stripe_recovery
  ON public.payments (created_at DESC)
  WHERE status = 'Pending'
    AND payment_provider = 'stripe'
    AND stripe_checkout_session_id IS NOT NULL;

-- Pass 2: captured 'Credit' rows stranded against a rental that still owes.
CREATE INDEX IF NOT EXISTS idx_payments_stranded_credit_recovery
  ON public.payments (created_at DESC)
  WHERE status = 'Credit'
    AND payment_provider = 'stripe'
    AND stripe_checkout_session_id IS NOT NULL;

COMMIT;

-- Verification:
--   EXPLAIN SELECT id FROM payments
--    WHERE status='Pending' AND payment_provider='stripe'
--      AND stripe_checkout_session_id IS NOT NULL
--      AND created_at >= now() - interval '24 hours'
--    ORDER BY created_at DESC LIMIT 100;
-- Expect an Index Scan on idx_payments_pending_stripe_recovery rather than a
-- Seq Scan on payments.
