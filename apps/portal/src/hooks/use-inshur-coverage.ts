'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { extractFunctionError } from '@/lib/edge-error';
import { useInshur, type InshurMode } from '@/hooks/use-inshur';

export type InshurCoverageStatus =
  | 'pending'
  | 'ineligible'
  | 'active'
  | 'ended'
  | 'cancelled'
  | 'failed';

export type InshurUsageType = 'Personal' | 'Rideshare';

export interface InshurCoverage {
  id: string;
  tenant_id: string;
  rental_id: string;
  customer_id: string | null;
  vehicle_id: string | null;
  vin: string;
  inshur_rental_id: string | null;
  inshur_renter_id: string | null;
  status: InshurCoverageStatus;
  usage_type: InshurUsageType;
  state: string | null;
  timezone: string | null;
  /** Verbatim copies of what was sent to ABI, in the rental's local timezone. */
  start_time_sent: string | null;
  end_time_sent: string | null;
  has_comp_coll: boolean | null;
  id_card_url: string | null;
  id_card_fetched_at: string | null;
  /** Stamped when the row was written. NEVER re-derive this from the tenant's
   *  current mode — a row created in simulation stays simulated forever, even
   *  after the operator goes live. */
  source_mode: InshurMode;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  cancelled_at: string | null;
}

/** `pending` and `active` are the two states the partial unique index treats as
 *  occupying the rental — everything else is history. */
const LIVE_STATUSES: InshurCoverageStatus[] = ['pending', 'active'];

export function isLiveInshurStatus(status: InshurCoverageStatus | null | undefined): boolean {
  return !!status && LIVE_STATUSES.includes(status);
}

function inshurCoverageKey(tenantId: string | undefined, rentalId: string | undefined) {
  return ['inshur-coverage', tenantId, rentalId] as const;
}

function normalizeMode(raw: unknown): InshurMode | null {
  return raw === 'live' || raw === 'test' || raw === 'mock' ? raw : null;
}

function readStatus(res: Record<string, any> | null | undefined): InshurCoverageStatus | null {
  const raw = res?.status ?? res?.state;
  const known: InshurCoverageStatus[] = ['pending', 'ineligible', 'active', 'ended', 'cancelled', 'failed'];
  return known.includes(raw) ? raw : null;
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export function useInshurCoverageQuery(rentalId: string | undefined) {
  const { tenant } = useTenant();

  return useQuery({
    queryKey: inshurCoverageKey(tenant?.id, rentalId),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('inshur_rental_coverage')
        .select('*')
        .eq('tenant_id', tenant!.id)
        .eq('rental_id', rentalId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as InshurCoverage[];
    },
    enabled: !!tenant && !!rentalId,
    // ABI publishes no webhooks and binding is drained asynchronously, so a
    // `pending` row is the only signal that an answer is still coming.
    refetchInterval: (query) =>
      (query.state.data as InshurCoverage[] | undefined)?.some((c) => c.status === 'pending') ? 5_000 : false,
    // Overrides the global `false`: operators tab out to portal.abiweb.com to
    // fix a Period X problem and come back expecting the card to have moved on.
    refetchOnWindowFocus: true,
  });
}

/** Fleet-wide count of rentals currently on cover. Head count only — the
 *  dashboard needs the number, not the rows. */
export function useInshurActiveCoverageCount() {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ['inshur-active-coverage-count', tenant?.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from('inshur_rental_coverage')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant!.id)
        .eq('status', 'active');

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!tenant,
    staleTime: 60_000,
  });

  return {
    // null, not 0 — "we could not count" and "nothing is on cover" are
    // different sentences on a dashboard.
    activeCount: typeof query.data === 'number' ? query.data : null,
    isLoading: query.isLoading,
  };
}
// -----------------------------------------------------------------------------
// Mutations
//
// All three write functions take snake_case `tenant_id` / `rental_id` and key
// everything off the rental — there is no coverage id in any request body,
// because the server resolves the one live row itself. That is deliberate on
// their side: a client-supplied coverage id is a second opinion about which row
// is live, and ABI's one-active-period-per-VIN invariant does not survive two
// opinions.
// -----------------------------------------------------------------------------

