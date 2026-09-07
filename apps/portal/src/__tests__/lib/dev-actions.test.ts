/**
 * `lib/dev-actions.ts` — the shared reset logic behind the /dev page.
 *
 * Pure and injectable, so every branch is exercised for real: fake storages
 * for the tour flags and checklist keys, and a fake Supabase client for the
 * first-run row — including the branch that matters most, the RLS silent
 * no-op, which a real client cannot be made to produce on demand.
 *
 * The two coupling tests at the end read the files that WRITE the keys this
 * module clears, so a rename over there fails here rather than leaving a
 * "reset" that quietly clears nothing.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  DEV_ROUTE,
  TOUR_STORAGE_PREFIX,
  checklistStorageKeys,
  clearChecklistState,
  clearTourSeenFlags,
  isLocalhostHost,
  replayTour,
  resetFirstRunRow,
  tourStorageKeys,
  type FirstRunClient,
} from '@/lib/dev-actions';
import { REPLAY_TOUR_EVENT, tourSeenKey } from '@/lib/first-rental-tour';
import { readPortalSource, codeOnly } from '../helpers/edge-source';

// ── A tiny in-memory Storage ───────────────────────────────────────────────

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

/** A storage whose every access throws — Safari private mode, blocked site data. */
const throwingStorage = new Proxy({} as Storage, {
  get() {
    throw new Error('SecurityError: storage is blocked');
  },
});

// ── The hostname gate ──────────────────────────────────────────────────────

describe('isLocalhostHost', () => {
  it.each(['localhost', 'northwind.portal.localhost', 'a.b.localhost', '127.0.0.1', '[::1]', '::1'])(
    'accepts %s',
    (host) => expect(isLocalhostHost(host)).toBe(true),
  );

  it.each([
    'northwind.portal.drive-247.com',
    'portal.drive-247.com',
    '192.168.1.42',
    '10.0.0.5',
    'northwind.portal.localhost.evil.com',
    'localhost.evil.com',
    'notlocalhost',
    '',
  ])('refuses %s', (host) => expect(isLocalhostHost(host)).toBe(false));
});

describe('DEV_ROUTE', () => {
  it('is the /dev page, and the route file exists where the link points', () => {
    expect(DEV_ROUTE).toBe('/dev');
    expect(readPortalSource('app/(dashboard)/dev/page.tsx')).toMatch(/export default function DevPage/);
  });
});

// ── The tour's seen flags ──────────────────────────────────────────────────

describe('tour seen flags', () => {
  it('the prefix matches what the tour actually writes, for any user and version', () => {
    // The one place the two modules could drift. `tourSeenKey` owns the key
    // shape; this module only knows the namespace.
    expect(tourSeenKey('app-user-1').startsWith(TOUR_STORAGE_PREFIX)).toBe(true);
    expect(tourSeenKey(null).startsWith(TOUR_STORAGE_PREFIX)).toBe(true);
    expect(tourSeenKey('').startsWith(TOUR_STORAGE_PREFIX)).toBe(true);
  });

  it('finds every user’s flag and nothing else', () => {
    const storage = memoryStorage({
      [tourSeenKey('user-a')]: '2026-09-05T00:00:00Z',
      [tourSeenKey('user-b')]: '2026-09-05T00:00:00Z',
      'd247.tour.some-other-tour.v3.user-a': 'x',
      'rentals-calendar-insights': '0',
      'setup-guide-state-tenant-1': 'minimized',
      'contour': 'not-a-tour-key',
    });
    expect(tourStorageKeys(storage).sort()).toEqual(
      [tourSeenKey('user-a'), tourSeenKey('user-b'), 'd247.tour.some-other-tour.v3.user-a'].sort(),
    );
  });

  it('clears them all, reports the count, and leaves everything else alone', () => {
    const storage = memoryStorage({
      [tourSeenKey('user-a')]: 'seen',
      [tourSeenKey('user-b')]: 'seen',
      'rentals-calendar-insights': '0',
    });
    expect(clearTourSeenFlags(storage)).toBe(2);
    expect(storage.getItem(tourSeenKey('user-a'))).toBeNull();
    expect(storage.getItem(tourSeenKey('user-b'))).toBeNull();
    expect(storage.getItem('rentals-calendar-insights')).toBe('0');
  });

  it('is a no-op, not a throw, when storage is missing or blocked', () => {
    expect(clearTourSeenFlags(null)).toBe(0);
    expect(tourStorageKeys(throwingStorage)).toEqual([]);
    expect(clearTourSeenFlags(throwingStorage)).toBe(0);
  });
});

