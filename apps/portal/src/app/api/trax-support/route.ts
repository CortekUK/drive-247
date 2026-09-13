import { createClient } from '@supabase/supabase-js';
import { handleSupportRequest } from '../../../../../../supabase/functions/trax-support/support/handler';
import { createSupportReads, type SupportDatabase } from '../../../../../../supabase/functions/trax-support/support/reads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Local V2 entry point. Authorization and guidance use the same code as the
 * edge function; development never supplies a fake user or bypasses permissions.
 * Production continues to use the reviewed, separately deployed edge endpoint.
 */
export async function POST(request: Request): Promise<Response> {
  const fail = (code: string, error: string, status: number) => Response.json({ code, error }, {
    status, headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' },
  });
  if (process.env.NODE_ENV !== 'development') return fail('not_found', 'Not found.', 404);
  if (!/^Bearer \S+$/.test(request.headers.get('Authorization') ?? '')) {
    return fail('unauthorized', 'Sign in to use TRAX.', 401);
  }
  // Use the same project as browser sign-in. No unrelated URL or anon-key fallback.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) {
    return fail('local_configuration_required', 'Local TRAX needs server configuration. Follow docs/trax/local-testing.md, then restart the portal.', 503);
  }
  try {
    const signal = AbortSignal.timeout(8_000);
    const db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
    });
    // Narrow the SDK at the adapter boundary; recursively comparing its generic
    // query builders exceeds TypeScript's depth limit. No client reaches a tool.
    const response = await handleSupportRequest(request, { reads: createSupportReads(db as unknown as SupportDatabase), signingSecret: secret });
    response.headers.set('X-TRAX-Runtime', 'local-development');
    return response;
  } catch {
    return fail('service_unavailable', 'Local TRAX could not verify access. Check the server configuration and connection.', 503);
  }
}
