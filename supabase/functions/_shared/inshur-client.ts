// INSHUR / ABI "Period Z" Insurance API Client
//
// Period Z is per-rental commercial cover. A vehicle can only receive Period Z
// while it already carries an active Period X (off-rental) policy that the
// operator buys manually at portal.abiweb.com — there is no API for that step,
// so the eligibility check is the gate for everything here.
//
// Mirrors the shape of bonzah-client.ts deliberately: per-tenant credentials,
// a mode split, a fail-closed sellability gate, and typed errors. Three things
// differ and drive most of the design below:
//
//   1. ABI has NO separate sandbox host. Staging and production are both
//      https://api.abiweb.com and only the credentials differ. There is
//      therefore no URL to "get wrong safely" — a live credential in a test
//      code path writes a REAL insurance policy. Hence the MODE_HOSTS map and
//      the assertions in resolveConfig().
//
//   2. Auth is HTTP Basic using the operator's ABI *portal* login, optionally
//      plus a 2FA "Token" header. See TwoFactorRequiredError.
//
//   3. We currently hold no credentials of any kind. `mock` is therefore a
//      first-class mode, not a test affordance: the entire integration runs
//      end-to-end against MOCK_TRANSPORT today, and the eventual handover is a
//      pure configuration change (set inshur_mode + paste four values). No code
//      path is left unexercised until credentials arrive, which is the usual
//      way an integration like this fails on day one.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `mock`  — no network. Deterministic fixtures. The default for every tenant
 *           until INSHUR issues credentials.
 * `test`  — real network, ABI-issued TEST credentials. Same host as live.
 * `live`  — real network, real credentials, real policies, real money.
 */
export type InshurMode = 'mock' | 'test' | 'live';

export type InshurUsageType = 'Personal' | 'Rideshare';

export interface InshurConfig {
  mode: InshurMode;
  username: string;
  password: string;
  customerNumber: string;
  policyNumber: string;
  /** Optional 2FA code, only present if the operator supplied one recently. */
  twoFactorToken: string | null;
}

export interface InshurEligibility {
  eligible: boolean;
  requirements: {
    onPeriodX: boolean;
    hasTrackingDevice: boolean;
    hasCompColl: boolean;
  };
  /** Operator-readable explanation of why an ineligible VIN failed. */
  reason: string | null;
}

export interface InshurRenterInput {
  firstName: string;
  lastName: string;
  licenseState: string;
  licenseNumber: string;
  phoneNumber: string;
  emailAddress: string;
  dob: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zip: string;
}

export interface InshurRentalInput {
  vin: string;
  renterId: string;
  state: string;
  timezone: string;
  startTime: string;
  endTime: string;
  usageType: InshurUsageType;
  /** Our rentals.id — lets us reconcile ABI's list back to our rows. */
  externalRef?: string | null;
}

export interface InshurRentalResult {
  rentalId: string;
  hasCompColl: boolean;
}

export interface InshurIdCard {
  base64: string;
  fileType: string;
  documentType: string;
  name: string;
}

export interface InshurBillingRow {
  vin: string;
  found: boolean;
  premium: number | null;
  softwareFee: number | null;
  totalCost: number | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class InshurError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'InshurError';
    this.code = code;
    this.status = status;
  }
}

/**
 * ABI demands a `Token` header on every request for 2FA-enrolled users, and
 * the code is emailed to a human. That is fatal for unattended calls, so we
 * surface it as its own error type rather than a generic auth failure — the
 * UI must be able to tell the operator "your ABI login needs 2FA disabled for
 * API use", which is a completely different fix from "wrong password".
 */
export class TwoFactorRequiredError extends InshurError {
  constructor(message = 'INSHUR requires a two-factor code for this account. API access needs a service user with 2FA disabled.') {
    super('INSHUR_2FA_REQUIRED', message, 401);
    this.name = 'TwoFactorRequiredError';
  }
}

