/**
 * usePortalAnnouncements: the one read every announcement surface shares.
 *
 * What is pinned, and why each matters:
 *   - the RPC and its arguments, and that FEATURE rows are only asked for where the
 *     v2 dashboard exists (v2 flag AND the lean slug list, failing closed);
 *   - polling, not realtime: the fixed interval, focus refetch, no background
 *     polling, no retry storm, disabled until tenant and staff user are known;
 *   - a read that never succeeded renders nothing (status 'error', [] and ONE warn),
 *     while a later failed refetch keeps the last good rows (a hard blocker must not
 *     blink off over a transient error);
 *   - dismissal is optimistic and survives a refetch that races the event write, but
 *     never hides a hard blocker, and a revision bump outranks it;
 *   - `shown` is sent once per id+revision per page load;
 *   - an event write that fails is swallowed: never thrown, never retried.
 *
 * HARNESS: renderHook with a real QueryClient. `useQuery` is wrapped (not replaced)
 * so the options it receives can be read back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  __resetPortalAnnouncementSession,
  portalAnnouncementsQueryKey,
  usePortalAnnouncements,
} from '@/hooks/use-portal-announcements';
import { ANNOUNCEMENTS_POLL_MS, ANNOUNCEMENTS_STALE_MS } from '@/lib/announcements/contract';

// ── Doubles ─────────────────────────────────────────────────────────────────

let tenant: { id: string; slug: string } | null = { id: 't1', slug: 'northwind' };
let appUser: { id: string } | null = { id: 'u1' };
let v2Dashboard = true;

type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };
let readResult: () => Promise<RpcResult> = async () => ({ data: [], error: null });
let eventResult: () => unknown = () => Promise.resolve({ error: null });

const rpc = vi.fn((name: string, _args: Record<string, unknown>) =>
  name === 'get_portal_announcements' ? readResult() : eventResult(),
);

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => rpc(name, args) },
}));
// `tenantSlug` as well as `tenant`: the lean half of the feature gate is now
// `useIsLean()`, which reads the slug the browser resolved from the hostname
// — exactly what the real context exposes under that name.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant, tenantSlug: tenant?.slug ?? null }),
}));
vi.mock('@/stores/auth-store', () => ({ useAuth: () => ({ appUser }) }));
vi.mock('@/lib/v2-context', () => ({
  useV2: (area: string) => area === 'dashboard' && v2Dashboard,
  // The provider now carries the tenant-level half of the same answer
  // (`onV2` = tenants.portal_experience, `lean` = that OR the slug list).
  // All-false here leaves the `LEAN_TENANTS` slug list to decide, which is
  // what these cases meant before the column existed.
  usePortalExperience: () => ({ onV2: false, lean: false }),
  usePortalOnV2: () => false,
}));

const queryOptions: any[] = [];
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: (opts: any) => {
      queryOptions.push(opts);
      return actual.useQuery(opts);
    },
  };
});

// ── Rows ────────────────────────────────────────────────────────────────────

const row = (over: Record<string, unknown> = {}) => ({
  id: 'soft1',
  kind: 'system',
  title: 'Maintenance',
  summary: null,
  body: 'Read-only on Sunday.',
  image_url: null,
  slides: [],
  cta_label: null,
  cta_url: null,
  display: 'dialog',
  blocking: 'soft',
  tone: 'info',
  repeat_after_days: 3,
  sort_order: 10,
  revision: 1,
  last_shown_at: null,
  dismissed_at: null,
  dont_show_again_at: null,
  is_due: true,
  ...over,
});

const featureRow = (over: Record<string, unknown> = {}) =>
  row({
    id: 'feat1',
    kind: 'feature',
    title: 'Expense tracker',
    summary: 'Log every cost.',
    body: null,
    image_url: null,
    slides: [
      { heading: 'One', body: 'First', image_url: null },
      { heading: 'Two', body: 'Second', image_url: null },
    ],
    display: null,
    tone: null,
    ...over,
  });

const hardRow = (over: Record<string, unknown> = {}) => row({ id: 'hard1', blocking: 'hard', repeat_after_days: null, ...over });

// ── Harness ─────────────────────────────────────────────────────────────────

let client: QueryClient;
// `children: any`: the root @types/react 18 (Testing Library) and the portal's 19 disagree on ReactNode.
const wrapper = ({ children }: { children?: any }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const readCalls = () => rpc.mock.calls.filter(([name]) => name === 'get_portal_announcements');
const eventCalls = () => rpc.mock.calls.filter(([name]) => name === 'record_portal_announcement_event');

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tenant = { id: 't1', slug: 'northwind' };
  appUser = { id: 'u1' };
  v2Dashboard = true;
  readResult = async () => ({ data: [], error: null });
  eventResult = () => Promise.resolve({ error: null });
  rpc.mockClear();
  queryOptions.length = 0;
  __resetPortalAnnouncementSession();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  client.clear();
  warn.mockRestore();
});

/**
 * Refetch, then let React Query deliver the result. Its notify manager hands
 * observers the new state on a `setTimeout(0)`, AFTER the refetch promise resolves,
 * so asserting straight after `await refetchQueries()` reads the previous render.
 */
