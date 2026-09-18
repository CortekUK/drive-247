/**
 * What each integration's connection actually says, read from the tenant's own rows.
 *
 * AUDITED, NOT ASSUMED. Every rule below was read out of the portal panel that
 * paints the same chip, and the file:line is quoted beside it. The one thing this
 * must never do is invent a healthier answer than the portal would give: showing
 * "connected" for an account the provider has paused is the failure that took a
 * live operator offline for two days (see the warning at the top of
 * apps/portal/src/app/(dashboard)/integrations/_panels/stripe-connect.tsx).
 *
 * Three honesty rules, forced by what the schema really holds:
 *
 * 1. This is STORED state, never a live provider call. No panel in the portal makes
 *    one either. Every answer says so, with the timestamp the state was recorded
 *    where one genuinely exists.
 * 2. `accounting_connections.last_synced_at` is ALWAYS NULL and nothing writes it
 *    (apps/portal/src/app/(dashboard)/integrations/_panels/xero-data.ts:52-59), so
 *    it is never reported. Xero's real activity lives in financial_event_sync_state.
 * 3. No integration stores a last-FAILURE timestamp. Where only a counter or an
 *    error string exists, that is what is returned — not a fabricated time.
 *
 * A read failure is reported as unknown, never as disconnected: every panel takes
 * that care (_kit.tsx), and "your integration is off" is a damaging thing to say
 * wrongly.
 */
import { SupportError } from './types.ts';
import type { SupportContext } from './types.ts';
import { canView } from './auth.ts';

export type Health = 'connected' | 'attention' | 'disconnected' | 'unknown' | 'unavailable';

export interface IntegrationState {
  key: string;
  name: string;
  health: Health;
  /** One line a person can act on. Never a raw column value. */
  summary: string;
  /** test / live, where the integration has the concept. */
  mode?: string | null;
  /** What the account is called at the provider, where stored. */
  account?: string | null;
  /** A timestamp that genuinely means "this state was recorded then". */
  recordedAt?: string | null;
  /** An error the provider actually gave us, where one is stored. */
  error?: string | null;
  /** Why an answer is limited, in the same words a person would use. */
  note?: string | null;
}

/** Only the shape used, so no client reaches the model. */
export interface IntegrationDatabase {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): PromiseLike<{ data: unknown; error: unknown }>;
        order(column: string, options: { ascending: boolean }): { limit(n: number): PromiseLike<{ data: unknown; error: unknown }> };
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/* The tenant columns every integration's state is derived from. One list, so the
   answer cannot drift from the panel that selects the same set. */
const TENANT_COLUMNS = [
  'id', 'payment_provider', 'payment_model', 'stripe_mode', 'stripe_account_id', 'stripe_account_status',
  'stripe_onboarding_complete', 'stripe_charges_enabled', 'stripe_payouts_enabled', 'stripe_requirements_due',
  'stripe_status_synced_at', 'stripe_account_disabled_reason', 'own_stripe_account_id', 'own_stripe_connected_at',
  'own_stripe_test_account_id', 'own_stripe_test_connected_at',
  'square_mode',
  'integration_twilio_sms', 'twilio_account_sid', 'twilio_phone_number', 'twilio_connection_verified_at',
  'twilio_voice_enabled', 'twilio_twiml_app_sid', 'twilio_api_key_sid', 'twilio_voice_webhook_configured',
  'integration_bonzah', 'bonzah_username', 'bonzah_mode', 'bonzah_sandbox_override',
  'integration_inshur', 'inshur_mode', 'inshur_username', 'inshur_states_synced_at',
  'integration_tesla_fleet', 'tesla_fleet_api_token_secret_id', 'tesla_fleet_refresh_token_secret_id', 'tesla_fleet_token_expires_at',
  'custom_booking_domain', 'custom_portal_domain',
].join(',');

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const on = (value: unknown): boolean => value === true;
const mask = (id: unknown): string | null => {
  const value = text(id);
  return value ? `…${value.slice(-4)}` : null;
};

