'use client';

/**
 * The alert bar: the customer's next course of action, on every page, directly
 * under the page header (owner, Oct 22 2026 — the one thing worth keeping from
 * the old Home). PageHeader and SettingsPageHeader draw it; nothing else should.
 *
 * Three variants only — red, yellow, grey — for severity. Which situation maps
 * to which colour is provisional until the notification system is redone; the
 * mapping lives in `useActionItems` below and nowhere else.
 *
 * Drawn as a stripe, not a rounded box: a small radius, the tone at a few
 * percent behind it, a hairline of the same tone, and the action button in the
 * bar's own colour family (never white).
 */

import Link from 'next/link';
import { useSyncExternalStore, type SVGProps } from 'react';

import { formatDate } from '@nw/components/portal/format';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerPayments } from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import { usePay } from '@nw/portal-v2/pay/pay-provider';

export type AlertBarVariant = 'red' | 'yellow' | 'grey';

export interface AlertBarItem {
  key: string;
  variant: AlertBarVariant;
  title: string;
  description?: string;
  /** A link, or — for a balance — the rental to pay (opens the card dialog in place). */
  action?: { label: string; href: string } | { label: string; payRentalId: string };
}

const BAR: Record<AlertBarVariant, string> = {
  red: 'border-pv-danger/25 bg-pv-danger/[0.07] text-pv-danger',
  yellow: 'border-pv-warning/30 bg-pv-warning-light/70 text-pv-warning',
  grey: 'border-pv-border bg-pv-muted/70 text-pv-fg',
};

const BUTTON: Record<AlertBarVariant, string> = {
  red: 'bg-pv-danger text-white hover:bg-pv-danger/85',
  yellow: 'bg-pv-warning text-white hover:bg-pv-warning/85',
  grey: 'bg-pv-fg/80 text-pv-card hover:bg-pv-fg',
};

/* The bar's icons, drawn in the v2 nav set's manner (shared/portal-v2/
   nav-icons): one even 2.2 stroke on the 24 grid, round caps, no fills. */
function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Red: an octagon, the stop sign — something is wrong and needs you now. */
function IconUrgent(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8.3 2.8h7.4l5.5 5.5v7.4l-5.5 5.5H8.3l-5.5-5.5V8.3z" />
      <path d="M12 7.6v5" />
      <path d="M12 16.4h.01" />
    </Svg>
  );
}

/** Yellow: a clock face — something is due. */
function IconDue(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 7v5l3.2 2" />
    </Svg>
  );
}

/** Grey: an arrow into a box — a step to take. */
function IconStep(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M9 12h6" />
      <path d="m12.5 9 3 3-3 3" />
    </Svg>
  );
}

const ICON: Record<AlertBarVariant, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  red: IconUrgent,
  yellow: IconDue,
  grey: IconStep,
};

/* ─────────────────────────────── dismissing ─────────────────────────────── */

/**
 * The customer can close a stripe with its ×, but only for now (owner, Oct 22
 * 2026): it must be back after a refresh, after signing out and in again, and
 * when they come back to the portal later. So the closed set lives in memory
 * only — a reload wipes it — the shell clears it whenever the portal mounts
 * (resetDismissedAlerts), and each close lapses after DISMISS_FOR_MS.
 *
 * Keyed on what the stripe SAYS (key + title), so a changed situation — a new
 * amount, a new due date — shows at once. One store for every bar on every
 * page, so closing it here closes it everywhere.
 */
const DISMISS_FOR_MS = 30 * 60 * 1000;
const listeners = new Set<() => void>();
let dismissedAt = new Map<string, number>();
let snapshot: string[] = [];

function publish() {
  const now = Date.now();
  snapshot = [...dismissedAt].filter(([, at]) => now - at < DISMISS_FOR_MS).map(([sig]) => sig);
  listeners.forEach((listener) => listener());
}

const signature = (item: AlertBarItem) => `${item.key}|${item.title}`;

function dismiss(item: AlertBarItem) {
  dismissedAt.set(signature(item), Date.now());
  publish();
  // Lapse on its own, even if nothing else re-renders the bar.
  window.setTimeout(publish, DISMISS_FOR_MS + 1000);
}

/** Every closed stripe back. The shell calls it when the portal mounts (sign-in, a fresh visit). */
export function resetDismissedAlerts() {
  dismissedAt = new Map();
  publish();
}

const EMPTY: string[] = [];
function useDismissed(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => EMPTY,
  );
}