export class InshurNotConfiguredError extends InshurError {
  constructor(message: string) {
    super('INSHUR_NOT_CONFIGURED', message, 400);
    this.name = 'InshurNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Staging and production are the SAME host. This map exists so that fact is
 * stated once, in code, rather than living in someone's memory — and so a
 * future ABI-issued sandbox host is a one-line change.
 */
const MODE_HOSTS: Record<Exclude<InshurMode, 'mock'>, string> = {
  test: 'https://api.abiweb.com',
  live: 'https://api.abiweb.com',
};

const REQUEST_TIMEOUT_MS = 20_000;

export function getInshurApiUrl(mode: Exclude<InshurMode, 'mock'>): string {
  return MODE_HOSTS[mode];
}

/**
 * Read a tenant's INSHUR configuration.
 *
 * Fails CLOSED in every ambiguous case. An integration that issues legally
 * required insurance must never guess: a missing policy number silently
 * treated as empty string would produce a request to
 * `/customer/123/policy//period-zero/rental/` which ABI answers with its
 * characteristic empty `{}` and a 400 — an error we would then have to
 * reverse-engineer at 2am instead of catching here.
 */
export async function getInshurConfig(
  supabase: SupabaseClient,
  tenantId: string
): Promise<InshurConfig> {
  const { data, error } = await supabase
    .from('tenants')
    .select(
      'integration_inshur, inshur_mode, inshur_username, inshur_password, inshur_customer_number, inshur_policy_number, inshur_2fa_token'
    )
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new InshurNotConfiguredError(`Could not read INSHUR configuration: ${error.message}`);
  }

  const mode = normalizeMode(data?.inshur_mode);

  // Mock needs no credentials at all — that is the entire point of it.
  if (mode === 'mock') {
    return {
      mode,
      username: 'mock@drive-247.local',
      password: 'mock',
      customerNumber: data?.inshur_customer_number?.trim() || 'MOCK-CUST-0001',
      policyNumber: data?.inshur_policy_number?.trim() || 'MOCK-POL-0001',
      twoFactorToken: null,
    };
  }

  const missing: string[] = [];
  // Whitespace stripped defensively: a credential pasted with one leading
  // space is otherwise sent verbatim and fails every call. This exact bug has
  // already bitten the Bonzah integration once.
  const username = data?.inshur_username?.trim() || '';
  const password = data?.inshur_password?.trim() || '';
  const customerNumber = data?.inshur_customer_number?.trim() || '';
  const policyNumber = data?.inshur_policy_number?.trim() || '';

  if (!username) missing.push('username');
  if (!password) missing.push('password');
  if (!customerNumber) missing.push('customer number');
  if (!policyNumber) missing.push('policy number');

  if (missing.length) {
    throw new InshurNotConfiguredError(
      `INSHUR is set to ${mode} mode but is missing: ${missing.join(', ')}. ` +
        'Add these in Settings → INSHUR, or switch back to simulated mode.'
    );
  }

  return {
    mode,
    username,
    password,
    customerNumber,
    policyNumber,
    twoFactorToken: data?.inshur_2fa_token?.trim() || null,
  };
}

function normalizeMode(raw: unknown): InshurMode {
  // Anything unrecognised — including null on a tenant that predates these
  // columns — degrades to mock. Degrading to `live` on a typo would issue real
  // policies; degrading to mock merely does nothing.
  return raw === 'live' || raw === 'test' ? raw : 'mock';
}

// ---------------------------------------------------------------------------
// Usability gate
// ---------------------------------------------------------------------------

export interface InshurUsability {
  usable: boolean;
  mode: InshurMode;
  /** True only when a real, legally binding policy would be created. */
  issuesRealCover: boolean;
  reason: string | null;
}

/**
 * Whether this tenant may create Period Z cover right now, and — critically —
 * whether that cover would be REAL.
 *
 * `usable` and `issuesRealCover` are deliberately separate. Mock and test are
 * both usable (we want the flow exercised), but neither produces cover that
 * would pay out. Every caller that shows something to a renter must branch on
 * `issuesRealCover`, never on `usable`, or we repeat the Bonzah incident where
 * sandbox policies reached real paying customers.
 */
export async function getInshurUsability(
  supabase: SupabaseClient,
  tenantId: string
): Promise<InshurUsability> {
  const { data, error } = await supabase
    .from('tenants')
    .select('integration_inshur, inshur_mode')
    .eq('id', tenantId)
    .single();

  if (error) {
    return {
      usable: false,
      mode: 'mock',
      issuesRealCover: false,
      reason: `Could not verify INSHUR configuration: ${error.message}`,
    };
  }

  const mode = normalizeMode(data?.inshur_mode);

  if (data?.integration_inshur !== true) {
    return {
      usable: false,
      mode,
      issuesRealCover: false,
      reason: 'INSHUR insurance is not enabled for this account.',
    };
  }

  return {
    usable: true,
    mode,
    issuesRealCover: mode === 'live',
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Field transformation
//
// ABI is strict about formats and answers malformed input with an empty {} and
// a 400, which carries no diagnostic information whatsoever. Every one of these
// helpers therefore validates locally and throws something readable, so a bad
// customer record produces "ZIP must be 5 digits, got 'SW1A 1AA'" rather than
// an anonymous 400 three layers down.
// ---------------------------------------------------------------------------

/**
 * ABI wants FIRSTNAME and LASTNAME; we store a single `customers.name`.
 * Everything before the final token is the first name, so "Mary Jane Watson"
 * yields "Mary Jane" / "Watson", which is right far more often than splitting
 * on the first space.
 */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new InshurError('INSHUR_INVALID_FIELD', 'Customer has no name on record. INSHUR requires a first and last name.');
  }
  if (parts.length === 1) {
    throw new InshurError(
      'INSHUR_INVALID_FIELD',
      `Customer name "${fullName}" has no surname. INSHUR requires both a first and a last name.`
    );
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

/**
 * ABI wants exactly 10 bare digits (US NANP), e.g. "8009801950".
 * Our stored numbers are typically E.164 and this platform defaults unknown
 * numbers to +44, so a UK number reaching here is a real possibility and must
 * be rejected loudly rather than truncated into a plausible-looking wrong one.
 */
export function normalizeUsPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  throw new InshurError(
    'INSHUR_INVALID_FIELD',
    `Phone number "${raw}" is not a 10-digit US number. INSHUR only covers US rentals.`
  );
}

export function normalizeState(raw: string, field = 'state'): string {
  const s = (raw || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) {
    throw new InshurError(
      'INSHUR_INVALID_FIELD',
      `${field} must be a 2-letter US state code, got "${raw}".`
    );
  }
  return s;
}

export function normalizeZip(raw: string): string {
  const z = (raw || '').trim();
  const m = z.match(/^(\d{5})(-\d{4})?$/);
  if (!m) {
    throw new InshurError('INSHUR_INVALID_FIELD', `ZIP must be 5 digits, got "${raw}".`);
  }
  return m[1];
}

export function normalizeVin(raw: string): string {
  const v = (raw || '').trim().toUpperCase();
  if (v.length !== 17) {
    throw new InshurError(
      'INSHUR_INVALID_FIELD',
      `VIN must be exactly 17 characters, got ${v.length} ("${raw}"). Add the VIN on the vehicle record.`
    );
  }
  // I, O and Q are not valid VIN characters; their presence means a typo or an
  // OCR artefact, and ABI will reject the VIN as unknown rather than malformed.
  if (/[IOQ]/.test(v)) {
    throw new InshurError('INSHUR_INVALID_FIELD', `VIN "${v}" contains I, O or Q, which are not valid VIN characters.`);
  }
  return v;
}

export function normalizeDob(raw: string): string {
  const d = (raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new InshurError('INSHUR_INVALID_FIELD', `Date of birth must be yyyy-mm-dd, got "${raw}".`);
  }
  return d;
}

/**
 * ABI wants "YYYY-MM-DD HH:mm:ss" expressed in the TIMEZONE also sent on the
 * request — not UTC, and not ISO 8601. Passing a UTC instant with a local
 * timezone label would shift cover by hours at each end of the rental, which
 * is the difference between a renter being insured at pickup and not.
 */
export function formatAbiDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  // en-CA renders hour 24 for midnight in some runtimes; normalise to 00.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  config: InshurConfig;
}

/**
 * ABI's success envelope is { STATUS: "success", RESULT: ... }. Failures very
 * often come back as a bare {} with HTTP 400 and no message at all, so a
 * generic "request failed" here is the best we can honestly say — the local
 * validation above exists precisely so we rarely get this far with bad input.
 */
async function abiRequest<T>(opts: RequestOptions): Promise<T> {
  const { method, path, body, config } = opts;

  if (config.mode === 'mock') {
    throw new InshurError('INSHUR_INTERNAL', 'abiRequest must never be called in mock mode — use the mock transport.', 500);
  }

  const url = `${getInshurApiUrl(config.mode)}${path}`;
  const basic = btoa(`${config.username}:${config.password}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${basic}`,
  };
  if (config.twoFactorToken) headers['Token'] = config.twoFactorToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    // Never log the URL with credentials, and never log the body — it carries
    // licence numbers and dates of birth.
    console.log(`[INSHUR] ${method} ${path} (mode: ${config.mode})`);
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
    throw new InshurError('INSHUR_BAD_RESPONSE', `INSHUR returned a non-JSON response (HTTP ${response.status}).`, 502);
  }

