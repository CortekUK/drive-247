'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, Car, Check, KeyRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { cn } from '@/lib/utils';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { useTodayOperations, type Movement } from '@/hooks/use-today-operations';

/**
 * Which cars go out today, which come back, and which were due back and have
 * not been returned. The question the charts below the fold do not answer.
 *
 * All data comes from useTodayOperations, which filters every query by
 * `tenant_id` — see the note at the top of that hook.
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

function MovementRow({ movement, onClick }: { movement: Movement; onClick: () => void }) {
  const time = formatTime(movement.time);
  const isOverdue = movement.kind === 'overdue';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
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

export function OnTheMoveToday({ className }: { className?: string }) {
  const router = useRouter();
  const { canView } = useManagerPermissions();
  const { pickups, returns, overdue, staleCount, staleAfterDays, isLoading } =
    useTodayOperations();

  if (!canView('rentals')) return null;

  // Overdue leads: a car that should be back and is not is the most expensive
  // thing on this card.
  const movements: Movement[] = [...overdue, ...pickups, ...returns];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <h2 className="flex items-baseline justify-between gap-2 px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
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
          <div className="space-y-1.5 px-2 py-1">
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
            className="mt-1 flex w-full shrink-0 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <span>
              {staleCount} over {staleAfterDays} days past their end date
            </span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
