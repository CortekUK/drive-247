// Bonzah Insurance API Client
// Handles authentication, token caching, and API calls to Bonzah

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

// Token cache with expiry (global env-based, backward compat)
let cachedToken: { token: string; expiresAt: number } | null = null;

// Per-tenant token cache keyed by username
const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

// API base URL - note: /api/v1 is the API path, /bb1 is the portal
const BONZAH_API_URL = Deno.env.get('BONZAH_API_URL') || 'https://bonzah.sb.insillion.com/api/v1';
const BONZAH_USERNAME = Deno.env.get('BONZAH_USERNAME') || '';
const BONZAH_PASSWORD = Deno.env.get('BONZAH_PASSWORD') || '';

// Token TTL (15 minutes, with 1 minute buffer)
const TOKEN_TTL_MS = 14 * 60 * 1000;

/**
 * Get the Bonzah API URL for a given mode
 */
export function getBonzahApiUrl(mode: 'test' | 'live'): string {
  return mode === 'live'
    ? 'https://bonzah.insillion.com/api/v1'
    : 'https://bonzah.sb.insillion.com/api/v1';
}

// Minutes of headroom between "now" and a same-day trip_start_date. Quote to
// payment is near-instant in production (p98 3 min over 31 policies, Oct 2026),
// and confirm-payment re-quotes once if Bonzah still calls the start stale.
const SAME_DAY_START_BUFFER_MIN = 15;

function zonedParts(at: Date, timeZone = 'America/New_York'): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at).map((x) => [x.type, x.value])
  );
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}:00` };
}

/**
 * The trip start to send Bonzah for a coverage window that should begin on
 * `requestedStart` (YYYY-MM-DD).
 *
 * Bonzah DOES sell same-day cover. It validates trip_start_date against the
 * current US Eastern wall clock, ignoring policy_booking_time_zone — probed on
 * live 2026-10-28 at 07:57 PT: today 10:57 rejected ("Invalid Policy Start
 * date"), today 10:59 accepted, with either time zone value. Earlier code sent
 * a same-day start of Pacific-now + 2h, always in Eastern's past, concluded
 * "same-day is blocked", and clamped every start to tomorrow — leaving the
 * first day of every same-day rental uninsured.
 *
 * So: a start today (Eastern) or earlier begins shortly after now; a future
 * start keeps the 15:00 convention. Callers use the same time for trip_end_date
 * so every chunk is a whole number of days.
 */
export function resolveBonzahTripStart(requestedStart: string): { date: string; time: string } {
  const soon = zonedParts(new Date(Date.now() + SAME_DAY_START_BUFFER_MIN * 60_000));
  const requested = String(requestedStart).slice(0, 10);
  if (requested > soon.date) return { date: requested, time: '15:00:00' };
  return soon;
}

/**
 * Minutes a first policy must be bought before pickup. Cover has to be in
 * force before the rental starts or it is void, and a same-day start lands
 * SAME_DAY_START_BUFFER_MIN after purchase — so a booking made a minute
 * before pickup would begin uninsured (Moore Luxe, 2026-10-28).
 */
export const MIN_MINUTES_BEFORE_PICKUP = 30;

/** The instant of wall-clock `date` (YYYY-MM-DD) + `time` (HH:MM[:SS]) in `timeZone`. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    const [py, pm, pd] = p.date.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    return Date.UTC(py, pm - 1, pd, ph, pmin) - t;
  };
  // Two passes so a DST change between the guess and the answer settles.
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/**
 * The policy window to send Bonzah, as Eastern wall-clock values.
 *
 * With the rental's pickup time, cover starts exactly at pickup and ends at the
 * same local time on `end` — whole days, in force before the car leaves. (A
 * fixed 15:00 Eastern start left a 9am pickup uninsured until 3pm.) Without a
 * pickup time, or when it is already too close to move the start there, it
 * falls back to resolveBonzahTripStart.
 */
export function resolveBonzahWindow(opts: {
  start: string;
  end: string;
  pickupTime?: string | null;
  timeZone?: string | null;
}): { startDate: string; time: string; endDate: string } {
  if (opts.pickupTime) {
    try {
      const tz = opts.timeZone || 'America/New_York';
      const startAt = zonedInstant(opts.start, opts.pickupTime, tz);
      if (startAt.getTime() >= Date.now() + SAME_DAY_START_BUFFER_MIN * 60_000) {
        const s = zonedParts(startAt);
        const e = zonedParts(zonedInstant(opts.end, opts.pickupTime, tz));
        return { startDate: s.date, time: s.time, endDate: e.date };
      }
    } catch {
      // bad pickup time or zone — fall through to the date-only rule
    }
  }
  const r = resolveBonzahTripStart(opts.start);
  return { startDate: r.date, time: r.time, endDate: String(opts.end).slice(0, 10) };
}

/** Today's date (YYYY-MM-DD) in `timeZone` — the tenant's — or Eastern if unknown/invalid. */
export function todayInZone(timeZone: string | null | undefined): string {
  try {
    return zonedParts(new Date(), timeZone || 'America/New_York').date;
  } catch {
    return zonedParts(new Date()).date;
  }
}

/** Bonzah's rejection when trip_start_date is not in the (Eastern) future. */
export function isBonzahStartDateError(message: string | null | undefined): boolean {
  return /invalid policy start date/i.test(message || '');
}

/**
 * Tenant Bonzah credentials
 */
export interface TenantBonzahCredentials {
  username: string;
  password: string;
  mode: 'test' | 'live';
}

/**
 * Fetch tenant's Bonzah credentials from the database
 */
export async function getTenantBonzahCredentials(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<TenantBonzahCredentials> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('bonzah_username, bonzah_password, bonzah_mode')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant Bonzah credentials: ${error.message}`);
  }

  const mode = (data?.bonzah_mode || 'test') as 'test' | 'live';

  // Test mode: use platform shared credentials (mirrors Stripe shared test account pattern)
  if (mode === 'test') {
    const platformUsername = BONZAH_USERNAME;
    const platformPassword = BONZAH_PASSWORD;
    if (!platformUsername || !platformPassword) {
      throw new Error('Platform Bonzah test credentials not configured');
    }
    return { username: platformUsername, password: platformPassword, mode: 'test' };
  }

  // Live mode: require tenant's own credentials
  if (!data?.bonzah_username || !data?.bonzah_password) {
    throw new Error('Tenant does not have Bonzah credentials configured. Please add your live Bonzah credentials in Settings.');
  }

  // Defense-in-depth: strip stray whitespace before use. A stored credential
  // with a single leading space (from copy/paste at save time) is otherwise
  // sent verbatim to Bonzah's /auth and fails every live insurance call.
  return {
    username: data.bonzah_username.trim(),
    password: data.bonzah_password.trim(),
    mode: 'live',
  };
}

