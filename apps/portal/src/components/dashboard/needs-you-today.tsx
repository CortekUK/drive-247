'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, Car, Check, KeyRound, Receipt } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useTodayOperations, type Movement } from '@/hooks/use-today-operations';

/**
 * "What do I have to do today" — the question the charts below do not answer.
 *
 * The money half costs nothing: the dashboard already calls useDashboardKPIs on
 * a 60s interval and was using only `fleetUtilization`, throwing `overdue`,
 * `dueToday` and `finesOpen` away on every poll. React Query dedupes on the key,
 * so this reads the same response rather than fetching again.
 */

/** "14:30:00" → "2:30 PM". Null when the rental never had a time set. */
function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
}

function MoneyRow({
  label,
  count,
  amount,
  currencyCode,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  amount?: number;
  currencyCode: string;
  tone: 'danger' | 'warn' | 'neutral';
  onClick: () => void;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            // Zero is a good outcome, so it reads as calm rather than as a
            // muted version of an alarm.
            empty
              ? 'bg-muted text-muted-foreground'
              : tone === 'danger'
                ? 'bg-destructive/10 text-destructive'
                : tone === 'warn'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-primary/10 text-primary'
          )}
        >
          {empty ? <Check className="size-3.5" /> : <Receipt className="size-3.5" />}
        </span>
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {amount !== undefined
            ? formatCurrency(amount, currencyCode, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })
            : count}
        </span>
        {amount !== undefined && count > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">· {count}</span>
        )}
        <ArrowUpRight className="size-3.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </span>
    </button>
  );
}

function MovementRow({ movement, onClick }: { movement: Movement; onClick: () => void }) {
  const time = formatTime(movement.time);
  const isOverdue = movement.kind === 'overdue';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md',
          isOverdue
            ? 'bg-destructive/10 text-destructive'
            : movement.kind === 'pickup'
              ? 'bg-primary/10 text-primary'
              : 'bg-success/10 text-success'
        )}
      >
        {isOverdue ? (
          <AlertTriangle className="size-3" />
        ) : movement.kind === 'pickup' ? (
          <Car className="size-3" />
        ) : (
          <KeyRound className="size-3" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{movement.customerName}</span>
        <span className="block truncate text-xs leading-tight text-muted-foreground">
          {movement.vehicleLabel}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-xs tabular-nums',
          isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground'
        )}
      >
        {isOverdue
          ? `${movement.daysLate}d late`
          : (time ?? (movement.kind === 'pickup' ? 'Pickup' : 'Return'))}
      </span>
    </button>
  );
}

export function NeedsYouToday({ className }: { className?: string }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const currencyCode = tenant?.currency_code || 'USD';

  const { data: kpis } = useDashboardKPIs();
  const { pickups, returns, overdue, staleCount, staleAfterDays, isLoading } =
    useTodayOperations();

  const showMoney = canView('payments');
  const showOps = canView('rentals');
  if (!showMoney && !showOps) return null;

  // Overdue returns lead: a car that should be back and is not is the most
  // expensive thing on this panel.
  const movements: Movement[] = [...overdue, ...pickups, ...returns];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        {showMoney && (
          <div>
            <h2 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              Money at risk
            </h2>
            {!kpis ? (
              <div className="space-y-1.5 px-3 py-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (
              <div className="space-y-0.5">
                <MoneyRow
                  label="Overdue"
                  count={kpis.overdue.count}
                  amount={kpis.overdue.amount}
                  currencyCode={currencyCode}
                  tone="danger"
                  onClick={() => router.push('/payments')}
                />
                <MoneyRow
                  label="Due today"
                  count={kpis.dueToday.count}
                  amount={kpis.dueToday.amount}
                  currencyCode={currencyCode}
                  tone="warn"
                  onClick={() => router.push('/payments')}
                />
                <MoneyRow
                  label="Open fines"
                  count={kpis.finesOpen.count}
                  amount={kpis.finesOpen.amount}
                  currencyCode={currencyCode}
                  tone="neutral"
                  onClick={() => router.push('/fines')}
                />
              </div>
            )}
          </div>
        )}

        {showOps && (
          <div className="flex min-h-0 flex-1 flex-col">
            <h2 className="flex items-baseline justify-between gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              <span>On the move today</span>
              {!isLoading && movements.length > 0 && (
                <span className="tabular-nums normal-case tracking-normal">
                  {pickups.length} out · {returns.length} back
                  {overdue.length > 0 && (
                    <span className="text-destructive"> · {overdue.length} late</span>
                  )}
                </span>
              )}
            </h2>

            {isLoading ? (
              <div className="space-y-1.5 px-3 py-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : movements.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-center">
                <span className="flex size-9 items-center justify-center rounded-full bg-success/10 text-success">
                  <Check className="size-4" />
                </span>
                <p className="text-sm font-medium">Nothing due today</p>
                <p className="text-xs text-muted-foreground">
                  No pickups, returns or overdue vehicles.
                </p>
              </div>
            ) : (
              <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
                {movements.map((m) => (
                  <MovementRow
                    key={`${m.kind}-${m.id}`}
                    movement={m}
                    onClick={() => router.push(`/rentals/${m.id}`)}
                  />
                ))}
              </div>
            )}

            {/* The overdue list stops at 30 days so a genuinely late car is not
                buried under months-old records. Those are not hidden — they are
                surfaced here as the housekeeping job they actually are. */}
            {!isLoading && staleCount > 0 && (
              <button
                type="button"
                onClick={() => router.push('/rentals')}
                className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60"
              >
                <span>
                  {staleCount} rental{staleCount === 1 ? '' : 's'} over {staleAfterDays} days past
                  their end date
                </span>
                <ArrowUpRight className="size-3.5 shrink-0" />
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
