/**
 * The five list pages mount, and keep their search box out of the fold.
 *
 * Moving the search field from inside `FilterPanel`'s card onto the row beside
 * the toggle touched five pages, and the only checks that existed for it read
 * the source. Source scans are what was green on all three occasions this app
 * threw a client-side exception in production: `tsc --noEmit` clean, dev server
 * 200, every grep passing, because a 200 from `/admin/<page>` is the sign-in
 * redirect and not the page.
 *
 * So this mounts them. Supabase, auth and the router are stubbed and every
 * list resolves empty, which is enough to get through the loading guard and
 * render the real chrome — the header, the search row, the folded panel.
 *
 * It asserts two things per page: that mounting does not throw, and that the
 * search field is reachable WITHOUT opening the filters. The second is the
 * behaviour the brief asked for, and the only way to state it that a future
 * refactor cannot quietly satisfy by leaving a `search={…}` prop in place while
 * putting a second input back in the card.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/rentals',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', email: 'a@b.c', is_super_admin: true },
    logout: vi.fn(),
  }),
}));

/* Everything resolves EMPTY. A stub that returns rows has to satisfy every
   column each page reads, and when it does not the page throws inside the
   stub's own bad data — a fault in the fixture that reads exactly like a fault
   in the page. Empty lists still exercise the chrome, which is what changed. */
function queryStub() {
  const result = { data: [], error: null, count: 0 };
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'in', 'is', 'or', 'not',
    'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'order', 'limit', 'range', 'filter', 'match',
    'contains', 'overlaps', 'textSearch',
  ];
  for (const m of methods) chain[m] = () => chain;
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => queryStub(),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}));

/* Promo Codes talks to an edge function rather than to a table. */
vi.mock('@/components/admin/promo-codes/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/components/admin/promo-codes/api',
  );
  return { ...actual, promoApi: async () => ({ codes: [], links: [], tenants: [] }) };
});

import { SidebarSectionsProvider } from '@/components/admin/sidebar-sections';
import FeedbacksPage from '@/app/admin/(protected)/feedbacks/page';
import PlatformRentalsPage from '@/app/admin/(protected)/platform-rentals/page';
import AuditLogsPage from '@/app/admin/(protected)/audit-logs/page';
import RequestsPage from '@/app/admin/(protected)/requests/page';
import RentalCompaniesPage from '@/app/admin/(protected)/rentals/page';
import ContactsPage from '@/app/admin/(protected)/contacts/page';
import OpenAiUsagePage from '@/app/admin/(protected)/openai-usage/page';
import BlacklistPage from '@/app/admin/(protected)/blacklist/page';
import BonzahSubmissions from '@/components/admin/BonzahSubmissions';
import { CodesTab } from '@/components/admin/promo-codes/codes-tab';
import { ReferralLinksTab } from '@/components/admin/promo-codes/referral-links-tab';

const PAGES: [string, React.ComponentType][] = [
  ['feedbacks', FeedbacksPage],
  ['platform-rentals', PlatformRentalsPage],
  ['audit-logs', AuditLogsPage],
  ['requests', RequestsPage],
  ['rentals', RentalCompaniesPage],
  /* Not pages. Promo Codes and Bonzah keep their filters in components, which
     is exactly why the first sweep missed them. */
  ['contacts', ContactsPage],
  ['openai-usage', OpenAiUsagePage],
  ['bonzah-submissions', BonzahSubmissions],
  ['promo-codes/codes', () => <CodesTab canEdit />],
  ['promo-codes/links', () => <ReferralLinksTab canEdit viewing={null} onView={() => {}} />],
];

/* Searches, but does not filter — so it has a field and deliberately no
   toggle. Kept out of PAGES because every assertion there is about the
   toggle. */
const SEARCH_ONLY: [string, React.ComponentType][] = [['blacklist', BlacklistPage]];

