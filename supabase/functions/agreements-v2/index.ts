// agreements-v2 — individual agreements from the v2 Agreements tab: send (with
// the PDF the browser drew), readiness, status sync and document view. All the
// logic lives in core.ts (pure, tested by tests/integrations/agreements-v2);
// this file only builds the service-role client and hands in fetch and the
// environment.
//
// verify_jwt stays ON (not listed in supabase/config.toml): the gateway admits
// only a JWT, and core.ts then requires that JWT to be a signed-in staff user.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { handleAgreementsV2 } from './core.ts';
import type { DbClient } from './auth.ts';

const env = (key: string): string | undefined => Deno.env.get(key) ?? undefined;

const respond = (body: unknown, status: number): Response => {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    console.error('[agreements-v2] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    return respond({ ok: false, error: "Sending agreements isn't set up yet." }, 503);
  }

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;

  try {
    const outcome = await handleAgreementsV2(req, {
      client: client as unknown as DbClient,
      fetch: (input, init) => fetch(input, init),
      env,
      waitUntil: (promise) => runtime?.waitUntil?.(promise),
    });
    return respond(outcome.body, outcome.status);
  } catch (e) {
    console.error('[agreements-v2] unhandled error:', e);
    return respond({ ok: false, error: 'Something went wrong. Try again.' }, 500);
  }
});