interface CreateCoverageInput {
  rentalId?: string;
  /** Re-read eligibility and re-register the renter instead of trusting the
   *  caches. It does NOT bypass the one-live-row guard. */
  force?: boolean;
}

interface EndCoverageInput {
  rentalId?: string;
}

export interface CoverageMutationResult {
  ok: boolean;
  coverage: InshurCoverage | null;
  status: InshurCoverageStatus | null;
  mode: InshurMode | null;
  /** Server's own verdict on whether real cover exists. Authoritative. */
  simulated: boolean | null;
  alreadyCovered: boolean;
  /** Nothing to do — the row was already ended or cancelled before this call. */
  alreadyEnded: boolean;
  /** Cancel arrived after the period had started, so it was ended instead. */
  fellBackToEnd: boolean;
  message: string | null;
  warnings: string[];
  error: string | null;
  errorCode: string | null;
}

function parseCoverageResponse(
  data: unknown,
  fallbackMode: InshurMode | null
): CoverageMutationResult {
  const res = (data || {}) as Record<string, any>;
  const coverage = (res.coverage as InshurCoverage) ?? null;
  const mode = normalizeMode(res.mode ?? coverage?.source_mode) ?? fallbackMode;

  return {
    ok: res.ok === true,
    coverage,
    status: readStatus(res) ?? (coverage?.status ?? null),
    mode,
    simulated: typeof res.simulated === 'boolean' ? res.simulated : null,
    alreadyCovered: res.already_covered === true,
    // `inshur-end-coverage` says `already_ended`; `inshur-cancel-coverage` says
    // `already_settled` because the row it finds may be either ended OR
    // cancelled. Reading only the first spelling titled a no-op cancel as though
    // it had just done something.
    alreadyEnded: res.already_ended === true || res.already_settled === true,
    fellBackToEnd: res.fell_back_to_end === true,
    message: typeof res.message === 'string' && res.message.trim() ? res.message : null,
    warnings: Array.isArray(res.warnings) ? res.warnings.filter((w: unknown) => typeof w === 'string') : [],
    error: typeof res.error === 'string' && res.error.trim() ? res.error : null,
    errorCode: typeof res.error_code === 'string' ? res.error_code : null,
  };
}

function describe(result: CoverageMutationResult, fallback: string): string {
  return [result.message ?? fallback, ...result.warnings].join(' ');
}

function useCoverageInvalidator() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  return (rentalId: string | undefined) => {
    queryClient.invalidateQueries({ queryKey: inshurCoverageKey(tenant?.id, rentalId) });
    queryClient.invalidateQueries({ queryKey: ['inshur-active-coverage-count', tenant?.id] });
    queryClient.invalidateQueries({ queryKey: ['rental', rentalId] });
    queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
    // The rental-detail coverage block keeps its own cache of the same rows.
    queryClient.invalidateQueries({ queryKey: ['rental-inshur-coverage', rentalId, tenant?.id] });
  };
}

/**
 * The title is branched on the mode the coverage was actually written in, not
 * on "did the call succeed". A green "Cover started" over a simulated policy is
 * precisely how an operator ends up telling a renter they are insured when
 * nothing left the building. The description prefers the server's own sentence,
 * which is written by the function that knows what really happened.
 */
