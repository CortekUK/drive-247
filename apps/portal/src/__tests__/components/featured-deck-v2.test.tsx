/**
 * The featured deck on the hero tabs (components/shared/featured-deck-v2.tsx
 * and featured-deck-view-v2.tsx): what it does on screen.
 *
 * The ordering and gating rules are pinned in __tests__/lib/featured-cards.test.ts;
 * this file pins behaviour — auto-advance and its pauses, reduced motion,
 * manual navigation, the keyboard, rotation between visits, and hiding an
 * announcement through the shared detail dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => motion.reduce };
});

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** What the connected deck's hooks answer, per test. */
const env = vi.hoisted(() => ({
  announcements: [] as any[],
  dismissCalls: [] as string[],
  trax: null as null | { openSheet: () => void },
  canEditCustomers: true,
  turoBridgeEnabled: true,
  tenantLoading: false,
}));

vi.mock('@/hooks/use-feature-announcements', async () => {
  const { useState } = await import('react');
  return {
    useFeatureAnnouncements: () => {
      const [dismissed, setDismissed] = useState<string[]>([]);
      return {
        announcements: env.announcements.filter((a) => !dismissed.includes(a.id)),
        hasDismissed: dismissed.length > 0,
        isLoading: false,
        dismiss: (id: string) => {
          env.dismissCalls.push(id);
          setDismissed((prev) => [...prev, id]);
        },
        restore: () => setDismissed([]),
      };
    },
  };
});
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 't-1', slug: 'northwind', turo_bridge_enabled: env.turoBridgeEnabled },
    tenantSlug: 'northwind',
    loading: env.tenantLoading,
  }),
}));
vi.mock('@/stores/auth-store', () => ({
  useAuth: () => ({ appUser: { id: 'user-1', role: 'head_admin' } }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    canView: () => true,
    canEdit: (tab: string) => (tab === 'customers' ? env.canEditCustomers : true),
    canAccessRoute: () => true,
    isLoading: false,
  }),
}));
vi.mock('@/components/trax/trax-provider', () => ({
  useTraxOptional: () => env.trax,
}));

import { ADVANCE_MS, FeaturedDeck, FeaturedDeckView, MAX_DOTS } from '@/components/shared/featured-deck-v2';
import { HeroRow } from '@/components/shared/hero-chart-v2';
import { V2Provider } from '@/lib/v2-context';
import type { DeckCard, FeaturedAction } from '@/lib/featured-cards';

/** The shared setup's vi.fn() arrow mocks cannot be constructed with `new`. */
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function feature(id: string, title: string, action: FeaturedAction = { kind: 'handler', handler: 'openCalendar' }): DeckCard {
  return {
    source: 'feature',
    id: `feature:${id}`,
    featureId: 'calendar-view',
    title,
    subtitle: `${title} subtitle`,
    art: 'calendar',
    badge: null,
    action,
  };
}

const THREE: DeckCard[] = [feature('one', 'Card one'), feature('two', 'Card two'), feature('three', 'Card three')];

