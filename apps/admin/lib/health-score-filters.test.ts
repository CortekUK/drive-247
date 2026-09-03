import { describe, expect, it } from 'vitest';
import {
  HEALTH_STATUSES,
  HEALTH_TREND_SERIES,
  matchesHealthQueueFilters,
  matchesHealthStatusFilter,
  matchesSubscriptionFilter,
  matchesTenantModeFilter,
  visibleHealthTrendSeries,
  type HealthStatus,
  type HealthStatusFilter,
  type HealthTrendFilter,
  type SubscriptionFilter,
  type TenantModeFilter,
} from './health-score-filters';

const FILTERS: HealthStatusFilter[] = [
  'all',
  'attention',
  ...HEALTH_STATUSES,
];

const EXPECTED: Record<HealthStatusFilter, HealthStatus[]> = {
  all: [...HEALTH_STATUSES],
  attention: ['watch', 'at_risk', 'dormant', 'recovering'],
  healthy: ['healthy'],
  watch: ['watch'],
  at_risk: ['at_risk', 'dormant'],
  dormant: ['dormant'],
  recovering: ['recovering'],
  insufficient_data: ['insufficient_data'],
  data_issue: ['data_issue'],
};

describe('matchesHealthStatusFilter', () => {
  for (const filter of FILTERS) {
    it(`matches the complete ${filter} status matrix`, () => {
      const matches = HEALTH_STATUSES.filter((status) =>
        matchesHealthStatusFilter(status, filter),
      );

      expect(matches).toEqual(EXPECTED[filter]);
    });
  }

  it('keeps the KPI/chart At Risk definition aligned with the table', () => {
    const latestStatuses: HealthStatus[] = [
      'at_risk',
      'dormant',
      'dormant',
      'dormant',
      'healthy',
      'watch',
    ];
    const metricCount = latestStatuses.filter((status) =>
      ['at_risk', 'dormant'].includes(status),
    ).length;
    const tableCount = latestStatuses.filter((status) =>
      matchesHealthStatusFilter(status, 'at_risk'),
    ).length;

    expect(metricCount).toBe(4);
    expect(tableCount).toBe(metricCount);
  });

  it('still lets Super Admin narrow the grouped risk result to dormant only', () => {
    expect(matchesHealthStatusFilter('dormant', 'dormant')).toBe(true);
    expect(matchesHealthStatusFilter('at_risk', 'dormant')).toBe(false);
  });

  it.each([
    ['production', 'production', true],
    ['production', null, true],
    ['production', 'test', false],
    ['test', 'production', false],
    ['test', null, false],
    ['test', 'test', true],
    ['all', 'production', true],
    ['all', null, true],
    ['all', 'test', true],
  ] as Array<[TenantModeFilter, string | null, boolean]>)('handles mode %s with tenant type %s', (filter, tenantType, expected) => {
    expect(matchesTenantModeFilter(tenantType, filter)).toBe(expected);
  });

  it.each([
    ['all', null, true],
    ['all', 'active', true],
    ['active', 'active', true],
    ['active', 'trialing', false],
    ['trialing', 'trialing', true],
    ['past_due', 'past_due', true],
    ['none', null, true],
    ['none', 'active', false],
  ] as Array<[SubscriptionFilter, string | null, boolean]>)('handles subscription %s with value %s', (filter, status, expected) => {
    expect(matchesSubscriptionFilter(status, filter)).toBe(expected);
  });

  it('exhaustively combines every status, mode, subscription, and search dimension', () => {
    const modes: TenantModeFilter[] = ['production', 'test', 'all'];
    const subscriptions: SubscriptionFilter[] = ['active', 'trialing', 'past_due', 'none', 'all'];
    const tenantTypes = ['production', 'test', null] as const;
    const subscriptionValues = ['active', 'trialing', 'past_due', null] as const;
    let combinations = 0;

    for (const status of HEALTH_STATUSES) {
      for (const statusFilter of FILTERS) {
        for (const mode of modes) {
          for (const tenantType of tenantTypes) {
            for (const subscription of subscriptions) {
              for (const subscriptionStatus of subscriptionValues) {
                for (const search of ['', 'example', 'EXAMPLE-TENANT', 'missing']) {
                  const actual = matchesHealthQueueFilters({
                    company_name: 'Example Company',
                    slug: 'example-tenant',
                    status,
                    tenant_type: tenantType,
                    subscription_status: subscriptionStatus,
                  }, {
                    search,
                    status: statusFilter,
                    mode,
                    subscription,
                  });
                  const expected = EXPECTED[statusFilter].includes(status)
                    && (mode === 'all' || (mode === 'test') === (tenantType === 'test'))
                    && (subscription === 'all' || subscription === (subscriptionStatus ?? 'none'))
                    && search !== 'missing';

                  expect(actual).toBe(expected);
                  combinations += 1;
                }
              }
            }
          }
        }
      }
    }

    expect(combinations).toBe(45360);
  });

  it.each([
    ['all', HEALTH_TREND_SERIES],
    ['at_risk', ['at_risk']],
    ['healthy', ['healthy']],
    ['watch', ['watch']],
    ['unavailable', ['unavailable']],
  ] as Array<[HealthTrendFilter, readonly string[]]>)('selects the correct %s graph lines', (filter, expected) => {
    expect(visibleHealthTrendSeries(filter)).toEqual(expected);
  });
});