async function refetchAll() {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['portal-announcements'] }).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function mountReady(rows: unknown[]) {
  readResult = async () => ({ data: rows, error: null });
  const hook = renderHook(() => usePortalAnnouncements(), { wrapper });
  await waitFor(() => expect(hook.result.current.status).toBe('ready'));
  return hook;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('the read', () => {
  it('asks for system AND feature rows on the v2 dashboard canary', async () => {
    const { result } = await mountReady([row(), featureRow()]);
    expect(readCalls()).toEqual([['get_portal_announcements', { p_tenant_id: 't1', p_kinds: ['system', 'feature'] }]]);
    expect(result.current.featuresEnabled).toBe(true);
    expect(result.current.system.map((a) => a.id)).toEqual(['soft1']);
    expect(result.current.features.map((a) => a.id)).toEqual(['feat1']);
  });

  it('asks for system rows only without the v2 dashboard, and never exposes a feature', async () => {
    v2Dashboard = false;
    const { result } = await mountReady([row(), featureRow()]);
    expect(readCalls()[0][1]).toEqual({ p_tenant_id: 't1', p_kinds: ['system'] });
    expect(result.current.featuresEnabled).toBe(false);
    expect(result.current.features).toEqual([]);
    expect(result.current.system.map((a) => a.id)).toEqual(['soft1']);
  });

  it('asks for system rows only for a tenant outside the lean slug list, even with the v2 flag on', async () => {
    tenant = { id: 't2', slug: 'revtek' };
    const { result } = await mountReady([row()]);
    expect(readCalls()[0][1]).toEqual({ p_tenant_id: 't2', p_kinds: ['system'] });
    expect(result.current.featuresEnabled).toBe(false);
  });

  it('polls on a fixed interval and on focus, never in the background, never retrying', async () => {
    await mountReady([]);
    const opts = queryOptions[queryOptions.length - 1];
    expect(opts.queryKey).toEqual(['portal-announcements', 't1', 'u1', 'system+feature']);
    expect(opts.refetchInterval).toBe(ANNOUNCEMENTS_POLL_MS);
    expect(opts.staleTime).toBe(ANNOUNCEMENTS_STALE_MS);
    expect(opts.refetchOnWindowFocus).toBe(true);
    expect(opts.refetchIntervalInBackground).toBe(false);
    expect(opts.retry).toBe(false);
    expect(opts.enabled).toBe(true);
  });

  it('stays disabled and loading until both the tenant and the staff user are known', async () => {
    tenant = null;
    const noTenant = renderHook(() => usePortalAnnouncements(), { wrapper });
    appUser = null;
    tenant = { id: 't1', slug: 'northwind' };
    const noUser = renderHook(() => usePortalAnnouncements(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(noTenant.result.current).toMatchObject({ status: 'loading', system: [], features: [] });
    expect(noUser.result.current).toMatchObject({ status: 'loading', system: [], features: [] });
    expect(queryOptions.every((o) => o.enabled === false)).toBe(true);
    expect(readCalls()).toHaveLength(0);
  });

  it('keys the cache by tenant, user and reach', () => {
    expect(portalAnnouncementsQueryKey('t1', 'u1', false)).toEqual(['portal-announcements', 't1', 'u1', 'system']);
    expect(portalAnnouncementsQueryKey('t1', 'u1', true)).toEqual(['portal-announcements', 't1', 'u1', 'system+feature']);
  });

  it('drops rows it cannot render', async () => {
    const { result } = await mountReady([row(), row({ id: 'bad', display: 'toast' }), null, row({ id: 'soft2' })]);
    expect(result.current.system.map((a) => a.id)).toEqual(['soft1', 'soft2']);
  });
});

describe('failures', () => {
  it('a read that never succeeded: status error, nothing to render, one warning, no retry', async () => {
    readResult = async () => ({ data: null, error: { message: 'Could not find the function', code: 'PGRST202' } });
    const { result } = renderHook(() => usePortalAnnouncements(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.system).toEqual([]);
    expect(result.current.features).toEqual([]);
    expect(readCalls()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('[announcements]');
  });

  it('a later refetch error keeps the last good rows', async () => {
    const { result } = await mountReady([hardRow()]);
    readResult = async () => ({ data: null, error: { message: 'Failed to fetch' } });
    await refetchAll();
    expect(readCalls()).toHaveLength(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.system.map((a) => a.id)).toEqual(['hard1']);
  });
});

describe('recordEvent', () => {
  it('sends the event RPC with the announcement, tenant and event', async () => {
    const { result } = await mountReady([row()]);
    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));
    expect(eventCalls()).toEqual([
      ['record_portal_announcement_event', { p_announcement_id: 'soft1', p_tenant_id: 't1', p_event: 'dismissed' }],
    ]);
  });

  it('hides a dismissed soft row at once, for every consumer, and through a refetch that still says due', async () => {
    const { result } = await mountReady([row()]);
    const other = renderHook(() => usePortalAnnouncements(), { wrapper });
    await waitFor(() => expect(other.result.current.status).toBe('ready'));

    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));
    expect(result.current.system[0].is_due).toBe(false);
    expect(other.result.current.system[0].is_due).toBe(false);

    // The server has not seen the write yet and still answers is_due: true.
    await refetchAll();
    expect(readCalls().length).toBeGreaterThanOrEqual(2);
    expect(result.current.system[0].is_due).toBe(false);
  });

  it('hands back to the server once it has recorded the dismissal, so "show again after N days" works in a tab left open', async () => {
    const { result } = await mountReady([row()]);
    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));

    // The write landed: the server now carries the dismissal and says not due.
    const recordedAt = '2026-09-16T10:00:00.000Z';
    readResult = async () => ({ data: [row({ dismissed_at: recordedAt, is_due: false })], error: null });
    await refetchAll();
    expect(result.current.system[0].is_due).toBe(false);

    // Days later, same page load: the repeat clock has run out on the server.
    readResult = async () => ({ data: [row({ dismissed_at: recordedAt, is_due: true })], error: null });
    await refetchAll();
    expect(result.current.system[0]).toMatchObject({ id: 'soft1', is_due: true });
  });

  it('a re-dismissal still hides through a refetch that carries only the PREVIOUS dismissal', async () => {
    // Due again because the last close was 4 days ago (repeat 3). The user closes it again;
    // a poll that races the write returns the old timestamp, which must not count as "recorded".
    const earlier = '2026-09-12T09:00:00.000Z';
    const { result } = await mountReady([row({ dismissed_at: earlier, is_due: true })]);
    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));
    expect(result.current.system[0].is_due).toBe(false);

    await refetchAll();
    expect(readCalls().length).toBeGreaterThanOrEqual(2);
    expect(result.current.system[0].is_due).toBe(false);

    readResult = async () => ({ data: [row({ dismissed_at: '2026-09-16T10:00:00.000Z', is_due: false })], error: null });
    await refetchAll();
    readResult = async () => ({ data: [row({ dismissed_at: '2026-09-16T10:00:00.000Z', is_due: true })], error: null });
    await refetchAll();
    expect(result.current.system[0].is_due).toBe(true);
  });

  it('"Don\'t show again" also hands back once recorded, and the server\'s stamp is what remains', async () => {
    const { result } = await mountReady([featureRow()]);
    act(() => result.current.recordEvent(result.current.features[0], 'dont_show_again'));
    const at = '2026-09-16T10:00:00.000Z';
    readResult = async () => ({
      data: [featureRow({ dismissed_at: at, dont_show_again_at: at, is_due: false })],
      error: null,
    });
    await refetchAll();
    expect(result.current.features[0]).toMatchObject({ is_due: false, dont_show_again_at: at });
  });

  it('a revision bump ("show it again to everyone") outranks the local dismissal', async () => {
    const { result } = await mountReady([row()]);
    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));
    readResult = async () => ({ data: [row({ revision: 2 })], error: null });
    await refetchAll();
    expect(result.current.system[0]).toMatchObject({ revision: 2, is_due: true });
  });

  it('never hides a hard blocker, whatever event arrives', async () => {
    const { result } = await mountReady([hardRow()]);
    for (const event of ['dismissed', 'dont_show_again', 'cta_clicked'] as const) {
      act(() => result.current.recordEvent(result.current.system[0], event));
      expect(result.current.system[0].is_due).toBe(true);
    }
  });

  it('a soft row dismissed this session still shows once the admin makes it hard (same revision)', async () => {
    const { result } = await mountReady([row()]);
    act(() => result.current.recordEvent(result.current.system[0], 'dismissed'));
    expect(result.current.system[0].is_due).toBe(false);
    readResult = async () => ({ data: [row({ blocking: 'hard', repeat_after_days: null })], error: null });
    await refetchAll();
    expect(result.current.system[0]).toMatchObject({ blocking: 'hard', revision: 1, is_due: true });
  });

  it('a soft CTA click counts as closing it', async () => {
    const { result } = await mountReady([row()]);
    act(() => result.current.recordEvent(result.current.system[0], 'cta_clicked'));
    expect(result.current.system[0].is_due).toBe(false);
  });

  it('"Don\'t show again" stamps dont_show_again_at locally', async () => {
    const { result } = await mountReady([featureRow()]);
    expect(result.current.features[0].dont_show_again_at).toBeNull();
    act(() => result.current.recordEvent(result.current.features[0], 'dont_show_again'));
    expect(result.current.features[0].is_due).toBe(false);
    expect(typeof result.current.features[0].dont_show_again_at).toBe('string');
    expect(Number.isNaN(Date.parse(result.current.features[0].dont_show_again_at!))).toBe(false);
  });

  it('shown and card_opened do not hide anything', async () => {
    const { result } = await mountReady([featureRow()]);
    act(() => result.current.recordEvent(result.current.features[0], 'card_opened'));
    act(() => result.current.recordEvent(result.current.features[0], 'shown'));
    expect(result.current.features[0].is_due).toBe(true);
  });

  it('sends `shown` once per id+revision per page load', async () => {
    const { result } = await mountReady([row()]);
    const a = result.current.system[0];
    act(() => {
      result.current.recordEvent(a, 'shown');
      result.current.recordEvent(a, 'shown');
    });
    expect(eventCalls()).toHaveLength(1);
    act(() => result.current.recordEvent({ ...a, revision: 2 }, 'shown'));
    expect(eventCalls()).toHaveLength(2);
    act(() => result.current.recordEvent(a, 'dismissed'));
    act(() => result.current.recordEvent(a, 'dismissed'));
    expect(eventCalls()).toHaveLength(4);
  });

  it('swallows a failed write: {error}, a rejected promise, or a client that throws', async () => {
    const { result } = await mountReady([row(), row({ id: 'soft2' }), row({ id: 'soft3' })]);
    const [a, b, c] = result.current.system;

    eventResult = () => Promise.resolve({ error: { message: 'permission denied' } });
    expect(() => act(() => result.current.recordEvent(a, 'dismissed'))).not.toThrow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(warn.mock.calls.some((call) => String(call[0]).includes('[announcements]'))).toBe(true);

    eventResult = () => Promise.reject(new Error('Failed to fetch'));
    expect(() => act(() => result.current.recordEvent(b, 'dismissed'))).not.toThrow();

    eventResult = () => {
      throw new Error('boom');
    };
    expect(() => act(() => result.current.recordEvent(c, 'dismissed'))).not.toThrow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Still optimistic, still no retry of the failed writes.
    expect(result.current.system.map((x) => x.is_due)).toEqual([false, false, false]);
    expect(eventCalls()).toHaveLength(3);
  });

  it('does nothing without a tenant or staff user', () => {
    tenant = null;
    const { result } = renderHook(() => usePortalAnnouncements(), { wrapper });
    act(() => result.current.recordEvent(row() as never, 'dismissed'));
    expect(eventCalls()).toHaveLength(0);
  });
});
