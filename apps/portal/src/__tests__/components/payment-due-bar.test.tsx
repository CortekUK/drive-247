/**
 * MAJOR 1 — a phone gets NO dunning warning at all, for the whole grace window.
 *
 * The billing chip in the sidebar footer (`app-sidebar-v2.tsx`, and v1's
 * `app-sidebar.tsx`) is the only billing surface during grace. Below `md` the
 * whole sidebar lives inside a CLOSED Radix `Sheet`, so it is not in the DOM at
 * all: an operator working on a phone saw nothing for the entire window and then
 * met a non-dismissible paywall with no prior warning. Proven by DOM probes at
 * 360px across D0–D7 (scratchpad/ann/subsim).
 *
 * `PaymentDueBar` is the phone-only replacement for that chip, and — because the
 * hard gate exempts `/subscription` and `/settings` — it is also the phone user's
 * only route to the hosted invoice once the window has closed. So the things
 * pinned here are: it appears in both grace states, it disappears completely
 * (no wrapper, no spacer, no DOM) in every other state, it always carries a pay
 * link, it escalates amber -> red with `graceSeverity`, and it is `md:hidden` so
 * it can never double up with the sidebar chip on desktop.
 *
 * The wording is the chip's, verbatim, with no countdown — see the note at
 * app-sidebar-v2.tsx:293-300 for why the countdown was deliberately removed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PaymentDueBar } from '@/components/subscription/payment-due-bar';

const INVOICE_URL = 'https://invoice.stripe.com/i/acct_test/test_in_paymentduebar';

type Billing = {
  isInGracePeriod: boolean;
  isGraceExpired: boolean;
  graceSeverity: 'none' | 'warning' | 'critical';
  outstandingInvoiceUrl: string | null;
};

const HEALTHY: Billing = {
  isInGracePeriod: false,
  isGraceExpired: false,
  graceSeverity: 'none',
  outstandingInvoiceUrl: null,
};

let billing: Billing = { ...HEALTHY };

vi.mock('@/hooks/use-tenant-subscription', () => ({
  useTenantSubscription: () => billing,
}));

// next/link needs no router to emit a plain anchor, but stubbing keeps this
// test independent of Next's app-router test shims.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  billing = { ...HEALTHY };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const paint = async () => {
  await act(async () => {
    root.render(<PaymentDueBar />);
  });
};

const bar = () => container.querySelector<HTMLElement>('[data-payment-due-bar]');
const anchors = () =>
  Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));

describe('PaymentDueBar — the phone-only dunning surface', () => {
  it('warns while the tenant is INSIDE the grace window', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();

    expect(bar()).not.toBeNull();
    // The chip's wording, verbatim, and no countdown anywhere.
    expect(container.textContent).toContain('Your payment is due.');
    expect(container.textContent).toContain('Action needed');
    expect(container.textContent).not.toMatch(/\d+\s*d(ay)?s? left/i);
  });

  it('still warns once the window has CLOSED (the gate exempts /subscription)', async () => {
    billing = {
      isInGracePeriod: false,
      isGraceExpired: true,
      graceSeverity: 'none',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();

    expect(bar()).not.toBeNull();
    expect(container.textContent).toContain('Your payment is due.');
    expect(container.textContent).toContain('Overdue');
  });

  it('renders NOTHING — no wrapper, no spacer — for a healthy tenant', async () => {
    await paint();
    expect(bar()).toBeNull();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a trialing tenant with no failed payment', async () => {
    billing = { ...HEALTHY, outstandingInvoiceUrl: null };
    await paint();
    expect(container.innerHTML).toBe('');
  });

  it('links to the hosted invoice when one exists, in a new tab', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();

    expect(anchors()).toContain(INVOICE_URL);
    const link = container.querySelector<HTMLAnchorElement>(`a[href="${INVOICE_URL}"]`)!;
    expect(link.getAttribute('target')).toBe('_blank');
    // An outbound link opened in a new tab without this hands the opener over.
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('falls back to /subscription when no invoice URL has synced', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: null,
    };
    await paint();

    // The bar's whole point is that it is the phone user's route to paying, so
    // it is never a dead end: with no invoice link it still reaches the page
    // that carries one.
    expect(anchors()).toContain('/subscription');
    expect(container.querySelector('a[href="/subscription"]')).not.toBeNull();
  });

  it('is amber while there is time left, and red once severity is critical', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();
    // The sidebar chip's exact class pairs, light + dark, so the two surfaces agree.
    expect(bar()!.className).toContain('bg-amber-50');
    expect(bar()!.className).toContain('text-amber-700');
    expect(bar()!.className).toContain('dark:bg-amber-950/40');
    expect(bar()!.className).toContain('dark:text-amber-400');
    expect(bar()!.className).not.toContain('bg-red-50');

    billing = { ...billing, graceSeverity: 'critical' };
    await paint();
    expect(bar()!.className).toContain('bg-red-50');
    expect(bar()!.className).toContain('text-red-700');
    expect(bar()!.className).toContain('dark:bg-red-950/40');
    expect(bar()!.className).toContain('dark:text-red-400');
    expect(bar()!.className).not.toContain('bg-amber-50');
  });

  it('is red once the window has expired, whatever severity says', async () => {
    // graceSeverity is "none" outside the window (it is derived from
    // isInGracePeriod), so isGraceExpired has to carry the escalation itself.
    billing = {
      isInGracePeriod: false,
      isGraceExpired: true,
      graceSeverity: 'none',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();
    expect(bar()!.className).toContain('bg-red-50');
    expect(bar()!.className).not.toContain('bg-amber-50');
  });

  it('is md:hidden, so desktop keeps the sidebar chip and only the sidebar chip', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();
    expect(bar()!.className.split(/\s+/)).toContain('md:hidden');
  });

  it('does not cover content or trap scroll: it is in flow, not fixed', async () => {
    billing = {
      isInGracePeriod: true,
      isGraceExpired: false,
      graceSeverity: 'warning',
      outstandingInvoiceUrl: INVOICE_URL,
    };
    await paint();
    const classes = bar()!.className.split(/\s+/);
    // A `fixed` bar would need its own spacer and would fight
    // SystemAnnouncementBanner's `--system-banner-h` offsets.
    expect(classes).not.toContain('fixed');
    expect(classes).not.toContain('sticky');
    expect(classes).not.toContain('absolute');
  });
});
