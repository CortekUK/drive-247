/**
 * The dashboard's "On your desk" band (components/dashboard-v2/home/home-bands.tsx)
 * and the add-only `gridClassName` on `Band` (home/ui.tsx).
 *
 * Sep 26 2026: Checklist and Reminders came off the dashboard and a revenue line
 * chart took their place. The feature card sits at the far right:
 *
 *   feature presence   children (in order)          grid
 *   'deck'             revenue chart, deck           three columns, chart spans two
 *   'skeleton'         revenue chart, placeholder    three columns, chart spans two
 *   'none'             revenue chart                 one column, full width
 *
 * The desk row has no heading (it was dropped the same day). The Today and
 * Stats bands keep the default grid string.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
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
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-dashboard-insights', () => ({
  useBusyDays: () => ({ data: undefined, isLoading: false }),
  useBookingSources: () => ({ data: undefined, isLoading: false }),
  busyWindowStart: () => new Date(),
}));
vi.mock('@/components/dashboard-v2/home/busy-days-card', () => ({
  BusyDaysCard: () => <div data-testid="busy-days-card" />,
}));
vi.mock('@/components/dashboard-v2/home/booking-sources-card', () => ({
  BookingSourcesCard: () => <div data-testid="booking-sources-card" />,
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
  FeatureAnnouncementDeck: ({ features, className }: { features: unknown[]; className?: string }) => (
    <section data-testid="feature-deck" data-count={features.length} className={className} />
  ),
}));
vi.mock('@/components/dashboard-v2/home/revenue-line-card', () => ({
  RevenueLineCard: ({ className }: { className?: string }) => (
    <div data-testid="revenue-chart" className={className} />
  ),
}));
vi.mock('@/components/dashboard-v2/home/admin-cards', () => ({
  TraxBriefCard: () => <div data-testid="trax-brief-card" />,
}));
vi.mock('@/components/dashboard-v2/home/requests-card', () => ({
  RequestsCard: () => <div data-testid="requests-card" />,
}));
vi.mock('@/components/dashboard-v2/home/todo-card', () => ({
  TodoCard: () => <div data-testid="todo-card" />,
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

/** The grid of a band: the section's second child (title row, then grid). The desk row has no title, so its grid is its only child. */
function bandGrid(title: string): HTMLElement {
  if (title === 'On your desk') {
    return document.querySelector('[data-desk-band]')!.children[0] as HTMLElement;
  }
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

// One flex row either way; the card beside the chart is what changes.
const WITH_FEATURE = 'flex flex-col items-stretch gap-5 lg:flex-row';
const CHART_ONLY = WITH_FEATURE;

describe('On your desk — no feature', () => {
  it('shows the revenue chart alone, full width', () => {
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['revenue-chart']);
    expect(grid.className).toBe(CHART_ONLY);
    expect(grid.children[0].className).toBe('flex-1');
    expect(screen.queryByTestId('feature-deck')).toBeNull();
  });

  it('does the same when the read failed', () => {
    env.status = 'error';
    render(<HomeBands />);
    expect(kinds(bandGrid('On your desk'))).toEqual(['revenue-chart']);
  });

  it('does the same while loading for a user whose desk had no card (or no record)', () => {
    env.status = 'loading';
    render(<HomeBands />);
    expect(kinds(bandGrid('On your desk'))).toEqual(['revenue-chart']);
  });

  it('has no band heading', () => {
    render(<HomeBands />);
    expect(screen.queryByRole('heading', { level: 2, name: 'On your desk' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Your money/);
  });

  it('never mounts Checklist or Reminders', () => {
    env.features = [feature('f-1')];
    render(<HomeBands />);
    expect(screen.queryByTestId('checklist-card')).toBeNull();
    expect(screen.queryByTestId('reminders-card')).toBeNull();
  });
});

describe('On your desk — with features', () => {
  it('puts the chart first and a 320px-wide feature card at the far right', () => {
    env.features = [feature('f-1'), feature('f-2'), feature('f-3')];
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['revenue-chart', 'feature-deck']);
    expect(grid.className).toBe(WITH_FEATURE);
    expect(grid.children[0].className).toBe('flex-1');
    expect(grid.children[1].className).toContain('lg:w-[320px]');
    expect(grid.children[1].getAttribute('data-count')).toBe('3');
  });

  it('holds a 240px placeholder at the right while loading for a user whose desk had a card last time', () => {
    env.status = 'loading';
    storage.map.set(deskFeatureHintKey('t-1', 'u-1'), '1');
    render(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['revenue-chart', 'skeleton']);
    const skeleton = grid.children[1] as HTMLElement;
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.className).toContain('h-[230px]');
    expect(skeleton.className).toContain('animate-pulse');
    expect(skeleton.className).toContain('motion-reduce:animate-none');
    expect(skeleton.className).toContain('lg:w-[320px]');
    expect(grid.className).toBe(WITH_FEATURE);
  });

  it('lets the chart take the whole row when the last feature goes', () => {
    env.features = [feature('f-1')];
    const { rerender } = render(<HomeBands />);
    expect(kinds(bandGrid('On your desk'))).toEqual(['revenue-chart', 'feature-deck']);
    env.features = [];
    rerender(<HomeBands />);
    const grid = bandGrid('On your desk');
    expect(kinds(grid)).toEqual(['revenue-chart']);
    expect(grid.className).toBe(CHART_ONLY);
  });
});

describe('the other bands', () => {
  it('are gone: the revenue row, then the three operations cards', () => {
    env.features = [feature('f-1')];
    render(<HomeBands />);
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'This week' })).toBeNull();
    expect(screen.getByTestId('trax-brief-card')).toBeInTheDocument();
    expect(screen.getByTestId('requests-card')).toBeInTheDocument();
    expect(screen.getByTestId('todo-card')).toBeInTheDocument();
    expect(screen.getByTestId('busy-days-card')).toBeInTheDocument();
    expect(screen.getByTestId('booking-sources-card')).toBeInTheDocument();
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
