/**
 * The sections registration, actually mounted.
 *
 * This exists because the first version of `sidebar-sections.tsx` shipped an
 * infinite render loop to production and took `/admin/promo-codes` down with a
 * client-side exception. Nothing caught it: `tsc --noEmit` was clean, the dev
 * server returned 200, and every page in that app redirects to the sign-in
 * without a session — so the component under test never rendered in any check
 * I ran.
 *
 * The bug was one object. The provider held `{ registration, register }` in a
 * single value memoised on `registration`, and the registering effect depended
 * on that object. Registering changed the value, which changed the object,
 * which re-ran the effect, which registered again.
 *
 * So these tests mount the real provider and the real hook and count renders.
 * A loop shows up as an unbounded count or React's own "Maximum update depth"
 * — either way, red.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import {
  SidebarSectionsProvider,
  useRegisterSidebarSections,
  useSidebarSections,
} from '@/components/admin/sidebar-sections';

/** Mirrors what a real page does: sections rebuilt inline on every render. */
function Page({ onRender, active = 'codes' }: { onRender: () => void; active?: string }) {
  onRender();
  const [tab, setTab] = useState(active);
  useRegisterSidebarSections(
    '/admin/promo-codes',
    [
      { id: 'codes', label: 'Codes' },
      { id: 'claims', label: 'Claims' },
    ],
    tab,
    setTab,
  );
  return <p>panel: {tab}</p>;
}

/** Stands in for the sidebar: reads the registration and draws the rows. */
function Rail() {
  const registration = useSidebarSections();
  if (!registration) return <p>no sections</p>;
  return (
    <ul>
      {registration.sections.map((s) => (
        <li key={s.id}>
          <button onClick={() => registration.onSelect(s.id)}>
            {s.label}
            {s.id === registration.active ? ' *' : ''}
          </button>
        </li>
      ))}
    </ul>
  );
}

describe('the sections registration settles', () => {
  it('renders a registering page a bounded number of times', () => {
    const onRender = vi.fn();
    render(
      <SidebarSectionsProvider>
        <Rail />
        <Page onRender={onRender} />
      </SidebarSectionsProvider>,
    );

    // The loop this guards against ran until React gave up. A handful of
    // renders is normal — mount, then one more once the registration lands.
    expect(onRender.mock.calls.length).toBeLessThan(10);
    expect(screen.getByText('panel: codes')).toBeTruthy();
  });

  it('publishes the page sections to the rail', () => {
    render(
      <SidebarSectionsProvider>
        <Rail />
        <Page onRender={() => {}} />
      </SidebarSectionsProvider>,
    );
    expect(screen.getByRole('button', { name: /Codes/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Claims/ })).toBeTruthy();
  });

  it('changes the page section when a rail row is pressed, and settles again', () => {
    const onRender = vi.fn();
    render(
      <SidebarSectionsProvider>
        <Rail />
        <Page onRender={onRender} />
      </SidebarSectionsProvider>,
    );
    const before = onRender.mock.calls.length;

    act(() => {
      screen.getByRole('button', { name: /Claims/ }).click();
    });

    expect(screen.getByText('panel: claims')).toBeTruthy();
    // Switching re-registers once with the new `active`; it must not cascade.
    expect(onRender.mock.calls.length - before).toBeLessThan(6);
  });

  it('takes the sections away when the page unmounts', () => {
    const { rerender } = render(
      <SidebarSectionsProvider>
        <Rail />
        <Page onRender={() => {}} />
      </SidebarSectionsProvider>,
    );
    expect(screen.queryByText('no sections')).toBeNull();

    rerender(
      <SidebarSectionsProvider>
        <Rail />
      </SidebarSectionsProvider>,
    );
    expect(screen.getByText('no sections')).toBeTruthy();
  });

  it('is inert with no provider around it', () => {
    // A page rendered outside the admin shell must not throw.
    expect(() => render(<Page onRender={() => {}} />)).not.toThrow();
  });
});
