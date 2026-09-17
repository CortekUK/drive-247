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

import { HARD_DIALOG_HELPER, SystemAnnouncementDialog } from '@/components/announcements/system-announcement-dialog';
import { SYSTEM_DIALOG_UI, TONE_CLASSES, type PortalAnnouncement } from '@/lib/announcements/contract';

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