  const env = payload as { STATUS?: string; RESULT?: unknown; ERROR?: string };

  if (!response.ok || env?.STATUS !== 'success') {
    throw new InshurError(
      'INSHUR_REQUEST_FAILED',
      env?.ERROR || `INSHUR rejected the request (HTTP ${response.status}).`,
      response.status || 400
    );
  }

  return env.RESULT as T;
}

// ---------------------------------------------------------------------------
// Mock transport
//
// Deterministic on purpose: the same VIN always produces the same rental id, so
// tests assert on fixed values and a demo shows stable data across reloads.
// Behaviour is keyed off magic VIN suffixes so every branch — including the
// unhappy ones we would otherwise never see until production — is reachable
// today, with no credentials.
// ---------------------------------------------------------------------------

/** 1x1 transparent PNG. Valid image bytes so the whole base64 → storage →
 *  download → render pipeline is genuinely exercised. The UI is responsible for
 *  stamping "SIMULATED" over any card whose coverage row is not live. */
const MOCK_ID_CARD_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Stable pseudo-id from a string, so mock results repeat across calls. */
function stableId(seed: string, prefix: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}${(h >>> 0).toString().padStart(10, '0').slice(0, 6)}`;
}

/**
 * VIN suffix → simulated outcome. Documented in the settings UI so an operator
 * testing the integration can deliberately reproduce each failure.
 */
function mockEligibilityFor(vin: string): InshurEligibility {
  if (vin.endsWith('0000')) {
    return {
      eligible: false,
      requirements: { onPeriodX: false, hasTrackingDevice: false, hasCompColl: false },
      reason: 'This vehicle has no active Period X policy. The operator must buy Period X at portal.abiweb.com first.',
    };
  }
  if (vin.endsWith('0001')) {
    return {
      eligible: false,
      requirements: { onPeriodX: true, hasTrackingDevice: false, hasCompColl: true },
      reason: 'This vehicle needs a tracking device fitted before it can be covered.',
    };
  }
  if (vin.endsWith('0002')) {
    return {
      eligible: false,
      requirements: { onPeriodX: true, hasTrackingDevice: true, hasCompColl: false },
      reason: 'This vehicle carries liability only. Comprehensive and collision must be added to its Period X policy.',
    };
  }
  return {
    eligible: true,
    requirements: { onPeriodX: true, hasTrackingDevice: true, hasCompColl: true },
    reason: null,
  };
}

const MOCK_STATES_ALLOWED = ['AZ', 'CA', 'CO', 'FL', 'GA', 'MD', 'PA', 'SC'];

// ---------------------------------------------------------------------------
// Operations
//
// Each operation branches to the mock transport FIRST and returns before any
// network code is reachable. The inverse arrangement — calling out and falling
// back to mock on failure — would mean a live outage silently produces fake
// cover, so the branch order here is load-bearing, not stylistic.
// ---------------------------------------------------------------------------

export async function checkVehicleEligibility(
  config: InshurConfig,
  rawVin: string
): Promise<InshurEligibility> {
  const vin = normalizeVin(rawVin);

  if (config.mode === 'mock') return mockEligibilityFor(vin);

  const result = await abiRequest<{
    ELIGIBLE: boolean;
    REQUIREMENTS: { ON_PERIOD_X: boolean; HAS_TRACKING_DEVICE: boolean; HAS_COMP_COLL: boolean };
  }>({
    method: 'GET',
    path: `/period-z/eligibility/vin/${encodeURIComponent(vin)}/`,
    config,
  });

  const req = result?.REQUIREMENTS ?? { ON_PERIOD_X: false, HAS_TRACKING_DEVICE: false, HAS_COMP_COLL: false };
  const eligible = Boolean(result?.ELIGIBLE);

  let reason: string | null = null;
  if (!eligible) {
    if (!req.ON_PERIOD_X) reason = 'This vehicle has no active Period X policy. Buy Period X at portal.abiweb.com first.';
    else if (!req.HAS_TRACKING_DEVICE) reason = 'This vehicle needs a tracking device fitted before it can be covered.';
    else if (!req.HAS_COMP_COLL) reason = 'This vehicle carries liability only. Add comprehensive and collision to its Period X policy.';
    else reason = 'INSHUR reports this vehicle as ineligible but gave no reason.';
  }

  return {
    eligible,
    requirements: {
      onPeriodX: Boolean(req.ON_PERIOD_X),
      hasTrackingDevice: Boolean(req.HAS_TRACKING_DEVICE),
      hasCompColl: Boolean(req.HAS_COMP_COLL),
    },
    reason,
  };
}

export async function addRenter(config: InshurConfig, input: InshurRenterInput): Promise<string> {
  const body = {
    FIRSTNAME: input.firstName,
    LASTNAME: input.lastName,
    LICENSESTATE: normalizeState(input.licenseState, 'Licence state'),
    LICENSENUMBER: input.licenseNumber,
    PHONENUMBER: normalizeUsPhone(input.phoneNumber),
    EMAILADDRESS: input.emailAddress,
    DOB: normalizeDob(input.dob),
    ADDRESSLINE1: input.addressLine1,
    ADDRESSLINE2: input.addressLine2 || '',
    CITY: input.city,
    STATE: normalizeState(input.state, 'State'),
    ZIP: normalizeZip(input.zip),
  };

  if (config.mode === 'mock') {
    return stableId(`${body.LICENSESTATE}${body.LICENSENUMBER}${body.DOB}`, '');
  }

  const result = await abiRequest<{ ID: string; RENTERID: string; status: string }>({
    method: 'POST',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/period-zero/renter/`,
    body,
    config,
  });

  const renterId = result?.RENTERID || result?.ID;
  if (!renterId) throw new InshurError('INSHUR_BAD_RESPONSE', 'INSHUR did not return a renter id.', 502);
  return String(renterId);
}

