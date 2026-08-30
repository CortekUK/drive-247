// INSHUR / ABI Period Z — start cover for one rental.
//
// The chain is: eligibility → renter → rental period → ID card → coverage row.
// Every step is a real ABI side effect except the first, and ABI has no
// idempotency key of any kind. A double-fired confirmation therefore buys cover
// twice and bills the operator twice, with no way to undo the second one after
// the rental starts. The partial unique index idx_inshur_cov_one_active
// (rental_id WHERE status IN ('pending','active')) is what makes that
// impossible: the row is claimed as `pending` BEFORE the billable call, so the
// loser of a race gets 23505 and is told "already covered" instead of buying a
// second policy.
//
// The other half of the contract is visibility. A rental whose cover could not
// be created is the single most important thing for an operator to see, so
// failures are persisted as rows with status='failed' and a real error code —
// never swallowed, never merely logged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { notifyOperatorsInApp } from '../_shared/notify-inapp.ts';
import { authorizeTenantAccess } from '../_shared/tenant-auth.ts';
import {
  addRenter,
  checkVehicleEligibility,
  createRentalPeriod,
  createServiceClient,
  getIdCard,
  getInshurConfig,
  getInshurUsability,
  InshurError,
  normalizeDob,
  normalizeState,
  normalizeUsPhone,
  normalizeVin,
  normalizeZip,
  splitName,
  type InshurConfig,
  type InshurEligibility,
  type InshurMode,
  type InshurRenterInput,
  type InshurUsageType,
} from '../_shared/inshur-client.ts';

const LOG = '[INSHUR Create]';

/** How long a cached eligibility verdict is trusted. It only changes when the
 *  operator edits their Period X policy, which is rare and manual. */
const ELIGIBILITY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `rentals.pickup_time` / `return_time` are nullable `time` columns and four
 * places in this repo already default them differently (`send-return-reminders`
 * uses 17:00, `capture-booking-payment` and `rentals/new` use 23:59, the lockbox
 * trigger uses 09:00). None of those is a defensible insurance boundary, so
 * this file states its own and widens in the safe direction: cover starts at
 * the first instant of the pickup day and ends at the last minute of the return
 * day. Over-insuring costs money; under-insuring puts an uninsured driver on
 * the road.
 */
const DEFAULT_PICKUP_TIME = '00:00:00';
const DEFAULT_RETURN_TIME = '23:59:00';

/** Outcomes where ABI may or may not have created the period. See isAmbiguousOutcome(). */
const AMBIGUOUS_ERROR_CODES = new Set([
  'INSHUR_TIMEOUT',
  'INSHUR_NETWORK',
  'INSHUR_BAD_RESPONSE',
]);

/** The bucket's allowed_mime_types. Anything else cannot be stored. */
const ID_CARD_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

// Longest-first so "West Virginia" matches before "Virginia".
const US_STATE_NAME_ENTRIES = Object.entries(US_STATE_NAMES).sort((a, b) => b[1].length - a[1].length);

/**
 * Pull a 2-letter state code out of a free-text address. `pickup_locations`
 * carries only an `address` string, so this is the only way to recover a state
 * for a vehicle whose `garaging_state` was never set. Mirrors the resolver in
 * `bonzah-create-quote`, which exists because pickup state was being taken from
 * the renter's home address.
 */
function extractStateFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const s = addr.trim();
  const beforeZip = s.match(/\b([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (beforeZip && US_STATE_NAMES[beforeZip[1].toUpperCase()]) return beforeZip[1].toUpperCase();
  const lower = s.toLowerCase();
  for (const [code, name] of US_STATE_NAME_ENTRIES) {
    if (new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower)) return code;
  }
  const trailing = s.match(/,\s*([A-Za-z]{2})\s*(?:,\s*(?:USA|United States))?\s*$/i);
  if (trailing && US_STATE_NAMES[trailing[1].toUpperCase()]) return trailing[1].toUpperCase();
  return null;
}

/** `HH:mm`, `HH:mm:ss` or `HH:mm:ss.sss` → `HH:mm:ss`. */
function toClockTime(raw: string | null | undefined, fallback: string): string {
  const t = (raw || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return fallback;
  const hh = m[1].padStart(2, '0');
  return `${hh}:${m[2]}:${m[3] ?? '00'}`;
}

/**
 * ABI wants "YYYY-MM-DD HH:mm:ss" expressed in the TIMEZONE sent alongside it.
 * `start_date`/`end_date` are `date` columns and `pickup_time`/`return_time` are
 * `time` columns — both are ALREADY the tenant's wall clock, so they are
 * concatenated directly. Routing them through a Date would reinterpret them in
 * the isolate's zone (UTC on Supabase) and shift every rental boundary by the
 * tenant's offset.
 */
function composeAbiDateTime(dateOnly: string, timeOnly: string | null | undefined, fallback: string): string {
  return `${String(dateOnly).slice(0, 10)} ${toClockTime(timeOnly, fallback)}`;
}

function base64ToBytes(raw: string): Uint8Array {
  const clean = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * ABI's ID-card envelope carries FILETYPE, and our own discovery notes list the
 * payload format as undocumented — it may be a PNG today and a PDF tomorrow.
 * Hardcoding `.png` would hand the renter an unopenable attachment, so the
 * extension and content type are always derived from what ABI actually sent.
 */
function resolveIdCardType(fileType: string): { ext: string; contentType: string } | null {
  const raw = (fileType || '').trim().toLowerCase();
  const ext = (raw.includes('/') ? raw.split('/').pop()! : raw).replace(/^\./, '');
  const contentType = ID_CARD_CONTENT_TYPES[ext];
  if (!contentType) return null;
  return { ext, contentType };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fingerprint of exactly the fields sent to Add Renter. ABI has no update
 * endpoint, so when a customer corrects their licence number the only way to
 * stop insuring them against stale details is to notice the hash moved and
 * register them again.
 */
function renterPayloadHash(input: InshurRenterInput): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      input.firstName, input.lastName, input.licenseState, input.licenseNumber,
      input.phoneNumber, input.emailAddress, input.dob, input.addressLine1,
      input.addressLine2 || '', input.city, input.state, input.zip,
    ]).toLowerCase()
  );
}

function isAmbiguousOutcome(err: unknown): boolean {
  if (err instanceof InshurError) {
    return AMBIGUOUS_ERROR_CODES.has(err.code) || err.status >= 500;
  }
  // An unrecognised throw around the billable call tells us nothing about
  // whether ABI acted. Treat it as unknown, which holds the slot.
  return true;
}