/**
 * Stripe. The panel's own rule, from stripe-connect.tsx:190-341.
 *
 * `payment_model='own'` and `'managed'` are different connections with different
 * columns, and stripe_account_status / stripe_onboarding_complete are deliberately
 * NOT maintained for an own account — reading them there is the outage bug.
 */
function stripe(t: Row): IntegrationState {
  const base = { key: 'stripe', name: 'Stripe', mode: text(t.stripe_mode) };
  if (text(t.payment_provider) && text(t.payment_provider) !== 'stripe') {
    return { ...base, health: 'unavailable', summary: `This account takes payments through ${text(t.payment_provider)}, not Stripe.` };
  }
  const own = text(t.payment_model) === 'own';
  const live = text(t.stripe_mode) === 'live';
  const account = own ? (live ? t.own_stripe_account_id : t.own_stripe_test_account_id) : t.stripe_account_id;
  const connectedAt = own ? (live ? t.own_stripe_connected_at : t.own_stripe_test_connected_at) : null;
  const disabled = text(t.stripe_account_disabled_reason);
  const requirements = Array.isArray(t.stripe_requirements_due) ? (t.stripe_requirements_due as unknown[]).length : 0;

  if (!text(account)) {
    // Live with no account is the state that breaks every charge, per getConnectAccountId.
    return { ...base, health: own && live ? 'attention' : 'disconnected',
      summary: own && live
        ? 'No live Stripe account is connected, so live card payments cannot be taken.'
        : `No Stripe account is connected for ${live ? 'live' : 'test'} mode.` };
  }
  const state: IntegrationState = { ...base, health: 'connected', account: mask(account),
    recordedAt: text(t.stripe_status_synced_at) ?? text(connectedAt),
    summary: `Connected in ${live ? 'live' : 'test'} mode on account ${mask(account)}.` };
  if (disabled) return { ...state, health: 'attention', error: disabled, summary: `Stripe has restricted this account: ${disabled}` };
  if (requirements) return { ...state, health: 'attention', summary: `Stripe is waiting on ${requirements} outstanding requirement${requirements === 1 ? '' : 's'} for this account.` };
  if (t.stripe_charges_enabled === false) return { ...state, health: 'attention', summary: 'Stripe has charges disabled on this account.' };
  if (!own && live && t.stripe_onboarding_complete !== true) return { ...state, health: 'attention', summary: 'The managed Stripe account has not finished onboarding, so it cannot take live payments.' };
  if (!text(t.stripe_status_synced_at)) state.note = 'Stripe has not been re-read since this account was connected, so this reflects what was stored at connection time.';
  return state;
}

/** Twilio SMS. deriveState, twilio-messages.tsx:109-125. */
function twilioSms(t: Row): IntegrationState {
  const base = { key: 'twilio_sms', name: 'Twilio SMS', account: mask(t.twilio_account_sid) };
  if (!text(t.twilio_account_sid)) return { ...base, health: 'disconnected', summary: 'No Twilio account is connected.' };
  if (!text(t.twilio_phone_number)) return { ...base, health: 'attention', summary: 'Twilio is connected but no sending number is configured.' };
  if (!on(t.integration_twilio_sms)) return { ...base, health: 'attention', summary: 'Twilio is connected but SMS is switched off for this account.' };
  return { ...base, health: 'connected', recordedAt: text(t.twilio_connection_verified_at),
    summary: `Connected and sending from ${text(t.twilio_phone_number)}.`,
    // The column is stamped at connect time only; calling it a sync would mislead.
    note: 'The time shown is when the connection was verified, not a data sync.' };
}