// ── The setup checklist ────────────────────────────────────────────────────

describe('setup checklist state', () => {
  it('every key is suffixed with the tenant id, so one tenant’s reset cannot touch another’s', () => {
    const keys = checklistStorageKeys('tenant-A');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.endsWith('-tenant-A')).toBe(true);
    expect(checklistStorageKeys('tenant-B').some((k) => k.endsWith('-tenant-A'))).toBe(false);
  });

  it('clears both stores and counts what was actually there', () => {
    const local = memoryStorage({
      'setup-guide-state-t1': 'closed',
      'getting-started-dismissed-t1': 'true',
      'setup-reminder-dismissed-t1': 'true',
      'setup-guide-state-OTHER': 'closed',
      'unrelated': '1',
    });
    const session = memoryStorage({ 'setup-reminder-snoozed-t1': 'true' });

    expect(clearChecklistState('t1', local, session)).toBe(4);

    expect(local.getItem('setup-guide-state-t1')).toBeNull();
    expect(local.getItem('getting-started-dismissed-t1')).toBeNull();
    expect(local.getItem('setup-reminder-dismissed-t1')).toBeNull();
    expect(session.getItem('setup-reminder-snoozed-t1')).toBeNull();
    // Another tenant's panel state and an unrelated key survive.
    expect(local.getItem('setup-guide-state-OTHER')).toBe('closed');
    expect(local.getItem('unrelated')).toBe('1');
  });

  it('tolerates missing or blocked storage', () => {
    expect(clearChecklistState('t1', null, null)).toBe(0);
    expect(clearChecklistState('t1', throwingStorage, throwingStorage)).toBe(0);
  });

  it('names only keys the checklist surfaces actually write', () => {
    // The coupling this module has to those surfaces is these literals. Read
    // the writers and check each prefix is still there, so a rename over
    // there breaks this test rather than silently making the reset a no-op.
    const writers = [
      codeOnly(readPortalSource('components/dashboard-v2/setup-guide.tsx')),
      codeOnly(readPortalSource('components/dashboard/getting-started-checklist.tsx')),
      codeOnly(readPortalSource('components/dashboard/setup-reminder-dialog.tsx')),
    ].join('\n');
    for (const key of checklistStorageKeys('X')) {
      const prefix = key.slice(0, -'X'.length); // e.g. "setup-guide-state-"
      expect(writers, `no surface writes "${prefix}…" any more`).toContain(prefix);
    }
  });
});

// ── The first-run row ──────────────────────────────────────────────────────

/**
 * A fake client with two knobs: how many rows the DELETE reports, and whether
 * a row is still visible afterwards. That second knob is the RLS case.
 */
function fakeClient(opts: {
  deleted: unknown;
  deleteError?: { message: string } | null;
  remaining?: unknown;
  readError?: { message: string } | null;
}) {
  const calls: string[] = [];
  const client: FirstRunClient = {
    from: (table) => ({
      delete: () => ({
        eq: (col, val) => ({
          select: async () => {
            calls.push(`delete ${table} where ${col}=${val}`);
            return { data: opts.deleted, error: opts.deleteError ?? null };
          },
        }),
      }),
      select: () => ({
        eq: (col, val) => ({
          maybeSingle: async () => {
            calls.push(`select ${table} where ${col}=${val}`);
            return { data: opts.remaining ?? null, error: opts.readError ?? null };
          },
        }),
      }),
    }),
  };
  return { client, calls };
}

