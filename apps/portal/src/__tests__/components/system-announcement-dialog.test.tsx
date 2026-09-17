/**
 * SystemAnnouncementDialog: a system notice as a dialog, soft or hard.
 *
 * SOFT must close every normal way (X, Esc, outside click, "Not now" / "Got it"),
 * each reaching `onClose` so the host records one dismissal.
 *
 * HARD must not close at all: no X in the DOM (not merely hidden), Esc and outside
 * clicks swallowed. It must always offer Sign out, because a blocker a user cannot
 * leave is a trap. The "no X" assertions look for the element, not a class: jsdom
 * loads no stylesheet, so a `hidden` utility would pass while asserting nothing.
 *
 * ROLES: the button renders only for a valid in-portal path the role may open, and
 * a hard blocker that leaves someone with nothing to press says who can clear it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
  HARD_DIALOG_HELPER,
  SYSTEM_DIALOG_PAGE_GUARD_MS,
  SystemAnnouncementDialog,
} from '@/components/announcements/system-announcement-dialog';
import { SYSTEM_DIALOG_UI, TONE_CLASSES, type PortalAnnouncement } from '@/lib/announcements/contract';
import { readPortalSource } from '../helpers/edge-source';

let perms = {
  isManager: false,
  isReadOnlyRole: false,
  canAccessRoute: (_p: string) => true,
};

vi.mock('@/hooks/use-manager-permissions', () => ({ useManagerPermissions: () => perms }));

function notice(over: Partial<PortalAnnouncement> = {}): PortalAnnouncement {
  return {
    id: 'n1',
    kind: 'system',
    title: 'Scheduled maintenance',
    summary: null,
    body: 'The portal is read-only on Sunday.\nBookings still come in.',
    image_url: null,
    slides: [],
    cta_label: null,
    cta_url: null,
    display: 'dialog',
    blocking: 'soft',
    tone: 'info',
    repeat_after_days: null,
    sort_order: 10,
    revision: 1,
    last_shown_at: null,
    dismissed_at: null,
    dont_show_again_at: null,
    is_due: true,
    ...over,
  };
}

const onClose = vi.fn();
const onCta = vi.fn();
const onSignOut = vi.fn();

function renderDialog(a: PortalAnnouncement) {
  return render(
    <SystemAnnouncementDialog announcement={a} open onClose={onClose} onCta={onCta} onSignOut={onSignOut} />,
  );
}

const dialog = () => screen.queryByRole('dialog');
const button = (name: string | RegExp) => screen.queryByRole('button', { name });

/** Radix arms its outside-pointer listener in a setTimeout(0); settle first or the click is a no-op. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

async function clickOutside() {
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

beforeEach(() => {
  perms = { isManager: false, isReadOnlyRole: false, canAccessRoute: () => true };
  onClose.mockClear();
  onCta.mockClear();
  onSignOut.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('content', () => {
  it('shows the title as the accessible name and the full body with its line breaks', () => {
    renderDialog(notice());
    expect(screen.getByRole('dialog', { name: 'Scheduled maintenance' })).toBeInTheDocument();
    const text = screen.getByText(/The portal is read-only on Sunday\./);
    expect(text.textContent).toBe('The portal is read-only on Sunday.\nBookings still come in.');
    expect(text.className).toContain('whitespace-pre-line');
  });

  it('uses the tone colours from the contract', () => {
    renderDialog(notice({ tone: 'warning' }));
    const panel = dialog()!;
    expect(panel.className).toContain('max-w-[480px]');
    expect(panel.querySelector(`.${TONE_CLASSES.warning.dialogAccent}`)).not.toBeNull();
    expect(panel.querySelector('[data-tone-icon="warning"]')).not.toBeNull();
  });

  // jsdom computes no CSS, so these pin the class that the headless-Chrome probe proved:
  // a plain `motion-reduce:animate-none` (0,1,0) loses to the primitive's
  // `data-[state=open]:animate-in` (0,2,0), and the panel still zoomed in.
  it('stops the panel AND the overlay animating under reduced motion, with a class that outranks the primitive', () => {
    renderDialog(notice());
    expect(dialog()!.className.split(/\s+/)).toContain('motion-reduce:!animate-none');
    const overlay = document.querySelector('.backdrop-blur-sm')!;
    expect(overlay.className.split(/\s+/)).toContain('motion-reduce:!animate-none');
  });

  it('wraps a title with no break opportunity instead of cutting it off at the panel edge', () => {
    renderDialog(notice({ title: 'acct_1QxYzAbCdEfGhIjKlMnOpQrStUvWxYz_payouts_paused_until_verified' }));
    const title = screen.getByRole('heading');
    expect(title.className.split(/\s+/)).toContain('break-words');
  });

  it('gives the panel a visible edge in dark mode (the contract drops the border)', () => {
    renderDialog(notice());
    const classes = dialog()!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['dark:ring-1', 'dark:ring-white/10']));
  });

  it('sizes the scrolling body against the real header and footer, keeping the contract cap as the base', () => {
    renderDialog(notice());
    const body = dialog()!.querySelector('[data-system-dialog-body]')!;
    const classes = body.className.split(/\s+/);
    expect(classes).toContain('max-h-[calc(100dvh-12rem)]');
    expect(classes).toEqual(
      expect.arrayContaining(['max-sm:max-h-[calc(100dvh-10rem)]', 'sm:max-h-[calc(100dvh-8rem)]']),
    );
  });
});

describe('initial focus', () => {
  // The host opens these by itself, mid-session, while someone may be typing. Their next
  // Enter or Space must not press Sign out, "Not now", "Got it" or the button.
  const cases: Array<[string, Partial<PortalAnnouncement>]> = [
    ['soft, no button', {}],
    ['soft with a button', { cta_label: 'Open settings', cta_url: '/settings' }],
    ['hard with a button', { blocking: 'hard', tone: 'critical', cta_label: 'Connect Stripe', cta_url: '/settings' }],
    ['hard without a button', { blocking: 'hard', tone: 'critical' }],
  ];

  it.each(cases)('%s: focus lands on the panel, never on a button', (_label, over) => {
    renderDialog(notice(over));
    const panel = dialog()!;
    expect(document.activeElement).toBe(panel);
    expect(document.activeElement?.tagName).not.toBe('BUTTON');
  });

  it('Tab still reaches every button from there', () => {
    renderDialog(notice({ blocking: 'hard', tone: 'critical', cta_label: 'Connect Stripe', cta_url: '/settings' }));
    const panel = dialog()!;
    const tabbable = [...panel.querySelectorAll('button')].filter((b) => b.tabIndex >= 0).map((b) => b.textContent);
    expect(tabbable).toEqual(['Sign out', 'Connect Stripe']);
  });

  it('renders text, never HTML', () => {
    renderDialog(notice({ body: '<img src=x onerror="alert(1)">' }));
    expect(dialog()!.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  });
});

describe('soft', () => {
  it('has a Close control that closes', () => {
    renderDialog(notice());
    fireEvent.click(button('Close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    renderDialog(notice());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside click', async () => {
    renderDialog(notice());
    await settle();
    await clickOutside();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('without a button: one primary "Got it" that closes', () => {
    renderDialog(notice());
    expect(button('Not now')).toBeNull();
    fireEvent.click(button('Got it')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(button('Sign out')).toBeNull();
  });

  it('with a button: "Not now" closes, the button hands its resolved href to onCta', () => {
    renderDialog(notice({ cta_label: 'Open settings', cta_url: '/settings?tab=payments#stripe' }));
    expect(button('Got it')).toBeNull();
    fireEvent.click(button('Not now')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Open settings')!);
    expect(onCta).toHaveBeenCalledWith('/settings?tab=payments#stripe');
  });

  it('a button the role may not open is simply left out (no helper on a soft notice)', () => {
    perms = { isManager: true, isReadOnlyRole: false, canAccessRoute: (p) => p !== '/settings' };
    renderDialog(notice({ cta_label: 'Open settings', cta_url: '/settings' }));
    expect(button('Open settings')).toBeNull();
    expect(button('Got it')).toBeInTheDocument();
    expect(screen.queryByText(HARD_DIALOG_HELPER)).toBeNull();
  });

  it('uses the soft overlay', () => {
    renderDialog(notice());
    const overlay = document.querySelector('.backdrop-blur-sm');
    expect(overlay).not.toBeNull();
    expect(SYSTEM_DIALOG_UI.overlaySoft).toContain('backdrop-blur-sm');
  });
});

describe('hard', () => {
  const hard = (over: Partial<PortalAnnouncement> = {}) => notice({ blocking: 'hard', tone: 'critical', ...over });

  it('has no close control in the DOM at all', () => {
    renderDialog(hard());
    expect(button('Close')).toBeNull();
    expect(button('Got it')).toBeNull();
    expect(button('Not now')).toBeNull();
  });

  it('ignores Escape', () => {
    renderDialog(hard());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('ignores an outside click', async () => {
    renderDialog(hard());
    await settle();
    await clickOutside();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('always offers Sign out', () => {
    renderDialog(hard());
    fireEvent.click(button('Sign out')!);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows Sign out and the button together when the button is valid and permitted', () => {
    renderDialog(hard({ cta_label: 'Connect Stripe', cta_url: '/settings?tab=payments' }));
    expect(button('Sign out')).toBeInTheDocument();
    fireEvent.click(button('Connect Stripe')!);
    expect(onCta).toHaveBeenCalledWith('/settings?tab=payments');
    expect(screen.queryByText(HARD_DIALOG_HELPER)).toBeNull();
  });

  it('hides a button that points outside the portal', () => {
    renderDialog(hard({ cta_label: 'Pay', cta_url: 'https://evil.example' }));
    expect(button('Pay')).toBeNull();
  });

  it('uses the blurred hard overlay', () => {
    renderDialog(hard());
    expect(document.querySelector('.backdrop-blur-md')).not.toBeNull();
  });
});

describe('roles on a hard blocker', () => {
  const hard = (over: Partial<PortalAnnouncement> = {}) =>
    notice({ blocking: 'hard', cta_label: 'Connect Stripe', cta_url: '/settings', ...over });

  it('a viewer sees the helper line and only Sign out: no button next to "only an admin can resolve this"', () => {
    perms = { isManager: false, isReadOnlyRole: true, canAccessRoute: () => true };
    renderDialog(hard());
    expect(screen.getByText(HARD_DIALOG_HELPER)).toBeInTheDocument();
    expect(button('Connect Stripe')).toBeNull();
    expect(button('Sign out')).toBeInTheDocument();
  });

  it('a viewer still gets the button on a SOFT notice (no helper there, nothing contradicts it)', () => {
    perms = { isManager: false, isReadOnlyRole: true, canAccessRoute: () => true };
    renderDialog(notice({ cta_label: 'Connect Stripe', cta_url: '/settings' }));
    expect(button('Connect Stripe')).toBeInTheDocument();
    expect(screen.queryByText(HARD_DIALOG_HELPER)).toBeNull();
  });

  it('a viewer sees the helper even when the blocker has no button', () => {
    perms = { isManager: false, isReadOnlyRole: true, canAccessRoute: () => true };
    renderDialog(hard({ cta_label: null, cta_url: null }));
    expect(screen.getByText(HARD_DIALOG_HELPER)).toBeInTheDocument();
  });

  it('a manager without that page: no button, and the helper line', () => {
    perms = { isManager: true, isReadOnlyRole: false, canAccessRoute: (p) => p !== '/settings' };
    renderDialog(hard());
    expect(button('Connect Stripe')).toBeNull();
    expect(screen.getByText(HARD_DIALOG_HELPER)).toBeInTheDocument();
  });

  it('a manager with that page: the button, no helper', () => {
    perms = { isManager: true, isReadOnlyRole: false, canAccessRoute: () => true };
    renderDialog(hard());
    expect(button('Connect Stripe')).toBeInTheDocument();
    expect(screen.queryByText(HARD_DIALOG_HELPER)).toBeNull();
  });

  it('an admin: the button, no helper', () => {
    renderDialog(hard());
    expect(button('Connect Stripe')).toBeInTheDocument();
    expect(screen.queryByText(HARD_DIALOG_HELPER)).toBeNull();
  });
});

// ── The pager: two or more system dialogs in ONE dialog ─────────────────────

describe('pager', () => {
  const onPrevious = vi.fn();
  const onNext = vi.fn();

  const pagesOf = () => [
    notice({ id: 'h', blocking: 'hard', tone: 'critical', title: 'Card payments are down', body: 'Hard body.', cta_label: 'Update card', cta_url: '/subscription' }),
    notice({ id: 's1', tone: 'warning', title: 'Maintenance tonight', body: 'Soft body one.' }),
    notice({ id: 's2', tone: 'info', title: 'New pricing rules', body: 'Soft body two.', cta_label: 'Open settings', cta_url: '/settings' }),
  ];

  function renderPaged(index: number, items = pagesOf(), turn: 1 | -1 = 1) {
    const pager = { items, index, turn, onPrevious, onNext };
    const el = (i: number) => (
      <SystemAnnouncementDialog
        announcement={items[i]}
        open
        onClose={onClose}
        onCta={onCta}
        onSignOut={onSignOut}
        pager={{ ...pager, index: i }}
      />
    );
    const view = render(el(index));
    return { ...view, show: (i: number) => view.rerender(el(i)) };
  }

  const pagerBar = () => dialog()!.querySelector<HTMLElement>('[data-system-dialog-pager]');
  const counter = () => dialog()!.querySelector<HTMLElement>('[data-system-dialog-counter]');
  const liveRegion = () => dialog()!.querySelector<HTMLElement>('[data-system-dialog-live]');
  const pageDots = () => Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-system-dialog-dot]'));
  const activeFooter = () => dialog()!.querySelector<HTMLElement>('[data-system-dialog-footer][data-active]')!;

  beforeEach(() => {
    onPrevious.mockClear();
    onNext.mockClear();
  });

  it('one item: no pager chrome at all (the single dialog as it always was)', () => {
    renderDialog(notice());
    expect(dialog()!.querySelector('[data-system-dialog-pager]')).toBeNull();
    expect(dialog()!.querySelector('[data-system-dialog-sizer], [data-system-dialog-footers], [data-system-dialog-dots]')).toBeNull();
    expect(dialog()!.hasAttribute('data-page-count')).toBe(false);
    expect(button('Previous announcement')).toBeNull();
    expect(button('Next announcement')).toBeNull();
    // A pager of ONE item is no pager either.
    cleanup();
    const only = notice({ id: 'only' });
    render(
      <SystemAnnouncementDialog announcement={only} open onClose={onClose} onCta={onCta} onSignOut={onSignOut}
        pager={{ items: [only], index: 0, turn: 1, onPrevious, onNext }} />,
    );
    expect(dialog()!.querySelector('[data-system-dialog-pager]')).toBeNull();
  });

  it('Previous, the dots, "n of N" and Next, with a polite "Announcement n of N"', () => {
    renderPaged(1);
    expect(dialog()!.getAttribute('data-page-count')).toBe('3');
    expect(dialog()!.getAttribute('data-page-index')).toBe('1');
    expect(pagerBar()).not.toBeNull();
    expect(pagerBar()!.getAttribute('role')).toBe('group');
    expect(counter()).toHaveTextContent('2 of 3');
    expect(liveRegion()).toHaveTextContent('Announcement 2 of 3');
    expect(liveRegion()!.getAttribute('aria-live')).toBe('polite');
    expect(liveRegion()!.className).toContain('sr-only');
    // The dots: one per page, the page showing a wider pill in ITS tone.
    expect(pageDots()).toHaveLength(3);
    expect(pageDots().map((d) => d.hasAttribute('data-active'))).toEqual([false, true, false]);
    expect(pageDots()[1].className.split(/\s+/)).toEqual(expect.arrayContaining(['w-4', 'h-1.5', 'rounded-full', TONE_CLASSES.warning.dialogAccent]));
    expect(pageDots()[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['w-1.5', 'h-1.5']));
    expect(pageDots()[0].parentElement!.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(button('Previous announcement')!);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Next announcement')!);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('Left / Right arrow keys page from anywhere in the dialog; not with a modifier', () => {
    renderPaged(0);
    fireEvent.keyDown(dialog()!, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button('Sign out')!, { key: 'ArrowLeft' });
    expect(onPrevious).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog()!, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(dialog()!, { key: 'ArrowRight', shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('a HARD page: no X, Escape and outside clicks ignored, Sign out and its button; still pageable', async () => {
    renderPaged(0);
    expect(dialog()!.getAttribute('data-blocking')).toBe('hard');
    expect(button('Close')).toBeNull();
    expect(button('Got it')).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    await clickOutside();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(button('Sign out')).toBeInTheDocument();
    fireEvent.click(button('Update card')!);
    expect(onCta).toHaveBeenCalledWith('/subscription');
    fireEvent.click(button('Next announcement')!);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('a SOFT page while a hard one remains: its X, Escape, outside click and Got it each close THAT item (onClose)', async () => {
    const { show } = renderPaged(1);
    expect(dialog()!.getAttribute('data-blocking')).toBe('soft');
    fireEvent.click(button('Close')!);
    fireEvent.click(button('Got it')!);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    show(1);
    await settle();
    await clickOutside();
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(button('Sign out')).toBeNull();
  });

  it('while any hard page remains the backdrop is the hard one, even on a soft page; soft pages only: the soft one', () => {
    renderPaged(1);
    expect(document.querySelector('.backdrop-blur-md')).not.toBeNull();
    cleanup();
    renderPaged(0, pagesOf().slice(1));
    expect(document.querySelector('.backdrop-blur-md')).toBeNull();
    expect(document.querySelector('.backdrop-blur-sm')).not.toBeNull();
  });

  it('each page keeps its own tone, icon, title, body and buttons', async () => {
    const { show } = renderPaged(0);
    const check = (tone: 'critical' | 'warning' | 'info', title: string, buttons: string[]) => {
      expect(dialog()!.getAttribute('data-tone')).toBe(tone);
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
      const page = dialog()!.querySelector('[data-system-dialog-page]')!;
      expect(page.querySelector(`[data-tone-icon="${tone}"]`)).not.toBeNull();
      expect(dialog()!.querySelector(`[aria-hidden="true"].${CSS.escape(TONE_CLASSES[tone].dialogAccent)}`)).not.toBeNull();
      expect([...activeFooter().querySelectorAll('button')].map((b) => b.textContent)).toEqual(buttons);
    };
    check('critical', 'Card payments are down', ['Sign out', 'Update card']);
    show(1);
    check('warning', 'Maintenance tonight', ['Got it']);
    show(2);
    check('info', 'New pricing rules', ['Not now', 'Open settings']);
    // This page has only just taken over, so its buttons wait out
    // SYSTEM_DIALOG_PAGE_GUARD_MS first (see "a click that lands on the page that just
    // took over"); a reader gets there long after.
    await act(async () => {
      await new Promise((r) => setTimeout(r, SYSTEM_DIALOG_PAGE_GUARD_MS + 50));
    });
    fireEvent.click(button('Open settings')!);
    expect(onCta).toHaveBeenCalledWith('/settings');
  });

  it('keeps ONE size for every page: every page is laid out in the same cells, only the one showing can be seen or pressed', () => {
    renderPaged(1);
    const sizers = Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-system-dialog-sizer]'));
    expect(sizers).toHaveLength(3);
    for (const s of sizers) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.hasAttribute('inert')).toBe(true);
      expect(s.className.split(/\s+/)).toEqual(expect.arrayContaining(['invisible', 'col-start-1', 'row-start-1']));
    }
    const footers = Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-system-dialog-footer]'));
    expect(footers.map((f) => f.getAttribute('data-system-dialog-footer'))).toEqual(['h', 's1', 's2']);
    for (const f of footers) {
      expect(f.className.split(/\s+/)).toEqual(expect.arrayContaining(['col-start-1', 'row-start-1']));
      const showingIt = f.getAttribute('data-system-dialog-footer') === 's1';
      expect(f.hasAttribute('inert')).toBe(!showingIt);
      expect(f.getAttribute('aria-hidden')).toBe(showingIt ? null : 'true');
      expect(f.className.split(/\s+/)).toContain(showingIt ? 'visible' : 'invisible');
    }
    // Buttons on the other pages are not reachable by role.
    expect(button('Sign out')).toBeNull();
    expect(button('Update card')).toBeNull();
    expect(button('Open settings')).toBeNull();
    // One heading and one description are the dialog's: the sizers' copies are hidden.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('slides the page in from the side it came from (the feature dialog\'s motion)', () => {
    renderPaged(1);
    const page = dialog()!.querySelector<HTMLElement>('[data-system-dialog-page]')!;
    expect(page.getAttribute('data-system-dialog-page')).toBe('s1');
    const source = readPortalSource('components/announcements/system-announcement-dialog.tsx');
    expect(source).toMatch(/initial=\{reduceMotion \? false : \{ opacity: 0, x: turn \* 16 \}\}/);
    expect(source).toMatch(/animate=\{\{ opacity: 1, x: 0 \}\}/);
  });

  it('when the page changes under a pressed button, focus goes back to the panel; paging from the pager keeps it there', () => {
    const { show } = renderPaged(1);
    const gotIt = button('Got it')!;
    act(() => gotIt.focus());
    show(2);
    expect(document.activeElement).toBe(dialog());
    const next = button('Next announcement')!;
    act(() => next.focus());
    show(0);
    expect(document.activeElement).toBe(next);
  });

  // Review round 5: every page's footer sits in ONE cell, so the second click of a
  // double click on a soft page's "Got it" landed on whatever the next page puts in that
  // spot — Sign out, a hard page's button, or another notice's "Got it".
  describe('a click that lands on the page that just took over', () => {
    /** Past the guard, without holding the suite up. */
    const afterGuard = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, SYSTEM_DIALOG_PAGE_GUARD_MS + 50));
      });
    };

    it('a HARD page taking the place of a soft one: Sign out and its button do nothing for a moment', async () => {
      const { show } = renderPaged(1);
      fireEvent.click(button('Got it')!);
      expect(onClose).toHaveBeenCalledTimes(1);
      // What the host does next: the item is gone and the hard page takes the place.
      show(0);
      fireEvent.click(button('Sign out')!);
      fireEvent.click(button('Update card')!);
      expect(onSignOut).not.toHaveBeenCalled();
      expect(onCta).not.toHaveBeenCalled();
      await afterGuard();
      fireEvent.click(button('Update card')!);
      expect(onCta).toHaveBeenCalledWith('/subscription');
      fireEvent.click(button('Sign out')!);
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });

    it('another SOFT page taking over: its Got it, X, Escape and an outside click cannot dismiss it unread', async () => {
      const { show } = renderPaged(1);
      fireEvent.click(button('Got it')!);
      expect(onClose).toHaveBeenCalledTimes(1);
      show(2);
      fireEvent.click(button('Not now')!);
      fireEvent.click(button('Open settings')!);
      fireEvent.click(button('Close')!);
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await clickOutside();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onCta).not.toHaveBeenCalled();
      await afterGuard();
      fireEvent.click(button('Not now')!);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('the operator\'s own paging is never held back: Next, then that page\'s button at once', () => {
      const { show } = renderPaged(1);
      fireEvent.click(button('Next announcement')!);
      show(2);
      fireEvent.click(button('Open settings')!);
      expect(onCta).toHaveBeenCalledWith('/settings');
      // The arrow keys count as the operator's own move too.
      fireEvent.keyDown(dialog()!, { key: 'ArrowLeft' });
      show(1);
      fireEvent.click(button('Got it')!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Review round 5: the body is one scrolling element shared by every page, so a page
  // opened after a long one was scrolled started below its own title.
  describe('scrolling', () => {
    const longShort = () => [
      notice({ id: 'long', title: 'Long notice', body: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}.`).join('\n') }),
      notice({ id: 'short', title: 'Short notice', body: 'Tiny.' }),
    ];
    const bodyEl = () => dialog()!.querySelector<HTMLElement>('[data-system-dialog-body]')!;

    it('a page change puts the body back at the top, whichever way the page changed', () => {
      const { show } = renderPaged(0, longShort());
      const body = bodyEl();
      body.scrollTop = 1617;
      show(1);
      // The same element (the pages share it), scrolled back to the title.
      expect(bodyEl()).toBe(body);
      expect(body.scrollTop).toBe(0);
      body.scrollTop = 900;
      show(0);
      expect(body.scrollTop).toBe(0);
    });

    it('the hidden sizers are clipped to the body, so a short page has no empty space to scroll through', () => {
      renderPaged(1, longShort());
      const clip = dialog()!.querySelector<HTMLElement>('[data-system-dialog-sizers]')!;
      expect(clip).not.toBeNull();
      // jsdom lays nothing out; the headless-Chrome probe proved the geometry. The clip
      // is the body's cap less its own padding (pt-6 + pb-2 = 2rem).
      expect(clip.className.split(/\s+/)).toEqual(
        expect.arrayContaining([
          'overflow-hidden',
          'col-start-1',
          'row-start-1',
          'max-sm:max-h-[calc(100dvh-15.5rem)]',
          'sm:max-h-[calc(100dvh-13.5rem)]',
        ]),
      );
      expect(clip.querySelectorAll('[data-system-dialog-sizer]')).toHaveLength(2);
    });
  });

  it('the single dialog\'s helper line appears once per page that needs it, on the page showing', () => {
    perms = { isManager: false, isReadOnlyRole: true, canAccessRoute: () => true };
    renderPaged(0);
    const helpers = dialog()!.querySelectorAll('[data-announcement-helper]');
    expect(helpers).toHaveLength(1);
    expect(button('Update card')).toBeNull();
  });
});
