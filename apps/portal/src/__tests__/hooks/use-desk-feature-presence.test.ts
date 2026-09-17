/**
 * Whether the dashboard desk band holds a feature card, a placeholder for one,
 * or no slot (components/announcements/use-desk-feature-presence.ts).
 *
 * Every branch, by hand:
 *
 *   status   hint   features  latched?  -> presence  hint written
 *   loading  '1'    -           -          skeleton    -
 *   loading  '0'    -           -          none        -
 *   loading  none   -           -          none        -
 *   ready    any    >= 1        no         deck        '1'
 *   ready    any    0           -          none        '0'  (and latches)
 *   ready    any    >= 1        yes        none        '1'  (insert deferred)
 *   error    any    -           -          none        -    (and latches)
 *
 * Storage that throws on read behaves as "no hint"; on write it is ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { deskFeatureHintKey, type PortalAnnouncement } from '@/lib/announcements/contract';
import { useDeskFeaturePresence } from '@/components/announcements/use-desk-feature-presence';

type Status = 'loading' | 'error' | 'ready';

const KEY = deskFeatureHintKey('t-1', 'u-1');

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: vi.fn((k: string) => (map.has(k) ? map.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, String(v));
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn(() => null),
    get length() {
      return map.size;
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;

const one = { id: 'f-1', kind: 'feature' } as unknown as PortalAnnouncement;
const state = (status: Status, count = 0) => ({ status, features: count ? [one] : [] });

/** `ids` defaults to tenant t-1 / user u-1; pass `{}` (or one of them) to leave ids out. */
function mount(
  initial: { status: Status; features: PortalAnnouncement[] },
  ids: { t?: string; u?: string } = { t: 't-1', u: 'u-1' },
) {
  return renderHook(
    ({ s, t, u }: { s: { status: Status; features: PortalAnnouncement[] }; t?: string; u?: string }) =>
      useDeskFeaturePresence(s, t, u),
    { initialProps: { s: initial, t: ids.t, u: ids.u } },
  );
}

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useDeskFeaturePresence — while loading', () => {
  it('holds a placeholder when this user’s desk had a feature card last time', () => {
    storage.map.set(KEY, '1');
    expect(mount(state('loading')).result.current).toBe('skeleton');
  });

  it('holds no slot when it had none, when there is no record, or the record is junk', () => {
    storage.map.set(KEY, '0');
    expect(mount(state('loading')).result.current).toBe('none');
    storage.map.set(KEY, 'yes');
    expect(mount(state('loading')).result.current).toBe('none');
    storage.map.clear();
    expect(mount(state('loading')).result.current).toBe('none');
  });

  it('reads the hint for THIS tenant and user only, and none without both ids', () => {
    storage.map.set(deskFeatureHintKey('t-2', 'u-1'), '1');
    storage.map.set(deskFeatureHintKey('t-1', 'u-2'), '1');
    expect(mount(state('loading')).result.current).toBe('none');
    storage.map.set(KEY, '1');
    expect(mount(state('loading'), { u: 'u-1' }).result.current).toBe('none');
    expect(mount(state('loading'), { t: 't-1' }).result.current).toBe('none');
    expect(mount(state('loading')).result.current).toBe('skeleton');
    expect(KEY).toBe('d247.desk.featureCount.t-1.u-1');
  });

  it('treats a storage that throws as no record', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const { result, rerender } = mount(state('loading'));
    expect(result.current).toBe('none');
    expect(() => rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' })).not.toThrow();
    expect(result.current).toBe('deck');
  });
});

describe('useDeskFeaturePresence — settled', () => {
  it('shows the deck when features arrived, and remembers that', () => {
    const { result } = mount(state('ready', 1));
    expect(result.current).toBe('deck');
    expect(storage.map.get(KEY)).toBe('1');
  });

  it('holds no slot for zero features, and remembers that', () => {
    storage.map.set(KEY, '1');
    const { result } = mount(state('ready', 0));
    expect(result.current).toBe('none');
    expect(storage.map.get(KEY)).toBe('0');
  });

  it('holds no slot on a failed read, and does not teach the next visit anything', () => {
    storage.map.set(KEY, '1');
    const { result } = mount(state('error'));
    expect(result.current).toBe('none');
    expect(storage.map.get(KEY)).toBe('1');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes nothing without a tenant and a user', () => {
    mount(state('ready', 1), {});
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('drops the placeholder at once when the read settles with nothing', () => {
    storage.map.set(KEY, '1');
    const { result, rerender } = mount(state('loading'));
    expect(result.current).toBe('skeleton');
    rerender({ s: state('ready', 0), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('none');
  });

  it('fills the placeholder when the read settles with features', () => {
    storage.map.set(KEY, '1');
    const { result, rerender } = mount(state('loading'));
    rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('deck');
  });
});

describe('useDeskFeaturePresence — the latch', () => {
  it('lets the FIRST settled read insert the card (no hint yet), once', () => {
    const { result, rerender } = mount(state('loading'));
    expect(result.current).toBe('none');
    rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('deck');
  });

  it('removes a card at once when its last feature goes, and does not bring it back in this mount', () => {
    const { result, rerender } = mount(state('ready', 1));
    expect(result.current).toBe('deck');
    rerender({ s: state('ready', 0), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('none');
    rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('none');
    // The hint still follows reality, so the next mount shows it.
    expect(storage.map.get(KEY)).toBe('1');
  });

  it('defers a feature that appears after the band settled on no card to the next mount', () => {
    const first = mount(state('ready', 0));
    expect(first.result.current).toBe('none');
    first.rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' });
    expect(first.result.current).toBe('none');
    first.unmount();

    // Next visit to the dashboard: cached data is ready at once.
    expect(mount(state('ready', 1)).result.current).toBe('deck');
    // And while a cold load is still pending, the hint holds its place.
    expect(mount(state('loading')).result.current).toBe('skeleton');
  });

  it('treats a failed first read as settled too: a later successful poll waits for the next mount', () => {
    const { result, rerender } = mount(state('error'));
    expect(result.current).toBe('none');
    rerender({ s: state('ready', 1), t: 't-1', u: 'u-1' });
    expect(result.current).toBe('none');
  });
});