/** One stripe. Exported so a page (or a preview) can draw a given variant. */
export function AlertStripe({
  item,
  className,
  dismissible = true,
}: {
  item: AlertBarItem;
  className?: string;
  /** The × that closes it. On by default; a page-owned stripe can turn it off. */
  dismissible?: boolean;
}) {
  const dismissed = useDismissed();
  if (dismissible && dismissed.includes(signature(item))) return null;
  const Icon = ICON[item.variant];
  return (
    <div
      role={item.variant === 'red' ? 'alert' : 'status'}
      className={cn(
        'flex min-h-11 items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 sm:pl-3.5',
        BAR[item.variant],
        className,
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="font-semibold">{item.title}</span>
        {/* A phone has room for the headline and the button; the detail is a tap away. */}
        {item.description ? <span className="text-pv-fg/70 max-sm:hidden"> · {item.description}</span> : null}
      </p>
      {item.action ? <StripeAction item={item} /> : null}
      {dismissible ? (
        <button
          type="button"
          onClick={() => dismiss(item)}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mr-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-current opacity-60 outline-none transition-opacity duration-200 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/40 motion-reduce:transition-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="size-4" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function StripeAction({ item }: { item: AlertBarItem }) {
  const { pay, minting } = usePay();
  const action = item.action;
  if (!action) return null;
  const className = cn(
    'inline-flex h-8 shrink-0 cursor-pointer items-center rounded-md px-3 text-[13px] font-semibold outline-none transition-colors duration-200',
    'focus-visible:ring-2 focus-visible:ring-current/40 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none',
    BUTTON[item.variant],
  );
  if ('payRentalId' in action) {
    return (
      <button type="button" disabled={minting !== null} onClick={() => pay(action.payRentalId)} className={className}>
        {minting === action.payRentalId ? 'Starting…' : action.label}
      </button>
    );
  }
  return (
    <Link href={action.href} className={className}>
      {action.label}
    </Link>
  );
}

const RANK: Record<AlertBarVariant, number> = { red: 0, yellow: 1, grey: 2 };

/**
 * What needs the customer, most severe first. Money comes from the ledger
 * Finances reads (`useCustomerPayments`), never `rentals.payment_status`.
 */
export function useActionItems(): { items: AlertBarItem[]; isLoading: boolean } {
  const { formatCurrency } = useTenantBranding();
  const { isIdentityVerified, isLoading: customerLoading } = useCustomer();
  const { payableBalances, activePlans, isLoading } = useCustomerPayments();

  const items: AlertBarItem[] = [];

  for (const row of payableBalances) {
    if (row.blockedReason !== null) continue;
    const car = row.rental?.vehicle?.displayName ?? row.rental?.reference ?? 'your booking';
    items.push({
      key: `pay-${row.rentalId}`,
      variant: row.isOverdue ? 'red' : 'yellow',
      title: `${formatCurrency(row.amount)} ${row.isOverdue ? 'overdue' : 'due'} on the ${car}`,
      description: row.nextDueDate ? `${row.isOverdue ? 'Was due' : 'Due'} ${formatDate(row.nextDueDate)}` : undefined,
      action: { label: 'Pay now', payRentalId: row.rentalId },
    });
  }

  // A plan collects its own instalments; it needs the customer only when one is late.
  for (const plan of activePlans) {
    const late = plan.installments.filter((i) => i.state === 'overdue' || i.state === 'failed');
    if (late.length === 0) continue;
    const first = late[0];
    const car = plan.rental?.vehicle?.displayName ?? plan.rental?.reference ?? 'your booking';
    items.push({
      key: `plan-${plan.id}`,
      variant: 'red',
      title: `Instalment ${first.number} of ${plan.count} on the ${car} ${first.state === 'failed' ? 'failed' : 'is overdue'}`,
      description: `${formatCurrency(first.amount)}, due ${formatDate(first.dueDate)}. Check the card on file`,
      action: { label: 'Update card', href: '/portal/payments?section=cards' },
    });
  }

  if (!customerLoading && !isIdentityVerified) {
    items.push({
      key: 'verify',
      variant: 'grey',
      title: 'Verify your ID before pickup',
      description: 'Your driving licence and a selfie, about two minutes',
      action: { label: 'Verify', href: '/portal/settings?section=verification' },
    });
  }

  items.sort((a, b) => RANK[a.variant] - RANK[b.variant]);
  return { items, isLoading };
}

/** Every stripe that applies, most severe first; nothing while loading or when all is well. */
export function PortalAlertBar({ className }: { className?: string }) {
  const { items: all, isLoading } = useActionItems();
  const dismissed = useDismissed();
  const items = all.filter((item) => !dismissed.includes(signature(item)));
  if (isLoading || items.length === 0) return null;
  return (
    <div aria-label="Needs you" className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => (
        <AlertStripe key={item.key} item={item} />
      ))}
    </div>
  );
}
