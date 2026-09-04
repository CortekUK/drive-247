// INSHUR / ABI Period Z vehicle eligibility.
//
// A vehicle can only receive Period Z cover while its Period X policy is
// active, a tracker is fitted and comprehensive/collision is on that policy.
// None of those are things we hold — only ABI knows — and the operator changes
// them at portal.abiweb.com, outside anything we can observe. So this is a
// cache-through read: the answer is stored per (tenant, vehicle) and refreshed
// on demand or when stale.
//
// It fails CLOSED. bonzah-check-vehicle-eligibility fails open at every level
// because a false negative there just loses an insurance upsell; here a false
// positive means a rental goes out believing it has cover that ABI would never
// have written. A vehicle we could not check is reported as not insurable, and
// — importantly — that verdict is NOT written to the cache, so a thirty-second
// ABI outage cannot leave a whole fleet marked red until the nightly sweep.

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  checkVehicleEligibility,
  createServiceClient,
  getInshurConfig,
  getInshurUsability,
  normalizeVin,
  InshurConfig,
  InshurEligibility,
  InshurError,
} from '../_shared/inshur-client.ts';
import { authorizeTenantAccess } from '../_shared/tenant-auth.ts';

/** A cached verdict older than this is re-checked. The nightly sweep keeps
 *  most rows well inside it; this bound exists for the ones it misses. */
const ELIGIBILITY_TTL_MS = 12 * 60 * 60 * 1000;

const MAX_VEHICLES = 200;
const CONCURRENCY = 3;

/** Stop calling ABI after this many consecutive transport failures — past that
 *  point we are hammering something that is down and burning the function's
 *  wall clock, which would leave the remaining vehicles unanswered anyway. */
const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 3;

/** Leave room to write results and respond before the isolate is killed. */
const NETWORK_DEADLINE_MS = 60_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CheckBody {
  tenant_id?: string;
  tenantId?: string;
  vehicle_id?: string;
  vehicleId?: string;
  vehicle_ids?: string[];
  vehicleIds?: string[];
  refresh?: boolean;
  force?: boolean;
}

type ResultCode =
  | 'eligible'
  | 'no_vin'
  | 'malformed_vin'
  | 'not_found'
  | 'no_period_x'
  | 'no_tracking_device'
  | 'no_comp_coll'
  | 'ineligible'
  | 'check_failed'
  | 'not_checked';

interface CachedEligibility {
  vehicle_id: string;
  vin: string | null;
  eligible: boolean | null;
  on_period_x: boolean | null;
  has_tracking_device: boolean | null;
  has_comp_coll: boolean | null;
  reason: string | null;
  source_mode: string;
  checked_at: string;
}

interface VehicleResult {
  vehicleId: string;
  vin: string | null;
  eligible: boolean;
  code: ResultCode;
  reason: string | null;
  onPeriodX: boolean;
  hasTrackingDevice: boolean;
  hasCompColl: boolean;
  cached: boolean;
  /** False whenever the verdict was not written to inshur_vehicle_eligibility. */
  stored: boolean;
  sourceMode: string;
  checkedAt: string | null;
}

function ineligibleCode(req: InshurEligibility['requirements']): ResultCode {
  if (!req.onPeriodX) return 'no_period_x';
  if (!req.hasTrackingDevice) return 'no_tracking_device';
  if (!req.hasCompColl) return 'no_comp_coll';
  return 'ineligible';
}

function statusForInshurError(err: InshurError): number {
  switch (err.code) {
    case 'INSHUR_NOT_CONFIGURED':
      return 400;
    case 'INSHUR_INVALID_FIELD':
      return 422;
    case 'INSHUR_2FA_REQUIRED':
    case 'INSHUR_AUTH_FAILED':
      return 401;
    case 'INSHUR_TIMEOUT':
      return 504;
    case 'INSHUR_NETWORK':
    case 'INSHUR_BAD_RESPONSE':
      return 502;
    default:
      return err.status || 400;
  }
}

/** A failure of ours or of the network, as opposed to a verdict from ABI.
 *  Only these trip the circuit breaker and skip the cache write. */
