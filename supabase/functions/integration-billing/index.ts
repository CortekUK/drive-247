// integration-billing — premium integrations on the platform bill: subscribe,
// the next invoice and a past invoice line by line, and a super admin's cancel.
// All the logic lives in core.ts (pure, tested by
// tests/integrations/integration-billing); this file only builds the
// service-role client and the Stripe client for the tenant's platform account.
//
// verify_jwt stays ON (not listed in supabase/config.toml): the gateway admits
// only a JWT, and core.ts then requires that JWT to be a signed-in staff user.
//
// The Stripe clients come from _shared/subscription-stripe.ts — the SAME
// account and mode resolution every other subscription function uses —
// imported, never edited.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  getSubscriptionStripeClientForAccount,
  getSubscriptionStripeMode,
} from '../_shared/subscription-stripe.ts';
import { handleIntegrationBilling, type StripeLike } from './core.ts';
import type { DbClient } from './auth.ts';

const respond = (body: unknown, status: number): Response => {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('[integration-billing] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return respond({ ok: false, error: 'Premium integrations are not set up yet. Nothing was charged.', code: 'not_set_up' }, 503);
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const outcome = await handleIntegrationBilling(req, {
      db: client as unknown as DbClient,
      stripeFor: (account, mode) => getSubscriptionStripeClientForAccount(account, mode) as unknown as StripeLike,
      subscriptionMode: (tenantId) => getSubscriptionStripeMode(client, tenantId),
      now: () => new Date(),
    });
    return respond(outcome.body, outcome.status);
  } catch (e) {
    console.error('[integration-billing] unhandled error:', e);
    return respond({ ok: false, error: 'Something went wrong. Nothing was charged. Try again.' }, 500);
  }
});