/**
 * Whether this tenant may SELL a new Bonzah policy right now.
 *
 * Test mode talks to Bonzah's sandbox (bonzah.sb.insillion.com) on shared
 * platform credentials, so any policy it issues is NOT real cover — while
 * `stripe_mode` is independent, so the customer can still be charged real
 * money. That combination has already shipped sandbox policies to real
 * renters, which is why selling is blocked outright in test mode.
 *
 * `bonzah_sandbox_override` is the super-admin escape hatch for internal/demo
 * tenants that must exercise the sandbox end-to-end.
 *
 * SCOPE: this gates *selling* only. Servicing an existing policy — confirming a
 * payment Stripe already took, downloading a certificate, viewing a policy,
 * reading the balance, cancelling — must keep working in every mode, otherwise
 * a customer who already paid is left with no policy and no document.
 */
export interface BonzahSellability {
  sellable: boolean;
  mode: 'test' | 'live';
  reason: string | null;
}

export async function getBonzahSellability(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<BonzahSellability> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('integration_bonzah, bonzah_mode, bonzah_sandbox_override')
    .eq('id', tenantId)
    .single();

  // Fail CLOSED: a safety gate that cannot read its own configuration must not
  // wave the sale through. Costs at most a retry; the alternative is a fake policy.
  if (error) {
    return {
      sellable: false,
      mode: 'test',
      reason: `Could not verify Bonzah configuration: ${error.message}`,
    };
  }

  const mode = (data?.bonzah_mode || 'test') as 'test' | 'live';

  if (data?.integration_bonzah !== true) {
    return { sellable: false, mode, reason: 'Bonzah insurance is not enabled for this account.' };
  }

  if (mode === 'live') return { sellable: true, mode, reason: null };

  if (data?.bonzah_sandbox_override === true) {
    console.log('[Bonzah] Sandbox override active — allowing test-mode sale for tenant:', tenantId);
    return { sellable: true, mode, reason: null };
  }

  return {
    sellable: false,
    mode: 'test',
    reason:
      'Bonzah is in test mode for this account, so no real policy can be issued. ' +
      'Complete Bonzah onboarding and switch to live mode before selling insurance.',
  };
}

