/**
 * The top bar's page search field (v2 chrome).
 *
 * The field debounces typing by 400ms, pushes the term to the page, and the
 * page's committed value comes back through the slot. Rentals and vehicles
 * commit through `router.push`, so that echo can arrive well after the push.
 * The bar used to write every echo straight into the field, which replaced
 * anything typed in the gap with the older term. Each test puts a real delay
 * between push and commit, and types into it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Everything the bar draws besides the search field. Stubbed so the test needs
// no tenant, query client, realtime socket or sidebar context.
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/ui-v2/sidebar', () => ({ SidebarTrigger: () => null }));
vi.mock('@/components/ui-v2/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock('@/components/shared/layout/global-search', () => ({ GlobalSearch: () => null }));
vi.mock('@/components/shared/layout/dock-sheets', () => ({ MessagesSheet: () => null }));
vi.mock('@/components/shared/layout/notification-bell', () => ({ NotificationBell: () => null }));
vi.mock('@/hooks/use-unread-count', () => ({ useUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/use-credit-wallet', () => ({
  useCreditWallet: () => ({ balance: 0, isLowBalance: false, isLoading: true }),
}));
vi.mock('@/components/trax/trax-provider', () => ({ useTraxOptional: () => null }));

import { TopBarV2 } from '@/components/shared/layout/top-bar-v2';
import { PageSearchProvider, usePageSearch } from '@/components/shared/layout/page-search-slot';

const DEBOUNCE = 400;
const LABEL = 'Search things…';

/** A page that commits each pushed term `commitDelay` ms later, like a router.push round trip. */
function DelayedPage({ commitDelay }: { commitDelay: number }) {
  const [value, setValue] = useState('');
  usePageSearch({
    placeholder: LABEL,
    value,
    onChange: (next) => {
      setTimeout(() => setValue(next), commitDelay);
    },
  });
  return (
    <>
      <output data-testid="committed">{value}</output>
      <button type="button" onClick={() => setValue('')}>
        Clear filters
      </button>
    </>
  );
}

/** A page whose value and onChange the test fixes. */
function FixedPage(props: { placeholder: string; value: string; onChange: (next: string) => void }) {
  usePageSearch(props);
  return null;
}

const withBar = (page: ReactNode) => (
  <PageSearchProvider>
    <TopBarV2 />
    {page}
  </PageSearchProvider>
);

const field = (label = LABEL) => screen.getByLabelText(label) as HTMLInputElement;
const committed = () => screen.getByTestId('committed').textContent;
const type = (value: string, label = LABEL) =>
  act(() => {
    fireEvent.change(field(label), { target: { value } });
  });
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('top bar page search', () => {
  it('keeps a keystroke typed while the page is still committing the previous push', () => {
    render(withBar(<DelayedPage commitDelay={200} />));
    type('abc');
    wait(DEBOUNCE); // pushes "abc"; the page commits it 200ms later
    type('abcd'); // typed into that gap
    wait(200); // the "abc" echo lands
    expect(field().value).toBe('abcd');

    wait(DEBOUNCE + 200);
    expect(committed()).toBe('abcd');
    expect(field().value).toBe('abcd');
  });

  it('survives a second push landing before the first echo returns', () => {
    render(withBar(<DelayedPage commitDelay={900} />));
    type('ab');
    wait(DEBOUNCE); // t=400   push "ab"   → echo at 1300
    wait(100);
    type('abc'); // t=500
    wait(DEBOUNCE); // t=900   push "abc"  → echo at 1800
    wait(50);
    type('abcd'); // t=950 (pushes at 1350 → echo at 2250)
    wait(350); // t=1300  the "ab" echo lands
    expect(field().value).toBe('abcd');
    wait(500); // t=1800  the "abc" echo lands
    expect(field().value).toBe('abcd');

    wait(1000); // t=2800
    expect(committed()).toBe('abcd');
    expect(field().value).toBe('abcd');
  });

  it('still clears the page when the term is deleted before its echo returns', () => {
    render(withBar(<DelayedPage commitDelay={300} />));
    type('ab');
    wait(DEBOUNCE); // t=400 push "ab" → the page will hold "ab" at 700
    wait(100);
    type(''); // t=500, while the page still holds ""
    wait(200); // t=700 the "ab" echo lands
    expect(field().value).toBe('');

    wait(DEBOUNCE + 300);
    expect(committed()).toBe('');
  });

  it('takes a change the page makes itself, such as Clear filters, and pushes nothing back', () => {
    render(withBar(<DelayedPage commitDelay={200} />));
    type('abc');
    wait(DEBOUNCE + 200);
    expect(committed()).toBe('abc');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    });
    expect(field().value).toBe('');
    wait(DEBOUNCE + 200);
    expect(committed()).toBe('');
  });

  it('drops a push still waiting when another page takes the bar', () => {
    const onChangeA = vi.fn();
    const { rerender } = render(
      withBar(<FixedPage key="a" placeholder="Search A…" value="ab" onChange={onChangeA} />),
    );
    type('', 'Search A…'); // the push of "" to page A is now waiting

    rerender(withBar(<FixedPage key="b" placeholder="Search B…" value="" onChange={vi.fn()} />));
    wait(DEBOUNCE * 2);
    expect(onChangeA).not.toHaveBeenCalled();
    expect(field('Search B…').value).toBe('');
  });
});