/**
 * A working localStorage. Under Node 25 the global `localStorage` (and so
 * `window.localStorage`, which is the same object here) is Node's own
 * experimental stub with no getItem/setItem unless `--localstorage-file` is
 * given, and it shadows jsdom's. The deck must survive that (it does: every
 * storage call is caught), but rotation needs a real store to be tested.
 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => (map.has(k) ? map.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, String(v));
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn((i: number) => [...map.keys()][i] ?? null),
    get length() {
      return map.size;
    },
  };
}

const slide = () => document.querySelector<HTMLElement>('[aria-roledescription="slide"]');
const shownTitle = () => slide()?.querySelector('[title]')?.textContent ?? null;
const live = () => document.querySelector('[aria-live="polite"]')?.textContent;
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('localStorage', memoryStorage());
  motion.reduce = false;
  env.announcements = [];
  env.dismissCalls = [];
  env.trax = null;
  env.canEditCustomers = true;
  env.turoBridgeEnabled = true;
  env.tenantLoading = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FeaturedDeckView — the slot', () => {
  it('renders nothing for an empty deck, ready or not', () => {
    expect(render(<FeaturedDeckView cards={[]} />).container.innerHTML).toBe('');
    expect(render(<FeaturedDeckView cards={[]} ready={false} />).container.innerHTML).toBe('');
  });

  it('holds an empty shell until ready, then fills the SAME root', () => {
    const { container, rerender } = render(<FeaturedDeckView cards={THREE} ready={false} anchor="rentals-featured" />);
    const root = container.querySelector('[data-tour="rentals-featured"]')!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.textContent).toBe('');
    expect(slide()).toBeNull();

    rerender(<FeaturedDeckView cards={THREE} ready anchor="rentals-featured" />);
    expect(container.querySelector('[data-tour="rentals-featured"]')).toBe(root);
    expect(container.childElementCount).toBe(1);
    expect(root.getAttribute('aria-hidden')).toBeNull();
    expect(root.getAttribute('aria-roledescription')).toBe('carousel');
    expect(screen.getByRole('region', { name: 'Featured' })).toBe(root);
    expect(shownTitle()).toBe('Card one');
  });

  it('labels each slide "n of N"', () => {
    render(<FeaturedDeckView cards={THREE} />);
    expect(slide()!.getAttribute('aria-label')).toBe('1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(slide()!.getAttribute('aria-label')).toBe('2 of 3');
  });

  it('shows dots and prev/next only with two or more cards', () => {
    const single = render(<FeaturedDeckView cards={[THREE[0]]} />);
    expect(screen.queryByRole('button', { name: 'Next card' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Show / })).toHaveLength(0);
    expect(slide()!.getAttribute('aria-label')).toBe('1 of 1');
    single.unmount();

    render(<FeaturedDeckView cards={THREE} />);
    expect(screen.getAllByRole('button', { name: /^Show / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Show Card one, 1 of 3',
      'Show Card two, 2 of 3',
      'Show Card three, 3 of 3',
    ]);
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeInTheDocument();
  });

  it('keeps dots up to MAX_DOTS cards, then shows an "n / N" count instead', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => feature(`c${i}`, `Card ${i + 1}`));
    expect(MAX_DOTS).toBe(8);

    const atLimit = render(<FeaturedDeckView cards={many(8)} />);
    expect(screen.getAllByRole('button', { name: /^Show / })).toHaveLength(8);
    expect(document.querySelector('[data-deck-count]')).toBeNull();
    atLimit.unmount();

    render(<FeaturedDeckView cards={many(9)} />);
    expect(screen.queryAllByRole('button', { name: /^Show / })).toHaveLength(0);
    expect(document.querySelector('[data-deck-count]')!.textContent).toBe('1 / 9');
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(document.querySelector('[data-deck-count]')!.textContent).toBe('2 / 9');
    expect(slide()!.getAttribute('aria-label')).toBe('2 of 9');
  });

  it('keeps the Important chip solid: never the class pair the v2 theme repaints as a tint', () => {
    // styles/v2-theme.css matches [class~="bg-destructive"][class~="text-destructive-foreground"].
    render(<FeaturedDeckView cards={[{ ...feature('imp', 'Heads up'), badge: 'Important' }]} />);
    const chip = within(slide()!).getByText('Important');
    expect(chip.classList.contains('bg-destructive')).toBe(true);
    expect(chip.classList.contains('text-destructive-foreground')).toBe(false);
  });

  it('renders titles as text, never as HTML', () => {
    const { container } = render(<FeaturedDeckView cards={[feature('x', '<b>bold</b>')]} />);
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('runs a handler card’s handler, and makes an href card a link', () => {
    const openCalendar = vi.fn();
    const first = render(<FeaturedDeckView cards={[feature('one', 'Card one')]} handlers={{ openCalendar }} />);
    fireEvent.click(screen.getByRole('button', { name: /Card one/ }));
    expect(openCalendar).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<FeaturedDeckView cards={[feature('turo', 'Turo Sync', { kind: 'href', href: '/turo-bridge' })]} />);
    expect(screen.getByRole('link', { name: /Turo Sync/ }).getAttribute('href')).toBe('/turo-bridge');
  });
});

describe('FeaturedDeckView — auto-advance', () => {
  it('moves every 8 seconds, wraps, and never speaks while doing it', () => {
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    expect(shownTitle()).toBe('Card one');
    tick(ADVANCE_MS - 1);
    expect(shownTitle()).toBe('Card one');
    tick(1);
    expect(shownTitle()).toBe('Card two');
    tick(ADVANCE_MS);
    expect(shownTitle()).toBe('Card three');
    tick(ADVANCE_MS);
    expect(shownTitle()).toBe('Card one');
    expect(live()).toBe('');
  });

  it('pauses while the pointer is over the deck, and restarts the full interval after', () => {
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    const root = screen.getByRole('region', { name: 'Featured' });
    tick(ADVANCE_MS / 2);
    fireEvent.mouseEnter(root);
    tick(ADVANCE_MS * 3);
    expect(shownTitle()).toBe('Card one');
    fireEvent.mouseLeave(root);
    tick(ADVANCE_MS - 1);
    expect(shownTitle()).toBe('Card one');
    tick(1);
    expect(shownTitle()).toBe('Card two');
  });

  it('pauses while focus is inside the deck', () => {
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    const card = within(slide()!).getByRole('button', { name: /Card one/ });
    act(() => card.focus());
    tick(ADVANCE_MS * 3);
    expect(shownTitle()).toBe('Card one');
    act(() => card.blur());
    tick(ADVANCE_MS);
    expect(shownTitle()).toBe('Card two');
  });

  it('pauses while the document is hidden', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<FeaturedDeckView cards={THREE} />);
    tick(ADVANCE_MS * 3);
    expect(shownTitle()).toBe('Card one');
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(ADVANCE_MS);
    expect(shownTitle()).toBe('Card two');
  });

  it('does not advance or animate under reduced motion, and still moves by hand', () => {
    // Positive control first: with motion on, the art and arrow carry animations.
    const moving = render(<FeaturedDeckView cards={THREE} />);
    const animated = () =>
      [...document.querySelectorAll<HTMLElement>('[style]')].filter((el) =>
        /animation/.test(el.getAttribute('style') ?? ''),
      );
    expect(animated().length).toBeGreaterThan(0);
    expect(document.querySelector('[data-motion]')!.getAttribute('data-motion')).toBe('live');
    moving.unmount();

    motion.reduce = true;
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    expect(document.querySelector('[data-motion]')!.getAttribute('data-motion')).toBe('still');
    expect(animated()).toHaveLength(0);
    tick(ADVANCE_MS * 4);
    expect(shownTitle()).toBe('Card one');
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(shownTitle()).toBe('Card two');
  });
});

describe('FeaturedDeckView — manual navigation', () => {
  it('stops auto-advance for good, and announces each manual change', () => {
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(shownTitle()).toBe('Card two');
    expect(live()).toBe('Card two, 2 of 3');
    tick(ADVANCE_MS * 5);
    expect(shownTitle()).toBe('Card two');

    fireEvent.click(screen.getByRole('button', { name: 'Previous card' }));
    expect(shownTitle()).toBe('Card one');
    expect(live()).toBe('Card one, 1 of 3');

    const dot = screen.getByRole('button', { name: 'Show Card three, 3 of 3' });
    fireEvent.click(dot);
    expect(shownTitle()).toBe('Card three');
    expect(dot.getAttribute('aria-current')).toBe('true');
    tick(ADVANCE_MS * 5);
    expect(shownTitle()).toBe('Card three');
  });

  it('moves with the arrow keys from anywhere in the deck, keeping focus on the card', () => {
    vi.useFakeTimers();
    render(<FeaturedDeckView cards={THREE} />);
    const first = within(slide()!).getByRole('button', { name: /Card one/ });
    act(() => first.focus());

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(shownTitle()).toBe('Card two');
    expect(document.activeElement).toBe(within(slide()!).getByRole('button', { name: /Card two/ }));

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(shownTitle()).toBe('Card three');
    expect(live()).toBe('Card three, 3 of 3');

    // Modified arrows belong to the browser or the OS.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', altKey: true });
    expect(shownTitle()).toBe('Card three');

    // From a dot, too; focus stays on the dot.
    const dot = screen.getByRole('button', { name: 'Show Card one, 1 of 3' });
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: 'ArrowRight' });
    expect(shownTitle()).toBe('Card one');
    expect(document.activeElement).toBe(dot);

    // A keyboard change is a manual change: no auto-advance afterwards.
    act(() => dot.blur());
    tick(ADVANCE_MS * 3);
    expect(shownTitle()).toBe('Card one');
  });
});

describe('FeaturedDeckView — rotation between visits', () => {
  it('starts on the card after the one shown last, and records what it shows', () => {
    localStorage.setItem('deck-key', 'feature:two');
    const first = render(<FeaturedDeckView cards={THREE} storageKey="deck-key" />);
    expect(shownTitle()).toBe('Card three');
    expect(localStorage.getItem('deck-key')).toBe('feature:three');
    first.unmount();

    render(<FeaturedDeckView cards={THREE} storageKey="deck-key" />);
    expect(shownTitle()).toBe('Card one');
    expect(localStorage.getItem('deck-key')).toBe('feature:one');
  });

  it('still renders when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => render(<FeaturedDeckView cards={THREE} storageKey="deck-key" />)).not.toThrow();
    expect(shownTitle()).toBe('Card one');
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(shownTitle()).toBe('Card two');
  });
});

describe('FeaturedDeck — connected to the portal', () => {
  const announcement = (fields: Record<string, unknown>) => ({
    id: 'a-1',
    title: 'Deposit Holds',
    summary: 'Holds now refresh themselves.',
    body_html: '<p>Nothing to do.</p>',
    image_url: null,
    cta_label: null,
    cta_url: '/rentals',
    severity: 'critical',
    published_at: '2026-09-10T00:00:00Z',
    expires_at: null,
    sort_priority: 0,
    audience_filter: null,
    ...fields,
  });

  it('opens the shared detail dialog, and "Got it, hide this" removes the card through the hook', async () => {
    env.announcements = [announcement({})];
    render(
      <V2Provider flags={{}}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar: vi.fn() }} anchor="rentals-featured" />
      </V2Provider>,
    );
    expect(shownTitle()).toBe('Deposit Holds');
    expect(within(slide()!).getByText('Important')).toBeInTheDocument();

    fireEvent.click(within(slide()!).getByRole('button', { name: /Deposit Holds/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Holds now refresh themselves.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it, hide this' }));
    expect(env.dismissCalls).toEqual(['a-1']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Deposit Holds')).toBeNull();
    expect(shownTitle()).toBe('Calendar View');
    expect(slide()!.getAttribute('aria-label')).toBe('1 of 1');
  });

  it('does not advance behind an open dialog', () => {
    vi.useFakeTimers();
    env.announcements = [announcement({})];
    render(
      <V2Provider flags={{}}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar: vi.fn() }} />
      </V2Provider>,
    );
    fireEvent.click(within(slide()!).getByRole('button', { name: /Deposit Holds/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pointer and focus have left the deck; only the open dialog holds it.
    fireEvent.mouseLeave(screen.getByRole('region', { name: 'Featured' }));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    tick(ADVANCE_MS * 3);
    expect(shownTitle()).toBe('Deposit Holds');
  });

  it('offers Ask Trax only under a Trax provider, and Turo Sync only with both gates', () => {
    const openCalendar = vi.fn();
    const dots = () => screen.getAllByRole('button', { name: /^Show / }).map((b) => b.getAttribute('aria-label'));

    const withTuro = render(
      <V2Provider flags={{ turo: true }}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar }} />
      </V2Provider>,
    );
    expect(dots()).toEqual(['Show Turo Sync, 1 of 2', 'Show Calendar View, 2 of 2']);
    withTuro.unmount();

    vi.stubGlobal('localStorage', memoryStorage());
    env.turoBridgeEnabled = false;
    env.trax = { openSheet: vi.fn() };
    render(
      <V2Provider flags={{ turo: true }}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar }} />
      </V2Provider>,
    );
    expect(dots()).toEqual(['Show Calendar View, 1 of 2', 'Show Ask Trax, 2 of 2']);
    fireEvent.click(screen.getByRole('button', { name: 'Show Ask Trax, 2 of 2' }));
    fireEvent.click(within(slide()!).getByRole('button', { name: /Ask Trax/ }));
    expect(env.trax.openSheet).toHaveBeenCalledTimes(1);
  });

  it('drops invite and import without canEdit("customers"), leaving the lean Blocked link', () => {
    env.canEditCustomers = false;
    render(
      <V2Provider flags={{}}>
        <FeaturedDeck
          tab="customers"
          routePrefixes={['/customers']}
          handlers={{ openInvite: vi.fn(), openImport: vi.fn() }}
          anchor="customers-featured"
        />
      </V2Provider>,
    );
    expect(screen.queryByText('Invite link')).toBeNull();
    expect(screen.queryByText('Import CSV')).toBeNull();
    expect(screen.getByRole('link', { name: /Blocklist/ }).getAttribute('href')).toBe('/blocked-customers');
    expect(document.querySelector('[data-tour="customers-featured"]')).not.toBeNull();
  });

  it('keeps its card, controls and Turo Sync while the tenant row reloads', () => {
    // refetchTenant() puts TenantContext's `loading` back to true with the page
    // still mounted. Before the latch this blanked the deck.
    const deck = () => (
      <V2Provider flags={{ turo: true }}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals', '/turo-bridge']} handlers={{ openCalendar: vi.fn() }} anchor="rentals-featured" />
      </V2Provider>
    );
    const dots = () => screen.queryAllByRole('button', { name: /^Show / }).map((b) => b.getAttribute('aria-label'));
    const { rerender } = render(deck());
    const root = document.querySelector('[data-tour="rentals-featured"]')!;
    const next = screen.getByRole('button', { name: 'Next card' });
    act(() => next.focus());
    expect(dots()).toEqual(['Show Turo Sync, 1 of 2', 'Show Calendar View, 2 of 2']);
    expect(shownTitle()).toBe('Turo Sync');

    env.tenantLoading = true;
    rerender(deck());
    expect(document.querySelector('[data-tour="rentals-featured"]')).toBe(root);
    expect(root.getAttribute('aria-hidden')).toBeNull();
    expect(root.getAttribute('aria-roledescription')).toBe('carousel');
    expect(slide()!.getAttribute('aria-label')).toBe('1 of 2');
    expect(shownTitle()).toBe('Turo Sync');
    expect(dots()).toEqual(['Show Turo Sync, 1 of 2', 'Show Calendar View, 2 of 2']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next card' }));

    // The reload lands with the switch turned off: now the card goes.
    env.tenantLoading = false;
    env.turoBridgeEnabled = false;
    rerender(deck());
    expect(dots()).toEqual([]);
    expect(shownTitle()).toBe('Calendar View');
    expect(slide()!.getAttribute('aria-label')).toBe('1 of 1');
  });

  it('still refuses Turo Sync while the tenant row is FIRST loading', () => {
    env.tenantLoading = true;
    const deck = () => (
      <V2Provider flags={{ turo: true }}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar: vi.fn() }} anchor="rentals-featured" />
      </V2Provider>
    );
    const { rerender } = render(deck());
    // Not ready: the shell holds the slot, nothing chosen, nothing announced.
    expect(document.querySelector('[data-tour="rentals-featured"]')!.getAttribute('aria-hidden')).toBe('true');
    expect(slide()).toBeNull();
    env.tenantLoading = false;
    rerender(deck());
    expect(shownTitle()).toBe('Turo Sync');
  });

  it('takes its tour anchor as `anchor` or as `data-tour`, `anchor` winning', () => {
    const deck = (props: Record<string, string>) => (
      <V2Provider flags={{}}>
        <FeaturedDeck tab="rentals" routePrefixes={['/rentals']} handlers={{ openCalendar: vi.fn() }} {...props} />
      </V2Provider>
    );
    const viaAttribute = render(deck({ 'data-tour': 'rentals-featured' }));
    expect(screen.getByRole('region', { name: 'Featured' }).getAttribute('data-tour')).toBe('rentals-featured');
    viaAttribute.unmount();

    render(deck({ anchor: 'from-anchor', 'data-tour': 'from-attribute' }));
    expect(screen.getByRole('region', { name: 'Featured' }).getAttribute('data-tour')).toBe('from-anchor');
  });

  it('remembers the card per tab and signed-in user', () => {
    render(
      <V2Provider flags={{}}>
        <FeaturedDeck tab="vehicles" routePrefixes={['/vehicles']} recommendations={[
          { id: 'no-photo', count: 3, title: '3 cars have no photo', subtitle: 'Add one', action: { kind: 'href', href: '/vehicles' } },
        ]} />
      </V2Provider>,
    );
    expect(shownTitle()).toBe('3 cars have no photo');
    expect(localStorage.getItem('portal:featured-deck:last-shown:vehicles:user-1')).toBe('recommendation:no-photo');
  });
});

describe('HeroRow with a deck', () => {
  it('wraps the card without a box of its own, and leaves the wrapper empty when the deck is', () => {
    const { container } = render(<HeroRow chart={<div>chart</div>} card={<FeaturedDeckView cards={[]} />} />);
    const row = container.firstElementChild!;
    expect(row.className).toContain('lg:[&:has(>[data-hero-card]:empty)>[data-hero-chart]]:col-span-4');
    const wrapper = row.querySelector('[data-hero-card]')!;
    expect(wrapper.className).toBe('contents');
    expect(wrapper.childNodes).toHaveLength(0);
    expect(row.firstElementChild!.hasAttribute('data-hero-chart')).toBe(true);
  });
});
