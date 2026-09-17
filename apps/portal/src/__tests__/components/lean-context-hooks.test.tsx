/**
 * The lean/v2 gates as they are actually read: hooks over one provider.
 *
 * Portal is client-heavy — 65 of its 81 dashboard pages are `"use client"`, and
 * `(dashboard)/layout.tsx`, which owns the sidebar, is one of them. So the
 * gates are resolved ONCE on the server in the root layout and handed down: the
 * per-area flags to `useV2`, and the tenant-level answer (`onV2` = the row's
 * `portal_experience`, `lean` = that OR'd with the `LEAN_TENANTS` slug list) to
 * the hooks in `lib/lean-context`.
 *
 * WHAT THIS FILE PROVES:
 *  - a flagged tenant reads v2 and lean out of the provider even though its
 *    slug is in no list — which is the whole point of the column
 *  - the slug list still works with no provider value at all, which is what
 *    keeps northwind working and keeps every existing `<V2Provider flags={…}>`
 *    in the test suite meaning what it meant
 *  - a v1 tenant gets every answer it got before: nothing hidden, no v2 area,
 *    BoldSign on whatever its column says
 *  - a component rendered OUTSIDE the provider is v1, not a crash
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// TenantContext is the client half of `useIsLean`: the hook OR's the server's
// answer with the slug the browser resolved from the hostname, so it can never
// answer narrower than it did before the column existed. Mocked here so a test
// can set that slug directly.
const tenantSlug = { current: null as string | null };
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: tenantSlug.current ? { id: 't1', slug: tenantSlug.current } : null,
    loading: false,
    error: null,
    tenantSlug: tenantSlug.current,
    refetchTenant: async () => {},
  }),
}));

import { V2Provider, useV2, usePortalOnV2, usePortalExperience } from '@/lib/v2-context';
import {
  useBoldSignMode,
  useIsAreaHidden,
  useIsLean,
  useIsSettingsTabHidden,
  useIsTestModeUiHidden,
} from '@/lib/lean-context';
import { LEAN_HIDDEN_AREAS } from '@/lib/lean-areas';
import { V2_AREA_LIST, type V2Area } from '@/lib/v2';

/** The shape the root layout hands down for a tenant flagged on its row. */
function flagged() {
  const flags = Object.fromEntries(V2_AREA_LIST.map((a) => [a, true])) as Partial<
    Record<V2Area, boolean>
  >;
  return { flags, experience: { onV2: true, lean: true } };
}

/** …and for a v1 tenant: every flag false, nothing lean. */
function v1() {
  const flags = Object.fromEntries(V2_AREA_LIST.map((a) => [a, false])) as Partial<
    Record<V2Area, boolean>
  >;
  return { flags, experience: { onV2: false, lean: false } };
}

function wrap(value: { flags: Partial<Record<V2Area, boolean>>; experience: { onV2: boolean; lean: boolean } } | null) {
  return ({ children }: { children: ReactNode }) =>
    value ? (
      <V2Provider flags={value.flags} experience={value.experience}>
        {children}
      </V2Provider>
    ) : (
      <>{children}</>
    );
}

describe('a tenant flagged on its row, whose slug is in no list', () => {
  const setup = () => {
    tenantSlug.current = 'wings';
    return { wrapper: wrap(flagged()) };
  };

  it.each(V2_AREA_LIST)('is on v2 for %s', (area) => {
    const { wrapper } = setup();
    expect(renderHook(() => useV2(area), { wrapper }).result.current).toBe(true);
  });

  it('is lean, and reads the column directly through usePortalOnV2', () => {
    const { wrapper } = setup();
    expect(renderHook(() => useIsLean(), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => usePortalOnV2(), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => usePortalExperience(), { wrapper }).result.current).toEqual({
      onV2: true,
      lean: true,
    });
  });

  it.each(LEAN_HIDDEN_AREAS)('hides %s', (area) => {
    const { wrapper } = setup();
    expect(renderHook(() => useIsAreaHidden(area), { wrapper }).result.current).toBe(true);
  });

  it('hides the Settings tabs the Integrations board owns, and the test-mode UI', () => {
    const { wrapper } = setup();
    for (const tab of ['payments', 'messaging', 'insurance', 'esign']) {
      expect(renderHook(() => useIsSettingsTabHidden(tab), { wrapper }).result.current).toBe(true);
    }
    expect(renderHook(() => useIsTestModeUiHidden(), { wrapper }).result.current).toBe(true);
  });

  it('signs BoldSign live whatever the column says', () => {
    const { wrapper } = setup();
    expect(renderHook(() => useBoldSignMode('test'), { wrapper }).result.current).toBe('live');
    expect(renderHook(() => useBoldSignMode(null), { wrapper }).result.current).toBe('live');
  });
});

