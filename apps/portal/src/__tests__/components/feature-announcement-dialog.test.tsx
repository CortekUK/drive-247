/**
 * The feature announcement dialog (components/announcements/feature-announcement-dialog.tsx):
 * the large "what's new" dialog with its slides, opened from the dashboard card
 * or by the announcement host.
 *
 * Every expected label and path below is written out by hand from the fixture
 * next to it. The dialog records nothing itself; each close path is asserted as
 * the callback it fires, and the callers' events are pinned in
 * feature-announcement-deck.test.tsx (card) and announcement-dialog-host.test.tsx
 * (auto).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { PortalAnnouncement } from '@/lib/announcements/contract';
import { readAppSource } from '../helpers/source';

const motion = vi.hoisted(() => ({ reduce: true }));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => motion.reduce };
});

const perms = vi.hoisted(() => ({ allowed: ((_path: string) => true) as (path: string) => boolean, asked: [] as string[] }));
vi.mock('@/hooks/use-manager-permissions', () => ({
  useManagerPermissions: () => ({
    canView: () => true,
    canEdit: () => true,
    canAccessRoute: (path: string) => {
      perms.asked.push(path);
      return perms.allowed(path);
    },
    isLoading: false,
  }),
}));

import { FeatureAnnouncementDialog } from '@/components/announcements/feature-announcement-dialog';

/** The portal's own Supabase project in these tests (stubbed below); images must come from it. */
const PROJECT_URL = 'https://abc.supabase.co';
const CARD_IMG = 'https://abc.supabase.co/storage/v1/object/public/portal-announcement-media/feature/card/11111111-2222-4333-8444-555555555555.png';
const SLIDE_IMG = 'https://abc.supabase.co/storage/v1/object/public/portal-announcement-media/feature/slide/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp';

