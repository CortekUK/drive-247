/**
 * The v2 vehicles list table (`app/(dashboard)/vehicles/page.tsx`, v2 branch).
 *
 * - Columns: Vehicle, Make / model, Year, Color, Status. No Location column,
 *   even for a tenant with pickup locations, and no sort controls.
 * - Order: the query's own (newest added first). A `?sort=` in the URL is
 *   ignored on v2.
 * - No thumbnail in the row: the cover photo opens large on hovering the
 *   registration, only for a car that has one, and a click in that card does
 *   not open the vehicle.
 * - An Unavailable car (every hire duration off) is dimmed per cell with its
 *   name struck through; Status stays at full strength. A Paused car is not.
 * - Headings and cells are centred; the body fills the window (fillViewport).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ current: new URLSearchParams() }));
const db = vi.hoisted(() => ({ vehicles: [] as Record<string, unknown>[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => search.current,
  usePathname: () => '/vehicles',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const result = { data: table === 'vehicles' ? db.vehicles : [], error: null };
    const chain: any = {};
    for (const m of ['select', 'eq', 'neq', 'not', 'in', 'order']) chain[m] = () => chain;
    chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return chain;
  };
  return { supabase: { from }, supabaseUntyped: { from } };
});
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 't1', currency_code: 'USD', slug: 'northwind' }, tenantSlug: 'northwind' }),
}));
vi.mock('@/lib/v2-context', () => ({ useV2: () => true }));
vi.mock('@/lib/lean-areas', () => ({
  isAreaHidden: () => true,
  isLeanTenant: () => false,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/hooks/use-forced-empty-state', () => ({ useForcedEmptyState: () => false }));
vi.mock('@/hooks/use-manager-permissions', () => ({ useManagerPermissions: () => ({ canEdit: () => false }) }));
vi.mock('@/hooks/use-vehicle-owners', () => ({ useVehicleOwners: () => ({ data: [] }) }));
// A tenant WITH pickup locations: v1 would show a Location column.
vi.mock('@/hooks/use-pickup-locations', () => ({
  usePickupLocations: () => ({ locations: [{ id: 'loc1', name: 'Airport' }] }),
}));
vi.mock('@/hooks/use-fleet-health', () => ({
  useFleetHealthEnabled: () => false,
  useFleetHealth: () => ({ data: [] }),
}));
vi.mock('@/components/vehicles/inshur-eligibility-badge', () => ({
  INSHUR_VEHICLE_FILTERS: {},
  InshurEligibilityBadge: () => null,
  deriveInshurEligibilityState: () => 'not_checked',
  useInshurEligibilityConfig: () => ({ enabled: false, mode: 'test', statesAllowed: [], isLoading: false }),
  useInshurEligibilityMap: () => ({ byVehicleId: new Map() }),
  useInshurRecheck: () => ({ recheck: vi.fn(), pendingVehicleId: null, failedVehicleIds: new Set() }),
}));
vi.mock('@/components/vehicles/add-vehicle-dialog', () => ({ AddVehicleDialog: () => null }));
vi.mock('@/components/vehicles/fleet-summary-cards', () => ({ FleetSummaryCards: () => null }));
vi.mock('@/components/empty-states/lean-empty-states', () => ({ VehiclesTeachingEmptyState: () => null }));
vi.mock('@/components/onboarding/tab-tour-button', () => ({ TabTourButton: () => null }));
vi.mock('@/components/shared/header-icon-button-v2', () => ({
  HEADER_ACTIONS_V2: '',
  HeaderIconButton: ({ children, label }: any) => <button aria-label={label}>{children}</button>,
}));
vi.mock('@/components/shared/layout/page-search-slot', () => ({ usePageSearch: () => {} }));
vi.mock('@/components/shared/layout/overview-flip', () => ({ OverviewFlip: () => null }));
vi.mock('@/components/vehicles-v2/vehicles-overview', () => ({ VehiclesOverview: () => null }));
vi.mock('@/components/vehicles-v2/vehicles-filter-panel', () => ({
  VehiclesFilterPanel: () => null,
  countActiveVehicleFilters: () => 0,
}));
vi.mock('@/hooks/use-vehicles-on-rent-v2', () => ({ useVehiclesOnRentV2: () => ({ data: [] }) }));

import VehiclesPage from '@/app/(dashboard)/vehicles/page';

/** Radix positions the hover card with a constructible ResizeObserver; the shared setup mock is not. */
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function vehicle(overrides: Record<string, unknown>) {
  return {
    id: 'v',
    reg: 'REG',
    make: 'Toyota',
    model: 'Corolla',
    colour: 'Blue',
    year: 2022,
    status: 'Available',
    is_paused: false,
    available_daily: true,
    available_weekly: true,
    available_monthly: true,
    photo_url: null,
    vehicle_photos: [],
    vehicle_owners: null,
    owner_id: null,
    pickup_location_id: 'loc1',
    ...overrides,
  };
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <VehiclesPage />
    </QueryClientProvider>,
  );
  await screen.findByRole('table');
  return utils;
}

const rowFor = (reg: string) => screen.getByRole('link', { name: reg }).closest('tr') as HTMLTableRowElement;
const classesOf = (el: Element) => el.className.split(/\s+/);

