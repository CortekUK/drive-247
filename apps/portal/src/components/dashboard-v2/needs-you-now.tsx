'use client';

import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Inbox,
  KeyRound,
  Receipt,
  ScrollText,
  Timer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { usePendingBookingsCount } from '@/hooks/use-pending-bookings';
import { useTodayOperations } from '@/hooks/use-today-operations';
import { AttentionWash } from './attention-wash';
import { CardSurface } from './card-surface';

/**
 * Everything blocked on a human decision, in one ranked list.
 *
 * This replaces MoneyAtRisk and OnTheMoveToday, which each showed you a number
 * and then left you to go find the thing behind it. The rule for what belongs
 * here: your action *today* changes the outcome. Ranked by that, not by size —
 * an unanswered booking request outranks a larger pile of overdue invoices
 * because the sale evaporates in hours and the invoices will still be there
 * tomorrow. Housekeeping sorts last.
 *
 * Costs no extra network: every hook below is already mounted by the dashboard
 * (or its siblings) and React Query dedupes on the key, so this re-reads
 * responses rather than issuing new requests.
 */

type Tone = 'critical' | 'warn' | 'info';

interface Item {
  id: string;
  icon: LucideIcon;
  label: string;
  /** The right-hand value — a count, an amount, a lateness. */
  detail: string;
  tone: Tone;
  href: string;
}

/**
 * Icons and values sit on their own near-white chips.
 *
 * The card ground is mid-accent, and red on purple stops reading as an alarm —
 * they are too close in the blue channel. Giving each value a light chip
 * restores a white ground locally, so `22d late` recovers its punch without
 * touching the card colour. The chip colours are literal rather than tokens on
 * purpose: the chip is always light in both themes, so the text on it must
 * always be dark, which `--destructive` (which lightens in dark mode) would
 * not be.
 */
const TONE_ICON: Record<Tone, string> = {
  critical: 'bg-white/85 text-red-600',
  warn: 'bg-white/75 text-amber-700',
  info: 'bg-white/60 text-slate-600',
};

const TONE_DETAIL: Record<Tone, string> = {
  critical: 'bg-white/85 font-semibold text-red-600',
  warn: 'bg-white/75 font-medium text-amber-700',
  info: 'bg-white/55 text-slate-600',
};

function ItemRow({ item, onClick }: { item: Item; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/15"
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          TONE_ICON[item.tone]
        )}
      >
        <Icon className="size-4" />
      </span>
      {/* White, not the foreground token: near-black on mid-accent goes muddy —
          it is neither dark enough to read as text nor light enough to sit on
          the colour. The chips carry the dark ink instead. */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.label}</span>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums',
          TONE_DETAIL[item.tone]
        )}
      >
        {item.detail}
      </span>
      <ArrowUpRight className="size-3.5 shrink-0 text-transparent transition-colors group-hover:text-white/70" />
    </button>
  );
}

