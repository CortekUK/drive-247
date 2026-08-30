'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { extractFunctionError } from '@/lib/edge-error';

export type InshurMode = 'mock' | 'test' | 'live';
export type InshurBillingMode = 'host_absorbs' | 'renter_pays';

/**
 * Three states, deliberately — `unknown` is not a flavour of "no".
 *
 * `useBonzahBalance` collapses a failed lookup into the same falsy value as a
 * genuine zero, which is why the dashboard card reads "$0.00 — top up your
 * balance" both when the operator really has no funds and when the balance call
 * simply errored. Those need opposite actions from the operator, and the second
 * one has sent people to the Bonzah portal to top up an account that was
 * already funded.
 *
 * Every tri-state value below is therefore `T | null`, where `null` means "we
 * could not determine this". `null` is falsy, so a consumer that carelessly
 * writes `if (issuesRealCover)` still fails closed; a consumer that cares can
 * test `=== null` and say so on screen.
 */
export type InshurConfigState = 'loading' | 'unknown' | 'known';

const INSHUR_CONFIG_COLUMNS =
  'integration_inshur, inshur_mode, inshur_username, inshur_password, inshur_customer_number, ' +
  'inshur_policy_number, inshur_2fa_token, inshur_states_allowed, inshur_states_synced_at, ' +
  'inshur_billing_mode, inshur_endpoint_overrides, stripe_mode';

/** Shape held in the query cache. Credentials are reduced to booleans before
 *  they get here — see the queryFn. */
export interface InshurConfig {
  enabled: boolean;
  mode: InshurMode;
  username: string | null;
  hasPassword: boolean;
  customerNumber: string | null;
  policyNumber: string | null;
  hasTwoFactorToken: boolean;
  /** null = never synced from ABI. `[]` = synced, and ABI allows nothing. */
  statesAllowed: string[] | null;
  statesSyncedAt: string | null;
  billingMode: InshurBillingMode;
  endpointOverrides: Record<string, string>;
  stripeMode: 'test' | 'live' | null;
}

export interface InshurVerifyInput {
  /** Verify credentials the operator has typed but not yet saved. Omitted
   *  fields fall back to whatever is stored on the tenant. */
  mode?: InshurMode;
  username?: string;
  password?: string;
  customerNumber?: string;
  policyNumber?: string;
  twoFactorToken?: string;
}

export interface InshurVerifyResult {
  valid: boolean;
  mode: InshurMode | null;
  /** True when nothing left the building — mock mode answered locally. */
  simulated: boolean;
  /** null = the response carried no usable state list (unknown), not "none". */
  statesAllowed: string[] | null;
  /** Which of the two candidate states-allowed paths actually answered. Worth
   *  showing: the two documented paths disagree and this records the winner. */
  statesPath: string | null;
  /** The verified list was written back to the tenant. */
  persisted: boolean;
  /** The deployment's own guard on live mode, independent of the credentials. */
  runtimeAllowsLive: boolean | null;
  twoFactorRequired: boolean;
  errorCode: string | null;
  error: string | null;
}

/**
 * Mirrors `normalizeMode` in `_shared/inshur-client.ts` exactly. If the two ever
 * disagree the UI would label a tenant as simulating while the server writes
 * real policies, which is the single worst outcome this integration has.
 */
function normalizeMode(raw: unknown): InshurMode {
  return raw === 'live' || raw === 'test' ? raw : 'mock';
}

/** For responses, where a missing mode means "not stated", not "mock". */
function normalizeModeOrNull(raw: unknown): InshurMode | null {
  return raw === 'live' || raw === 'test' || raw === 'mock' ? raw : null;
}

function normalizeBillingMode(raw: unknown): InshurBillingMode {
  return raw === 'renter_pays' ? 'renter_pays' : 'host_absorbs';
}