beforeEach(() => {
  push.mockClear();
  search.current = new URLSearchParams();
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  // In the order the query returns them: created_at desc.
  db.vehicles = [
    vehicle({
      id: 'v-new',
      reg: 'ZZ99 NEW',
      make: 'Tesla',
      model: 'Model 3',
      vehicle_photos: [{ photo_url: 'https://cdn.test/cover.jpg', display_order: 0 }],
    }),
    vehicle({
      id: 'v-off',
      reg: 'MM55 OFF',
      make: 'Ford',
      model: 'Focus',
      available_daily: false,
      available_weekly: false,
      available_monthly: false,
    }),
    vehicle({ id: 'v-paused', reg: 'PP11 PAU', make: 'Kia', model: 'Ceed', is_paused: true }),
    vehicle({ id: 'v-old', reg: 'AA11 OLD', make: 'Audi', model: 'A3' }),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('v2 vehicles table columns', () => {
  it('shows Vehicle, Make / model, Year, Color and Status, with no Location column', async () => {
    const { container } = await renderPage();
    const headings = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headings).toEqual(['Vehicle', 'Make / model', 'Year', 'Color', 'Status']);
    expect(screen.queryByText('Airport')).toBeNull();
  });

  it('has no sort controls in the header', async () => {
    const { container } = await renderPage();
    const thead = container.querySelector('thead')!;
    expect(within(thead as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(thead.querySelectorAll('[aria-sort]')).toHaveLength(0);
  });

  it('centres headings and cells', async () => {
    const { container } = await renderPage();
    for (const th of Array.from(container.querySelectorAll('thead th'))) {
      expect(classesOf(th)).toContain('text-center');
    }
    for (const td of Array.from(rowFor('AA11 OLD').querySelectorAll('td'))) {
      expect(classesOf(td)).toContain('text-center');
    }
  });

  it('fills the window from md up', async () => {
    const { container } = await renderPage();
    const box = container.querySelector('[data-slot="card-content"]')!;
    expect(classesOf(box)).toContain('md:overscroll-contain');
  });
});

describe('v2 vehicles order', () => {
  it('keeps the query order (newest added first) and ignores a sort in the URL', async () => {
    // v1 would put AA11 OLD first for this URL.
    search.current = new URLSearchParams('sort=reg&dir=asc');
    const { container } = await renderPage();
    const regs = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('a')?.textContent);
    expect(regs).toEqual(['ZZ99 NEW', 'MM55 OFF', 'PP11 PAU', 'AA11 OLD']);
  });
});

describe('v2 vehicles photo', () => {
  it('draws no thumbnail in any row', async () => {
    const { container } = await renderPage();
    expect(container.querySelectorAll('tbody img')).toHaveLength(0);
  });

  it('opens the cover photo on hovering the registration, and a click in it does not open the vehicle', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: 'ZZ99 NEW' });
    fireEvent.pointerEnter(link);
    const photo = await screen.findByAltText('Photo of ZZ99 NEW');
    expect(photo.getAttribute('src')).toBe('https://cdn.test/cover.jpg');
    fireEvent.click(photo);
    expect(push).not.toHaveBeenCalled();
  });

  it('says the photo is unavailable when it fails to load', async () => {
    await renderPage();
    fireEvent.pointerEnter(screen.getByRole('link', { name: 'ZZ99 NEW' }));
    fireEvent.error(await screen.findByAltText('Photo of ZZ99 NEW'));
    expect(await screen.findByText('Photo unavailable')).toBeInTheDocument();
  });

  it('is a plain link, with no hover card, for a car with no photo', async () => {
    await renderPage();
    const link = screen.getByRole('link', { name: 'AA11 OLD' });
    // The Radix trigger marks its element with data-state; a plain link has none.
    expect(link.hasAttribute('data-state')).toBe(false);
    expect(screen.getByRole('link', { name: 'ZZ99 NEW' }).getAttribute('data-state')).toBe('closed');
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    await new Promise((resolve) => setTimeout(resolve, 250)); // past the 150ms open delay
    expect(screen.queryByAltText('Photo of AA11 OLD')).toBeNull();
  });
});

describe('v2 vehicles unavailable rows', () => {
  it('dims every cell but Status, and strikes through the registration and make / model', async () => {
    await renderPage();
    const row = rowFor('MM55 OFF');
    expect(row.getAttribute('data-unavailable')).toBe('true');
    expect(classesOf(row)).not.toContain('opacity-60');

    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells.map((td) => td.textContent)).toEqual(['MM55 OFF', 'Ford Focus', '2022', 'Blue', 'Unavailable']);
    expect(cells.slice(0, 4).every((td) => classesOf(td).includes('opacity-60'))).toBe(true);
    expect(classesOf(cells[4])).not.toContain('opacity-60');

    expect(classesOf(screen.getByRole('link', { name: 'MM55 OFF' }))).toContain('line-through');
    expect(classesOf(screen.getByRole('link', { name: 'MM55 OFF' }))).not.toContain('hover:underline');
    expect(classesOf(cells[1].querySelector('span')!)).toContain('line-through');
  });

  it('leaves Paused and Available cars at full strength', async () => {
    await renderPage();
    for (const reg of ['PP11 PAU', 'AA11 OLD']) {
      const row = rowFor(reg);
      expect(row.hasAttribute('data-unavailable')).toBe(false);
      expect(Array.from(row.querySelectorAll('td')).some((td) => classesOf(td).includes('opacity-60'))).toBe(false);
      expect(classesOf(screen.getByRole('link', { name: reg }))).not.toContain('line-through');
    }
    expect(within(rowFor('PP11 PAU')).getByText('Paused')).toBeInTheDocument();
  });
});
