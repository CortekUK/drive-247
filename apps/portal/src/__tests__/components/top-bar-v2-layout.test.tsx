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

    // The sparkle is Trax's own round gradient mark, not a line icon (team
    // lead, Sep 20 2026: "a bit bolder, a bit more 3D — not too prominent").
    // The badge is the one at `xs`, and the glyph sits INSIDE it.
    const mark = help.querySelector<HTMLElement>('[data-slot="trax-mark"]');
    expect(mark).not.toBeNull();
    expect(mark!.className.split(/\s+/)).toContain('size-5');
    expect(mark!.querySelector('svg.lucide-sparkles')).not.toBeNull();
    // Its lift is the small one; the 14px bloom belongs to the larger marks.
    expect(mark!.innerHTML).toContain('shadow-[0_2px_6px_-2px_hsl(var(--primary)/0.5)]');
    expect(mark!.innerHTML).not.toContain('0_4px_14px');
    // The badge sits in the pill like an avatar in a chip: left inset = top inset.
    expect(help.className.split(/\s+/)).toEqual(expect.arrayContaining(['pl-1.5', 'pr-2.5']));

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
 * bar shows a line; we want it to blend, not a transparency effect." Then, Sep
 * 23 2026, with a screenshot of the top-left: "the sidebar heading is fixed and
 * scrolling begins after it. Make the main view's top bar fixed the same way…
 * that also solves the line problem we keep seeing."
 *
 * They were the same defect twice. The bar was `sticky top-0` over a
 * window-scrolling page, so rows passed UNDER it, so it painted a ground to
 * keep the search field readable — first `bg-background/60` with an inset
 * hairline, then a masked, blurred veil that faded in on scroll. Every
 * complaint was about the edge of that ground.
 *
 * The frame fixes it at the cause: `<main>` is the scroll container and starts
 * at this bar's bottom edge, so nothing passes under the bar and it needs no
 * ground at all. These pin that: the bar does not scroll, has no seam of any
 * kind, and the veil and its `window.scrollY` listener are gone rather than
 * retuned.
 */
describe('v2 top bar: a row, not a pinned layer', () => {
  const header = () => document.querySelector('header')!;
  const SRC = readFileSync(
    join(__dirname, '..', '..', 'components', 'shared', 'layout', 'top-bar-v2.tsx'),
    'utf8',
  );
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('does not scroll: no sticky, no fixed, no top-0, no z-index', () => {
    render(<TopBarV2 />);
    const cls = header().className.split(/\s+/);
    expect(cls).not.toContain('sticky');
    expect(cls).not.toContain('fixed');
    expect(cls).not.toContain('top-0');
    expect(cls.filter((c) => /^z-\d/.test(c))).toEqual([]);
    // Still a fixed-height row the flex pass subtracts, which is what keeps
    // main's bound (and every `h-[calc(100svh-66px)]` page) true.
    expect(cls).toContain('h-16');
    expect(cls).toContain('shrink-0');
    // Nothing in the source may put it back, in any state.
    expect(code).not.toContain('sticky top-0');
  });

  it('carries no border, hairline, shadow or fill of its own, in any state', () => {
    render(<TopBarV2 />);
    const cls = header().className;
    expect(cls).not.toMatch(/\bborder(-[btlrxy])?\b/);
    expect(cls).not.toMatch(/\bshadow-/);
    expect(cls).not.toContain('inset_0_-1px_0');
    expect(cls).toContain('bg-transparent');

    // Nor in the class strings the source could swap to.
    expect(code).not.toContain('shadow-[inset_0_-1px_0_hsl(var(--border))]');
    expect(code).not.toContain('bg-background/60');
    expect(code).not.toContain('from-background/75 via-background/55');
  });

  it('paints no veil, and listens to no window scroll', () => {
    render(<TopBarV2 />);
    // The masked, blurred ground is GONE, not merely hidden: with nothing
    // scrolling under the bar there is no edge for it to remove.
    expect(document.querySelector('[data-slot="top-bar-veil"]')).toBeNull();
    expect(header().querySelector('[aria-hidden="true"].backdrop-blur-xl')).toBeNull();
    expect(code).not.toContain('top-bar-veil');
    expect(code).not.toContain('backdrop-blur-xl');
    expect(code).not.toContain('mask-image');
    // No scroll state, and no window scroll listener to drive it.
    expect(code).not.toContain('window.scrollY');
    expect(code).not.toMatch(/addEventListener\(\s*["']scroll["']/);
    expect(code).not.toContain('setScrolled');
  });

  it('keeps every control it had, on the bar itself', () => {
    render(<TopBarV2 />);
    // The veil was the only thing between the bar and its controls; removing it
    // must not have taken anything with it.
    for (const name of ['Help, ask Trax', 'Messages', 'Notifications'] as const) {
      expect(header().contains(screen.getByRole('button', { name }))).toBe(true);
    }
    expect(header().contains(screen.getByRole('link', { name: /Credits/ }))).toBe(true);
    const [searchField] = screen.getAllByRole('button', { name: 'Search' });
    expect(header().contains(searchField)).toBe(true);
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