/** jsonb arrives as an array, but a hand-edited row can hold a JSON string. */
function parseStates(raw: unknown): string[] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  return value
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function useInshur() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ['inshur-config', tenant?.id],
    queryFn: async (): Promise<InshurConfig> => {
      const { data, error } = await (supabase as any)
        .from('tenants')
        .select(INSHUR_CONFIG_COLUMNS)
        .eq('id', tenant!.id)
        .single();

      if (error) throw error;

      const row = data as Record<string, any>;
      const syncedAt: string | null = row.inshur_states_synced_at ?? null;

      return {
        enabled: row.integration_inshur === true,
        mode: normalizeMode(row.inshur_mode),
        username: row.inshur_username?.trim() || null,
        // The password is read (there is no `*_set` column to read instead) but
        // reduced to a boolean here, inside the queryFn, so the secret is never
        // parked in the React Query cache where every devtools panel and error
        // reporter can see it.
        hasPassword: !!row.inshur_password?.trim(),
        customerNumber: row.inshur_customer_number?.trim() || null,
        policyNumber: row.inshur_policy_number?.trim() || null,
        hasTwoFactorToken: !!row.inshur_2fa_token?.trim(),
        // Without the synced-at stamp an empty array is indistinguishable from
        // "we have never asked ABI" — the exact conflation this hook exists to
        // avoid. No stamp, no answer.
        statesAllowed: syncedAt ? parseStates(row.inshur_states_allowed) : null,
        statesSyncedAt: syncedAt,
        billingMode: normalizeBillingMode(row.inshur_billing_mode),
        endpointOverrides:
          row.inshur_endpoint_overrides && typeof row.inshur_endpoint_overrides === 'object'
            ? (row.inshur_endpoint_overrides as Record<string, string>)
            : {},
        stripeMode: row.stripe_mode === 'live' ? 'live' : row.stripe_mode === 'test' ? 'test' : null,
      };
    },
    enabled: !!tenant,
    staleTime: 30_000,
  });

  const config = configQuery.data ?? null;

  const configState: InshurConfigState = config
    ? 'known'
    : configQuery.isLoading || configQuery.isPending
      ? 'loading'
      : 'unknown';

  const known = configState === 'known';

  const mode = known ? config!.mode : null;
  const enabled = known ? config!.enabled : null;

  const hasCredentials = known
    ? !!config!.username && config!.hasPassword && !!config!.customerNumber && !!config!.policyNumber
    : null;

  const missingFields = known
    ? [
        !config!.username && 'username',
        !config!.hasPassword && 'password',
        !config!.customerNumber && 'customer number',
        !config!.policyNumber && 'policy number',
      ].filter((f): f is string => typeof f === 'string')
    : null;

  // Mock needs no credentials at all — that is what makes the whole flow
  // exercisable before INSHUR hands anything over. Test and live do.
  const isConfigured = known
    ? config!.enabled && (config!.mode === 'mock' || hasCredentials === true)
    : null;

  const issuesRealCover = known ? config!.mode === 'live' && isConfigured === true : null;
  const isSimulated = known ? config!.mode === 'mock' : null;

  const statesAllowed = known ? config!.statesAllowed : null;

  const isStateAllowed = useCallback(
    (state: string | null | undefined): boolean | null => {
      if (!statesAllowed || !state) return null;
      return statesAllowed.includes(state.trim().toUpperCase());
    },
    [statesAllowed]
  );

  /**
   * The Bonzah incident in one boolean: a tenant taking real card payments while
   * the insurance behind them is simulated. The renter is charged and receives
   * cover that does not exist. Consumers render this as an escalated, red,
   * un-dismissible warning — see the simulation banner.
   */
  const simulatedWhileStripeLive = known
    ? config!.enabled && config!.mode !== 'live' && config!.stripeMode === 'live'
    : null;

  const verify = useMutation<InshurVerifyResult, Error, InshurVerifyInput | void>({
    mutationFn: async (input) => {
      const draft = (input || {}) as InshurVerifyInput;

      const { data, error } = await supabase.functions.invoke('inshur-verify-credentials', {
        body: {
          tenant_id: tenant!.id,
          mode: draft.mode,
          username: draft.username,
          password: draft.password,
          customerNumber: draft.customerNumber,
          policyNumber: draft.policyNumber,
          twoFactorToken: draft.twoFactorToken,
        },
      });

      // Every verification OUTCOME is a 200 with `ok:false` — a rejected
      // credential is the answer to the question, not a transport failure. Only
      // auth and malformed requests reach here.
      if (error) throw new Error(await extractFunctionError(error, 'Could not reach INSHUR.'));

      const res = (data || {}) as Record<string, any>;
      const valid = res.ok === true;

      return {
        valid,
        mode: normalizeModeOrNull(res.mode),
        simulated: res.simulated === true,
        // The function sends `states: []` alongside every failure. Reporting
        // that as "INSHUR covers no states" would be a fabrication — a failed
        // verification tells us nothing about coverage areas.
        statesAllowed: valid && Array.isArray(res.states) ? parseStates(res.states) : null,
        statesPath: typeof res.statesPath === 'string' ? res.statesPath : null,
        persisted: res.persisted === true,
        runtimeAllowsLive: typeof res.runtimeAllowsLive === 'boolean' ? res.runtimeAllowsLive : null,
        twoFactorRequired: res.twoFactorRequired === true,
        errorCode: typeof res.code === 'string' ? res.code : null,
        error: typeof res.error === 'string' && res.error.trim() ? res.error : null,
      };
    },
    onSettled: () => {
      // A successful verify caches the state list server-side, so re-read the
      // config whichever way the call went.
      queryClient.invalidateQueries({ queryKey: ['inshur-config', tenant?.id] });
    },
  });

  return {
    configState,
    isLoading: configQuery.isLoading,
    isFetching: configQuery.isFetching,
    error: (configQuery.error as Error | null) ?? null,
    refetch: configQuery.refetch,

    enabled,
    mode,
    isConfigured,
    hasCredentials,
    missingFields,
    issuesRealCover,
    isSimulated,

    statesAllowed,
    statesSyncedAt: known ? config!.statesSyncedAt : null,
    isStateAllowed,

    billingMode: known ? config!.billingMode : null,
    renterPays: known ? config!.billingMode === 'renter_pays' : null,
    endpointOverrides: known ? config!.endpointOverrides : {},

    stripeMode: known ? config!.stripeMode : null,
    simulatedWhileStripeLive,

    verify,
  };
}
