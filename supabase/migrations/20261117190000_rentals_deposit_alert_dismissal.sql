-- Lets staff permanently dismiss the "deposit never taken / not secured" alert for one rental.
-- The dismissal records the deposit hold status it was made against; if that status changes,
-- the alert comes back. Applied live via the Management API on 2026-11-17.
alter table public.rentals
  add column if not exists deposit_alert_dismissed_at timestamptz,
  add column if not exists deposit_alert_dismissed_by uuid references public.app_users(id) on delete set null,
  add column if not exists deposit_alert_dismissed_status text;

comment on column public.rentals.deposit_alert_dismissed_status is
  'deposit_hold_status (or ''none'' for NULL) at the moment the deposit alert was dismissed; the alert returns when it differs.';