export async function createRentalPeriod(
  config: InshurConfig,
  input: InshurRentalInput
): Promise<InshurRentalResult> {
  const vin = normalizeVin(input.vin);
  const body: Record<string, unknown> = {
    VIN: vin,
    RENTERID: input.renterId,
    STATE: normalizeState(input.state, 'Rental state'),
    TIMEZONE: input.timezone,
    STARTTIME: input.startTime,
    ENDTIME: input.endTime,
    USAGETYPE: input.usageType,
  };
  if (input.externalRef) body.EXTERNALREF = input.externalRef;

  if (config.mode === 'mock') {
    const elig = mockEligibilityFor(vin);
    if (!elig.eligible) {
      throw new InshurError('INSHUR_VEHICLE_INELIGIBLE', elig.reason || 'Vehicle is not eligible for cover.');
    }
    return {
      rentalId: stableId(`${vin}${input.startTime}${input.renterId}`, ''),
      hasCompColl: elig.requirements.hasCompColl,
    };
  }

  const result = await abiRequest<{ ID: string; RENTALID: string; HAS_COMP_COLL: boolean }>({
    method: 'POST',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/rental/`,
    body,
    config,
  });

  const rentalId = result?.RENTALID || result?.ID;
  if (!rentalId) throw new InshurError('INSHUR_BAD_RESPONSE', 'INSHUR did not return a rental id.', 502);
  return { rentalId: String(rentalId), hasCompColl: Boolean(result?.HAS_COMP_COLL) };
}

export async function getIdCard(config: InshurConfig, rentalId: string): Promise<InshurIdCard> {
  if (config.mode === 'mock') {
    return { base64: MOCK_ID_CARD_PNG, fileType: 'png', documentType: 'idcard', name: 'ID Card (simulated)' };
  }

  const result = await abiRequest<{
    DOCUMENTTYPE: string;
    BASE64: string;
    FILETYPE: string;
    NAME: string;
  }>({
    method: 'GET',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/rental/${encodeURIComponent(rentalId)}/idcard/`,
    config,
  });

  if (!result?.BASE64) throw new InshurError('INSHUR_BAD_RESPONSE', 'INSHUR did not return an ID card.', 502);
  return {
    base64: result.BASE64,
    fileType: result.FILETYPE || 'png',
    documentType: result.DOCUMENTTYPE || 'idcard',
    name: result.NAME || 'ID Card',
  };
}

