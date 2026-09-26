/**
 * Finances — where the tab lives, and how the three tabs it replaced lead into it.
 *
 * docs/FINANCES_DESIGN.md §1. On the canary (the `finances` v2 area, slug only)
 * the sidebar's Payments, Invoices and Fines rows become ONE Finances row, and
 * the three old list routes redirect into the matching view:
 *
 *   /payments → /finances?view=received
 *   /invoices → /finances?view=billed
 *   /fines    → /finances?view=fines
 *
 * EXACT paths only. `/payments/[id]`, `/payments/analytics`, `/fines/[id]`,
 * `/fines/new` and `/fines/analytics` are untouched: the side panel and the
 * dashboards still link to them, and a deep link to one record must keep
 * opening that record.
 *
 * PURE and import-free at runtime (the one import is a type), so `proxy.ts`,
 * the sidebar, the nav-preferences overlay and the page all read one copy.
 */
import type { FinanceView } from '@/lib/finances/types';

export const FINANCES_HREF = '/finances';

/** The views, in the order the switch shows them. */
export const FINANCE_VIEWS: readonly FinanceView[] = ['billed', 'received', 'upcoming', 'fines'];

/** Each old list route, and the view that replaced it. */
export const LEGACY_FINANCE_VIEWS: Readonly<Record<string, FinanceView>> = {
  '/payments': 'received',
  '/invoices': 'billed',
  '/fines': 'fines',
};

export const LEGACY_FINANCE_HREFS: readonly string[] = Object.keys(LEGACY_FINANCE_VIEWS);

/**
 * Which manager grant shows which view (design §1).
 *
 * The keys are the three that already exist — no `manager_permissions`
 * migration. Upcoming is money still to be COLLECTED, which is what the
 * Payments grant has always covered.
 */
export const FINANCE_VIEW_TAB_KEY: Readonly<Record<FinanceView, string>> = {
  billed: 'invoices',
  received: 'payments',
  upcoming: 'payments',
  fines: 'fines',
};

/** The views this user may see, in switch order. Empty means no Finances at all. */
export function financeViewsFor(canView: (tabKey: string) => boolean): FinanceView[] {
  return FINANCE_VIEWS.filter((view) => canView(FINANCE_VIEW_TAB_KEY[view]));
}

/**
 * Legacy status words carried in old links, translated to a Received status.
 * `/payments?status=pending` is what the notifications centre links to.
 */
const LEGACY_PAYMENT_STATUS: Readonly<Record<string, string>> = {
  pending: 'pending_review',
  approved: 'approved',
  auto_approved: 'approved',
  rejected: 'rejected',
};

/**
 * The Finances URL an old list route redirects to, or null when `pathname` is
 * not one of the three exact list routes.
 *
 * The old query string is carried across so a deep link keeps its meaning:
 * a `search` becomes the shared search (`q`), a payment `status` /
 * `verificationStatus` becomes the Received status it names, and a fines
 * `status` passes straight through (the Fines view reads the fines statuses).
 * Next's internal `_rsc` key never is.
 */
export function financesRedirectFor(pathname: string, search: URLSearchParams | string = ''): string | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const view = LEGACY_FINANCE_VIEWS[path];
  if (!view) return null;

  const from = typeof search === 'string' ? new URLSearchParams(search) : new URLSearchParams(search.toString());
  const next = new URLSearchParams();
  next.set('view', view);

  const q = from.get('q') ?? from.get('search') ?? from.get('customerSearch');
  if (q) next.set('q', q);

  if (view === 'received') {
    const status = from.get('status') ?? from.get('verificationStatus');
    const mapped = status ? LEGACY_PAYMENT_STATUS[status] : undefined;
    if (mapped) next.set('status', mapped);
    const method = from.get('method');
    if (method && method !== 'all') next.set('method', method);
  } else if (view === 'fines') {
    const status = from.get('status');
    if (status) next.set('status', status);
  }

  return `${FINANCES_HREF}?${next.toString()}`;
}

/**
 * Stored sidebar orders that name an old row, re-pointed at Finances.
 *
 * A user who arranged their sidebar before the merge has `/payments` (and
 * friends) in `moreOrder`. Those rows no longer exist on the canary, so the
 * first of them to appear takes Finances' place instead — Finances keeps the
 * spot the user gave Payments rather than dropping to the end. Only an order
 * is ever re-pointed: a HIDDEN old row hides nothing (design §1: stored
 * preferences must not hide Finances), because the overlay matches hidden
 * hrefs against rows that exist and `/payments` is not one of them.
 *
 * A no-op unless `/finances` is actually on screen and not already placed,
 * which makes it a no-op for every tenant that is not on the canary.
 */
export function repointLegacyFinanceOrder(order: readonly string[], presentHrefs: ReadonlySet<string>): string[] {
  if (!presentHrefs.has(FINANCES_HREF) || order.includes(FINANCES_HREF)) return [...order];
  let placed = false;
  const out: string[] = [];
  for (const href of order) {
    if (LEGACY_FINANCE_HREFS.includes(href) && !presentHrefs.has(href)) {
      if (!placed) {
        out.push(FINANCES_HREF);
        placed = true;
      }
      continue;
    }
    out.push(href);
  }
  return out;
}