describe('northwind, with no provider experience value at all', () => {
  // This is every `<V2Provider flags={…}>` already in the suite: `experience`
  // is optional and defaults to all-false, so those call sites keep meaning
  // "these flags, and a tenant that is not lean". The slug list is what still
  // makes the canary lean here.
  const wrapper = wrap({ flags: { chrome: true }, experience: { onV2: false, lean: false } });

  it('is lean from the client slug alone', () => {
    tenantSlug.current = 'northwind';
    expect(renderHook(() => useIsLean(), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => usePortalOnV2(), { wrapper }).result.current).toBe(false);
  });

  it.each(LEAN_HIDDEN_AREAS)('still hides %s', (area) => {
    tenantSlug.current = 'northwind';
    expect(renderHook(() => useIsAreaHidden(area), { wrapper }).result.current).toBe(true);
  });
});

describe('a v1 tenant', () => {
  const wrapper = wrap(v1());

  it.each(['revtekrentals', 'goniko', 'jangramrentals', 'globalmotiontransport'])(
    '%s: no v2 area, nothing hidden, no test-mode UI change',
    (slug) => {
      tenantSlug.current = slug;
      for (const area of V2_AREA_LIST) {
        expect(renderHook(() => useV2(area), { wrapper }).result.current).toBe(false);
      }
      expect(renderHook(() => useIsLean(), { wrapper }).result.current).toBe(false);
      expect(renderHook(() => useIsTestModeUiHidden(), { wrapper }).result.current).toBe(false);
      for (const area of LEAN_HIDDEN_AREAS) {
        expect(renderHook(() => useIsAreaHidden(area), { wrapper }).result.current).toBe(false);
      }
      for (const tab of ['payments', 'messaging', 'insurance', 'esign', 'accounting', 'tesla']) {
        expect(renderHook(() => useIsSettingsTabHidden(tab), { wrapper }).result.current).toBe(false);
      }
    },
  );

  it('keeps whatever BoldSign mode its column says', () => {
    tenantSlug.current = 'revtekrentals';
    expect(renderHook(() => useBoldSignMode('test'), { wrapper }).result.current).toBe('test');
    expect(renderHook(() => useBoldSignMode('live'), { wrapper }).result.current).toBe('live');
    expect(renderHook(() => useBoldSignMode(null), { wrapper }).result.current).toBe('test');
  });
});

describe('outside the provider, and before the slug resolves', () => {
  const wrapper = wrap(null);

  it('is v1 rather than a crash', () => {
    tenantSlug.current = null;
    for (const area of V2_AREA_LIST) {
      expect(renderHook(() => useV2(area), { wrapper }).result.current).toBe(false);
    }
    expect(renderHook(() => useIsLean(), { wrapper }).result.current).toBe(false);
    expect(renderHook(() => usePortalOnV2(), { wrapper }).result.current).toBe(false);
  });

  it('hides nothing while the tenant is unknown — the gate fails OPEN here', () => {
    // `TenantContext` sets the slug in an effect, so it is null for a tick on
    // first paint. Taking areas away on an unknown tenant would blink a live
    // operator's nav; the provider value is what removes that tick for a
    // tenant the server has already resolved.
    tenantSlug.current = null;
    for (const area of LEAN_HIDDEN_AREAS) {
      expect(renderHook(() => useIsAreaHidden(area), { wrapper }).result.current).toBe(false);
    }
  });
});