/*
 * Which surfaces pair the toggle with a SEARCH FIELD, and which show it alone.
 *
 * Contact Requests and OpenAI Usage narrow without a query — one by status,
 * one by date range — so there is no field for the toggle to sit inside and it
 * stands on its own. Asserting a search box on every surface is what made the
 * first version of this fail: it encoded "all pages look alike" rather than
 * what the pages actually do.
 */
const TOGGLE_ONLY = new Set(['contacts', 'openai-usage']);
const WITH_FIELD = PAGES.filter(([name]) => !TOGGLE_ONLY.has(name));

describe('the list pages render', () => {
  afterEach(cleanup);

  it.each(PAGES)('%s mounts and settles without throwing', async (_name, Page) => {
    expect(() =>
      render(
        <SidebarSectionsProvider>
          <Page />
        </SidebarSectionsProvider>,
      ),
    ).not.toThrow();

    // The render AFTER the queries resolve is where a hook below an early
    // return runs for the first time and React throws.
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });
  });

  it.each(WITH_FIELD)('%s shows its search field before the filters are opened', async (_name, Page) => {
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    // Nothing has been clicked: the panel is folded. The search box is on the
    // row above it, so it is in the document regardless.
    //
    // Found via the toggle rather than by placeholder text: Promo Codes
    // prompts with "SUNSET, LAUNCH50…" and "NORTHWIND, KEYWAY…", so matching
    // on the word "Search" silently skipped both of the surfaces this sweep
    // was added to cover.
    const toggle = screen.getByRole('button', { name: /show filters/i });
    expect(toggle.parentElement?.querySelector('input')).not.toBeNull();
  });

  it.each(WITH_FIELD)('%s offers the filter toggle inside the search field', async (_name, Page) => {
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    const toggle = screen.getByRole('button', { name: /show filters/i });
    // Folded on arrival — the whole point of the brief was that a list page
    // does not open wearing its filters.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    // INSIDE the field, not beside it. The toggle and the input share a
    // positioned wrapper, and the toggle is absolutely placed within it —
    // which is exactly the arrangement the round-button-beside-the-field
    // version failed to produce.
    const wrapper = toggle.parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('input')).not.toBeNull();
    expect(wrapper!.className).toContain('relative');
    expect(toggle.className).toContain('absolute');
  });

  it.each([...TOGGLE_ONLY])('%s shows the toggle on its own, with no empty field beside it', async (name) => {
    const entry = PAGES.find(([n]) => n === name)!;
    const Page = entry[1];
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    const toggle = screen.getByRole('button', { name: /show filters/i });
    // `standalone` positions it statically; an absolutely-placed toggle here
    // would be one that thinks it is sitting inside a field that is not there.
    expect(toggle.className).toContain('relative');
    expect(toggle.className).not.toContain('absolute');
  });

  it.each(PAGES)('%s opens and closes its filter panel', async (_name, Page) => {
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /show filters/i }));
    });

    // The panel is in the document and announces itself as open. jsdom runs no
    // animation, so this is the state change rather than the rotation — the
    // rotation is asserted against the source in admin-responsive-chrome.
    const toggle = await screen.findByRole('button', { name: /hide filters/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /close filters/i })).toBeTruthy();

    // ✕ closes it again. A mode with no way out is the bug this replaces.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close filters/i }));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /show filters/i })).toBeTruthy(),
    );
  });
});

describe('a page that searches without filtering', () => {
  afterEach(cleanup);

  it.each(SEARCH_ONLY)('%s mounts and shows the shared search field', async (_name, Page) => {
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    expect(document.querySelector('input[placeholder^="Search" i]')).not.toBeNull();
  });

  it.each(SEARCH_ONLY)('%s offers no filter toggle, because it has no filters', async (_name, Page) => {
    render(
      <SidebarSectionsProvider>
        <Page />
      </SidebarSectionsProvider>,
    );
    await waitFor(() => expect(document.body.textContent ?? '').not.toBe(''), { timeout: 4000 });

    // A toggle here would open an empty panel — a button that lies.
    expect(screen.queryByRole('button', { name: /show filters/i })).toBeNull();
  });
});