/** Twilio voice. deriveReadiness, twilio-calling.tsx:182-239. */
function twilioVoice(t: Row): IntegrationState {
  const base = { key: 'twilio_voice', name: 'Twilio calling' };
  if (!text(t.twilio_account_sid)) return { ...base, health: 'disconnected', summary: 'No Twilio account is connected.' };
  if (!on(t.twilio_voice_enabled)) return { ...base, health: 'disconnected', summary: 'Calling is switched off for this account.' };
  const missing = [!text(t.twilio_phone_number) && 'a number', !on(t.twilio_voice_webhook_configured) && 'its webhook',
    !text(t.twilio_twiml_app_sid) && 'its voice app', !text(t.twilio_api_key_sid) && 'an API key'].filter(Boolean);
  if (missing.length) return { ...base, health: 'attention', summary: `Calling is enabled but still needs ${missing.join(', ')}.` };
  return { ...base, health: 'connected', summary: `Calling is set up on ${text(t.twilio_phone_number)}.`,
    note: 'Twilio calling records no status or error, so this is configuration only.' };
}

/** Bonzah. deriveStage, bonzah.tsx:166-194. */
function bonzah(t: Row): IntegrationState {
  const base = { key: 'bonzah', name: 'Bonzah insurance', mode: text(t.bonzah_mode) };
  if (!text(t.bonzah_username)) return { ...base, health: 'disconnected', summary: 'No Bonzah credentials are set up.' };
  if (!on(t.integration_bonzah)) return { ...base, health: 'attention', summary: 'Bonzah is set up but not selling on this account.' };
  const liveish = text(t.bonzah_mode) === 'live' || on(t.bonzah_sandbox_override);
  return { ...base, health: liveish ? 'connected' : 'attention',
    summary: liveish ? 'Connected and selling.' : 'Set up in sandbox, so policies sold are not real.',
    note: 'Bonzah stores no connection error; a rejected credential only shows when a submission is attempted.' };
}

/** INSHUR. inshur-settings.tsx:532, 550-555. */
function inshur(t: Row): IntegrationState {
  const base = { key: 'inshur', name: 'INSHUR', mode: text(t.inshur_mode), recordedAt: text(t.inshur_states_synced_at) };
  if (!on(t.integration_inshur)) return { ...base, health: 'disconnected', summary: 'INSHUR is switched off for this account.' };
  if (!text(t.inshur_username)) return { ...base, health: 'attention', summary: 'INSHUR is switched on but its credentials are incomplete.' };
  return { ...base, health: 'connected', summary: `Connected in ${text(t.inshur_mode) ?? 'mock'} mode.` };
}

/** Tesla Fleet. derive(), tesla.tsx:280-366. */
function tesla(t: Row, now: number): IntegrationState {
  const base = { key: 'tesla', name: 'Tesla Fleet' };
  if (!on(t.integration_tesla_fleet)) return { ...base, health: 'disconnected', summary: 'Tesla Fleet is switched off for this account.' };
  if (!text(t.tesla_fleet_api_token_secret_id) || !text(t.tesla_fleet_refresh_token_secret_id)) {
    return { ...base, health: 'attention', summary: 'Tesla Fleet is switched on but its tokens are not stored.' };
  }
  // Two hours past expiry is the portal's stall threshold (tesla.tsx:261).
  const expires = Date.parse(String(t.tesla_fleet_token_expires_at ?? ''));
  const stalled = !Number.isFinite(expires) || expires < now - 2 * 60 * 60 * 1000;
  return { ...base, health: stalled ? 'attention' : 'connected', recordedAt: text(t.tesla_fleet_token_expires_at),
    summary: stalled ? 'The Tesla token has not renewed when it should have, so fleet data may be stale.' : 'Connected and renewing.' };
}

/** Custom domains. custom-domain.tsx:307-329 — deliberately never "connected". */
function customDomain(t: Row): IntegrationState {
  const booking = text(t.custom_booking_domain), portal = text(t.custom_portal_domain);
  const base = { key: 'custom_domain', name: 'Custom domain' };
  if (!booking && !portal) return { ...base, health: 'disconnected', summary: 'No custom domain is requested.' };
  return { ...base, health: 'attention',
    summary: `${[booking && `booking: ${booking}`, portal && `portal: ${portal}`].filter(Boolean).join(', ')} — set, but DNS cannot be verified from inside the application.`,
    note: 'Whether the domain actually resolves is not something this application can see.' };
}

