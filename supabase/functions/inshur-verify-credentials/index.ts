// INSHUR / ABI credential smoke test for the Settings panel.
//
// Two things make this more than a wrapper around verifyInshurCredentials():
//
//   1. It verifies the credentials it is HANDED, not the ones on the tenant row.
//      The panel tests before it saves, and the slot being saved is often not
//      the mode the tenant is currently running in — a tenant in `mock` pasting
//      their first live credentials would otherwise have those credentials
//      "verified" against the simulator, which passes for literally any input.
//
//   2. It resolves the states-allowed path. Our 2026-05-23 discovery document
//      and the current ABI API reference disagree about where that endpoint
//      lives, and covered-states is a blocking go-live gate — so a wrong guess
//      would lock go-live permanently with no way out from the UI. This probes
//      both candidates and records the winner in tenants.inshur_endpoint_overrides,
//      making the fix a Settings edit rather than a redeploy.
//
// Verification never persists credentials. It does persist the states list,
// which is a cache rather than a secret and is the one thing the go-live
// preflight cannot proceed without.

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  createServiceClient,
  getInshurApiUrl,
  getStatesAllowed,
  InshurError,
  InshurConfig,
  InshurMode,
  TwoFactorRequiredError,
} from '../_shared/inshur-client.ts';
import { authorizeTenantAccess } from '../_shared/tenant-auth.ts';

/**
 * Candidate paths for GET states-allowed, in the order they are tried.
 * [0] is what the current ABI API reference documents and what inshur-client.ts
 * uses everywhere else; [1] is what docs/INSHUR.html recorded on 2026-05-23.
 * `{CN}` and `{PN}` are substituted with the customer and policy numbers.
 */
const STATES_PATH_CANDIDATES = [
  '/customer/{CN}/policy/{PN}/period-zero/states-allowed/',
  '/period-z/states-allowed/',
];

const REQUEST_TIMEOUT_MS = 20_000;

/** Only these roles may exercise ABI credentials — this is the credentials panel. */
const CREDENTIAL_ROLES = ['head_admin', 'admin'];

interface VerifyBody {
  tenant_id?: string;
  tenantId?: string;
  mode?: string;
  username?: string;
  password?: string;
  customerNumber?: string;
  customer_number?: string;
  policyNumber?: string;
  policy_number?: string;
  twoFactorToken?: string;
}

function normalizeMode(raw: unknown): InshurMode | null {
  if (raw === 'mock' || raw === 'test' || raw === 'live') return raw;
  return null;
}

function renderPath(template: string, config: InshurConfig): string {
  const path = template
    .replace(/\{CN\}/g, encodeURIComponent(config.customerNumber))
    .replace(/\{PN\}/g, encodeURIComponent(config.policyNumber));
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * The response shape of states-allowed is undocumented — the two sources we
 * have disagree even about its URL — so accept anything array-shaped: a bare
 * array of codes, an object wrapping one, or objects carrying a code field.
 */
function extractStates(result: unknown): string[] {
  let raw: unknown[] | undefined;
  if (Array.isArray(result)) {
    raw = result;
  } else if (result && typeof result === 'object') {
    raw = Object.values(result as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined;
  }

  const codes: string[] = [];
  for (const item of raw ?? []) {
    let code: string | null = null;
    if (typeof item === 'string') {
      code = item;
    } else if (item && typeof item === 'object') {
      const match = Object.values(item as Record<string, unknown>).find(
        (v) => typeof v === 'string' && /^[A-Za-z]{2}$/.test(v)
      );
      code = typeof match === 'string' ? match : null;
    }
    const upper = (code || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(upper) && !codes.includes(upper)) codes.push(upper);
  }
  return codes;
}

/**
 * Raw ABI GET, mirroring _shared/inshur-client.ts's transport conventions.
 *
 * It is duplicated here rather than reused because the client deliberately
 * hardcodes one path per operation, and probing more than one path is this
 * function's entire reason for existing.
 */
async function abiGetStates(config: InshurConfig, path: string): Promise<string[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
  };
  if (config.twoFactorToken) headers['Token'] = config.twoFactorToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    console.log(`[INSHUR verify] GET ${path} (mode: ${config.mode})`);
    response = await fetch(`${getInshurApiUrl(config.mode as Exclude<InshurMode, 'mock'>)}${path}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new InshurError('INSHUR_TIMEOUT', `INSHUR did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`, 504);
    }
    throw new InshurError('INSHUR_NETWORK', `Could not reach INSHUR: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    const text = await response.text().catch(() => '');
    if (/2\s*factor|two\s*factor|token/i.test(text)) throw new TwoFactorRequiredError();
    throw new InshurError('INSHUR_AUTH_FAILED', 'INSHUR rejected these credentials.', 401);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InshurError(
      'INSHUR_BAD_RESPONSE',
      `INSHUR returned a non-JSON response (HTTP ${response.status}).`,
      response.status || 502
    );
  }

  const env = payload as { STATUS?: string; RESULT?: unknown; ERROR?: string };
  if (!response.ok || env?.STATUS !== 'success') {
    throw new InshurError(
      'INSHUR_REQUEST_FAILED',
      env?.ERROR || `INSHUR rejected the request (HTTP ${response.status}).`,
      response.status || 400
    );
  }

  return extractStates(env.RESULT);
}

/**
 * A failure that could plausibly mean "wrong URL" rather than "wrong
 * credentials". Only these justify spending a second request on the alternate
 * path; retrying an auth rejection would just walk the account towards a
 * lockout, and retrying a timeout would double the operator's wait.
 */
function looksLikeWrongPath(err: InshurError): boolean {
  if (err.code === 'INSHUR_BAD_RESPONSE') return true;
  return err.code === 'INSHUR_REQUEST_FAILED' && [400, 404, 405, 501].includes(err.status);
}

interface StatesOutcome {
  states: string[];
  pathUsed: string | null;
  /** True when the winning path came from probing rather than a stored override. */
  autoResolved: boolean;
}

async function resolveStates(
  config: InshurConfig,
  storedOverride: { path: string | null; source: string | null }
): Promise<StatesOutcome> {
  if (config.mode === 'mock') {
    return { states: await getStatesAllowed(config), pathUsed: null, autoResolved: false };
  }

  // An operator-entered override is an instruction, not a hint: use it and do
  // not silently second-guess it by probing something else.
  if (storedOverride.path && storedOverride.source !== 'auto') {
    return {
      states: await abiGetStates(config, renderPath(storedOverride.path, config)),
      pathUsed: storedOverride.path,
      autoResolved: false,
    };
  }

  const candidates = storedOverride.path
    ? [storedOverride.path, ...STATES_PATH_CANDIDATES.filter((p) => p !== storedOverride.path)]
    : [...STATES_PATH_CANDIDATES];

  let lastError: InshurError | null = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      const states = await abiGetStates(config, renderPath(candidates[i], config));
      return { states, pathUsed: candidates[i], autoResolved: true };
    } catch (err) {
      const e = err as InshurError;
      lastError = e;
      const isLast = i === candidates.length - 1;
      if (isLast || !looksLikeWrongPath(e)) throw e;
      console.log(`[INSHUR verify] states path ${candidates[i]} failed (${e.code}) — trying the alternate`);
    }
  }

  throw lastError ?? new InshurError('INSHUR_BAD_RESPONSE', 'Could not read the covered states list.', 502);
}

