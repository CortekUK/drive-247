'use client';

/**
 * Integration billing — React hooks. Every read is scoped to the signed-in
 * tenant and switched on only for the integration-billing tenant, so no other
 * tenant issues a single extra query.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/contexts/TenantContext';
import { supabaseUntyped } from '@/integrations/supabase/client';
import { isMissingTableError } from '@/lib/agreements-v2/status';
import { isIntegrationBillingTenant } from './gate';
import { catalogFromRows, type CatalogEntry, type CatalogRow } from './catalog';
import {
  fetchInvoiceLines,
  fetchUpcomingInvoice,
  subscribeToIntegration,
  type InvoiceSummary,
  type SubscribeResult,
  type UpcomingInvoice,
} from './api-client';

/** Is the signed-in tenant on integration billing (premium integrations, no credits)? */
export function useIntegrationBilling(): boolean {
  const { tenant, tenantSlug } = useTenant();
  return isIntegrationBillingTenant(tenantSlug ?? tenant?.slug ?? null);
}

export const CATALOG_QUERY_KEY = 'integration-catalog-v2';
export const SUBSCRIPTIONS_QUERY_KEY = 'integration-subscriptions-v2';
export const UPCOMING_QUERY_KEY = 'integration-upcoming-invoice-v2';

/**
 * The catalog, one entry per board integration. When the table is missing,
 * the read fails, or the tenant is not on integration billing, it answers the
 * DEFAULTS (catalog.ts: every integration free and visible, except the three
 * premium-by-default ones). Callers must gate on `useIntegrationBilling()`
 * themselves before showing anything from it.
 */
export function useIntegrationCatalog(): { catalog: Record<string, CatalogEntry>; isLoading: boolean } {
  const enabled = useIntegrationBilling();
  const query = useQuery({
    queryKey: [CATALOG_QUERY_KEY],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('integration_catalog_v2')
        .select('integration_key, is_premium, monthly_price_cents, currency, first_month_free, is_hidden, is_beta, is_unavailable');
      if (error) {
        if (!isMissingTableError(error)) console.error('[integration-billing] catalog read failed:', error.message);
        return [];
      }
      return (data ?? []) as CatalogRow[];
    },
  });
  return { catalog: catalogFromRows(enabled ? query.data : []), isLoading: enabled && query.isLoading };
}

export interface IntegrationSubscriptionRow {
  id: string;
  integration_key: string;
  status: 'pending' | 'active' | 'canceled' | 'failed';
  monthly_price_cents: number;
  currency: string;
  first_month_free: boolean;
  first_bill_at: string | null;
  subscribed_at: string;
  canceled_at: string | null;
  stripe_subscription_id: string;
}

/**
 * Was this integration ever on one of the tenant's bills? The same rule as the
 * edge function's `wasOnABill`: what uses up the free first month.
 */
export function wasOnABill(row: { first_bill_at: string | null; canceled_at: string | null }, now = new Date()): boolean {
  if (!row.first_bill_at) return false;
  const firstBill = new Date(row.first_bill_at).getTime();
  const until = row.canceled_at ? new Date(row.canceled_at).getTime() : now.getTime();
  return Number.isFinite(firstBill) && firstBill <= until;
}

/**
 * This tenant's integration subscriptions: `byKey` holds the live one (pending
 * or active) per key; `everBilled` the keys that were ever on a bill (active or
 * canceled), because the free first month is only for the first time — the
 * edge function applies the same rule, this only lets the dialog say it.
 */
export function useIntegrationSubscriptions(): {
  byKey: Record<string, IntegrationSubscriptionRow>;
  everBilled: ReadonlySet<string>;
  isLoading: boolean;
} {
  const enabled = useIntegrationBilling();
  const { tenant } = useTenant();
  // Which platform subscriptions are live. A row on one that has since ended
  // (or been replaced) ended with it, and must not read as "Subscribed".
  const livePlans = useQuery({
    queryKey: ['integration-live-plans-v2', tenant?.id],
    enabled: enabled && !!tenant?.id,
    queryFn: async (): Promise<string[] | null> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_subscriptions')
        .select('stripe_subscription_id')
        .eq('tenant_id', tenant!.id)
        .in('status', ['active', 'trialing', 'past_due']);
      // A failed read must never hide something the tenant is paying for.
      if (error) return null;
      return ((data ?? []) as Array<{ stripe_subscription_id: string }>).map((r) => r.stripe_subscription_id);
    },
  });
  const query = useQuery({
    queryKey: [SUBSCRIPTIONS_QUERY_KEY, tenant?.id],
    enabled: enabled && !!tenant?.id,
    queryFn: async (): Promise<IntegrationSubscriptionRow[]> => {
      const { data, error } = await supabaseUntyped
        .from('tenant_integration_subscriptions_v2')
        .select('id, integration_key, status, monthly_price_cents, currency, first_month_free, first_bill_at, subscribed_at, canceled_at, stripe_subscription_id')
        .eq('tenant_id', tenant!.id);
      if (error) {
        if (!isMissingTableError(error)) console.error('[integration-billing] subscriptions read failed:', error.message);
        return [];
      }
      return (data ?? []) as IntegrationSubscriptionRow[];
    },
  });
  const byKey: Record<string, IntegrationSubscriptionRow> = {};
  const everBilled = new Set<string>();
  const liveIds = livePlans.data;
  for (const row of query.data ?? []) {
    const live = row.status === 'pending' || row.status === 'active';
    // Until the plans are known (loading, or a failed read), trust the row.
    const onLivePlan = !Array.isArray(liveIds) || liveIds.includes(row.stripe_subscription_id);
    if (live && onLivePlan) byKey[row.integration_key] = row;
    if ((row.status === 'canceled' || (live && !onLivePlan)) && wasOnABill(row)) everBilled.add(row.integration_key);
  }
  return { byKey, everBilled, isLoading: enabled && query.isLoading };
}

/** Subscribe, then refresh everything that shows it: the board, the next invoice, the plan. */
export function useSubscribeToIntegration() {
  const queryClient = useQueryClient();
  return useMutation<SubscribeResult, Error, string>({
    mutationFn: (integrationKey: string) => subscribeToIntegration(integrationKey),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [SUBSCRIPTIONS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [UPCOMING_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ['tenant-subscription'] });
    },
  });
}

/** The next invoice, line by line (only for the integration-billing tenant). */
export function useUpcomingInvoice(opts: { enabled: boolean }) {
  const gate = useIntegrationBilling();
  const { tenant } = useTenant();
  return useQuery<UpcomingInvoice | null, Error>({
    queryKey: [UPCOMING_QUERY_KEY, tenant?.id],
    enabled: gate && opts.enabled && !!tenant?.id,
    staleTime: 30_000,
    retry: 1,
    queryFn: () => fetchUpcomingInvoice(),
  });
}

/** One past invoice, line by line, fetched when its receipt is opened. */
export function useInvoiceLines(stripeInvoiceId: string | null | undefined) {
  const gate = useIntegrationBilling();
  return useQuery<InvoiceSummary, Error>({
    queryKey: ['integration-invoice-lines-v2', stripeInvoiceId],
    enabled: gate && !!stripeInvoiceId,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => fetchInvoiceLines(stripeInvoiceId!),
  });
}
