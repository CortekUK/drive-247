/**
 * The v2 top bar's layout, as the team lead set it (Sep 2026):
 *
 *   [search field][Trax] ................ [credits][messages][notifications]
 *
 * - the search field is a little smaller than it was (32px tall, 380px max),
 * - Trax sits right after the search field instead of at the far right, labelled
 *   "Help" with the AI sparkle, and greets "Hi, I'm Trax. How can I help?" on hover,
 * - notifications are at the extreme right, messages before them, credits
 *   before messages,
 * - hovering those controls shows the sidebar's light purple (`bg-primary/10`,
 *   the active-item pill), never the white/grey `bg-muted`.
 *
 * Also pins the other half of the same request: the dashboard no longer carries
 * a New Rental button (Rentals has its own).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ui-v2/sidebar', () => ({ SidebarTrigger: () => null }));
vi.mock('@/components/ui-v2/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock('@/components/shared/layout/global-search', () => ({ GlobalSearch: () => null }));
// The real trigger is what the bar passes in, so render it.
vi.mock('@/components/shared/layout/dock-sheets', () => ({
  MessagesSheet: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock('@/components/shared/layout/notification-bell', () => ({
  NotificationBell: () => (
    <button type="button" aria-label="Notifications">
      bell
    </button>
  ),
}));
vi.mock('@/hooks/use-unread-count', () => ({ useUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/use-credit-wallet', () => ({
  useCreditWallet: () => ({ balance: 100, isLowBalance: false, isLoading: false }),
}));
vi.mock('@/components/trax/trax-provider', () => ({
  useTraxOptional: () => ({ sheetOpen: false, openSheet: () => {}, closeSheet: () => {} }),
}));
vi.mock('@/components/shared/layout/page-search-slot', () => ({ usePageSearchSlot: () => null }));

import { TopBarV2 } from '@/components/shared/layout/top-bar-v2';

/** Every element that follows `a` in document order is "after" it. */
const isBefore = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('v2 top bar layout', () => {
  it('orders the bar: search, Trax, then credits, messages, notifications', () => {
    render(<TopBarV2 />);
    // The sm+ field is the first "Search" control; the phone icon button follows it.
    const [searchField] = screen.getAllByRole('button', { name: 'Search' });
    const trax = screen.getByRole('button', { name: 'Help, ask Trax' });
    const credits = screen.getByRole('link', { name: /Credits/ });
    const messages = screen.getByRole('button', { name: 'Messages' });
    const bell = screen.getByRole('button', { name: 'Notifications' });

    const order = [searchField, trax, credits, messages, bell];
    for (let i = 0; i < order.length - 1; i++) {
      expect(isBefore(order[i], order[i + 1])).toBe(true);
    }

    // Trax is outside the right-hand cluster; the three icons are inside it, and
    // notifications is the cluster's last control.
    const cluster = credits.closest('div.ml-auto')!;
    expect(cluster).not.toBeNull();
    expect(cluster.contains(trax)).toBe(false);
    expect(cluster.contains(messages)).toBe(true);
    expect(cluster.contains(bell)).toBe(true);
    const controls = cluster.querySelectorAll('a, button');
    expect(controls[controls.length - 1]).toBe(bell);
  });

  it('makes the search field a little smaller', () => {
    render(<TopBarV2 />);
    const [searchField] = screen.getAllByRole('button', { name: 'Search' });
    expect(searchField.className).toContain('h-8');
    expect(searchField.className).toContain('max-w-[380px]');
    expect(searchField.className).not.toContain('max-w-[460px]');
  });

  it('hovers every control in light purple, never white or grey', () => {
    render(<TopBarV2 />);
    const trax = screen.getByRole('button', { name: 'Help, ask Trax' });
    const credits = screen.getByRole('link', { name: /Credits/ });
    const messages = screen.getByRole('button', { name: 'Messages' });
    const bellWrapper = screen.getByRole('button', { name: 'Notifications' }).parentElement!;

    for (const el of [trax, credits, messages]) {
      expect(el.className).toContain('hover:bg-primary/10');
    }
    expect(bellWrapper.className).toContain('[&>button:hover]:bg-primary/10');

    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'shared', 'layout', 'top-bar-v2.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/hover:bg-muted/);
  });
});

describe('v2 top bar Help button', () => {
  it('reads "Help" with the AI sparkle, and Trax introduces itself on hover', () => {
    render(<TopBarV2 />);
    const help = screen.getByRole('button', { name: 'Help, ask Trax' });
    expect(help.textContent?.trim()).toBe('Help');
    expect(help.querySelector('svg.lucide-sparkles')).not.toBeNull();
    expect(help.querySelector('svg.lucide-bot')).toBeNull();

    // The tooltip is stubbed out in this harness, so pin its copy at the source.
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'shared', 'layout', 'top-bar-v2.tsx'),
      'utf8',
    );
    expect(src).toContain("Hi, I&apos;m Trax. How can I help?");
    expect(src).not.toContain('Ask Trax · ⌘J');
  });
});

describe('v2 dashboard', () => {
  it('no longer renders a New Rental button', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'dashboard-v2', 'dashboard-v2.tsx'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/New Rental/);
    expect(code).not.toMatch(/rentals\/new/);
    expect(code).toMatch(/<HomeBands \/>/);
  });
});