function coverageCreatedToast(result: CoverageMutationResult) {
  const started = result.status === 'active';

  if (result.status === 'ineligible') {
    return {
      title: 'Vehicle not eligible',
      description: describe(
        result,
        'INSHUR will not cover this vehicle yet. Open the vehicle to see which requirement failed.'
      ),
      variant: 'destructive' as const,
    };
  }

  if (result.alreadyCovered) {
    return {
      title: started ? 'Already covered' : 'Cover already being created',
      description: describe(result, 'This rental already has INSHUR cover.'),
    };
  }

  if (result.mode === 'live') {
    return {
      title: started ? 'Cover started' : 'Cover requested',
      description: describe(
        result,
        started
          ? 'This rental is now covered by INSHUR Period Z.'
          : 'INSHUR has not confirmed cover yet. This card updates itself.'
      ),
    };
  }

  if (result.mode === 'test') {
    return {
      title: started ? 'Test cover created' : 'Test cover requested',
      description: describe(result, 'This used your INSHUR test account. No renter is insured by it.'),
    };
  }

  if (result.mode === 'mock') {
    return {
      title: started ? 'Simulated cover created' : 'Simulated cover requested',
      description: describe(result, 'Nothing reached INSHUR. This rental is not insured.'),
    };
  }

  return {
    title: 'Cover created',
    description: describe(
      result,
      'Could not confirm whether this is real cover. Check Settings → Insurance before telling the renter they are covered.'
    ),
  };
}

export function useCreateInshurCoverage(defaultRentalId?: string) {
  const { tenant } = useTenant();
  const { mode } = useInshur();
  const { toast } = useToast();
  const invalidate = useCoverageInvalidator();

  return useMutation<CoverageMutationResult, Error, CreateCoverageInput | void>({
    mutationFn: async (input) => {
      const vars = (input || {}) as CreateCoverageInput;
      const rentalId = vars.rentalId ?? defaultRentalId;
      if (!rentalId) throw new Error('No rental to cover.');

      const { data, error } = await supabase.functions.invoke('inshur-create-coverage', {
        body: { tenant_id: tenant!.id, rental_id: rentalId, force: vars.force === true },
      });

      if (error) throw new Error(await extractFunctionError(error, 'Could not start INSHUR cover.'));

      const result = parseCoverageResponse(data, mode);
      // The function answers a refused request with HTTP 200 and an `error`
      // field in several places, so a clean `error` from invoke() is not by
      // itself evidence that cover exists.
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result, input) => {
      invalidate(((input || {}) as CreateCoverageInput).rentalId ?? defaultRentalId);
      toast(coverageCreatedToast(result));
    },
    onError: (error) => {
      toast({ title: 'Could not start cover', description: error.message, variant: 'destructive' });
    },
  });
}

export function useEndInshurCoverage(defaultRentalId?: string) {
  const { tenant } = useTenant();
  const { mode } = useInshur();
  const { toast } = useToast();
  const invalidate = useCoverageInvalidator();

  return useMutation<CoverageMutationResult, Error, EndCoverageInput | void>({
    mutationFn: async (input) => {
      const vars = (input || {}) as EndCoverageInput;
      const rentalId = vars.rentalId ?? defaultRentalId;
      if (!rentalId) throw new Error('No rental to end cover for.');

      const { data, error } = await supabase.functions.invoke('inshur-end-coverage', {
        body: { tenant_id: tenant!.id, rental_id: rentalId },
      });

      if (error) throw new Error(await extractFunctionError(error, 'Could not end INSHUR cover.'));

      const result = parseCoverageResponse(data, mode);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result, input) => {
      invalidate(((input || {}) as EndCoverageInput).rentalId ?? defaultRentalId);
      toast({
        title: result.alreadyEnded
          ? 'Cover already ended'
          : result.mode === 'live'
            ? 'Cover ended'
            : 'Simulated cover ended',
        description: describe(
          result,
          result.mode === 'live'
            ? 'INSHUR has been told this rental is over.'
            : 'Nothing reached INSHUR — this row was never real cover.'
        ),
      });
    },
    onError: (error) => {
      toast({ title: 'Could not end cover', description: error.message, variant: 'destructive' });
    },
  });
}