/** Throws BONZAH_NOT_SELLABLE when this tenant may not sell a new policy. */
export async function assertBonzahSellable(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<void> {
  const verdict = await getBonzahSellability(supabaseClient, tenantId);
  if (!verdict.sellable) {
    const err = new Error(verdict.reason || 'Bonzah insurance is unavailable for this account.') as Error & {
      code: string;
    };
    err.code = 'BONZAH_NOT_SELLABLE';
    throw err;
  }
}

/**
 * Thrown when Bonzah rejects the credentials themselves (bad password, account
 * disabled) rather than the request. Callers check `.code` to tell "your saved
 * Bonzah login went stale" apart from "this quote was malformed" — the two need
 * completely different messages in front of an operator.
 */
export const BONZAH_AUTH_FAILED = 'BONZAH_AUTH_FAILED';

export function isBonzahAuthError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === BONZAH_AUTH_FAILED;
}

/**
 * Get Bonzah authentication token for specific credentials (cached per-username)
 *
 * `context` shapes the failure message only. 'saved' (the default) is every call
 * that runs on credentials already stored on the tenant, so the remedy is to go
 * re-enter them. 'entered' is the verify-credentials path, where the operator is
 * looking at the credential form as they type — telling them to open that form
 * would be nonsense.
 */
export async function getBonzahTokenForCredentials(
  username: string,
  password: string,
  apiUrl: string,
  context: 'saved' | 'entered' = 'saved'
): Promise<string> {
  const cached = tenantTokenCache.get(username);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  console.log('[Bonzah] Authenticating with API for:', username);

  const response = await fetch(`${apiUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: username, pwd: password }),
  });

  const responseData = await response.json();

  if (responseData.status !== 0) {
    // Log the raw Insillion payload (it carries fail_count, which separates a
    // lockout from a wrong password) but never surface it: its `txt` reads
    // "Authentication failed <email>", which tells an operator nothing about
    // what to do and puts the account's login address on screen.
    console.error('[Bonzah] Authentication failed:', username, responseData);
    const err = new Error(
      context === 'entered'
        ? 'Bonzah rejected these credentials. Check the email and password on your Bonzah account and try again.'
        : 'Bonzah rejected the login saved for this account, so no policy can be issued right now. ' +
          'This usually means the Bonzah password was changed or reset on Bonzah\'s side. ' +
          'Update it in Settings → Integrations → Bonzah, then retry.'
    ) as Error & { code: string };
    err.code = BONZAH_AUTH_FAILED;
    throw err;
  }

  if (!responseData.data?.token) {
    console.error('[Bonzah] No token in response:', responseData);
    throw new Error('Bonzah authentication did not return a token');
  }

  tenantTokenCache.set(username, {
    token: responseData.data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  console.log('[Bonzah] Authentication successful for:', responseData.data.email);
  return responseData.data.token;
}

/**
 * Make an authenticated API call to Bonzah using per-tenant credentials
 */
export async function bonzahFetchWithCredentials<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  credentials: TenantBonzahCredentials,
  method: 'POST' | 'GET' = 'POST'
): Promise<T> {
  const apiUrl = getBonzahApiUrl(credentials.mode);
  const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl);

  const url = endpoint.startsWith('http') ? endpoint : `${apiUrl}${endpoint}`;

  console.log(`[Bonzah] ${method} ${endpoint} (tenant: ${credentials.username})`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'in-auth-token': token,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    console.error('[Bonzah] Failed to parse response:', responseText);
    throw new Error('Failed to parse Bonzah API response');
  }

  if (responseData.status !== 0 && responseData.status !== undefined) {
    console.error(`[Bonzah] API error (status ${responseData.status}):`, responseData);
    const errorMsg = responseData.txt || 'Unknown error';
    const error = new Error(`Bonzah API error: ${errorMsg}`) as Error & { bonzahStatus: number };
    error.bonzahStatus = responseData.status;
    throw error;
  }

  return responseData as T;
}

/**
 * Get Bonzah authentication token (cached for 15 minutes) — global env-based (backward compat)
 */
export async function getBonzahToken(): Promise<string> {
  // Check if cached token is still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  console.log('[Bonzah] Authenticating with API...');

  // Bonzah/Insillion API uses 'email' and 'pwd' fields, endpoint is /auth
  const response = await fetch(`${BONZAH_API_URL}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: BONZAH_USERNAME,
      pwd: BONZAH_PASSWORD,
    }),
  });

  const responseData = await response.json();

  // Check for API-level error (status !== 0 means error)
  if (responseData.status !== 0) {
    console.error('[Bonzah] Authentication failed:', responseData);
    throw new Error(`Bonzah authentication failed: ${responseData.txt || 'Unknown error'}`);
  }

  // Token is nested in data.token
  if (!responseData.data?.token) {
    console.error('[Bonzah] No token in response:', responseData);
    throw new Error('Bonzah authentication did not return a token');
  }

  // Cache the token
  cachedToken = {
    token: responseData.data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  console.log('[Bonzah] Authentication successful for:', responseData.data.email);
  return cachedToken.token;
}