describe('resetFirstRunRow', () => {
  it('reports the deleted row and never reads back when the delete succeeded', async () => {
    const { client, calls } = fakeClient({ deleted: [{ id: 'row-1' }] });
    await expect(resetFirstRunRow(client, 'tenant-1')).resolves.toEqual({ ok: true, deleted: 1 });
    expect(calls).toEqual(['delete tenant_first_run where tenant_id=tenant-1']);
  });

  it('treats zero rows with nothing left behind as an already-clear tenant', async () => {
    const { client, calls } = fakeClient({ deleted: [], remaining: null });
    await expect(resetFirstRunRow(client, 'tenant-1')).resolves.toEqual({ ok: true, deleted: 0 });
    expect(calls).toEqual([
      'delete tenant_first_run where tenant_id=tenant-1',
      'select tenant_first_run where tenant_id=tenant-1',
    ]);
  });

  it('THE RLS CASE — zero rows but the row is still there is a loud failure, not a success', async () => {
    // RLS on tenant_first_run lets a tenant session READ its row; if the DELETE
    // policy refuses the session, PostgREST answers success with zero rows.
    // The read-back is what turns that into a refusal the operator can see.
    const { client } = fakeClient({ deleted: [], remaining: { id: 'row-1' } });
    const result = await resetFirstRunRow(client, 'tenant-1');
    expect(result.ok).toBe(false);
    // Equality, not truthiness: strictNullChecks is off here, and only an
    // equality check narrows the union far enough to read `reason`.
    if (result.ok !== false) throw new Error('unreachable');
    expect(result.reason).toBe('blocked');
    expect(result.message).toMatch(/row-level security/i);
    expect(result.message).toMatch(/nothing was reset/i);
  });

  it('surfaces a database error from the delete verbatim', async () => {
    const { client } = fakeClient({
      deleted: null,
      deleteError: { message: 'relation "public.tenant_first_run" does not exist' },
    });
    await expect(resetFirstRunRow(client, 'tenant-1')).resolves.toEqual({
      ok: false,
      reason: 'error',
      message: 'relation "public.tenant_first_run" does not exist',
    });
  });

  it('surfaces a database error from the read-back too', async () => {
    const { client } = fakeClient({ deleted: [], readError: { message: 'boom' } });
    await expect(resetFirstRunRow(client, 'tenant-1')).resolves.toEqual({
      ok: false,
      reason: 'error',
      message: 'boom',
    });
  });

  it('does not trust a non-array payload as a deletion', async () => {
    const { client } = fakeClient({ deleted: { id: 'row-1' }, remaining: { id: 'row-1' } });
    const result = await resetFirstRunRow(client, 'tenant-1');
    expect(result.ok).toBe(false);
  });
});

// ── The replay signal ──────────────────────────────────────────────────────

describe('replayTour', () => {
  it('dispatches exactly the event the tour listens for', () => {
    const dispatch = vi.fn(() => true);
    expect(replayTour({ dispatchEvent: dispatch })).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0] as unknown as [Event])[0].type).toBe(REPLAY_TOUR_EVENT);
  });

  it('is a no-op without a window', () => {
    expect(replayTour(null)).toBe(false);
  });

  it('the tour hook really does listen for that event name', () => {
    const hook = codeOnly(readPortalSource('hooks/use-first-rental-tour.ts'));
    expect(hook).toMatch(/addEventListener\(REPLAY_TOUR_EVENT/);
  });
});

// ── Purity ─────────────────────────────────────────────────────────────────

describe('the module stays pure', () => {
  it('imports neither Supabase, React nor Next — the client is injected', () => {
    const src = codeOnly(readPortalSource('lib/dev-actions.ts'));
    expect(src).not.toMatch(/from ['"]@\/integrations\/supabase/);
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toMatch(/from ['"]next\//);
  });
});
