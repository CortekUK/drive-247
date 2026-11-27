-- APPLIED to staging and production 2026-11-27.
--
-- Signups tab follow-up tags, part 2 (sales team, 2026-11-27): after the call
-- tags, the team also tracks how far a signup got with onboarding:
--   Completed sign up · Onboarding – Completed · Onboarding – Scheduled ·
--   Onboarding – Not reachable
-- Only the allowed values change; no row is touched.

alter table public.signup_followups drop constraint if exists signup_followups_status_check;

alter table public.signup_followups add constraint signup_followups_status_check check (status in (
  'interested', 'undecided', 'not_interested', 'not_reachable',
  'completed_signup', 'onboarding_completed', 'onboarding_scheduled', 'onboarding_not_reachable'
));