/**
 * Make an authenticated API call to Bonzah — global env-based (backward compat)
 */
export async function bonzahFetch<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  method: 'POST' | 'GET' = 'POST'
): Promise<T> {
  const token = await getBonzahToken();

  const url = endpoint.startsWith('http') ? endpoint : `${BONZAH_API_URL}${endpoint}`;

  console.log(`[Bonzah] ${method} ${endpoint}`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'in-auth-token': token, // Bonzah/Insillion uses this header instead of Authorization
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    console.error('[Bonzah] Failed to parse response:', responseText);
    throw new Error('Failed to parse Bonzah API response');
  }

  // Bonzah API returns status: 0 for success, negative for errors
  if (responseData.status !== 0 && responseData.status !== undefined) {
    console.error(`[Bonzah] API error (status ${responseData.status}):`, responseData);
    // Include the status code in the error for better debugging
    const errorMsg = responseData.txt || 'Unknown error';
    const error = new Error(`Bonzah API error: ${errorMsg}`) as Error & { bonzahStatus: number };
    error.bonzahStatus = responseData.status;
    throw error;
  }

  return responseData as T;
}

/**
 * Format date for Bonzah API (MM/DD/YYYY)
 */
export function formatDateForBonzah(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Normalize a ZIP code for Bonzah API.
 * Bonzah's /Bonzah/quote endpoint with finalize: 1 silently returns an EMPTY
 * payment_id (status 0, no error) when zip_code is in ZIP+4 format with a
 * hyphen (e.g. "30034-2123"). Extract the first 5-digit run; fall back to the
 * provided default only when no 5-digit run exists.
 */
export function normalizeZipForBonzah(zip: string | null | undefined, fallback = '33101'): string {
  const match = String(zip || '').match(/\d{5}/);
  return match ? match[0] : fallback;
}

/**
 * Coverage type codes used by Bonzah API
 */
export const COVERAGE_CODES = {
  CDW: 'CDW',    // Collision Damage Waiver
  RCLI: 'RCLI',  // Rental Car Liability Insurance
  SLI: 'SLI',    // Supplemental Liability Insurance
  PAI: 'PAI',    // Personal Accident Insurance
} as const;

/**
 * Coverage types interface
 */
export interface CoverageTypes {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
}

/**
 * Premium calculation response
 */
export interface PremiumResponse {
  total_premium: number;
  breakdown: {
    cdw: number;
    rcli: number;
    sli: number;
    pai: number;
  };
}

/**
 * Quote response from Bonzah
 */
export interface BonzahQuoteResponse {
  quote_id: string;
  quote_no?: string;
  payment_id?: string;
  premium: number;
}

/**
 * Payment/Policy response from Bonzah
 */
export interface BonzahPolicyResponse {
  policy_no: string;
  policy_id: string;
  status: string;
}

/**
 * Renter details for quote creation
 */
export interface RenterDetails {
  first_name: string;
  last_name: string;
  dob: string; // YYYY-MM-DD
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  license: {
    number: string;
    state: string;
  };
}