/** Machine-readable code for the Settings panel to key its message off. */
function verdictCode(err: InshurError): string {
  switch (err.code) {
    case 'INSHUR_2FA_REQUIRED':
      return 'twofactor_required';
    case 'INSHUR_AUTH_FAILED':
      return 'bad_credentials';
    case 'INSHUR_TIMEOUT':
    case 'INSHUR_NETWORK':
      return 'network';
    case 'INSHUR_NOT_CONFIGURED':
      return 'missing_fields';
    case 'INSHUR_REQUEST_FAILED':
    case 'INSHUR_BAD_RESPONSE':
    default:
      return 'unknown';
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Read once, up front: this is reported even on the failure paths, because
  // the go-live preflight blocks on it and must be able to see it whatever
  // else went wrong. Without the fence a tenant can be flipped to live and
  // then have every single bind throw.
  const runtimeAllowsLive = Deno.env.get('INSHUR_ALLOW_LIVE') === 'true';

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization header', 401);

    const supabase = createServiceClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) return errorResponse('Unauthorized', 401);

    let body: VerifyBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body');
    }

    const tenantId = (body.tenant_id || body.tenantId || '').trim();
    if (!tenantId) return errorResponse('tenant_id is required');

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    if (!access.appUser.is_super_admin) {
      const { data: staff } = await supabase
        .from('app_users')
        .select('role')
        .eq('id', access.appUser.id)
        .maybeSingle();
      if (!CREDENTIAL_ROLES.includes(staff?.role ?? '')) {
        return errorResponse('Only an owner or admin can test INSHUR credentials', 403);
      }
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(
        'inshur_mode, inshur_username, inshur_password, inshur_customer_number, inshur_policy_number, inshur_2fa_token, inshur_endpoint_overrides'
      )
      .eq('id', tenantId)
      .single();

    if (tenantError || !tenant) return errorResponse('Could not read tenant settings', 404);

    // Read the columns directly rather than via getInshurConfig: that helper
    // throws when a field is blank, and here a blank field is legitimately
    // filled in by the inline value being tested.
    const requestedMode = body.mode
      ? normalizeMode(body.mode)
      : normalizeMode(tenant.inshur_mode) ?? 'mock';
    if (!requestedMode) return errorResponse('mode must be one of mock, test or live');

    const envelope = (extra: Record<string, unknown>) =>
      jsonResponse({
        ok: false,
        mode: requestedMode,
        states: [],
        twoFactorRequired: false,
        runtimeAllowsLive,
        error: null,
        code: null,
        simulated: requestedMode === 'mock',
        statesPath: null,
        statesSyncedAt: null,
        persisted: false,
        ...extra,
      });

    // Every verification OUTCOME is HTTP 200 with ok:false — an invalid
    // credential is the answer to the question asked, not a transport failure,
    // and supabase-js buries a non-2xx body inside FunctionsHttpError where
    // the panel cannot render mode/runtimeAllowsLive alongside the message.
    // Only auth, authorization and malformed requests get real error statuses.

    if (requestedMode === 'live' && !runtimeAllowsLive) {
      return envelope({
        code: 'live_not_permitted',
        error:
          'This environment is not permitted to write live INSHUR cover. Live mode is enabled on production only.',
      });
    }

    // Inline value wins; a blank one falls back to what is stored. The panel
    // omits the password once it is saved, and a blank string is never a
    // credential worth testing, so blank and absent mean the same thing here.
    // Trimmed for the reason bonzah-client.ts documents: one pasted leading
    // space silently breaks every subsequent auth.
    const pick = (...values: Array<string | null | undefined>) =>
      values.map((v) => (v ?? '').trim()).find(Boolean) ?? '';

    const username = pick(body.username, tenant.inshur_username);
    const password = pick(body.password, tenant.inshur_password);
    const customerNumber = pick(body.customerNumber, body.customer_number, tenant.inshur_customer_number);
    const policyNumber = pick(body.policyNumber, body.policy_number, tenant.inshur_policy_number);
    const twoFactorToken = pick(body.twoFactorToken, tenant.inshur_2fa_token) || null;

    if (requestedMode !== 'mock') {
      const missing: string[] = [];
      if (!username) missing.push('username');
      if (!password) missing.push('password');
      if (!customerNumber) missing.push('customer number');
      if (!policyNumber) missing.push('policy number');
      if (missing.length) {
        return envelope({
          code: 'missing_fields',
          error: `Missing ${missing.join(', ')}. Fill in all four values before testing the connection.`,
        });
      }
    }

    const config: InshurConfig = {
      mode: requestedMode,
      username: requestedMode === 'mock' ? 'mock@drive-247.local' : username,
      password: requestedMode === 'mock' ? 'mock' : password,
      customerNumber: customerNumber || 'MOCK-CUST-0001',
      policyNumber: policyNumber || 'MOCK-POL-0001',
      twoFactorToken: requestedMode === 'mock' ? null : twoFactorToken,
    };

    const overridesRaw = (tenant.inshur_endpoint_overrides ?? {}) as Record<string, unknown>;
    const storedOverride = {
      path: typeof overridesRaw.states_allowed_path === 'string' ? overridesRaw.states_allowed_path : null,
      source:
        typeof overridesRaw.states_allowed_path_source === 'string'
          ? overridesRaw.states_allowed_path_source
          : null,
    };

    let outcome: StatesOutcome;
    try {
      outcome = await resolveStates(config, storedOverride);
    } catch (err) {
      const e = err as InshurError;
      const code = verdictCode(e);
      console.log(`[INSHUR verify] tenant ${tenantId} mode ${requestedMode} failed: ${e.code}`);
      return envelope({
        code,
        error: e?.message || 'Verification failed.',
        twoFactorRequired: code === 'twofactor_required',
      });
    }

    const syncedAt = new Date().toISOString();

    // Persisting the states list is not persisting a credential. It is the
    // cache the booking side reads to reject an out-of-area rental without a
    // round trip, and the go-live preflight cannot clear without it.
    let persisted = true;
    const patch: Record<string, unknown> = {
      inshur_states_allowed: outcome.states,
      inshur_states_synced_at: syncedAt,
    };
    if (outcome.autoResolved && outcome.pathUsed && outcome.pathUsed !== storedOverride.path) {
      patch.inshur_endpoint_overrides = {
        ...overridesRaw,
        states_allowed_path: outcome.pathUsed,
        states_allowed_path_source: 'auto',
        states_allowed_path_resolved_at: syncedAt,
      };
    }

    const { error: updateError } = await supabase.from('tenants').update(patch).eq('id', tenantId);
    if (updateError) {
      // The credentials are good; only the cache write failed. Say so rather
      // than reporting a verification failure the operator cannot act on.
      persisted = false;
      console.error('[INSHUR verify] could not persist states:', updateError.message);
    }

    console.log(
      `[INSHUR verify] tenant ${tenantId} mode ${requestedMode} ok — ${outcome.states.length} states, path ${outcome.pathUsed ?? 'simulated'}`
    );

    return jsonResponse({
      ok: true,
      mode: requestedMode,
      states: outcome.states,
      twoFactorRequired: false,
      runtimeAllowsLive,
      error: null,
      code: null,
      simulated: requestedMode === 'mock',
      statesPath: outcome.pathUsed,
      statesSyncedAt: persisted ? syncedAt : null,
      persisted,
    });
  } catch (error) {
    console.error('[INSHUR verify] Unexpected error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to verify INSHUR credentials',
      500
    );
  }
});