/** Only valid before the rental has started. ABI rejects it afterwards. */
export async function cancelRentalPeriod(config: InshurConfig, rawVin: string): Promise<void> {
  const vin = normalizeVin(rawVin);
  if (config.mode === 'mock') return;

  await abiRequest<unknown>({
    method: 'DELETE',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/rental/${encodeURIComponent(vin)}/`,
    config,
  });
}

export async function endRentalPeriod(config: InshurConfig, rawVin: string): Promise<void> {
  const vin = normalizeVin(rawVin);
  if (config.mode === 'mock') return;

  await abiRequest<unknown>({
    method: 'POST',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/rental/${encodeURIComponent(vin)}/end/`,
    config,
  });
}

/**
 * The reconciliation read. ABI publishes no webhooks, so this list is the only
 * way to detect drift between what we believe is covered and what actually is.
 */
export async function listRentals(config: InshurConfig): Promise<unknown[]> {
  if (config.mode === 'mock') return [];

  const result = await abiRequest<unknown[]>({
    method: 'GET',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/rentals/`,
    config,
  });
  return Array.isArray(result) ? result : [];
}

export async function getStatesAllowed(config: InshurConfig): Promise<string[]> {
  if (config.mode === 'mock') return [...MOCK_STATES_ALLOWED];

  const result = await abiRequest<string[]>({
    method: 'GET',
    path: `/customer/${encodeURIComponent(config.customerNumber)}/policy/${encodeURIComponent(config.policyNumber)}/period-zero/states-allowed/`,
    config,
  });
  return Array.isArray(result) ? result : [];
}

/** Monthly reconciliation. Note ABI's response key is literally "SOFTWARE FEE", with a space. */
export async function getCostByVin(
  config: InshurConfig,
  startDate: string,
  endDate: string
): Promise<InshurBillingRow[]> {
  if (config.mode === 'mock') return [];

  const path =
    `/customer/${encodeURIComponent(config.customerNumber)}/billing/vins/` +
    `?STARTDATE=${encodeURIComponent(startDate)}&ENDDATE=${encodeURIComponent(endDate)}`;

  const result = await abiRequest<Array<Record<string, unknown>>>({ method: 'GET', path, config });

  return (Array.isArray(result) ? result : []).map((r) => ({
    vin: String(r.VIN ?? ''),
    found: Boolean(r.FOUND),
    premium: r.PREMIUM == null ? null : Number(r.PREMIUM),
    softwareFee: r['SOFTWARE FEE'] == null ? null : Number(r['SOFTWARE FEE']),
    totalCost: r.TOTALCOST == null ? null : Number(r.TOTALCOST),
  }));
}

/**
 * Credential smoke test for the Settings panel. Uses states-allowed because it
 * is the cheapest authenticated call that exercises BOTH the customer number
 * and the policy number — a plain sign-in would pass even if those two were
 * wrong, which is the failure an operator is most likely to have.
 */
export async function verifyInshurCredentials(
  config: InshurConfig
): Promise<{ ok: boolean; mode: InshurMode; states: string[]; error: string | null }> {
  try {
    const states = await getStatesAllowed(config);
    return { ok: true, mode: config.mode, states, error: null };
  } catch (err) {
    const e = err as InshurError;
    return { ok: false, mode: config.mode, states: [], error: e?.message || 'Verification failed.' };
  }
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}
