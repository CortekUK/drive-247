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
const pageSlot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/components/shared/layout/page-search-slot', () => ({ usePageSearchSlot: () => pageSlot.current }));

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

describe('v2 top bar page field: filter badge', () => {
  it('keeps the active-filter count inside the field, which clips its overflow', () => {
    // The badge used to hang outside the filter button (-right-1.5 -top-1.5),
    // and the field's overflow-hidden cut it in half.
    pageSlot.current = {
      placeholder: 'Search rentals',
      value: '',
      onChange: () => {},
      filters: { open: false, onOpenChange: () => {}, activeCount: 3 },
    };
    try {
      render(<TopBarV2 />);
      const button = screen.getByRole('button', { name: 'Show filters' });
      const badge = [...button.querySelectorAll('span')].find((el) => el.textContent === '3')!;
      expect(badge).toBeDefined();
      const field = button.parentElement!;
      expect(field.className).toContain('overflow-hidden');
      expect(field.contains(badge)).toBe(true);

      const cls = badge.className.split(/\s+/);
      expect(cls).toEqual(expect.arrayContaining(['absolute', 'right-0', 'top-0', 'size-3.5', 'rounded-full']));
      // No negative offset may push it past the button's own box.
      expect(cls.filter((c) => /^-(right|top|left|bottom|inset)-/.test(c))).toEqual([]);
    } finally {
      pageSlot.current = null;
    }
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

/**
 * Team lead, Sep 2026, with a screenshot of the seam: "when scrolling, the top
 * bar shows a line; we want it to blend, not a transparency effect."
 *
 * The bar used to paint `bg-background/60` with an inset hairline along its
 * bottom while the page was scrolled, and that hairline read as a line drawn
 * across the top of the screen. It is now a veil BEHIND the controls, reaching
 * past the bar and masked away over that tail, so there is no edge anywhere.
 */
describe('v2 top bar: the scrolled ground blends', () => {
  const header = () => document.querySelector('header')!;
  const veil = () => document.querySelector<HTMLElement>('[data-slot="top-bar-veil"]')!;

  it('carries no border, hairline or shadow of its own, in any state', () => {
    render(<TopBarV2 />);
    const cls = header().className;
    expect(cls).not.toMatch(/\bborder(-[btlrxy])?\b/);
    expect(cls).not.toMatch(/\bshadow-/);
    expect(cls).not.toContain('inset_0_-1px_0');
    expect(cls).toContain('bg-transparent');

    // Nor in the class strings the source can swap to on scroll.
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'shared', 'layout', 'top-bar-v2.tsx'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toContain('shadow-[inset_0_-1px_0_hsl(var(--border))]');
    expect(code).not.toContain('bg-background/60');
  });

  it('paints the ground as a masked veil behind the controls, which never takes a click', () => {
    render(<TopBarV2 />);
    const v = veil();
    expect(v).not.toBeNull();
    expect(v.parentElement).toBe(header());
    expect(v.getAttribute('aria-hidden')).toBe('true');

    const cls = v.className;
    // Behind the controls: the header is `sticky z-40`, which is its own
    // stacking context, so a negative z-index stays inside the bar.
    expect(cls).toContain('-z-[1]');
    expect(cls).toContain('pointer-events-none');
    // Reaches the bar's real edges. An absolutely positioned child is placed
    // against its ancestor's PADDING box, so `inset-x-0` would stop inside the
    // bar's own `px-3 sm:px-4` and leave a crisp gutter at each end.
    expect(cls).toContain('-inset-x-3');
    expect(cls).toContain('sm:-inset-x-4');
    expect(cls).not.toContain('inset-x-0');
    // Every horizontal padding the bar carries has its matching negative inset,
    // so adding one later without widening the veil fails here.
    const pads = (header().className.match(/(?:^|\s)(?:sm:)?px-\d+/g) ?? []).map((p) => p.trim());
    expect(pads.length).toBeGreaterThan(0);
    for (const pad of pads) {
      const expected = pad.startsWith('sm:') ? `sm:-inset-x-${pad.slice(6)}` : `-inset-x-${pad.slice(3)}`;
      expect(cls, pad).toContain(expected);
    }
    // Past the bar, then faded to nothing over that tail — blur and all, which
    // is why the mask is on this child and not on the header.
    expect(cls).toContain('h-[calc(100%+1.5rem)]');
    expect(cls).toContain('to-transparent');
    expect(cls).toContain('backdrop-blur-xl');
    expect(cls).toMatch(/\[mask-image:linear-gradient\(to_bottom,[^\]]*transparent[^\]]*\)\]/);
    // Nothing on it that would draw an edge.
    expect(cls).not.toMatch(/\bborder(-[btlrxy])?\b/);
    expect(cls).not.toMatch(/\bshadow-/);
  });

  it('is invisible until the page scrolls, and no control is inside it', () => {
    render(<TopBarV2 />);
    // Not scrolled: nothing painted at all, so the app gradient runs from the top.
    expect(veil().className).toContain('opacity-0');

    for (const name of ['Help, ask Trax', 'Messages', 'Notifications'] as const) {
      expect(veil().contains(screen.getByRole('button', { name }))).toBe(false);
    }
    expect(veil().contains(screen.getByRole('link', { name: /Credits/ }))).toBe(false);
    const [searchField] = screen.getAllByRole('button', { name: 'Search' });
    expect(veil().contains(searchField)).toBe(false);
  });
});

describe('v2 dashboard', () => {
  /**
   * The colour fix (team lead, Sep 20 2026: "the background issue, the colour
   * issue"). At rest the bar has no ground, so the app gradient runs from the
   * very top. What had to change: the fill was `--background`, plain white in
   * both v2 trees, so the moment the page scrolled a white wash lay over a
   * brand-tinted gradient and cut exactly the pale band across the top that the
   * earlier review had asked us to remove. It now comes from `--v2-wash`, the
   * token the gradient itself is painted with.
   *
   * It is the VEIL that carries it, not the header: the header keeps no ground
   * of its own in any state (see the veil describe above), so a fill on the
   * header would put back the edge the veil exists to remove.
   */
  it('scrolls to a brand-tinted veil, not a white band', () => {
    render(<TopBarV2 />);
    const header = document.querySelector('header')!;
    // The header itself never has a ground, scrolled or not.
    expect(header.className).toContain('bg-transparent');

    const cls = document.querySelector<HTMLElement>('[data-slot="top-bar-veil"]')!.className;
    // Brand hue, from the same token as the app gradient.
    expect(cls).toContain('from-[hsl(var(--v2-wash,var(--primary))_/_0.10)]');
    expect(cls).toContain('via-[hsl(var(--v2-wash,var(--primary))_/_0.06)]');
    expect(cls).toContain('backdrop-blur-xl');
    // Dark keeps the fill it had — dark mode was out of scope.
    expect(cls).toContain('dark:from-background/75');
    expect(cls).toContain('dark:via-background/55');

    const source = readFileSync(
      join(process.cwd(), 'src/components/shared/layout/top-bar-v2.tsx'),
      'utf8',
    );
    // The light-mode white veil is gone, not merely moved...
    expect(source).not.toContain('from-background/75 via-background/55');
    expect(source).not.toContain('? "bg-background/60');
    // ...and no hairline came back with the tint: --border carries its own
    // alpha in dark, and the edge is the thing the veil removes.
    expect(source).not.toContain('shadow-[inset_0_-1px_0_hsl(var(--border))]');
  });

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
