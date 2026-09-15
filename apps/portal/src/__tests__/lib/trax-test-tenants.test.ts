import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTraxTestTenant, parseTraxTestTenants, traxTestTenantSlugs } from '@/lib/trax-test-tenants';

afterEach(() => { vi.unstubAllEnvs(); });

describe('local TRAX test tenants', () => {
  it('parses a bounded, normalized slug list', () => {
    expect(parseTraxTestTenants(' Test, jangramrentals ,,test, bad slug, ../x ')).toEqual(['test', 'jangramrentals']);
    expect(parseTraxTestTenants(undefined)).toEqual([]);
    expect(parseTraxTestTenants(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','))).toHaveLength(20);
  });
  it('applies only in local development', () => {
    vi.stubEnv('NEXT_PUBLIC_TRAX_TEST_TENANTS', 'test,jangramrentals');
    vi.stubEnv('NODE_ENV', 'development');
    expect(traxTestTenantSlugs()).toEqual(['test', 'jangramrentals']);
    expect(isTraxTestTenant('jangramrentals')).toBe(true);
    expect(isTraxTestTenant('globalmotiontransport')).toBe(false);
    expect(isTraxTestTenant(undefined)).toBe(false);
    vi.stubEnv('NODE_ENV', 'production');
    expect(traxTestTenantSlugs()).toEqual([]);
    expect(isTraxTestTenant('jangramrentals')).toBe(false);
  });
});
