/**
 * Gate for internal-only functions (ops tools, diagnostics, server-to-server
 * senders).
 *
 * WHY: these functions sit at the gateway default `verify_jwt = true`, and that
 * default is satisfied by the PUBLIC ANON KEY that ships in every app bundle —
 * and by any renter's session, because staff and customers share one Supabase
 * auth project. Until 2026-10-19 send-tenant-sms, diag-twilio-a2p,
 * diag-twilio-voice and ops-twilio-repoint-sms read nothing from the
 * Authorization header, so anyone with the anon key could text from any
 * tenant's number, read a tenant's Twilio account data, or repoint its SMS
 * webhook.
 *
 * Accepted callers:
 *   - the service-role key (another edge function, or an operator's script);
 *   - when `allowSuperAdmin`, a signed-in, active super admin.
 * Everything else, including every failure while checking, is refused.
 */

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

export interface InternalAuthOptions {
  allowSuperAdmin?: boolean;
}

function deny(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export function bearerOf(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

export function isServiceRoleBearer(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const bearer = bearerOf(req);
  return key.length > 0 && bearer.length === key.length && bearer === key;
}

/** Returns null when the caller may proceed, otherwise the Response to send. */
export async function requireInternalCaller(
  req: Request,
  supabase: ServiceClient,
  opts: InternalAuthOptions = {},
): Promise<Response | null> {
  if (isServiceRoleBearer(req)) return null;
  if (!opts.allowSuperAdmin) return deny(403, 'Forbidden');

  const bearer = bearerOf(req);
  if (!bearer) return deny(401, 'Missing authorization');
  try {
    const { data: { user }, error } = await supabase.auth.getUser(bearer);
    if (error || !user) return deny(401, 'Unauthorized');
    const { data: appUser, error: lookupError } = await supabase
      .from('app_users')
      .select('is_super_admin, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (lookupError) return deny(500, 'Could not verify access');
    if (!appUser?.is_super_admin || appUser.is_active === false) return deny(403, 'Forbidden');
    return null;
  } catch {
    return deny(500, 'Could not verify access');
  }
}