export function NeedsYouNow({ className }: { className?: string }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const { data: kpis } = useDashboardKPIs();
  const { data: pendingBookings } = usePendingBookingsCount();
  const { pickups, returns, overdue, staleCount, staleAfterDays, isLoading } =
    useTodayOperations();

  const currencyCode = tenant?.currency_code || 'USD';
  const canSeeRentals = canView('rentals');
  const canSeePayments = canView('payments');

  // Nothing on this card is visible to this manager — render nothing at all and
  // let the grid reflow rather than hold an empty slot open.
  if (!canSeeRentals && !canSeePayments && !canView('pending_bookings') && !canView('fines')) {
    return null;
  }

  const money = (amount: number) =>
    formatCurrency(amount, currencyCode, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const items: Item[] = [];

  // 1. A car that should be back and is not. Nothing else on this card is
  //    worth more per hour of inattention.
  if (canSeeRentals && overdue.length > 0) {
    const worst = Math.max(...overdue.map((o) => o.daysLate ?? 0));
    items.push({
      id: 'overdue-vehicles',
      icon: AlertTriangle,
      label: overdue.length === 1 ? '1 vehicle not returned' : `${overdue.length} vehicles not returned`,
      detail: `${worst}d late`,
      tone: 'critical',
      href: '/rentals',
    });
  }

  // 2. A customer is waiting on a yes. This decays fastest of anything here.
  if (canView('pending_bookings') && (pendingBookings ?? 0) > 0) {
    items.push({
      id: 'pending-bookings',
      icon: Inbox,
      label:
        pendingBookings === 1 ? '1 booking request' : `${pendingBookings} booking requests`,
      detail: 'awaiting you',
      tone: 'warn',
      href: '/pending-bookings',
    });
  }

  // 3. Money already earned and not collected.
  if (canSeePayments && kpis && kpis.overdue.count > 0) {
    items.push({
      id: 'overdue-payments',
      icon: Receipt,
      label:
        kpis.overdue.count === 1 ? '1 overdue payment' : `${kpis.overdue.count} overdue payments`,
      detail: money(kpis.overdue.amount),
      tone: 'critical',
      href: '/payments',
    });
  }

  if (canSeePayments && kpis && kpis.dueToday.count > 0) {
    items.push({
      id: 'due-today',
      icon: Timer,
      label: kpis.dueToday.count === 1 ? '1 payment due today' : `${kpis.dueToday.count} payments due today`,
      detail: money(kpis.dueToday.amount),
      tone: 'warn',
      href: '/payments',
    });
  }

  // 4. Fines get more expensive on a deadline, so only the ones with a clock
  //    on them belong on a "now" list — the rest live on /fines.
  if (canView('fines') && kpis && kpis.finesOpen.dueSoonCount > 0) {
    items.push({
      id: 'fines-due-soon',
      icon: ScrollText,
      label:
        kpis.finesOpen.dueSoonCount === 1
          ? '1 fine due soon'
          : `${kpis.finesOpen.dueSoonCount} fines due soon`,
      detail: money(kpis.finesOpen.amount),
      tone: 'warn',
      href: '/fines',
    });
  }

  // 5. Today's physical work. Real, but it is scheduled rather than blocked.
  const handovers = pickups.length + returns.length;
  if (canSeeRentals && handovers > 0) {
    items.push({
      id: 'handovers',
      icon: KeyRound,
      label: handovers === 1 ? '1 handover today' : `${handovers} handovers today`,
      detail: `${pickups.length} out · ${returns.length} back`,
      tone: 'info',
      href: '/rentals',
    });
  }

  // 6. Housekeeping, and last on purpose: rentals so far past their end date
  //    that they are a data problem rather than a missing car.
  if (canSeeRentals && staleCount > 0) {
    items.push({
      id: 'stale-rentals',
      icon: Timer,
      label: `${staleCount} rentals never closed off`,
      detail: `${staleAfterDays}d+`,
      tone: 'info',
      href: '/rentals',
    });
  }

  const hasCritical = items.some((i) => i.tone === 'critical');

  return (
    <Card
      className={cn(
        // The middle rung: a pale accent tint, not solid accent. That completes
        // the row's ramp — saturated brand card, pale accent, plain white — and
        // it keeps dark text on a light ground, so red and amber stay legible
        // for the rows that need them.
        'relative isolate flex flex-col overflow-hidden border-primary/15',
        className
      )}
    >
      <CardSurface cardId="needs-you" />
      {/* A gentle diagonal deepening so the tint has some depth to it. */}
      <AttentionWash hsl="var(--primary)" level="low" />

      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <h2 className="flex items-center justify-between gap-2 px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-white/70">
          <span>Needs you now</span>
          {!isLoading && items.length > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[11px] tabular-nums normal-case tracking-normal',
                hasCritical ? 'bg-white/85 font-semibold text-red-600' : 'bg-white/60 text-slate-600'
              )}
            >
              {items.length}
            </span>
          )}
        </h2>

        {isLoading ? (
          <div className="space-y-1.5 px-2 py-1">
            <Skeleton className="h-11 w-full bg-white/40" />
            <Skeleton className="h-11 w-full bg-white/40" />
            <Skeleton className="h-11 w-full bg-white/40" />
          </div>
        ) : items.length === 0 ? (
          /* An empty list is the good outcome, so it reads as a result rather
             than as a card that failed to load. */
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center">
            <span className="flex size-9 items-center justify-center rounded-full bg-white/80 text-emerald-600">
              <Check className="size-4" />
            </span>
            <p className="text-sm font-medium text-white">All clear</p>
            <p className="text-xs text-white/70">
              No overdue cars, payments or requests.
            </p>
          </div>
        ) : (
          /* Centred rather than top-aligned: two items in a tall card looked
             like the card had failed to finish loading. Centring makes a short
             list read as deliberate, and a long one still fills and scrolls. */
          <div className="-mx-1 flex min-h-0 flex-1 flex-col justify-center gap-0.5 overflow-y-auto px-1">
            {items.map((item) => (
              <ItemRow key={item.id} item={item} onClick={() => router.push(item.href)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