function feature(fields: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id: 'f-1',
    kind: 'feature',
    title: 'Expense tracker',
    summary: 'Log every cost against the car it belongs to.',
    body: null,
    image_url: CARD_IMG,
    slides: [
      { heading: 'Every cost in one place', body: 'Fuel, tolls and repairs.\nAll on the car.', image_url: SLIDE_IMG },
      { heading: 'Receipts attached', body: 'Snap the receipt with your phone.', image_url: null },
      { heading: 'Where to find it', body: 'Insights, then Expenses.', image_url: null },
    ],
    cta_label: 'Open expenses',
    cta_url: '/insights/expenses?from=whats-new#top',
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

function setup(props: Partial<React.ComponentProps<typeof FeatureAnnouncementDialog>> = {}) {
  const onClose = vi.fn();
  const onDontShowAgain = vi.fn();
  const onCta = vi.fn();
  const all = {
    announcement: feature(),
    source: 'card' as const,
    onClose,
    onDontShowAgain,
    onCta,
    ...props,
  };
  const utils = render(<FeatureAnnouncementDialog {...all} />);
  return { ...utils, onClose, onDontShowAgain, onCta, props: all };
}

const dialog = () => screen.getByRole('dialog');
const live = () => within(dialog()).getByText(/^Slide \d of \d$/);
const button = (name: string | RegExp) => within(dialog()).getByRole('button', { name });
const queryButton = (name: string | RegExp) => within(dialog()).queryByRole('button', { name });

beforeEach(() => {
  motion.reduce = true;
  perms.allowed = () => true;
  perms.asked = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FeatureAnnouncementDialog — open and closed', () => {
  it('renders nothing while `announcement` is null', () => {
    setup({ announcement: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the feature title as the eyebrow and slide one as the page', () => {
    setup();
    // DialogTitle is the eyebrow, so the dialog's accessible name is the feature.
    expect(screen.getByRole('dialog', { name: 'Expense tracker' })).toBeInTheDocument();
    expect(within(dialog()).getByRole('heading', { level: 3, name: 'Every cost in one place' })).toBeInTheDocument();
    expect(live().textContent).toBe('Slide 1 of 3');
    expect(live().className).toContain('sr-only');
    expect(live().getAttribute('aria-live')).toBe('polite');
  });

  it('keeps line breaks and never renders the text as HTML', () => {
    setup({
      announcement: feature({
        slides: [
          { heading: '<b>bold</b>', body: 'one\n<i>two</i>', image_url: null },
          { heading: 'Two', body: 'Second.', image_url: null },
        ],
      }),
    });
    const description = within(dialog()).getByText((_, el) => el?.getAttribute('data-slot') === 'dialog-description');
    expect(description.textContent).toBe('one\n<i>two</i>');
    expect(description.className).toContain('whitespace-pre-line');
    expect(dialog().querySelector('b, i')).toBeNull();
  });

  it('has no dangerouslySetInnerHTML and no tour button in its source', () => {
    const src = readAppSource('components/announcements/feature-announcement-dialog.tsx');
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/startTour|useFirstRentalTour|data-tour|>\s*(Take|Start) (the )?tour/i);
  });
});

describe('FeatureAnnouncementDialog — paging', () => {
  it('pages with Next and Back; Back is disabled on the first slide', () => {
    setup();
    expect(button('Back')).toBeDisabled();
    fireEvent.click(button('Next'));
    expect(live().textContent).toBe('Slide 2 of 3');
    expect(within(dialog()).getByRole('heading', { level: 3, name: 'Receipts attached' })).toBeInTheDocument();
    expect(button('Back')).not.toBeDisabled();
    fireEvent.click(button('Back'));
    expect(live().textContent).toBe('Slide 1 of 3');
    expect(button('Back')).toBeDisabled();
  });

  it('pages with the arrow keys, without wrapping, and leaves modified arrows alone', () => {
    setup();
    const panel = dialog();
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(live().textContent).toBe('Slide 1 of 3');
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(live().textContent).toBe('Slide 3 of 3');
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(live().textContent).toBe('Slide 3 of 3');
    fireEvent.keyDown(panel, { key: 'ArrowLeft', altKey: true });
    expect(live().textContent).toBe('Slide 3 of 3');
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(live().textContent).toBe('Slide 2 of 3');
  });

  it('pages the same with motion on (the body fades in instead of swapping)', () => {
    motion.reduce = false;
    setup();
    fireEvent.click(button('Next'));
    expect(live().textContent).toBe('Slide 2 of 3');
    expect(within(dialog()).getByRole('heading', { level: 3, name: 'Receipts attached' })).toBeInTheDocument();
    expect(within(dialog()).queryByRole('heading', { level: 3, name: 'Every cost in one place' })).toBeNull();
  });

  it('keeps keyboard focus in the dialog when Back disables or Next gives way to the last action', () => {
    setup();
    // Opens on the way forward, not on the close button.
    expect(document.activeElement).toBe(button('Next'));
    fireEvent.click(button('Next'));
    act(() => button('Back').focus());
    fireEvent.click(button('Back'));
    // Back is disabled now; focus moved to Next rather than dropping to <body>.
    expect(document.activeElement).toBe(button('Next'));
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    expect(document.activeElement).toBe(button('Open expenses'));
  });

  it('draws one dot per slide, hidden from assistive tech, the current one wide', () => {
    setup();
    fireEvent.click(button('Next'));
    const dots = dialog().querySelector('[aria-hidden="true"].flex.items-center.gap-1\\.5')!;
    const spans = [...dots.querySelectorAll('span')];
    expect(spans).toHaveLength(3);
    expect(spans.map((s) => s.className.includes('w-4'))).toEqual([false, true, false]);
  });

  it('starts again at slide one when a different announcement arrives, but not for a fresh copy of the same one', () => {
    const { rerender, props } = setup();
    fireEvent.click(button('Next'));
    expect(live().textContent).toBe('Slide 2 of 3');

    // A poll hands back a new object for the same row: stay put.
    rerender(<FeatureAnnouncementDialog {...props} announcement={feature()} />);
    expect(live().textContent).toBe('Slide 2 of 3');

    const other = feature({
      id: 'f-2',
      title: 'WhatsApp inbox',
      slides: [
        { heading: 'Chats in the portal', body: 'Reply from here.', image_url: null },
        { heading: 'Templates', body: 'Save replies.', image_url: null },
      ],
    });
    rerender(<FeatureAnnouncementDialog {...props} announcement={other} />);
    expect(live().textContent).toBe('Slide 1 of 2');
    expect(within(dialog()).getByRole('heading', { level: 3, name: 'Chats in the portal' })).toBeInTheDocument();
  });

  it('starts at slide one when the same announcement is opened again after a close', () => {
    const { rerender, props } = setup();
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    expect(live().textContent).toBe('Slide 3 of 3');
    rerender(<FeatureAnnouncementDialog {...props} announcement={null} />);
    rerender(<FeatureAnnouncementDialog {...props} announcement={feature()} />);
    expect(live().textContent).toBe('Slide 1 of 3');
  });
});

describe('FeatureAnnouncementDialog — the last slide', () => {
  const toLast = () => {
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
  };

  it('offers "Got it" and the button when the path is valid and permitted', () => {
    const { onCta, onClose } = setup();
    expect(queryButton('Open expenses')).toBeNull();
    toLast();
    expect(queryButton('Next')).toBeNull();
    const cta = button('Open expenses');
    expect(cta.className).toContain('bg-indigo-600');
    expect(button('Got it').className).not.toContain('bg-indigo-600');
    // The permission check sees the pathname only, never the query or hash.
    expect(perms.asked).toContain('/insights/expenses');
    fireEvent.click(cta);
    expect(onCta).toHaveBeenCalledWith('/insights/expenses?from=whats-new#top');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows only "Got it" (primary) without a button', () => {
    const { onClose } = setup({ announcement: feature({ cta_label: null, cta_url: null }) });
    toLast();
    const gotIt = button('Got it');
    expect(gotIt.className).toContain('bg-indigo-600');
    expect(within(dialog()).getAllByRole('button').map((b) => b.textContent)).toEqual(['', 'Back', 'Got it']);
    fireEvent.click(gotIt);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides the button for a path that is not in-portal, even when a label is set', () => {
    for (const url of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '/a/../b']) {
      const { unmount, onCta } = setup({ announcement: feature({ cta_url: url }) });
      toLast();
      expect(queryButton('Open expenses'), url).toBeNull();
      expect(button('Got it')).toBeInTheDocument();
      expect(onCta).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('hides the button when the viewer may not open its page', () => {
    perms.allowed = (path) => path !== '/insights/expenses';
    setup();
    toLast();
    expect(queryButton('Open expenses')).toBeNull();
    expect(button('Got it').className).toContain('bg-indigo-600');
  });
});

describe('FeatureAnnouncementDialog — closing', () => {
  it('closes from the X, Escape and "Got it"', () => {
    const x = setup();
    fireEvent.click(button('Close'));
    expect(x.onClose).toHaveBeenCalledTimes(1);
    x.unmount();

    const esc = setup();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(esc.onClose).toHaveBeenCalledTimes(1);
    esc.unmount();

    const got = setup({ announcement: feature({ slides: [{ heading: 'Only', body: 'One.', image_url: null }] }) });
    fireEvent.click(button('Got it'));
    expect(got.onClose).toHaveBeenCalledTimes(1);
  });

  it('offers "Don\'t show again" only when it opened by itself AND repeats', () => {
    const auto = setup({ source: 'auto' });
    const link = button("Don't show again");
    fireEvent.click(link);
    expect(auto.onDontShowAgain).toHaveBeenCalledTimes(1);
    expect(auto.onClose).not.toHaveBeenCalled();
    auto.unmount();

    const once = setup({ source: 'auto', announcement: feature({ repeat_after_days: null }) });
    expect(queryButton("Don't show again")).toBeNull();
    once.unmount();

    setup({ source: 'card', announcement: feature({ repeat_after_days: 7 }) });
    expect(queryButton("Don't show again")).toBeNull();
  });

  /** An opener outside the dialog, the way the dashboard card is: no Radix trigger. */
  function Opener({ announcement = feature() }: { announcement?: PortalAnnouncement }) {
    const [open, setOpen] = React.useState(false);
    const [mounted, setMounted] = React.useState(true);
    return (
      <>
        {mounted && (
          <button type="button" onClick={() => setOpen(true)}>
            Open it
          </button>
        )}
        <button type="button" onClick={() => setMounted(false)}>
          Remove opener
        </button>
        <FeatureAnnouncementDialog
          announcement={open ? announcement : null}
          source="auto"
          onClose={() => setOpen(false)}
          onDontShowAgain={() => setOpen(false)}
          onCta={() => setOpen(false)}
        />
      </>
    );
  }

  it('gives keyboard focus back to what had it before opening, however it closes', async () => {
    const one = feature({ slides: [{ heading: 'Only', body: 'One.', image_url: null }] });
    for (const how of ['Escape', 'Close', 'Got it', "Don't show again"] as const) {
      const { unmount } = render(<Opener announcement={one} />);
      const opener = screen.getByRole('button', { name: 'Open it' });
      act(() => opener.focus());
      fireEvent.click(opener);
      // source="auto": the panel takes focus, not a button (see the auto-open test).
      expect(document.activeElement).toBe(dialog());
      if (how === 'Escape') fireEvent.keyDown(dialog(), { key: 'Escape' });
      else fireEvent.click(button(how));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement, how).toBe(opener));
      unmount();
    }
  });

  it('focuses the panel, never a button, when it opens by itself', () => {
    const one = feature({ slides: [{ heading: 'Only', body: 'One.', image_url: null }] });
    const { onClose, onCta } = setup({ source: 'auto', announcement: one });
    expect(document.activeElement).toBe(dialog());
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
    // An Enter meant for the page lands on the panel and presses nothing.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    expect(onCta).not.toHaveBeenCalled();
  });

  it('opens on the primary action when opened from the card', () => {
    setup({ source: 'card' });
    expect(document.activeElement).toBe(button('Next'));
  });

  it('beats the primitive zoom under reduced motion', () => {
    setup();
    expect(dialog().className).toContain('motion-reduce:!animate-none');
    expect(dialog().className).not.toMatch(/(^|\s)motion-reduce:animate-none(\s|$)/);
  });

  it('leaves focus alone when the element that had it is gone', async () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    act(() => opener.focus());
    fireEvent.click(opener);
    // Removed while the dialog is open (a poll replaced the card, say).
    act(() => {
      fireEvent.click(screen.getByText('Remove opener'));
    });
    expect(opener.isConnected).toBe(false);
    fireEvent.click(button('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('FeatureAnnouncementDialog — footer and focus styles', () => {
  it('keeps "Don\'t show again" beside the dots, apart from the actions, so it never jumps sides when they wrap', () => {
    setup({ source: 'auto' });
    const link = button("Don't show again");
    const group = link.parentElement!;
    // The dots live in the same left-hand group as the link...
    expect(group.querySelector('[aria-hidden="true"] > span')).not.toBeNull();
    // ...and the actions are not in it.
    expect(within(group).queryByRole('button', { name: 'Next' })).toBeNull();
    const footer = group.parentElement!;
    expect(footer.children).toHaveLength(2);
    expect(within(footer.children[1] as HTMLElement).getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('gives every control a visible indigo focus ring, including the close button over a white panel', () => {
    setup({ source: 'auto' });
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    const controls = within(dialog()).getAllByRole('button');
    expect(controls.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Close',
      "Don't show again",
      'Back',
      'Got it',
      'Open expenses',
    ]);
    for (const control of controls) {
      const label = control.getAttribute('aria-label') ?? control.textContent;
      expect(control.className, label!).toContain('focus-visible:ring-2');
      expect(control.className, label!).toContain('focus-visible:ring-indigo-500');
      expect(control.className, label!).toContain('focus-visible:ring-offset-2');
      expect(control.className, label!).not.toContain('focus-visible:ring-white');
    }
  });
});

describe('FeatureAnnouncementDialog — media row and a steady frame', () => {
  /** The panel's in-flow children, i.e. without the absolutely positioned close button. */
  const rows = () => [...dialog().children].filter((el) => el.getAttribute('aria-label') !== 'Close');
  const NO_PICTURES = feature({
    slides: [
      { heading: 'One', body: 'x', image_url: null },
      { heading: 'Two', body: 'y', image_url: null },
    ],
  });

  it('always keeps three grid rows: media, body, footer', () => {
    setup();
    expect(rows()).toHaveLength(3);
    const media = rows()[0];
    expect(media.querySelector('img')!.getAttribute('src')).toBe(SLIDE_IMG);
    expect(media.querySelector('img')!.getAttribute('alt')).toBe('');

    fireEvent.click(button('Next'));
    expect(rows()).toHaveLength(3);
  });

  it('keeps the picture frame, as a paper surface, on a slide without a picture when another slide has one', () => {
    // Otherwise the panel shrinks from slide one to slide two and Next moves out
    // from under the pointer; a second click at the same spot then lands on the
    // backdrop and closes the dialog.
    setup();
    const frame = () => rows()[0];
    const frameClass = frame().className;
    expect(frameClass).toContain('aspect-[16/9]');
    fireEvent.click(button('Next'));
    expect(frame().querySelector('img')).toBeNull();
    expect(frame().getAttribute('aria-hidden')).toBe('true');
    expect(frame().className).toBe(frameClass);
    expect(frame().querySelector('[data-feature-media-paper]')).not.toBeNull();
  });

  it('has no picture frame at all when no slide has a picture', () => {
    setup({ announcement: NO_PICTURES });
    expect(rows()).toHaveLength(3);
    expect(rows()[0].getAttribute('aria-hidden')).toBe('true');
    expect(rows()[0].childElementCount).toBe(0);
    expect(rows()[0].className).toBe('');
    fireEvent.click(button('Next'));
    expect(rows()[0].childElementCount).toBe(0);
  });

  it('caps the picture height so a short screen still shows the heading, the text and the buttons', () => {
    setup();
    expect(rows()[0].className).toContain('max-h-[calc(100dvh-17rem)]');
  });

  it('sizes the text area for the longest slide, so the footer stays put while paging', () => {
    setup();
    const sizers = [...rows()[1].querySelectorAll('[data-slide-sizer]')];
    // Every slide is laid out invisibly in the same cell; the visible one sits on top.
    expect(sizers.map((el) => el.querySelector('h3')!.textContent)).toEqual([
      'Every cost in one place',
      'Receipts attached',
      'Where to find it',
    ]);
    for (const el of sizers) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.className).toContain('invisible');
    }
    // Hidden from assistive tech: one heading and one description, the current slide's.
    expect(within(dialog()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Every cost in one place',
    ]);
    expect(dialog().querySelectorAll('[data-slot="dialog-description"]')).toHaveLength(1);
    fireEvent.click(button('Next'));
    expect(rows()[1].querySelectorAll('[data-slide-sizer]')).toHaveLength(3);
    expect(within(dialog()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Receipts attached',
    ]);
  });

  it('shows the paper surface once the image fails to load', () => {
    setup();
    const img = rows()[0].querySelector('img')!;
    act(() => {
      fireEvent.error(img);
    });
    expect(rows()).toHaveLength(3);
    expect(dialog().querySelector('img')).toBeNull();
    expect(rows()[0].getAttribute('aria-hidden')).toBe('true');
    expect(rows()[0].querySelector('[data-feature-media-paper]')).not.toBeNull();
  });

  it('never loads an image from outside the announcement store', () => {
    const PATH = '/storage/v1/object/public/portal-announcement-media/feature/slide/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp';
    for (const url of ['https://evil.example/a.png', 'https://evil.example' + PATH, 'https://abc.supabase.co.evil.example' + PATH]) {
      const { unmount } = setup({
        announcement: feature({
          slides: [
            { heading: 'One', body: 'x', image_url: url },
            { heading: 'Two', body: 'y', image_url: null },
          ],
        }),
      });
      expect(dialog().querySelector('img'), url).toBeNull();
      // Not a picture, so no frame kept for it either.
      expect(rows()[0].childElementCount, url).toBe(0);
      unmount();
    }
  });

  it("takes the project's host from NEXT_PUBLIC_SUPABASE_URL, falling back to the client's default", () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const DEFAULT_IMG = SLIDE_IMG.replace('abc.supabase.co', 'hviqoaokxvlancmftwuo.supabase.co');
    const { unmount } = setup();
    expect(dialog().querySelector('img')).toBeNull();
    unmount();
    setup({
      announcement: feature({
        slides: [
          { heading: 'One', body: 'x', image_url: DEFAULT_IMG },
          { heading: 'Two', body: 'y', image_url: null },
        ],
      }),
    });
    expect(dialog().querySelector('img')!.getAttribute('src')).toBe(DEFAULT_IMG);
  });
});
