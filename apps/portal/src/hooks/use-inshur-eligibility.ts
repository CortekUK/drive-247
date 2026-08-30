'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { extractFunctionError } from '@/lib/edge-error';
import { useInshur, type InshurMode } from '@/hooks/use-inshur';

/** A cached verdict older than this is shown as stale rather than as fact — an
 *  operator can add or remove a VIN from their Period X policy at any time and
 *  ABI tells us nothing when they do. */
export const INSHUR_ELIGIBILITY_STALE_DAYS = 7;

export interface InshurEligibility {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  vin: string;
  eligible: boolean;
  on_period_x: boolean;
  has_tracking_device: boolean;
  has_comp_coll: boolean;
  reason: string | null;
  /** Which mode produced this verdict. A `mock` row is not evidence that a real
   *  vehicle is really insurable. */
  source_mode: InshurMode;
  checked_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Four outcomes, not two.
 *
 * `unchecked` (no row yet) and `unknown` (the read itself failed) both leave
 * `eligible` null, but they are different problems: the first is fixed by
 * pressing Re-check, the second means the page is showing nothing trustworthy.
 */
export type InshurEligibilityState = 'loading' | 'unknown' | 'unchecked' | 'known';

const ELIGIBILITY_COLUMNS =
  'id, tenant_id, vehicle_id, vin, eligible, on_period_x, has_tracking_device, has_comp_coll, ' +
  'reason, source_mode, checked_at, created_at, updated_at';

function isStale(checkedAt: string | null | undefined): boolean {
  if (!checkedAt) return true;
  const age = Date.now() - new Date(checkedAt).getTime();
  return age > INSHUR_ELIGIBILITY_STALE_DAYS * 24 * 60 * 60 * 1000;
}

// -----------------------------------------------------------------------------
// Refresh
// -----------------------------------------------------------------------------

interface RefreshEligibilityInput {
  vehicleId?: string;
}

/**
 * `check_failed` and `not_checked` are verdict-shaped but are not verdicts —
 * the server still sends `eligible: false` with them because the field is a
 * boolean. Flattening that into "not eligible" would tell an operator their
 * vehicle had been rejected by ABI when in fact ABI was never reached.
 */
const NON_VERDICT_CODES = ['check_failed', 'not_checked'];

interface RefreshEligibilityResult {
  vehicleId: string | null;
  /** null when the check produced no verdict at all. */
  eligible: boolean | null;
  code: string | null;
  reason: string | null;
  onPeriodX: boolean | null;
  hasTrackingDevice: boolean | null;
  hasCompColl: boolean | null;
  cached: boolean;
  /** False when the verdict was not written to the cache, so the badges on
   *  other screens will not have moved. */
  stored: boolean;
  mode: InshurMode | null;
  checkedAt: string | null;
}

function normalizeMode(raw: unknown): InshurMode | null {
  return raw === 'live' || raw === 'test' || raw === 'mock' ? raw : null;
}

function readBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Manual "Re-check with ABI" for one vehicle.
 *
 * The edge function also accepts `vehicle_ids` for a whole-fleet sweep in a
 * single call; a Settings-level "re-check everything" button should use that
 * rather than looping this mutation, because ABI publishes no rate limits and
 * the server already throttles its own fan-out.
 */
export function useRefreshInshurEligibility(defaultVehicleId?: string) {
  const { tenant } = useTenant();
  const { mode } = useInshur();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation<RefreshEligibilityResult, Error, RefreshEligibilityInput | void>({
    mutationFn: async (input) => {
      const vars = (input || {}) as RefreshEligibilityInput;
      const vehicleId = vars.vehicleId ?? defaultVehicleId;
      if (!vehicleId) throw new Error('No vehicle to check.');

      const { data, error } = await supabase.functions.invoke('inshur-check-eligibility', {
        body: { tenant_id: tenant!.id, vehicle_id: vehicleId, force: true },
      });

      if (error) throw new Error(await extractFunctionError(error, 'Could not check this vehicle with INSHUR.'));

      const res = (data || {}) as Record<string, any>;
      const first = Array.isArray(res.results) ? res.results[0] : null;
      if (!first) throw new Error('INSHUR did not return a verdict for this vehicle.');

      const code = typeof first.code === 'string' ? first.code : null;
      const verdictless = !code || NON_VERDICT_CODES.includes(code);

      return {
        vehicleId: first.vehicleId ?? vehicleId,
        eligible: verdictless ? null : first.eligible === true,
        code,
        reason: typeof first.reason === 'string' && first.reason.trim() ? first.reason : null,
        onPeriodX: readBool(first.onPeriodX),
        hasTrackingDevice: readBool(first.hasTrackingDevice),
        hasCompColl: readBool(first.hasCompColl),
        cached: first.cached === true,
        stored: first.stored === true,
        mode: normalizeMode(res.mode ?? first.sourceMode) ?? mode,
        checkedAt: first.checkedAt ?? null,
      };
    },
    onSuccess: (result, input) => {
      const vehicleId = ((input || {}) as RefreshEligibilityInput).vehicleId ?? defaultVehicleId;
      queryClient.invalidateQueries({ queryKey: ['inshur-eligibility', tenant?.id, vehicleId] });
      queryClient.invalidateQueries({ queryKey: ['inshur-fleet-eligibility', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      // The vehicles-list badge keeps its own cache of the same two reads.
      queryClient.invalidateQueries({ queryKey: ['inshur-eligibility-map', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['inshur-vehicle-eligibility', tenant?.id, vehicleId] });

      // A mock or test verdict says nothing about whether the real vehicle is
      // on a real Period X policy. Never let it read as confirmation.
      const simulatedPrefix =
        result.mode === 'live' ? '' : 'Simulated result — nothing was checked with INSHUR. ';

      if (result.eligible === true) {
        toast({
          title: 'Vehicle is eligible',
          description: `${simulatedPrefix}Period Z cover can be started for this vehicle.`,
        });
        return;
      }

      if (result.eligible === false) {
        toast({
          title: 'Vehicle is not eligible',
          description: simulatedPrefix + (result.reason || 'INSHUR gave no reason for this verdict.'),
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Could not check this vehicle',
        description:
          result.reason ||
          'INSHUR did not answer with a verdict, so this vehicle’s status is unchanged. Try again shortly.',
        variant: 'destructive',
      });
    },
    onError: (error) => {
      toast({ title: 'Eligibility check failed', description: error.message, variant: 'destructive' });
    },
  });
}

// -----------------------------------------------------------------------------
// Per-vehicle
// -----------------------------------------------------------------------------

export function useInshurEligibility(vehicleId: string | undefined) {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ['inshur-eligibility', tenant?.id, vehicleId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('inshur_vehicle_eligibility')
        .select(ELIGIBILITY_COLUMNS)
        .eq('tenant_id', tenant!.id)
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (error) throw error;
      return (data as InshurEligibility) ?? null;
    },
    enabled: !!tenant && !!vehicleId,
    staleTime: 60_000,
  });

  const refresh = useRefreshInshurEligibility(vehicleId);

  const row = query.data ?? null;

  const state: InshurEligibilityState = row
    ? 'known'
    : query.isLoading || query.isPending
      ? 'loading'
      : query.isError
        ? 'unknown'
        : 'unchecked';

  return {
    eligibility: row,
    state,

    /** null in every state except `known` — an unchecked vehicle is not an
     *  ineligible one, and neither is a vehicle whose row failed to load. */
    eligible: state === 'known' ? row!.eligible : null,
    onPeriodX: state === 'known' ? row!.on_period_x : null,
    hasTrackingDevice: state === 'known' ? row!.has_tracking_device : null,
    hasCompColl: state === 'known' ? row!.has_comp_coll : null,
    reason: row?.reason ?? null,

    checkedAt: row?.checked_at ?? null,
    isStale: state === 'known' ? isStale(row!.checked_at) : null,
    /** True when this verdict came from simulation rather than from ABI. */
    isSimulated: state === 'known' ? row!.source_mode !== 'live' : null,
    sourceMode: row?.source_mode ?? null,

    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,

    refresh,
    isRefreshing: refresh.isPending,
  };
}

// -----------------------------------------------------------------------------
// Fleet
// -----------------------------------------------------------------------------

interface FleetVehicle {
  id: string;
  reg: string;
  vin: string | null;
}

export interface InshurFleetEligibility {
  /** Every count is `number | null`. null means the read failed — which must
   *  not render as "0 vehicles eligible", the failure mode this integration
   *  inherited from the Bonzah balance card. */
  total: number | null;
  eligible: number | null;
  ineligible: number | null;
  needsPeriodX: number | null;
  noTracker: number | null;
  noCompColl: number | null;
  noVin: number | null;
  unchecked: number | null;
  stale: number | null;
  /** Verdicts produced in mock or test mode. Non-zero means the fleet numbers
   *  above describe a simulation, not the real fleet. */
  simulated: number | null;
  byVehicle: Map<string, InshurEligibility>;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useInshurFleetEligibility(): InshurFleetEligibility {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ['inshur-fleet-eligibility', tenant?.id],
    queryFn: async () => {
      const [vehicleRes, eligibilityRes] = await Promise.all([
        (supabase as any)
          .from('vehicles')
          .select('id, reg, vin')
          .eq('tenant_id', tenant!.id)
          // A disposed vehicle can never be rented, so counting it as
          // "not eligible" would understate readiness forever.
          .or('is_disposed.is.null,is_disposed.eq.false'),
        (supabase as any)
          .from('inshur_vehicle_eligibility')
          .select(ELIGIBILITY_COLUMNS)
          .eq('tenant_id', tenant!.id),
      ]);

      // Either half missing makes every count a lie, so fail the whole query
      // and let the caller show "unavailable" rather than a plausible zero.
      if (vehicleRes.error) throw vehicleRes.error;
      if (eligibilityRes.error) throw eligibilityRes.error;

      return {
        vehicles: (vehicleRes.data || []) as FleetVehicle[],
        rows: (eligibilityRes.data || []) as InshurEligibility[],
      };
    },
    enabled: !!tenant,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const byVehicle = new Map<string, InshurEligibility>();
    const data = query.data;

    if (!data) {
      return {
        total: null,
        eligible: null,
        ineligible: null,
        needsPeriodX: null,
        noTracker: null,
        noCompColl: null,
        noVin: null,
        unchecked: null,
        stale: null,
        simulated: null,
        byVehicle,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
      };
    }

    for (const row of data.rows) byVehicle.set(row.vehicle_id, row);

    let eligible = 0;
    let ineligible = 0;
    let needsPeriodX = 0;
    let noTracker = 0;
    let noCompColl = 0;
    let noVin = 0;
    let unchecked = 0;
    let stale = 0;
    let simulated = 0;

    for (const vehicle of data.vehicles) {
      if (!vehicle.vin?.trim()) {
        // INSHUR identifies vehicles by VIN only, so this one cannot even be
        // asked about. It is its own bucket, not an ineligible vehicle.
        noVin++;
        continue;
      }

      const row = byVehicle.get(vehicle.id);
      if (!row) {
        unchecked++;
        continue;
      }

      if (row.source_mode !== 'live') simulated++;
      if (isStale(row.checked_at)) stale++;

      if (row.eligible) {
        eligible++;
        continue;
      }

      ineligible++;
      if (!row.on_period_x) needsPeriodX++;
      else if (!row.has_tracking_device) noTracker++;
      else if (!row.has_comp_coll) noCompColl++;
    }

    return {
      total: data.vehicles.length,
      eligible,
      ineligible,
      needsPeriodX,
      noTracker,
      noCompColl,
      noVin,
      unchecked,
      stale,
      simulated,
      byVehicle,
      isLoading: query.isLoading,
      isError: query.isError,
      refetch: query.refetch,
    };
  }, [query.data, query.isLoading, query.isError, query.refetch]);
}