function errorCodeOf(err: unknown): string {
  return err instanceof InshurError ? err.code : 'INSHUR_UNEXPECTED';
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface CoverageDraft {
  tenant_id: string;
  rental_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  vin: string;
  source_mode: InshurMode;
  usage_type: InshurUsageType;
  state?: string | null;
  timezone?: string | null;
  start_time_sent?: string | null;
  end_time_sent?: string | null;
}

/**
 * Persist an unsuccessful attempt. Reuses the rental's existing terminal-failure
 * row rather than accumulating one per retry, so `attempt_count` reads as the
 * number of attempts for this rental and the insurances list shows one line per
 * uninsured rental instead of a pile.
 */
async function persistFailure(
  supabase: any,
  draft: CoverageDraft,
  existingRow: any | null,
  status: 'failed' | 'ineligible',
  errorCode: string,
  errorMessage: string
): Promise<any> {
  const patch = {
    ...draft,
    status,
    error_code: errorCode,
    error_message: errorMessage,
    last_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existingRow) {
    const { data, error } = await supabase
      .from('inshur_rental_coverage')
      .update({ ...patch, attempt_count: (existingRow.attempt_count ?? 0) + 1 })
      .eq('id', existingRow.id)
      .select('*')
      .single();
    if (error) {
      console.error(`${LOG} could not update coverage ${existingRow.id} to ${status}:`, error.message);
      return { ...existingRow, ...patch };
    }
    return data;
  }

  const { data, error } = await supabase
    .from('inshur_rental_coverage')
    .insert({ ...patch, attempt_count: 1 })
    .select('*')
    .single();
  if (error) {
    console.error(`${LOG} could not record ${status} coverage for rental ${draft.rental_id}:`, error.message);
    return { ...patch, id: null, attempt_count: 1 };
  }
  return data;
}

/**
 * Raise the "this rental is not insured" alarm. Wrapped whole: an alerting
 * fault must never fail — or mask — the operation it is reporting on.
 */
async function emitFailureAlert(
  supabase: any,
  params: {
    tenantId: string;
    rentalId: string;
    rentalNumber: string | null;
    reg: string | null;
    severity: 'warning' | 'critical';
    errorCode: string;
    errorMessage: string;
  }
): Promise<void> {
  const label = params.rentalNumber ? `Rental ${params.rentalNumber}` : 'This rental';
  const vehicle = params.reg ? ` (${params.reg})` : '';
  const title = 'INSHUR cover could not be started';
  const message = `${label}${vehicle} has no INSHUR cover. ${params.errorMessage}`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    await notifyOperatorsInApp({
      tenantId: params.tenantId,
      type: params.severity === 'critical' ? 'reminder_critical' : 'reminder_warning',
      title,
      message,
      link: `/rentals/${params.rentalId}`,
      metadata: { rule_code: 'INSHUR_COVERAGE_FAILED', rental_id: params.rentalId, error_code: params.errorCode },
      // One bell per rental per cause per day. Retrying the same broken record
      // ten times is one problem, not ten.
      dedupeKey: `inshur-coverage-failed-${params.rentalId}-${params.errorCode}-${today}`,
    });
  } catch (err) {
    console.error(`${LOG} in-app alert failed (ignored):`, err);
  }

  try {

    // ux_reminders_identity is UNIQUE(rule_code, object_type, object_id, due_on,
    // remind_on), so the second failure for the same rental on the same day is a
    // 23505 on insert. Upserting keeps the alert unlatched — it must fire every
    // time — while counting the occurrences on the one row.
    const { data: existing } = await supabase
      .from('reminders')
      .select('context')
      .eq('rule_code', 'INSHUR_COVERAGE_FAILED')
      .eq('object_type', 'Rental')
      .eq('object_id', params.rentalId)
      .eq('due_on', today)
      .eq('remind_on', today)
      .maybeSingle();

    const occurrences = Number(existing?.context?.occurrences ?? 0) + 1;

    const { error } = await supabase
      .from('reminders')
      .upsert(
        {
          rule_code: 'INSHUR_COVERAGE_FAILED',
          object_type: 'Rental',
          object_id: params.rentalId,
          tenant_id: params.tenantId,
          title,
          message,
          due_on: today,
          remind_on: today,
          severity: params.severity,
          status: 'pending',
          context: {
            occurrences,
            error_code: params.errorCode,
            error_message: params.errorMessage,
            rental_number: params.rentalNumber,
            reg: params.reg,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'rule_code,object_type,object_id,due_on,remind_on' }
      );

    if (error) console.error(`${LOG} reminder upsert failed (ignored):`, error.message);
  } catch (err) {
    console.error(`${LOG} reminder emission failed (ignored):`, err);
  }
}

/** Resolve, or create, this customer's ABI RENTERID. */
async function resolveRenterId(
  supabase: any,
  config: InshurConfig,
  tenantId: string,
  customerId: string,
  input: InshurRenterInput,
  force: boolean
): Promise<{ renterId: string; created: boolean }> {
  const hash = await renterPayloadHash(input);

  const { data: cached } = await supabase
    .from('inshur_renters')
    .select('id, inshur_renter_id, payload_hash')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('source_mode', config.mode)
    .maybeSingle();

  if (cached?.inshur_renter_id && cached.payload_hash === hash && !force) {
    return { renterId: cached.inshur_renter_id, created: false };
  }

  const renterId = await addRenter(config, input);

  const { error } = await supabase
    .from('inshur_renters')
    .upsert(
      {
        tenant_id: tenantId,
        customer_id: customerId,
        inshur_renter_id: renterId,
        source_mode: config.mode,
        payload_hash: hash,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,customer_id,source_mode' }
    );

  // A cache-write failure costs a duplicate renter at ABI next time, which is
  // untidy but harmless. Losing the cover we are about to bind is not.
  if (error) console.error(`${LOG} renter cache write failed (continuing):`, error.message);

  return { renterId, created: true };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization header', 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse('Unauthorized', 401);

    const supabase = createServiceClient();

    // Both spellings are accepted: the portal hooks send camelCase, the
    // server-side callers send snake_case, and a silently-missing id would look
    // to the operator like an unexplained validation failure.
    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body?.tenant_id ?? body?.tenantId;
    const rentalId: string | undefined = body?.rental_id ?? body?.rentalId;
    // `force` re-reads eligibility from ABI and re-registers the renter instead
    // of trusting the caches. It deliberately does NOT bypass the one-active-row
    // guard: a second concurrent period is exactly what must never happen.
    const force: boolean = body?.force === true;
    // Usage type defaults from the rental's gig-driver flag but the operator can
    // override it, because it decides whether the renter's name appears on the
    // ID card — and the wrong choice leaves a gig driver holding an invalid one.
    const rawUsageType = body?.usage_type ?? body?.usageType;
    const usageOverride: InshurUsageType | null =
      rawUsageType === 'Rideshare' || rawUsageType === 'Personal' ? rawUsageType : null;

    if (!tenantId) return errorResponse('tenant_id is required', 400);
    if (!rentalId) return errorResponse('rental_id is required', 400);
    if (rawUsageType && !usageOverride) {
      return errorResponse(`usage_type must be "Personal" or "Rideshare", got "${rawUsageType}".`, 400);
    }

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    const usability = await getInshurUsability(supabase, tenantId);
    if (!usability.usable) {
      return errorResponse(usability.reason || 'INSHUR insurance is unavailable for this account.', 403);
    }

    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select(`
        id, tenant_id, customer_id, vehicle_id, rental_number, status,
        start_date, end_date, pickup_time, return_time,
        is_gig_driver, is_pay_as_you_go,
        pickup_location, pickup_location_id, delivery_address,
        customers!rentals_customer_id_fkey (
          id, name, email, phone, date_of_birth, license_number, license_state,
          address_street, address_city, address_state, address_zip,
          customer_type, is_gig_driver
        ),
        vehicles!rentals_vehicle_id_fkey (
          id, reg, make, model, vin, garaging_state
        )
      `)
      .eq('id', rentalId)
      .maybeSingle();

    if (rentalError) {
      console.error(`${LOG} rental lookup failed:`, rentalError.message);
      // 42703 is PostgREST's undefined-column code. The embed above names
      // `vehicles.garaging_state`, which arrives with the INSHUR schema — if that
      // has not been applied, EVERY rental fails this read and the generic
      // message below sends an operator hunting through their own data for a
      // problem that is entirely ours.
      if (rentalError.code === '42703' || /column .* does not exist/i.test(rentalError.message || '')) {
        return jsonResponse(
          {
            error:
              'INSHUR cannot read rentals on this database yet: ' +
              `${rentalError.message}. The INSHUR schema has not been fully applied. ` +
              'No cover was started and nothing is wrong with this rental.',
            error_code: 'INSHUR_SCHEMA_INCOMPLETE',
          },
          503
        );
      }
      return errorResponse('Could not load the rental.', 500);
    }
    if (!rental) return errorResponse('Rental not found.', 404);
    if (rental.tenant_id !== tenantId) return errorResponse('Forbidden', 403);

    const customer = (rental as any).customers || null;
    const vehicle = (rental as any).vehicles || null;

    // Buying cover for a rental that is over or was refused is real money spent
    // on nothing, and no failure row belongs on the record for it either.
    const deadStatuses = ['Cancelled', 'Rejected', 'Closed'];
    if (rental.status && deadStatuses.includes(rental.status)) {
      return jsonResponse(
        {
          error: `This rental is ${String(rental.status).toLowerCase()}, so INSHUR cover cannot be started for it.`,
          error_code: 'INSHUR_RENTAL_NOT_ACTIVE',
        },
        409
      );
    }

    const { data: existingRows, error: existingError } = await supabase
      .from('inshur_rental_coverage')
      .select('*')
      .eq('rental_id', rentalId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (existingError) {
      // Failing closed here is deliberate: without a reliable read of the
      // existing rows we cannot tell a first attempt from a second one, and the
      // cost of guessing wrong is a duplicate policy.
      console.error(`${LOG} coverage lookup failed:`, existingError.message);
      return errorResponse('Could not check existing INSHUR cover for this rental.', 500);
    }

    const liveRow = (existingRows || []).find((r: any) => r.status === 'pending' || r.status === 'active');
    if (liveRow) {
      return jsonResponse({
        ok: true,
        already_covered: true,
        status: liveRow.status,
        mode: liveRow.source_mode,
        simulated: liveRow.source_mode !== 'live',
        coverage_id: liveRow?.id ?? null,
        coverage: liveRow,
        message:
          liveRow.status === 'active'
            ? 'This rental is already on INSHUR cover.'
            : 'Cover for this rental is already being created. Waiting for ABI to confirm.',
      });
    }

    const reusableRow = (existingRows || []).find((r: any) => r.status === 'failed' || r.status === 'ineligible') || null;

    let config: InshurConfig;
    try {
      config = await getInshurConfig(supabase, tenantId);
    } catch (err) {
      return jsonResponse({ error: errorMessageOf(err), error_code: errorCodeOf(err) }, 400);
    }

    const rentalNumber: string | null = rental.rental_number ?? null;
    const reg: string | null = vehicle?.reg ?? null;

    const draft: CoverageDraft = {
      tenant_id: tenantId,
      rental_id: rentalId,
      customer_id: rental.customer_id ?? null,
      vehicle_id: rental.vehicle_id ?? null,
      vin: String(vehicle?.vin ?? '').trim().toUpperCase(),
      source_mode: config.mode,
      usage_type: usageOverride ?? ((rental.is_gig_driver || customer?.is_gig_driver) ? 'Rideshare' : 'Personal'),
    };

    /** Record + alert + respond, in one place so no failure path can skip a step. */
    const fail = async (
      status: 'failed' | 'ineligible',
      errorCode: string,
      errorMessage: string,
      httpStatus: number
    ): Promise<Response> => {
      const row = await persistFailure(supabase, draft, reusableRow, status, errorCode, errorMessage);
      const started = rental.start_date ? String(rental.start_date).slice(0, 10) <= new Date().toISOString().slice(0, 10) : false;
      await emitFailureAlert(supabase, {
        tenantId,
        rentalId,
        rentalNumber,
        reg,
        severity: started ? 'critical' : 'warning',
        errorCode,
        errorMessage,
      });
      console.warn(`${LOG} rental ${rentalId} → ${status} (${errorCode}): ${errorMessage}`);
      return jsonResponse(
        {
          ok: false,
          error: errorMessage,
          error_code: errorCode,
          status,
          mode: config.mode,
          simulated: config.mode !== 'live',
          coverage_id: row?.id ?? null,
          coverage: row,
        },
        httpStatus
      );
    };

    // ---------------------------------------------------------------------
    // Local validation. ABI answers malformed input with a bare {} and a 400,
    // so everything checkable is checked here where the message can name the
    // field and the fix.
    // ---------------------------------------------------------------------

    if (!customer) {
      return await fail('failed', 'INSHUR_NO_CUSTOMER', 'This rental has no customer attached, so there is nobody to name on the policy.', 422);
    }
    if (!vehicle) {
      return await fail('failed', 'INSHUR_NO_VEHICLE', 'This rental has no vehicle attached. INSHUR identifies vehicles by VIN.', 422);
    }
    if (rental.is_pay_as_you_go || !rental.end_date) {
      return await fail(
        'failed',
        'INSHUR_OPEN_ENDED_UNSUPPORTED',
        'This rental has no end date. Every INSHUR rental period needs an exact start and end time, so open-ended and pay-as-you-go rentals have to be insured another way.',
        422
      );
    }

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('timezone, address, fixed_pickup_address')
      .eq('id', tenantId)
      .maybeSingle();

    const resolvedTimezone = (tenantRow?.timezone || '').trim();
    if (!resolvedTimezone) {
      return await fail(
        'failed',
        'INSHUR_NO_TIMEZONE',
        'Your business timezone is not set. Every INSHUR rental period carries a timezone — set yours in Settings → INSHUR before starting cover.',
        422
      );
    }

    // garaging_state is the vehicle's own answer and is authoritative. The
    // address chain behind it exists only so a fleet whose column was never
    // filled is not blocked outright.
    const rawState =
      (vehicle.garaging_state ? String(vehicle.garaging_state).trim().toUpperCase() : null) ||
      extractStateFromAddress(rental.pickup_location) ||
      extractStateFromAddress(rental.delivery_address) ||
      extractStateFromAddress(tenantRow?.fixed_pickup_address) ||
      extractStateFromAddress(tenantRow?.address);

    if (!rawState) {
      return await fail(
        'failed',
        'INSHUR_NO_GARAGING_STATE',
        `We could not work out which US state ${reg || 'this vehicle'} is garaged in. Set the garaging state on the vehicle — INSHUR requires it on every rental period.`,
        422
      );
    }

    let vin!: string;
    let renterInput!: InshurRenterInput;
    let stateCode!: string;
    try {
      vin = normalizeVin(vehicle.vin);
      stateCode = normalizeState(rawState, 'Garaging state');

      const { firstName, lastName } = splitName(customer.name);
      renterInput = {
        firstName,
        lastName,
        licenseState: customer.license_state || '',
        licenseNumber: (customer.license_number || '').trim(),
        phoneNumber: customer.phone || '',
        emailAddress: (customer.email || '').trim(),
        // The column is a `date`; slicing tolerates a value that arrived as a
        // full timestamp without inventing one that did not.
        dob: normalizeDob(String(customer.date_of_birth || '').slice(0, 10)),
        addressLine1: (customer.address_street || '').trim(),
        addressLine2: null,
        city: (customer.address_city || '').trim(),
        state: customer.address_state || '',
        zip: customer.address_zip || '',
      };

      if (!renterInput.licenseNumber) {
        throw new InshurError('INSHUR_INVALID_FIELD', 'Customer has no driving licence number on record.');
      }
      if (!renterInput.emailAddress) {
        throw new InshurError('INSHUR_INVALID_FIELD', 'Customer has no email address on record.');
      }
      if (!renterInput.addressLine1 || !renterInput.city) {
        throw new InshurError('INSHUR_INVALID_FIELD', 'Customer has no street address and city on record. INSHUR requires a full US address.');
      }
      // Validated here rather than inside addRenter so a bad value is reported
      // before anything is created at ABI.
      normalizeState(renterInput.licenseState, 'Licence state');
      normalizeState(renterInput.state, 'State');
      normalizeZip(renterInput.zip);
      normalizeUsPhone(renterInput.phoneNumber);
    } catch (err) {
      return await fail('failed', errorCodeOf(err), errorMessageOf(err), 422);
    }

    const startTimeSent = composeAbiDateTime(rental.start_date, rental.pickup_time, DEFAULT_PICKUP_TIME);
    const endTimeSent = composeAbiDateTime(rental.end_date, rental.return_time, DEFAULT_RETURN_TIME);

    if (endTimeSent <= startTimeSent) {
      return await fail(
        'failed',
        'INSHUR_INVALID_WINDOW',
        `This rental ends (${endTimeSent}) before or when it starts (${startTimeSent}). Fix the pickup and return times before starting cover.`,
        422
      );
    }

    draft.vin = vin;
    draft.state = stateCode;
    draft.timezone = resolvedTimezone;
    draft.start_time_sent = startTimeSent;
    draft.end_time_sent = endTimeSent;

    // ---------------------------------------------------------------------
    // Eligibility. A read, so it is safe before the slot is claimed — and it
    // fails CLOSED, unlike the Bonzah equivalent: a false "eligible" here means
    // a Create that ABI answers with an unexplainable {}.
    // ---------------------------------------------------------------------

    let eligibility: InshurEligibility;
    const { data: cachedEligibility } = await supabase
      .from('inshur_vehicle_eligibility')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('vehicle_id', vehicle.id)
      .maybeSingle();

    const cacheFresh =
      !force &&
      cachedEligibility &&
      cachedEligibility.source_mode === config.mode &&
      cachedEligibility.vin === vin &&
      Date.now() - new Date(cachedEligibility.checked_at).getTime() < ELIGIBILITY_TTL_MS;

    if (cacheFresh) {
      eligibility = {
        eligible: cachedEligibility.eligible,
        requirements: {
          onPeriodX: cachedEligibility.on_period_x,
          hasTrackingDevice: cachedEligibility.has_tracking_device,
          hasCompColl: cachedEligibility.has_comp_coll,
        },
        reason: cachedEligibility.reason,
      };
    } else {
      try {
        eligibility = await checkVehicleEligibility(config, vin);
      } catch (err) {
        return await fail(
          'failed',
          'INSHUR_ELIGIBILITY_UNAVAILABLE',
          `We could not confirm with INSHUR whether ${reg || vin} can be covered, so cover was not started. ${errorMessageOf(err)}`,
          502
        );
      }

      const { error: cacheError } = await supabase
        .from('inshur_vehicle_eligibility')
        .upsert(
          {
            tenant_id: tenantId,
            vehicle_id: vehicle.id,
            vin,
            eligible: eligibility.eligible,
            on_period_x: eligibility.requirements.onPeriodX,
            has_tracking_device: eligibility.requirements.hasTrackingDevice,
            has_comp_coll: eligibility.requirements.hasCompColl,
            reason: eligibility.reason,
            source_mode: config.mode,
            checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,vehicle_id' }
        );
      if (cacheError) console.error(`${LOG} eligibility cache write failed (continuing):`, cacheError.message);
    }

    if (!eligibility.eligible) {
      return await fail(
        'ineligible',
        'INSHUR_VEHICLE_INELIGIBLE',
        eligibility.reason || `INSHUR cannot cover ${reg || vin} at the moment and gave no reason.`,
        422
      );
    }

    // ---------------------------------------------------------------------
    // Claim the slot. Everything after this point can spend the operator's
    // money, so the unique index has to be holding the rental first.
    // ---------------------------------------------------------------------

    const claimPatch = {
      ...draft,
      status: 'pending',
      has_comp_coll: eligibility.requirements.hasCompColl,
      error_code: null,
      error_message: null,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let coverage: any = null;
    let claimError: any = null;

    if (reusableRow) {
      const { data, error } = await supabase
        .from('inshur_rental_coverage')
        .update({ ...claimPatch, attempt_count: (reusableRow.attempt_count ?? 0) + 1 })
        .eq('id', reusableRow.id)
        .select('*')
        .single();
      coverage = data;
      claimError = error;
    } else {
      const { data, error } = await supabase
        .from('inshur_rental_coverage')
        .insert({ ...claimPatch, attempt_count: 1 })
        .select('*')
        .single();
      coverage = data;
      claimError = error;
    }

    if (claimError) {
      // 23505 on idx_inshur_cov_one_active means another invocation claimed this
      // rental between our read and our write. That is the guard working, not an
      // error: report the winner instead of buying a second policy.
      if (claimError.code === '23505') {
        const { data: winner } = await supabase
          .from('inshur_rental_coverage')
          .select('*')
          .eq('rental_id', rentalId)
          .in('status', ['pending', 'active'])
          .maybeSingle();
        console.log(`${LOG} concurrent claim on rental ${rentalId}; returning existing coverage ${winner?.id}`);
        return jsonResponse({
          ok: true,
          already_covered: true,
          status: winner?.status ?? 'pending',
          mode: winner?.source_mode ?? config.mode,
          simulated: (winner?.source_mode ?? config.mode) !== 'live',
          coverage_id: winner?.id ?? null,
          coverage: winner ?? null,
          message: 'Cover for this rental was already being created by another request.',
        });
      }
      console.error(`${LOG} could not claim coverage row:`, claimError.message);
      return errorResponse('Could not start INSHUR cover: the coverage record could not be written.', 500);
    }

    console.log(`${LOG} claimed coverage ${coverage.id} for rental ${rentalId} (VIN ${vin}, mode ${config.mode})`);

    /** Move the claimed row out of `pending` after a definite ABI rejection. */
    const failClaimed = async (errorCode: string, errorMessage: string, httpStatus: number): Promise<Response> => {
      const { data: row } = await supabase
        .from('inshur_rental_coverage')
        .update({
          status: 'failed',
          error_code: errorCode,
          error_message: errorMessage,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', coverage.id)
        .select('*')
        .single();

      const started = String(rental.start_date).slice(0, 10) <= new Date().toISOString().slice(0, 10);
      await emitFailureAlert(supabase, {
        tenantId, rentalId, rentalNumber, reg,
        severity: started ? 'critical' : 'warning',
        errorCode, errorMessage,
      });
      console.warn(`${LOG} coverage ${coverage.id} → failed (${errorCode}): ${errorMessage}`);
      return jsonResponse(
        {
          ok: false,
          error: errorMessage,
          error_code: errorCode,
          status: 'failed',
          mode: config.mode,
          simulated: config.mode !== 'live',
          coverage_id: (row ?? coverage)?.id ?? null,
          coverage: row ?? coverage,
        },
        httpStatus
      );
    };

    // ---------------------------------------------------------------------
    // Renter, then the rental period itself.
    // ---------------------------------------------------------------------

    let renterId: string;
    try {
      const resolved = await resolveRenterId(supabase, config, tenantId, customer.id, renterInput, force);
      renterId = resolved.renterId;
      if (resolved.created) console.log(`${LOG} registered renter for customer ${customer.id} (mode ${config.mode})`);
    } catch (err) {
      return await failClaimed(
        errorCodeOf(err),
        `INSHUR would not accept the renter's details, so cover was not started. ${errorMessageOf(err)}`,
        err instanceof InshurError ? err.status : 502
      );
    }

    await supabase
      .from('inshur_rental_coverage')
      .update({ inshur_renter_id: renterId, updated_at: new Date().toISOString() })
      .eq('id', coverage.id);

    let period: { rentalId: string; hasCompColl: boolean };
    try {
      period = await createRentalPeriod(config, {
        vin,
        renterId,
        state: stateCode,
        timezone: resolvedTimezone,
        startTime: startTimeSent,
        endTime: endTimeSent,
        usageType: draft.usage_type,
        externalRef: rentalId,
      });
    } catch (err) {
      if (isAmbiguousOutcome(err)) {
        // ABI may or may not have written the period. Leaving the row `pending`
        // keeps the unique index occupied, which is the only thing standing
        // between this and a second, non-cancellable policy on the same VIN.
        const message =
          `INSHUR did not confirm whether cover was created (${errorMessageOf(err)}). ` +
          'The rental is being held so nobody starts a second policy on this vehicle — check portal.abiweb.com before trying again.';
        const { data: row } = await supabase
          .from('inshur_rental_coverage')
          .update({
            error_code: errorCodeOf(err),
            error_message: message,
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', coverage.id)
          .select('*')
          .single();

        await emitFailureAlert(supabase, {
          tenantId, rentalId, rentalNumber, reg,
          severity: 'critical',
          errorCode: errorCodeOf(err),
          errorMessage: message,
        });
        console.error(`${LOG} ambiguous create for coverage ${coverage.id}; holding pending:`, errorMessageOf(err));

        return jsonResponse(
          {
            ok: false,
            error: message,
            error_code: errorCodeOf(err),
            status: 'pending',
            ambiguous: true,
            mode: config.mode,
            simulated: config.mode !== 'live',
            coverage_id: (row ?? coverage)?.id ?? null,
            coverage: row ?? coverage,
          },
          202
        );
      }

      return await failClaimed(
        errorCodeOf(err),
        `INSHUR rejected the rental period. ${errorMessageOf(err)}`,
        err instanceof InshurError ? err.status : 502
      );
    }

    const { data: activeRow, error: activateError } = await supabase
      .from('inshur_rental_coverage')
      .update({
        status: 'active',
        inshur_rental_id: period.rentalId,
        has_comp_coll: period.hasCompColl,
        error_code: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', coverage.id)
      .select('*')
      .single();

    if (activateError) {
      // The policy exists at ABI regardless. Say so loudly rather than
      // returning a failure the operator would act on by trying again.
      console.error(`${LOG} cover created at ABI (${period.rentalId}) but the row update failed:`, activateError.message);
      return jsonResponse(
        {
          ok: false,
          error: `Cover WAS created at INSHUR (rental period ${period.rentalId}) but we could not record it. Do not start cover again — check this rental at portal.abiweb.com.`,
          error_code: 'INSHUR_RECORD_WRITE_FAILED',
          status: 'pending',
          mode: config.mode,
          simulated: config.mode !== 'live',
          coverage_id: coverage?.id ?? null,
          coverage,
        },
        500
      );
    }

    coverage = activeRow;
    console.log(`${LOG} coverage ${coverage.id} active — ABI rental period ${period.rentalId}`);

    // ---------------------------------------------------------------------
    // ID card. Cover is already active and does not depend on this, so a
    // failure here is a warning on a successful response, never a rollback.
    // ---------------------------------------------------------------------

    const warnings: string[] = [];
    let idCardPath: string | null = null;

    try {
      const card = await getIdCard(config, period.rentalId);
      const type = resolveIdCardType(card.fileType);

      if (!type) {
        warnings.push(
          `INSHUR returned the ID card as "${card.fileType}", which we cannot store. Cover is active — download the card from portal.abiweb.com.`
        );
      } else {
        // Documented as base64, but the payload format is one of the fields our
        // own discovery notes list as unconfirmed, so a URL is handled too.
        let bytes: Uint8Array;
        if (/^https?:\/\//i.test(card.base64.trim())) {
          const res = await fetch(card.base64.trim());
          if (!res.ok) throw new Error(`ID card URL returned HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } else {
          bytes = base64ToBytes(card.base64);
        }

        // The mode is in the path AND in the filename: a simulated card must be
        // unmistakable to anyone who ever sees it, including in a bucket listing
        // or a download folder, long after it left this function.
        const simulated = config.mode !== 'live';
        const fileName = `${simulated ? 'SIMULATED-' : ''}inshur-id-card-${rentalNumber || rentalId}.${type.ext}`;
        const objectPath = `${tenantId}/${config.mode}/${rentalId}/${coverage.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('inshur-id-cards')
          .upload(objectPath, bytes, { contentType: type.contentType, upsert: true });

        if (uploadError) throw new Error(uploadError.message);

        idCardPath = objectPath;
        const { data: withCard } = await supabase
          .from('inshur_rental_coverage')
          // Private bucket: the storage PATH is stored, not a URL. A public URL
          // would 400, and the path is what createSignedUrl needs.
          .update({ id_card_url: objectPath, id_card_fetched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', coverage.id)
          .select('*')
          .single();
        if (withCard) coverage = withCard;
      }
    } catch (err) {
      console.error(`${LOG} ID card fetch/upload failed for coverage ${coverage.id} (cover unaffected):`, errorMessageOf(err));
      warnings.push('Cover is active, but the ID card has not come through from INSHUR yet. Try downloading it again in a minute.');
    }

    return jsonResponse({
      ok: true,
      status: 'active',
      mode: config.mode,
      simulated: config.mode !== 'live',
      coverage_id: coverage?.id ?? null,
      coverage,
      inshur_rental_id: period.rentalId,
      has_comp_coll: period.hasCompColl,
      id_card_ready: idCardPath !== null,
      warnings,
      message:
        config.mode === 'live'
          ? 'INSHUR cover is active for this rental.'
          : 'SIMULATED cover created. No insurance exists behind this — it is a test of the flow only.',
    });
  } catch (error) {
    console.error(`${LOG} unhandled error:`, error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to start INSHUR cover', 500);
  }
});
