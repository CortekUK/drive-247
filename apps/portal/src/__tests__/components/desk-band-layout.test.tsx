/**
 * The dashboard's "On your desk" band (components/dashboard-v2/home/home-bands.tsx)
 * and the add-only `gridClassName` on `Band` (home/ui.tsx).
 *
 * The user's rule (Sep 16 2026): no announcement means NO card, and the two
 * other cards stretch. So the band's grid follows the number of cards actually
 * rendered:
 *
 *   feature presence   children (in order)                        grid classes
 *   'deck'             deck, Checklist, Reminders                 DESK_GRID_CLASSES[3]
 *   'skeleton'         placeholder, Checklist, Reminders          DESK_GRID_CLASSES[3]
 *   'none'             Checklist, Reminders                       DESK_GRID_CLASSES[2]
 *
 * and the hint loses "What's new" together with the card. The Today and Stats
 * bands keep the default grid string. Geometry in pixels is proved in the
 * screenshot harness; here it is the DOM and the classes.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  DESK_BAND_HINT,
  DESK_GRID_CLASSES,
  deskFeatureHintKey,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';

const env = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'error' | 'ready',
  features: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't-1', slug: 'northwind', currency_code: 'USD' }, tenantSlug: 'northwind', loading: false }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: 'u-1', role: 'head_admin' } }),
}));
vi.mock('@/hooks/use-dashboard-kpis', () => ({ useDashboardKPIs: () => ({ data: undefined }) }));
vi.mock('@/hooks/use-pending-bookings', () => ({ usePendingBookingsCount: () => ({ data: 0 }) }));
vi.mock('@/hooks/use-today-operations', () => ({
  useTodayOperations: () => ({ pickups: [], returns: [], overdue: [], staleCount: 0, staleAfterDays: 7 }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({ canView: () => true, canEdit: () => true, canAccessRoute: () => true, isLoading: false }),
}));
vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({
    status: env.status,
    system: [],
    features: env.features,
    featuresEnabled: true,
    recordEvent: vi.fn(),
  }),
}));
vi.mock('@/components/announcements/feature-announcement-deck', () => ({
  FeatureAnnouncementDeck: ({ features }: { features: unknown[] }) => (
    <section data-testid="feature-deck" data-count={features.length} />
  ),
}));
vi.mock('@/components/dashboard-v2/checklist-card', () => ({
  ChecklistCard: () => <div data-testid="checklist-card" />,
}));
vi.mock('@/components/dashboard-v2/reminders-card', () => ({
  RemindersCard: () => <div data-testid="reminders-card" />,
}));

import { HomeBands } from '@/components/dashboard-v2/home/home-bands';
import { Band } from '@/components/dashboard-v2/home/ui';

const DEFAULT_GRID = 'grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;

/** The grid of the band titled `title`: the section's second child (title row, then grid). */
function bandGrid(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: title });
  const section = heading.closest('section')!;
  return section.children[1] as HTMLElement;
}

const kinds = (grid: HTMLElement) =>
  [...grid.children].map(
    (el) => el.getAttribute('data-testid') ?? (el.hasAttribute('data-feature-deck-skeleton') ? 'skeleton' : el.tagName),
  );

const feature = (id: string) => ({ id, kind: 'feature', title: id }) as unknown as PortalAnnouncement;

beforeEach(() => {
  env.status = 'ready';
  env.features = [];
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('On your desk — no feature, no card', () => {
  it('renders exactly the two other cards, stretched two across, with the shorter hint', () => {
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['checklist-card', 'reminders-card']);
    expect(grid.className).toBe(DESK_GRID_CLASSES[2]);
    expect(grid.className).toBe('grid items-stretch gap-5 md:grid-cols-2');
    expect(screen.getByText(DESK_BAND_HINT.withoutFeatures)).toBeInTheDocument();
    expect(screen.queryByText(DESK_BAND_HINT.withFeatures)).toBeNull();
    expect(screen.queryByTestId('feature-deck')).toBeNull();
    expect(document.body.textContent).not.toMatch(/What.s new/);
  });

  it('does the same when the read failed', () => {
    env.status = 'error';
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['checklist-card', 'reminders-card']);
    expect(grid.className).toBe(DESK_GRID_CLASSES[2]);
  });

  it('does the same while loading for a user whose desk had no card (or no record)', () => {
    env.status = 'loading';
    render(<HomeBands />);
    expect(kinds(bandGrid('On your desk'))).toEqual(['checklist-card', 'reminders-card']);
  });
});

describe('On your desk — with features', () => {
  it('puts the feature deck first, three across, with the full hint', () => {
    env.features = [feature('f-1'), feature('f-2'), feature('f-3')];
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['feature-deck', 'checklist-card', 'reminders-card']);
    expect(grid.children[0].getAttribute('data-count')).toBe('3');
    expect(grid.className).toBe(DESK_GRID_CLASSES[3]);
    // At md the third card spans both columns, so 768px has no hole either.
    expect(grid.className).toContain('md:[&>*:nth-child(3)]:col-span-2');
    expect(screen.getByText(DESK_BAND_HINT.withFeatures)).toBeInTheDocument();
  });

  it('holds a 352px placeholder while loading for a user whose desk had a card last time', () => {
    env.status = 'loading';
    storage.map.set(deskFeatureHintKey('t-1', 'u-1'), '1');
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['skeleton', 'checklist-card', 'reminders-card']);
    const skeleton = grid.children[0] as HTMLElement;
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.className).toContain('h-[352px]');
    expect(skeleton.className).toContain('animate-pulse');
    expect(skeleton.className).toContain('motion-reduce:animate-none');
    expect(grid.className).toBe(DESK_GRID_CLASSES[3]);
    expect(screen.getByText(DESK_BAND_HINT.withFeatures)).toBeInTheDocument();
  });

  it('removes the card and stretches the other two when the last feature goes', () => {
    env.features = [feature('f-1')];
    const { rerender } = render(<HomeBands />);
    expect(kinds(bandGrid('On your desk'))).toEqual(['feature-deck', 'checklist-card', 'reminders-card']);
    env.features = [];
    rerender(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['checklist-card', 'reminders-card']);
    expect(grid.className).toBe(DESK_GRID_CLASSES[2]);
  });
});

describe('the other bands', () => {
  it('keep the default three-column grid', () => {
    env.features = [feature('f-1')];
    render(<HomeBands />);
    expect(bandGrid('Today').className).toBe(DEFAULT_GRID);
    expect(bandGrid('How it’s going').className).toBe(DEFAULT_GRID);
  });

  it('Band: the default grid string is unchanged, and gridClassName replaces it', () => {
    const { unmount } = render(
      <Band title="Default">
        <div />
      </Band>,
    );
    expect(bandGrid('Default').className).toBe(DEFAULT_GRID);
    unmount();
    render(
      <Band title="Custom" gridClassName="grid gap-5 grid-cols-1">
        <div />
      </Band>,
    );
    expect(bandGrid('Custom').className).toBe('grid gap-5 grid-cols-1');
  });
});
