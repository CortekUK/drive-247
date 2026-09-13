import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { POST } from '@/app/api/trax-support/route';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
const tenantId = '00000000-0000-4000-8000-000000000001';
const otherTenant = '00000000-0000-4000-8000-000000000002';
let tenant: Record<string, unknown>;
let staff: Record<string, unknown>;
const queries: { table: string; fields?: string; filters: Record<string, string>; limit?: number }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://offline.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'offline-test-signing-material-not-a-credential');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this test.'); }));
  tenant = { id: tenantId, slug: 'northwind', status: 'active' };
  staff = { id: 'staff-a', auth_user_id: 'user-a', tenant_id: tenantId, role: 'admin', is_active: true, is_super_admin: false };
  queries.length = 0;
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  mocks.from.mockImplementation((table: string) => {
    const record: typeof queries[number] = { table, filters: {} }; queries.push(record);
    const data = () => table === 'app_users' ? staff : table === 'tenants' ? tenant : table === 'manager_permissions' ? [] : null;
    const query = {
      select: (fields: string) => { record.fields = fields; return query; },
      eq: (column: string, value: string) => { record.filters[column] = value; return query; },
      limit: (count: number) => { record.limit = count; return query; },
      maybeSingle: async () => ({ data: data(), error: null }),
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: data(), error: null }).then(resolve),
    };
    return query;
  });
  mocks.createClient.mockImplementation(() => ({ auth: { getUser: mocks.getUser }, from: mocks.from }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function request(body: Record<string, unknown> = { message: 'Where are rentals?' }, token = 'offline-session') {
  const response = await POST(new Request('http://northwind.portal.localhost:4002/api/trax-support', {
    method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

describe('local V2 TRAX with the real authorization and guidance handler', () => {
  it('is unavailable in production before constructing a database client', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await request()).response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('rejects a missing bearer token before reading any data', async () => {
    expect((await request({}, '')).response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])('fails closed without %s', async (name) => {
    vi.stubEnv(name, '');
    const result = await request();
    expect(result.response.status).toBe(503);
    expect(result.body.code).toBe('local_configuration_required');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('verifies the real session instead of accepting a local fake identity', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'private auth failure' } });
    const result = await request();
    expect(result.response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(JSON.stringify(result.body)).not.toContain('private auth failure');
  });
  it('serves prepared guidance and revalidates membership before responding', async () => {
    const result = await request();
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('X-TRAX-Runtime')).toBe('local-development');
    expect(result.response.headers.get('Cache-Control')).toBe('no-store');
    expect(result.body.sources[0].id).toBe('rentals');
    expect(result.body.provenance.liveDataChecked).toBe(false);
    expect(result.body.navigation).toContainEqual({ target: 'rentals', label: 'Open Rentals' });
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.getUser).toHaveBeenCalledWith('offline-session');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses server-only credentials and bounds upstream calls to a deadline', async () => {
    await request();
    const [url, credential, options] = mocks.createClient.mock.calls[0];
    expect(url).toBe('https://offline.invalid');
    expect(credential).toBe('offline-test-signing-material-not-a-credential');
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    await options.global.fetch('https://offline.invalid/auth/v1/user', {});
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('denies V1 tenants even for a super administrator', async () => {
    tenant.slug = 'offline-v1'; staff.is_super_admin = true;
    expect((await request({ message: 'rentals', tenantId })).response.status).toBe(403);
  });
  it('denies a forged tenant selection', async () => {
    expect((await request({ message: 'rentals', tenantId: otherTenant })).response.status).toBe(403);
  });
  it('denies inactive staff', async () => {
    staff.is_active = false;
    expect((await request()).response.status).toBe(403);
  });
  it('applies bounded server-loaded manager permissions to navigation', async () => {
    staff.role = 'manager';
    const result = await request({ type: 'navigate', navigation: { target: 'rentals' } });
    expect(result.response.status).toBe(403);
    expect(queries).toContainEqual({ table: 'manager_permissions', fields: 'tab_key,access_level', filters: { app_user_id: 'staff-a' }, limit: 101 });
  });
  it('scopes record resolution to the authorized tenant with minimal fields', async () => {
    const result = await request({ type: 'navigate', navigation: { target: 'rental', entityId: otherTenant } });
    expect(result.response.status).toBe(403);
    expect(queries).toContainEqual({ table: 'rentals', fields: 'id,tenant_id', filters: { tenant_id: tenantId, id: otherTenant } });
  });
  it('does not enable business writes in development', async () => {
    expect((await request({ type: 'execute_action' })).response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not fabricate a live Stripe balance', async () => {
    const result = await request({ message: 'What is my available Stripe balance?' });
    expect(result.response.status).toBe(200);
    expect(result.body.sources).toEqual([]);
    expect(result.body.response).toContain('not available');
    expect(result.body.response).not.toMatch(/[$£€]\s*\d/);
    expect(queries.every((query) => ['app_users', 'tenants'].includes(query.table))).toBe(true);
  });
  it('sanitizes service failures without echoing credentials or diagnostics', async () => {
    mocks.from.mockImplementation(() => { throw new Error('private diagnostic sentinel'); });
    const result = await request();
    expect(result.response.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/private diagnostic|offline-test-signing/);
  });
});