function isTransportFailure(err: InshurError): boolean {
  return ['INSHUR_TIMEOUT', 'INSHUR_NETWORK', 'INSHUR_BAD_RESPONSE', 'INSHUR_REQUEST_FAILED'].includes(err.code);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization header', 401);

    const supabase = createServiceClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) return errorResponse('Unauthorized', 401);

    let body: CheckBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse('Invalid JSON body');
    }

    const tenantId = (body.tenant_id || body.tenantId || '').trim();
    if (!tenantId) return errorResponse('tenant_id is required');

    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    const single = (body.vehicle_id || body.vehicleId || '').trim();
    const many = (body.vehicle_ids || body.vehicleIds || []).map((v) => String(v || '').trim());
    const requestedIds = [...new Set([single, ...many].filter(Boolean))];

    if (requestedIds.length === 0) {
      return errorResponse('Provide vehicle_id or vehicle_ids');
    }
    if (requestedIds.length > MAX_VEHICLES) {
      return errorResponse(`Too many vehicles in one request — send at most ${MAX_VEHICLES}`, 413);
    }

    const usability = await getInshurUsability(supabase, tenantId);
    if (!usability.usable) {
      return errorResponse(usability.reason || 'INSHUR is not available for this account.', 400);
    }

    let config: InshurConfig;
    try {
      config = await getInshurConfig(supabase, tenantId);
    } catch (err) {
      const e = err as InshurError;
      return errorResponse(e.message, statusForInshurError(e));
    }

    const refresh = Boolean(body.refresh ?? body.force);

    // Postgres raises `invalid input syntax for type uuid` on a malformed id,
    // which would fail the whole batch for one bad entry. Filter them out and
    // report them individually instead.
    const lookupIds = requestedIds.filter((id) => UUID_PATTERN.test(id));

    let vehicles: Array<{ id: string; vin: string | null }> = [];
    let cachedRows: CachedEligibility[] = [];

    if (lookupIds.length) {
      // Scoped to the tenant, not just filtered by id: authorizeTenantAccess
      // proves the caller belongs to this tenant, it does not prove the vehicle
      // ids they sent do.
      const { data, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, vin')
        .eq('tenant_id', tenantId)
        .in('id', lookupIds);

      if (vehiclesError) {
        console.error('[INSHUR eligibility] vehicle lookup failed:', vehiclesError.message);
        return errorResponse('Could not read vehicles', 500);
      }
      vehicles = (data ?? []) as Array<{ id: string; vin: string | null }>;

      const { data: cacheData } = await supabase
        .from('inshur_vehicle_eligibility')
        .select('vehicle_id, vin, eligible, on_period_x, has_tracking_device, has_comp_coll, reason, source_mode, checked_at')
        .eq('tenant_id', tenantId)
        .in('vehicle_id', lookupIds);
      cachedRows = (cacheData ?? []) as CachedEligibility[];
    }

    const cacheByVehicle = new Map(cachedRows.map((r) => [r.vehicle_id, r]));
    const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

    const results: VehicleResult[] = [];
    const toCheck: Array<{ vehicleId: string; vin: string }> = [];
    const upserts: Record<string, unknown>[] = [];
    const nowMs = Date.now();

    for (const vehicleId of requestedIds) {
      const vehicle = vehicleById.get(vehicleId);

      if (!vehicle) {
        results.push({
          vehicleId,
          vin: null,
          eligible: false,
          code: 'not_found',
          reason: UUID_PATTERN.test(vehicleId)
            ? 'This vehicle does not exist on this account.'
            : 'That is not a valid vehicle id.',
          onPeriodX: false,
          hasTrackingDevice: false,
          hasCompColl: false,
          cached: false,
          stored: false,
          sourceMode: config.mode,
          checkedAt: null,
        });
        continue;
      }

      const rawVin = (vehicle.vin ?? '').trim();
      if (!rawVin) {
        // A missing VIN is a gap in our own record, not an ABI verdict. There
        // is nothing to key a cache row on (vin is NOT NULL) and nothing to
        // ask ABI about, so surface it and move on — never a 500.
        results.push({
          vehicleId,
          vin: null,
          eligible: false,
          code: 'no_vin',
          reason: 'This vehicle has no VIN on record. Add the VIN before it can be insured.',
          onPeriodX: false,
          hasTrackingDevice: false,
          hasCompColl: false,
          cached: false,
          stored: false,
          sourceMode: config.mode,
          checkedAt: null,
        });
        continue;
      }

      let vin: string;
      try {
        // normalizeVin runs inside checkVehicleEligibility too; doing it here
        // first turns a malformed VIN into a named data problem rather than a
        // wasted round trip that ABI answers with an anonymous 400.
        vin = normalizeVin(rawVin);
      } catch (err) {
        results.push({
          vehicleId,
          vin: rawVin,
          eligible: false,
          code: 'malformed_vin',
          reason: (err as InshurError).message,
          onPeriodX: false,
          hasTrackingDevice: false,
          hasCompColl: false,
          cached: false,
          stored: false,
          sourceMode: config.mode,
          checkedAt: null,
        });
        continue;
      }

      const cached = cacheByVehicle.get(vehicleId);
      const cacheUsable = Boolean(
        !refresh &&
          cached &&
          // A verdict produced in a different mode says nothing about this one —
          // a simulated pass must never stand in for a real one.
          cached.source_mode === config.mode &&
          // A VIN correction makes the cached verdict a verdict about a
          // different vehicle identity.
          cached.vin === vin &&
          cached.checked_at &&
          nowMs - new Date(cached.checked_at).getTime() < ELIGIBILITY_TTL_MS
      );

      if (cacheUsable && cached) {
        const requirements = {
          onPeriodX: Boolean(cached.on_period_x),
          hasTrackingDevice: Boolean(cached.has_tracking_device),
          hasCompColl: Boolean(cached.has_comp_coll),
        };
        results.push({
          vehicleId,
          vin,
          eligible: Boolean(cached.eligible),
          code: cached.eligible ? 'eligible' : ineligibleCode(requirements),
          reason: cached.reason ?? null,
          ...requirements,
          cached: true,
          stored: true,
          sourceMode: cached.source_mode,
          checkedAt: cached.checked_at,
        });
        continue;
      }

      toCheck.push({ vehicleId, vin });
    }

    let consecutiveFailures = 0;
    let circuitOpen = false;
    const deadline = Date.now() + NETWORK_DEADLINE_MS;

    for (const batch of chunk(toCheck, CONCURRENCY)) {
      const outOfTime = config.mode !== 'mock' && Date.now() > deadline;

      if (circuitOpen || outOfTime) {
        for (const { vehicleId, vin } of batch) {
          results.push({
            vehicleId,
            vin,
            eligible: false,
            code: circuitOpen ? 'check_failed' : 'not_checked',
            reason: circuitOpen
              ? 'INSHUR is not responding. This vehicle was not checked — try again shortly.'
              : 'Ran out of time before this vehicle could be checked. Run the check again for the remainder.',
            onPeriodX: false,
            hasTrackingDevice: false,
            hasCompColl: false,
            cached: false,
            stored: false,
            sourceMode: config.mode,
            checkedAt: null,
          });
        }
        continue;
      }

      const settled = await Promise.all(
        batch.map(async ({ vehicleId, vin }) => {
          try {
            return { vehicleId, vin, eligibility: await checkVehicleEligibility(config, vin), error: null as InshurError | null };
          } catch (err) {
            return { vehicleId, vin, eligibility: null, error: err as InshurError };
          }
        })
      );

      const checkedAt = new Date().toISOString();

      for (const { vehicleId, vin, eligibility, error } of settled) {
        if (error) {
          if (isTransportFailure(error)) consecutiveFailures++;
          // A verdict we could not obtain is not evidence of anything, so it is
          // deliberately not cached — overwriting a good row with a network
          // blip would turn a transient outage into a red fleet.
          results.push({
            vehicleId,
            vin,
            eligible: false,
            code: 'check_failed',
            reason: error.message || 'INSHUR could not confirm this vehicle right now.',
            onPeriodX: false,
            hasTrackingDevice: false,
            hasCompColl: false,
            cached: false,
            stored: false,
            sourceMode: config.mode,
            checkedAt: null,
          });
          console.warn(`[INSHUR eligibility] vehicle ${vehicleId} check failed: ${error.code}`);
          continue;
        }

        consecutiveFailures = 0;
        const verdict = eligibility as InshurEligibility;

        upserts.push({
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          vin,
          eligible: verdict.eligible,
          on_period_x: verdict.requirements.onPeriodX,
          has_tracking_device: verdict.requirements.hasTrackingDevice,
          has_comp_coll: verdict.requirements.hasCompColl,
          reason: verdict.reason,
          source_mode: config.mode,
          checked_at: checkedAt,
          updated_at: checkedAt,
        });

        results.push({
          vehicleId,
          vin,
          eligible: verdict.eligible,
          code: verdict.eligible ? 'eligible' : ineligibleCode(verdict.requirements),
          reason: verdict.reason,
          onPeriodX: verdict.requirements.onPeriodX,
          hasTrackingDevice: verdict.requirements.hasTrackingDevice,
          hasCompColl: verdict.requirements.hasCompColl,
          cached: false,
          stored: true,
          sourceMode: config.mode,
          checkedAt,
        });
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
        circuitOpen = true;
        console.warn(`[INSHUR eligibility] tenant ${tenantId} — ABI unreachable, skipping remaining vehicles`);
      }
    }

    if (upserts.length) {
      const { error: upsertError } = await supabase
        .from('inshur_vehicle_eligibility')
        .upsert(upserts, { onConflict: 'tenant_id,vehicle_id' });

      if (upsertError) {
        // The verdicts are still correct and are returned; only the cache write
        // failed, so mark them unstored rather than failing the whole call.
        console.error('[INSHUR eligibility] cache write failed:', upsertError.message);
        const attempted = new Set(upserts.map((u) => u.vehicle_id as string));
        for (const r of results) if (attempted.has(r.vehicleId)) r.stored = false;
      }
    }

    // Preserve the caller's ordering — the fleet grid renders in the order it asked.
    const byId = new Map(results.map((r) => [r.vehicleId, r]));
    const ordered = requestedIds.map((id) => byId.get(id)!).filter(Boolean);

    return jsonResponse({
      mode: config.mode,
      simulated: config.mode === 'mock',
      issuesRealCover: usability.issuesRealCover,
      results: ordered,
      summary: {
        requested: requestedIds.length,
        eligible: ordered.filter((r) => r.eligible).length,
        ineligible: ordered.filter((r) => !r.eligible && r.code !== 'check_failed' && r.code !== 'not_checked').length,
        failed: ordered.filter((r) => r.code === 'check_failed').length,
        skipped: ordered.filter((r) => r.code === 'not_checked').length,
        fromCache: ordered.filter((r) => r.cached).length,
      },
    });
  } catch (error) {
    console.error('[INSHUR eligibility] Unexpected error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to check vehicle eligibility',
      500
    );
  }
});
