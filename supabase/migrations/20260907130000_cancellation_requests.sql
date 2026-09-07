-- Subscription cancellation requests, on the queue that already exists.
--
-- The Billing page has no destructive "Cancel subscription" button by decision:
-- a tenant asks, and a person answers. Previously the customer-facing text was
-- a mailto: link — a dead end, with nothing recorded and nobody alerted.
--
-- A cancellation is now a row in `go_live_requests` with
-- integration_type = 'subscription_cancellation' and the reason in `note`.
-- That table is already a generic tenant -> platform request queue (tenant,
-- requester, free-text type with NO check constraint, note, pending/approved/
-- rejected, RLS enabled) and the super admin dashboard at /admin/requests
-- already renders it with tenant name and requester email. A second table would
-- have meant a second admin page and a second policy set for a row shape that
-- already exists.
--
-- The only schema change needed is send-once tracking for the internal email.
alter table public.go_live_requests
  add column if not exists notified_at timestamptz;

comment on column public.go_live_requests.notified_at is
  'When the internal team was emailed about this request. Set by notify-cancellation-request so a retry cannot re-mail the list; left null when every send failed, so a retry can still reach the team.';