/** Square. deriveSquareVerdict, square-data.ts:347-515. */
function square(t: Row, connection: Row | null, now: number): IntegrationState {
  const base = { key: 'square', name: 'Square', mode: text(t.square_mode) };
  if (text(t.payment_provider) !== 'square' && !connection) {
    return { ...base, health: 'unavailable', summary: 'This account does not use Square.' };
  }
  if (!connection) return { ...base, health: 'disconnected', summary: 'No Square connection is stored.' };
  const status = text(connection.status);
  const error = text(connection.last_error);
  const failures = Number(connection.refresh_failure_count ?? 0);
  const expires = Date.parse(String(connection.token_expires_at ?? ''));
  const expired = Number.isFinite(expires) && expires <= now;
  const state: IntegrationState = { ...base, health: 'connected', account: text(connection.business_name) ?? mask(connection.merchant_id),
    recordedAt: text(connection.connected_at), error,
    summary: `Connected to ${text(connection.business_name) ?? 'Square'}.` };
  if (status === 'revoked' || status === null) return { ...state, health: 'disconnected', summary: 'The Square connection has been revoked.' };
  if (status === 'error' || error) return { ...state, health: 'attention', summary: `Square reported a problem: ${error ?? 'connection error'}.` };
  if (status === 'expired' || expired) return { ...state, health: 'attention', summary: 'The Square token has expired and needs reconnecting.' };
  if (failures > 0) return { ...state, health: 'attention', summary: `Square has failed to refresh its token ${failures} time${failures === 1 ? '' : 's'}.` };
  if (!text(connection.location_id)) return { ...state, health: 'attention', summary: 'Square is connected but no location is selected.' };
  return state;
}

/**
 * Xero and Zoho. deriveXeroVerdict (xero-data.ts:209) and describeZoho (zoho.tsx:217).
 *
 * `last_synced_at` is deliberately not read: it is always NULL and nothing writes
 * it. Real activity comes from financial_event_sync_state, which is passed in.
 */
function accounting(provider: 'xero' | 'zoho', connection: Row | null, sync: Row | null, now: number): IntegrationState {
  const name = provider === 'xero' ? 'Xero' : 'Zoho Books';
  const base = { key: provider, name };
  if (!connection) return { ...base, health: 'disconnected', summary: `${name} is not connected.` };
  const status = text(connection.status);
  const error = text(connection.last_error);
  const expiresAt = text(connection.token_expires_at);
  const expires = Date.parse(String(expiresAt ?? ''));
  // Xero treats a missing expiry as fine; Zoho treats it as expired. Kept apart
  // deliberately rather than averaged into one wrong rule.
  const expired = provider === 'zoho' ? !Number.isFinite(expires) || expires <= now : Number.isFinite(expires) && expires <= now;
  const org = text(connection.external_org_name);
  const state: IntegrationState = { ...base, health: 'connected', account: org,
    recordedAt: text(sync?.last_attempt_at) ?? text(sync?.synced_at) ?? text(connection.connected_at), error,
    summary: `Connected to ${org ?? name}.` };
  if (status === 'revoked') return { ...state, health: 'disconnected', summary: `The ${name} connection has been revoked.` };
  if (status === 'error') return { ...state, health: 'attention', summary: `${name} reported a problem: ${error ?? 'connection error'}.` };
  if (status === 'expired' || expired) return { ...state, health: 'attention', summary: `The ${name} token has expired and needs reconnecting.` };
  if (error) return { ...state, health: 'attention', summary: `${name} is connected but its last sync failed: ${error}` };
  if (text(sync?.state) === 'failed') return { ...state, health: 'attention', summary: `${name} is connected but the last accounting sync failed.`, error: text(sync?.last_error) ?? error };
  return state;
}