export function useCancelInshurCoverage(defaultRentalId?: string) {
  const { tenant } = useTenant();
  const { mode } = useInshur();
  const { toast } = useToast();
  const invalidate = useCoverageInvalidator();

  return useMutation<CoverageMutationResult, Error, EndCoverageInput | void>({
    mutationFn: async (input) => {
      const vars = (input || {}) as EndCoverageInput;
      const rentalId = vars.rentalId ?? defaultRentalId;
      if (!rentalId) throw new Error('No rental to cancel cover for.');

      const { data, error } = await supabase.functions.invoke('inshur-cancel-coverage', {
        body: { tenant_id: tenant!.id, rental_id: rentalId },
      });

      if (error) throw new Error(await extractFunctionError(error, 'Could not cancel INSHUR cover.'));

      const result = parseCoverageResponse(data, mode);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (result, input) => {
      invalidate(((input || {}) as EndCoverageInput).rentalId ?? defaultRentalId);
      // ABI refuses DELETE once the period has started, so a late cancel is
      // routed to `end` server-side and comes back saying so.
      toast({
        title: result.alreadyEnded
          ? 'Cover already stopped'
          : result.fellBackToEnd
            ? 'Cover ended instead'
            : 'Cover cancelled',
        description: describe(
          result,
          result.mode === 'live'
            ? 'INSHUR has removed this rental.'
            : 'Nothing reached INSHUR — this row was never real cover.'
        ),
      });
    },
    onError: (error) => {
      toast({ title: 'Could not cancel cover', description: error.message, variant: 'destructive' });
    },
  });
}

/**
 * Retry after a `failed` or `ineligible` attempt. It goes to the same function
 * as the first try — that function reuses the settled row and owns the
 * duplicate guard, so re-deciding "is it safe to try again?" on the client would
 * put that judgement on the wrong side of the wire. `force` is on because the
 * point of a retry is to stop trusting the caches that produced the failure.
 */
export function useRetryInshurCoverage(defaultRentalId?: string) {
  const create = useCreateInshurCoverage(defaultRentalId);

  return {
    ...create,
    mutate: (input?: CreateCoverageInput) => create.mutate({ ...(input || {}), force: true }),
    mutateAsync: (input?: CreateCoverageInput) => create.mutateAsync({ ...(input || {}), force: true }),
  };
}

// -----------------------------------------------------------------------------
// Aggregate
// -----------------------------------------------------------------------------

/**
 * Everything the rental-detail coverage card needs. Mutations are pre-bound to
 * `rentalId`, so callers there invoke `create.mutate()` with no arguments.
 */
export function useInshurCoverage(rentalId: string | undefined) {
  const query = useInshurCoverageQuery(rentalId);

  const create = useCreateInshurCoverage(rentalId);
  const end = useEndInshurCoverage(rentalId);
  const cancel = useCancelInshurCoverage(rentalId);
  const retry = useRetryInshurCoverage(rentalId);

  const coverages = query.data ?? null;

  // The row that describes this rental right now: the one occupying it if any,
  // otherwise the most recent piece of history.
  const current = coverages
    ? coverages.find((c) => isLiveInshurStatus(c.status)) ?? coverages[coverages.length - 1] ?? null
    : null;

  const status = current?.status ?? null;

  return {
    coverages,
    coverage: current,
    status,
    hasCoverage: coverages ? coverages.length > 0 : null,
    isCovered: current ? current.status === 'active' : coverages ? false : null,
    isPendingCover: current?.status === 'pending',
    needsAttention: current ? current.status === 'failed' : coverages ? false : null,

    /**
     * Whether this specific row is simulation, read off the row's own stamp.
     * null means there is no row to judge — never assume "real" by default.
     */
    isSimulated: current ? current.source_mode !== 'live' : null,
    sourceMode: current?.source_mode ?? null,

    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,

    create,
    end,
    cancel,
    retry,
    isMutating: create.isPending || end.isPending || cancel.isPending || retry.isPending,
  };
}
