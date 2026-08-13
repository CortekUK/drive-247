-- Finance Sync — widen the OAuth nonce window from 10 to 30 minutes.
--
-- 10 minutes assumed the operator goes straight through the provider's screens.
-- In practice the round-trip can include signing in to the provider, clearing
-- 2FA, and picking an organisation — and if anything needs correcting in the
-- provider's console mid-flow (a redirect URI, say) the window is gone. Two
-- consecutive production attempts died as `state_expired` after the operator
-- had already granted consent, which is the worst place to fail: the grant is
-- spent and nothing is saved.
--
-- 30 minutes is still conservative for this nonce. It is single-use, bound to
-- one tenant and provider, deleted the moment it is redeemed, and reaped hourly
-- by accounting_oauth_state_reap. Widening it does not widen what an attacker
-- could do with one — they would still need the unguessable nonce itself.
ALTER TABLE public.accounting_oauth_state
  ALTER COLUMN expires_at SET DEFAULT now() + interval '30 minutes';

COMMENT ON COLUMN public.accounting_oauth_state.expires_at IS
  'Single-use nonce TTL, 30 minutes. Was 10, which expired mid-consent in production when the operator had to sign in or fix provider console settings during the round-trip.';
