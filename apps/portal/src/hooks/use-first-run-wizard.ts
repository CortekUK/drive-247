'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { isLeanTenant } from '@/lib/lean-areas';
import {
  FIRST_RUN_QUESTION_SET_VERSION,
  type FirstRunAnswers,
} from '@/lib/first-run-questions';

export interface TenantFirstRunRow {
  id: string;
  tenant_id: string;
  answers: FirstRunAnswers;
  question_set_version: number;
  was_skipped: boolean;
  completed_at: string;
}

export const firstRunQueryKey = (tenantId: string | undefined) => [
  'tenant-first-run',
  tenantId,
];

/**
 * The first-run onboarding wizard's state.
 *
 * GATING — northwind only, keyed on the tenant's SLUG.
 * ---------------------------------------------------
 * `isLeanTenant` from `lib/lean-areas` is the predicate, not `isAreaHidden`:
 * that one answers "is this area hidden FROM a lean tenant", which is the exact
 * inverse of what this needs. The wizard is a lean-product screen the other 57
 * tenants have never had and must not suddenly meet.
 *
 * The slug comes from `tenant.slug` — the row that actually came back — and
 * NOT from `tenantSlug`, which TenantContext derives from
 * `window.location.hostname` before any lookup has happened. Keying on the
 * resolved row collapses the third case for free: a bogus host like
 * `nosuchtenant.portal.…` leaves `tenant` null, so the wizard cannot show, and
 * neither can it show for a host that merely *spells* the canary in an
 * environment where the canary does not exist. It also guarantees `tenant.id`
 * is in hand before anything is written.
 *
 * Never key on the id. `northwind` is 6e5c544f-… in production and 8e6bc88f-…
 * on the staging branch, so an id-keyed gate silently resolves to the ungated
 * path in whichever environment it was not written against — no error, no
 * failed build, the screen simply never changes.
 *
 * FAIL-CLOSED on anything unknown.
 * --------------------------------
 * `shouldShow` requires a query that genuinely SUCCEEDED and came back empty.
 * A loading, errored or disabled query shows nothing. That matters more than
 * usual here because the migration that creates `tenant_first_run` is
 * deliberately shipped unapplied: until it is run, every select against the
 * table 404s, and the only acceptable behaviour for a full-screen blocker whose
 * storage is missing is to stay out of the way.
 */
export function useFirstRunWizard() {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const queryClient = useQueryClient();

  const isCanary = isLeanTenant(tenant?.slug);
  const enabled = isCanary && !!tenant?.id;

  const query = useQuery({
    queryKey: firstRunQueryKey(tenant?.id),
    queryFn: async (): Promise<TenantFirstRunRow | null> => {
      // Untyped: `tenant_first_run` is not in the generated types until the
      // migration is applied and types are regenerated.
      const { data, error } = await (supabase as any)
        .from('tenant_first_run')
        .select('id, tenant_id, answers, question_set_version, was_skipped, completed_at')
        .eq('tenant_id', tenant!.id)
        .maybeSingle();

      if (error) throw error;
      return (data as TenantFirstRunRow | null) ?? null;
    },
    enabled,
    // The answer cannot change behind our back: this tenant's row is written
    // exactly once, from this screen.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // One round trip. A missing table is not going to appear on a retry, and
    // every retry holds the dashboard's first paint that much longer.
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (input: {
      answers: FirstRunAnswers;
      skipped: boolean;
    }): Promise<void> => {
      // Upsert on the UNIQUE tenant_id, so a double-click, a retry after a
      // dropped response, or two tabs finishing at once all converge on one row
      // instead of failing with a duplicate-key error the operator would see.
      const { error } = await (supabase as any)
        .from('tenant_first_run')
        .upsert(
          {
            tenant_id: tenant!.id,
            answers: input.skipped ? {} : input.answers,
            question_set_version: FIRST_RUN_QUESTION_SET_VERSION,
            was_skipped: input.skipped,
            completed_by: appUser?.id ?? null,
          },
          { onConflict: 'tenant_id' },
        );

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: firstRunQueryKey(tenant?.id),
      });
    },
  });

  return {
    isCanary,
    /**
     * Show the wizard? Only when the canary's row is *known* to be absent.
     * `isSuccess` rather than `!isLoading` — an errored query means "unknown",
     * and unknown must never put a non-dismissible screen over the dashboard.
     */
    shouldShow: enabled && query.isSuccess && query.data === null,
    row: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    save,
  };
}
