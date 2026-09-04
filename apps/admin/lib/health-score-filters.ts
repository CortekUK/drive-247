export const HEALTH_STATUSES = [
  'healthy',
  'watch',
  'at_risk',
  'dormant',
  'recovering',
  'insufficient_data',
  'data_issue',
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export type HealthStatusFilter = HealthStatus | 'all' | 'attention';
export type TenantModeFilter = 'production' | 'test' | 'all';
export type SubscriptionFilter = 'all' | 'active' | 'trialing' | 'past_due' | 'none';
export type HealthTrendSeries = 'at_risk' | 'healthy' | 'watch' | 'unavailable';
export type HealthTrendFilter = HealthTrendSeries | 'all';

export const HEALTH_TREND_SERIES: readonly HealthTrendSeries[] = [
  'at_risk',
  'healthy',
  'watch',
  'unavailable',
];

export interface HealthQueueFilterableRow {
  company_name: string;
  slug: string;
  status: HealthStatus;
  tenant_type: string | null;
  subscription_status: string | null;
}

export interface HealthQueueFilters {
  search: string;
  status: HealthStatusFilter;
  mode: TenantModeFilter;
  subscription: SubscriptionFilter;
}

const ATTENTION_STATUSES = new Set<HealthStatus>([
  'at_risk',
  'dormant',
  'watch',
  'recovering',
]);

const AT_RISK_STATUSES = new Set<HealthStatus>(['at_risk', 'dormant']);

/**
 * Dashboard risk metrics group dormant tenants with threshold-breach tenants.
 * Keep the At Risk table filter aligned with that same user-facing definition.
 */
export function matchesHealthStatusFilter(
  status: HealthStatus,
  filter: HealthStatusFilter,
) {
  if (filter === 'all') return true;
  if (filter === 'attention') return ATTENTION_STATUSES.has(status);
  if (filter === 'at_risk') return AT_RISK_STATUSES.has(status);
  return status === filter;
}

export function matchesTenantModeFilter(
  tenantType: string | null,
  filter: TenantModeFilter,
) {
  if (filter === 'all') return true;
  const isTest = tenantType === 'test';
  return filter === 'test' ? isTest : !isTest;
}

export function matchesSubscriptionFilter(
  subscriptionStatus: string | null,
  filter: SubscriptionFilter,
) {
  return filter === 'all' || (subscriptionStatus ?? 'none') === filter;
}

export function matchesHealthQueueFilters(
  row: HealthQueueFilterableRow,
  filters: HealthQueueFilters,
) {
  const query = filters.search.trim().toLowerCase();
  if (query && !`${row.company_name} ${row.slug}`.toLowerCase().includes(query)) {
    return false;
  }

  return matchesHealthStatusFilter(row.status, filters.status)
    && matchesTenantModeFilter(row.tenant_type, filters.mode)
    && matchesSubscriptionFilter(row.subscription_status, filters.subscription);
}

export function visibleHealthTrendSeries(filter: HealthTrendFilter) {
  return filter === 'all' ? [...HEALTH_TREND_SERIES] : [filter];
}