/** Cards that exist in the portal but carry no readable state at all. */
const PREVIEW: IntegrationState[] = [
  { key: 'turo', name: 'Turo sync', health: 'unavailable', summary: 'Not available in this portal yet; no connection state is recorded.' },
  { key: 'checkmydriver', name: 'CheckMyDriver', health: 'unavailable', summary: 'Not available in this portal yet; no connection state is recorded.' },
];

export interface IntegrationReads {
  tenant(tenantId: string): Promise<Row | null>;
  square(tenantId: string): Promise<Row | null>;
  accounting(tenantId: string, provider: string): Promise<Row | null>;
  accountingSync(tenantId: string, provider: string): Promise<Row | null>;
}

export function createIntegrationReads(db: IntegrationDatabase): IntegrationReads {
  const one = async (query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row | null> => {
    const result = await query;
    if (result.error) throw new SupportError('live_read_failed', 'An integration’s stored status could not be read, so its state is unknown.', 503);
    const data = result.data;
    if (Array.isArray(data)) return (data[0] as Row) ?? null;
    return (data as Row) ?? null;
  };
  return {
    tenant: (t) => one(db.from('tenants').select(TENANT_COLUMNS).eq('id', t).maybeSingle()),
    // The public views, which is what the portal reads: no tokens are exposed by them.
    square: (t) => one(db.from('square_connections_public').select('status,token_expires_at,merchant_id,location_id,business_name,refresh_failure_count,last_error,connected_at,disconnected_at').eq('tenant_id', t).order('connected_at', { ascending: false }).limit(1)),
    accounting: (t, provider) => one(db.from('accounting_connections_public').select('provider,status,token_expires_at,external_org_name,last_error,connected_at,disconnected_at').eq('tenant_id', t).eq('provider', provider)),
    accountingSync: (t, provider) => one(db.from('financial_event_sync_state').select('provider,state,last_error,last_error_code,last_attempt_at,synced_at').eq('tenant_id', t).eq('provider', provider)),
  };
}

/**
 * Every integration's stored state for THIS account.
 *
 * A read that fails leaves that integration `unknown` rather than failing the whole
 * answer or, worse, reporting it as off.
 */
export async function readIntegrationStatus(auth: SupportContext, reads: IntegrationReads, now: number): Promise<{ integrations: IntegrationState[]; observedAt: string; basis: string }> {
  if (!canView(auth, 'settings') && !canView(auth, 'vehicles')) {
    throw new SupportError('restricted', 'Your role cannot read this account’s integration settings.', 403);
  }
  const tenantId = auth.tenant.id;
  const tenant = await reads.tenant(tenantId);
  if (!tenant || String(tenant.id) !== tenantId) {
    throw new SupportError('record_unavailable', 'This account’s settings could not be read.', 503);
  }

  const guard = async (key: string, name: string, run: () => Promise<IntegrationState>): Promise<IntegrationState> => {
    try { return await run(); }
    catch { return { key, name, health: 'unknown', summary: `${name}’s stored status could not be read just now, so its state is unknown. It has not been reported as disconnected.` }; }
  };

  const [squareState, xeroState, zohoState] = await Promise.all([
    guard('square', 'Square', async () => square(tenant, await reads.square(tenantId), now)),
    guard('xero', 'Xero', async () => accounting('xero', await reads.accounting(tenantId, 'xero'), await reads.accountingSync(tenantId, 'xero'), now)),
    guard('zoho', 'Zoho Books', async () => accounting('zoho', await reads.accounting(tenantId, 'zoho'), await reads.accountingSync(tenantId, 'zoho'), now)),
  ]);

  return {
    observedAt: new Date(now).toISOString(),
    basis: 'Stored connection state for this account. No integration was contacted; the portal does not make live provider checks either.',
    integrations: [stripe(tenant), squareState, twilioSms(tenant), twilioVoice(tenant), bonzah(tenant), inshur(tenant), xeroState, zohoState, tesla(tenant, now), customDomain(tenant), ...PREVIEW],
  };
}
