/**
 * The feature card deck on the dashboard desk band
 * (components/announcements/feature-announcement-deck.tsx).
 *
 * Pins: nothing rendered at zero; the card face (heading, one line, no pill);
 * the paper fallback for a missing or broken image; opening the slides dialog
 * by click, Enter and Space with the events recorded in order; what closing and
 * the button record; auto-advance and each of its five pauses; dots; the arrow
 * keys.
 *
 * `usePortalAnnouncements`, the manager permissions and the router are mocked;
 * the real dialog renders. Which slide is on screen is read from the slide
 * marked `data-slide-state="active"` (a slide crossfading out stays in the DOM
 * for its 250ms, marked "leaving") and from the dots' aria-current.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { FEATURE_DECK_ROTATE_MS, type PortalAnnouncement } from '@/lib/announcements/contract';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => motion.reduce };
});

const env = vi.hoisted(() => ({
  events: [] as Array<[string, string]>,
  pushed: [] as string[],
  allowed: ((_path: string) => true) as (path: string) => boolean,
}));

vi.mock('@/hooks/use-portal-announcements', () => ({
  usePortalAnnouncements: () => ({
    status: 'ready',
    system: [],
    features: [],
    featuresEnabled: true,
    recordEvent: (a: { id: string }, event: string) => {
      env.events.push([a.id, event]);
    },
  }),
}));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    canView: () => true,
    canEdit: () => true,
    canAccessRoute: (path: string) => env.allowed(path),
    isLoading: false,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => env.pushed.push(href), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
}));

import { FeatureAnnouncementDeck } from '@/components/announcements/feature-announcement-deck';

const img = (n: number) =>
  `https://abc.supabase.co/storage/v1/object/public/portal-announcement-media/feature/card/1111111${n}-2222-4333-8444-555555555555.png`;

function feature(id: string, title: string, fields: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id,
    kind: 'feature',
    title,
    summary: `${title}, in one line.`,
    body: null,
    image_url: img(1),
    slides: [
      { heading: `${title} slide one`, body: 'First.', image_url: null },
      { heading: `${title} slide two`, body: 'Second.', image_url: null },
    ],
    cta_label: 'Take me there',
    cta_url: '/insights/expenses',
    display: null,
    blocking: 'soft',
    tone: null,
    repeat_after_days: 3,
    sort_order: 10,
    revision: 1,
    last_shown_at: null,
    dismissed_at: null,
    dont_show_again_at: null,
    is_due: true,
    ...fields,
  };
}

const THREE = [feature('f-1', 'Expense tracker'), feature('f-2', 'WhatsApp inbox'), feature('f-3', 'Auto-extension')];

const section = () => screen.getByRole('region', { name: "What's new" });
const activeSlide = () => document.querySelector<HTMLButtonElement>('[data-slide-state="active"]');
const activeTitle = () => activeSlide()?.querySelector('h3')?.textContent ?? null;
const currentDot = () =>
  screen
    .queryAllByRole('button', { name: /^Show / })
    .find((b) => b.getAttribute('aria-current') === 'true')
    ?.getAttribute('aria-label') ?? null;
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  motion.reduce = false;
  env.events = [];
  env.pushed = [];
  env.allowed = () => true;
  // The portal's own Supabase project; card images must be served from it.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FeatureAnnouncementDeck — the card', () => {
  it('renders nothing at all for zero features', () => {
    const { container } = render(<FeatureAnnouncementDeck features={[]} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows the heading and the one-line description, full text in the tooltip', () => {
    const long = 'A description long enough that the card has to cut it off with an ellipsis on a narrow screen.';
    render(<FeatureAnnouncementDeck features={[feature('f-1', 'Expense tracker', { summary: long })]} />);
    const root = section();
    expect(root.getAttribute('aria-roledescription')).toBe('carousel');
    expect(root.className).toContain('h-[352px]');
    expect(within(root).getByRole('heading', { level: 3, name: 'Expense tracker' }).className).toContain('line-clamp-2');
    const summary = within(root).getByText(long);
    expect(summary.getAttribute('title')).toBe(long);
    expect(summary.className).toContain('truncate');
    expect(within(root).getByText('See how it works')).toBeInTheDocument();
  });

  it('has no severity pill, badge, dismiss or restore', () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    const text = section().textContent ?? '';
    for (const word of ['Important', 'New', 'Update', 'Note', 'Show announcements', 'Got it, hide this', 'Read more']) {
      expect(text, word).not.toContain(word);
    }
    expect(within(section()).queryByRole('button', { name: /dismiss|hide|restore/i })).toBeNull();
  });

  it('uses the illustration as the background, and a paper fallback when it is missing, foreign or broken', () => {
    const { unmount } = render(<FeatureAnnouncementDeck features={[feature('f-1', 'With image')]} />);
    const image = activeSlide()!.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(img(1));
    expect(image.getAttribute('alt')).toBe('');
    expect(activeSlide()!.querySelector('[data-feature-fallback]')).toBeNull();
    act(() => {
      fireEvent.error(image);
    });
    expect(activeSlide()!.querySelector('img')).toBeNull();
    expect(activeSlide()!.querySelector('[data-feature-fallback]')).not.toBeNull();
    // Still legible: the heading is there on the fallback.
    expect(activeTitle()).toBe('With image');
    unmount();

    const foreignHost = img(1).replace('https://abc.supabase.co', 'https://evil.example');
    for (const url of [null, 'http://abc.supabase.co/a.png', 'https://evil.example/a.svg', foreignHost]) {
      const r = render(<FeatureAnnouncementDeck features={[feature('f-2', 'No image', { image_url: url })]} />);
      expect(activeSlide()!.querySelector('img'), String(url)).toBeNull();
      expect(activeSlide()!.querySelector('[data-feature-fallback]'), String(url)).not.toBeNull();
      r.unmount();
    }
  });
});

describe('FeatureAnnouncementDeck — opening the dialog', () => {
  it('opens on click and records card_opened, then shown', async () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.click(activeSlide()!);
    const dialog = await screen.findByRole('dialog', { name: 'Expense tracker' });
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Expense tracker slide one' })).toBeInTheDocument();
    expect(env.events).toEqual([
      ['f-1', 'card_opened'],
      ['f-1', 'shown'],
    ]);
    // Opened from the card: no "Don't show again", even though this one repeats.
    expect(within(dialog).queryByRole('button', { name: "Don't show again" })).toBeNull();
  });

  it('opens on Enter and on Space, once each', async () => {
    const first = render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.keyDown(activeSlide()!, { key: 'Enter' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // A second press while it is open does not open or record again.
    fireEvent.keyDown(activeSlide()!, { key: 'Enter' });
    expect(env.events).toEqual([
      ['f-1', 'card_opened'],
      ['f-1', 'shown'],
    ]);
    first.unmount();

    env.events = [];
    render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.keyDown(activeSlide()!, { key: ' ' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(env.events.map((e) => e[1])).toEqual(['card_opened', 'shown']);
  });

  it('records dismissed when the dialog closes, and the card stays', async () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.click(activeSlide()!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(env.events.map((e) => e.join(':'))).toEqual(['f-1:card_opened', 'f-1:shown', 'f-1:dismissed']);
    expect(env.pushed).toEqual([]);
    expect(activeTitle()).toBe('Expense tracker');

    // Opening it again is allowed (a second read of the same feature).
    fireEvent.click(activeSlide()!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(env.events.slice(3).map((e) => e[1])).toEqual(['card_opened', 'shown']);
  });

  it('gives keyboard focus back to the card when the dialog closes, however it closes', async () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    for (const how of ['Escape', 'Close', 'Got it'] as const) {
      const slide = activeSlide()!;
      act(() => slide.focus());
      fireEvent.keyDown(slide, { key: 'Enter' });
      const dialog = await screen.findByRole('dialog');
      if (how === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
      else if (how === 'Close') fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      else {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement, how).toBe(activeSlide()));
      expect(activeTitle()).toBe('Expense tracker');
    }
    expect(env.events.filter((e) => e[1] === 'dismissed')).toHaveLength(3);
  });

  it('records cta_clicked, closes and navigates on the button', async () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.click(activeSlide()!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take me there' }));
    expect(env.events.map((e) => e[1])).toEqual(['card_opened', 'shown', 'cta_clicked']);
    expect(env.pushed).toEqual(['/insights/expenses']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('FeatureAnnouncementDeck — several features', () => {
  it('shows no dots and never rotates with a single feature', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={[THREE[0]]} />);
    expect(screen.queryAllByRole('button', { name: /^Show / })).toHaveLength(0);
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Expense tracker');
  });

  it('labels a dot per feature and moves on a dot press', () => {
    render(<FeatureAnnouncementDeck features={THREE} />);
    expect(screen.getAllByRole('button', { name: /^Show / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Show Expense tracker (1 of 3)',
      'Show WhatsApp inbox (2 of 3)',
      'Show Auto-extension (3 of 3)',
    ]);
    expect(currentDot()).toBe('Show Expense tracker (1 of 3)');
    fireEvent.click(screen.getByRole('button', { name: 'Show Auto-extension (3 of 3)' }));
    expect(activeTitle()).toBe('Auto-extension');
    expect(currentDot()).toBe('Show Auto-extension (3 of 3)');
    // A dot is not the card: no dialog, nothing recorded.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(env.events).toEqual([]);
  });

  it('advances every FEATURE_DECK_ROTATE_MS and wraps', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    tick(FEATURE_DECK_ROTATE_MS - 1);
    expect(activeTitle()).toBe('Expense tracker');
    tick(1);
    expect(activeTitle()).toBe('WhatsApp inbox');
    tick(FEATURE_DECK_ROTATE_MS);
    expect(activeTitle()).toBe('Auto-extension');
    tick(FEATURE_DECK_ROTATE_MS);
    expect(activeTitle()).toBe('Expense tracker');
    expect(FEATURE_DECK_ROTATE_MS).toBe(7000);
  });

  it('pause 1: never rotates under reduced motion', () => {
    motion.reduce = true;
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    tick(FEATURE_DECK_ROTATE_MS * 4);
    expect(activeTitle()).toBe('Expense tracker');
    expect(document.querySelectorAll('[data-feature-slide]')).toHaveLength(1);
  });

  it('pause 2: holds while the pointer is over the card, then gives a full interval', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    tick(FEATURE_DECK_ROTATE_MS / 2);
    fireEvent.mouseEnter(section());
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Expense tracker');
    fireEvent.mouseLeave(section());
    tick(FEATURE_DECK_ROTATE_MS - 1);
    expect(activeTitle()).toBe('Expense tracker');
    tick(1);
    expect(activeTitle()).toBe('WhatsApp inbox');
  });

  it('pause 3: holds while focus is inside the card', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    const slide = activeSlide()!;
    act(() => slide.focus());
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Expense tracker');
    act(() => slide.blur());
    tick(FEATURE_DECK_ROTATE_MS);
    expect(activeTitle()).toBe('WhatsApp inbox');
  });

  it('pause 4: holds while the tab is hidden', () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<FeatureAnnouncementDeck features={THREE} />);
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Expense tracker');
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    tick(FEATURE_DECK_ROTATE_MS);
    expect(activeTitle()).toBe('WhatsApp inbox');
  });

  it('pause 5: holds while its dialog is open', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.click(activeSlide()!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Pointer and focus are not on the card here: only the open dialog holds it.
    // (The modal hides the page from the accessibility tree, so the region is
    // found by its marker rather than by role.)
    fireEvent.mouseLeave(document.querySelector('[data-feature-deck]')!);
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Expense tracker');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    tick(FEATURE_DECK_ROTATE_MS);
    expect(activeTitle()).toBe('WhatsApp inbox');
  });

  it('moves with ←/→ on the focused card, keeps focus on it, and stops auto-advance after a manual move', () => {
    vi.useFakeTimers();
    render(<FeatureAnnouncementDeck features={THREE} />);
    act(() => activeSlide()!.focus());
    fireEvent.keyDown(activeSlide()!, { key: 'ArrowRight' });
    expect(activeTitle()).toBe('WhatsApp inbox');
    expect(document.activeElement).toBe(activeSlide());
    fireEvent.keyDown(activeSlide()!, { key: 'ArrowLeft' });
    fireEvent.keyDown(activeSlide()!, { key: 'ArrowLeft' });
    expect(activeTitle()).toBe('Auto-extension');
    // Modified arrows belong to the browser.
    fireEvent.keyDown(activeSlide()!, { key: 'ArrowRight', altKey: true });
    expect(activeTitle()).toBe('Auto-extension');
    act(() => activeSlide()!.blur());
    tick(FEATURE_DECK_ROTATE_MS * 3);
    expect(activeTitle()).toBe('Auto-extension');
  });

  it('follows the list when the feature on screen is deactivated', () => {
    const { rerender } = render(<FeatureAnnouncementDeck features={THREE} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show WhatsApp inbox (2 of 3)' }));
    rerender(<FeatureAnnouncementDeck features={[THREE[0], THREE[2]]} />);
    expect(activeTitle()).toBe('Auto-extension');
    rerender(<FeatureAnnouncementDeck features={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
  });
});
