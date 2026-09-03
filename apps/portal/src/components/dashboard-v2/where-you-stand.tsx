'use client';

import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';
import { AttentionWash } from './attention-wash';
import { CardSurface } from './card-surface';

/**
 * The standing picture — how much of the fleet is earning, and what it has
 * earned this month.
 *
 * Deliberately the one card in the row that asks nothing of you. Its brief is
 * "never empty, never demands" — which is why it is built on utilisation
 * rather than on events: there is always a percentage, even on a day when
 * nothing happens. Idle cars are the number operators never see anywhere else,
 * so they get named rather than left as the remainder of a bar.
 */

export function WhereYouStand({ className }: { className?: string }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const { data: kpis } = useDashboardKPIs();

  const canSeeFleet = canView('vehicles');
  const canSeeMoney = canView('payments');

  if (!canSeeFleet && !canSeeMoney) return null;

  const currencyCode = tenant?.currency_code || 'USD';
  const fleet = kpis?.fleetUtilization;
  // `available` is what the KPI function calls it; on this card it is framed as
  // idle, because an available car on a Tuesday afternoon is lost revenue, not
  // readiness.
  const idle = fleet ? Math.max(0, fleet.total - fleet.rented) : 0;
  const percentage = fleet?.percentage ?? 0;

  const money = (amount: number) =>
    formatCurrency(amount, currencyCode, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  return (
    <Card className={cn('relative isolate flex flex-col overflow-hidden', className)}>
      <CardSurface cardId="where-you-stand" />
      {/* Bottom rung of the attention ramp — present enough that the card is
          not a blank white block, faint enough that it never competes with the
          two cards to its left. */}
      <AttentionWash hsl="var(--primary)" level="low" />

      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Where you stand
        </h2>

        {!kpis ? (
          <div className="space-y-2 px-2 py-2">
            <Skeleton className="h-12 w-28" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-3 px-2">
            {canSeeFleet && fleet && (
              <button
                type="button"
                onClick={() => router.push('/vehicles')}
                className="group -mx-2 space-y-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/40"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[34px] font-semibold leading-none tabular-nums">
                    {percentage}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    of the fleet on rent
                  </span>
                  <ArrowUpRight className="ml-auto size-3.5 shrink-0 self-center text-transparent transition-colors group-hover:text-muted-foreground" />
                </div>

                {/* One bar, two segments. The idle segment is the point of the
                    card, so it is a visible surface rather than empty track. */}
                <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
                  <div
                    className="rounded-full bg-primary transition-all"
                    style={{ width: `${percentage}%` }}
                  />
                  <div className="flex-1 rounded-full bg-foreground/10" />
                </div>

                {/* The counts get real weight. On most fleets the idle number
                    is the largest and least-known figure on the dashboard, and
                    as 11px legend text nobody ever read it. */}
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-primary" />
                    <span className="font-semibold tabular-nums">{fleet.rented}</span>
                    <span className="text-muted-foreground">on rent</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-foreground/25" />
                    <span className="font-semibold tabular-nums">{idle}</span>
                    <span className="text-muted-foreground">idle</span>
                  </span>
                </div>
              </button>
            )}

            {canSeeFleet && canSeeMoney && <div className="border-t border-foreground/10" />}

            {canSeeMoney && (
              <button
                type="button"
                onClick={() => router.push('/payments')}
                className="group -mx-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/40"
              >
                {/* Two stats rather than one: a lone row left half the card
                    empty, and revenue per vehicle is the number that makes the
                    utilisation above mean something — it is what the idle cars
                    are costing, expressed as what the working ones earn. */}
                <div className="flex items-end justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">
                      Collected this month
                    </span>
                    <span className="block text-lg font-semibold leading-tight tabular-nums">
                      {money(kpis.monthlyRevenue.amount)}
                    </span>
                  </span>

                  {canSeeFleet && fleet && fleet.total > 0 && (
                    <span className="min-w-0 text-right">
                      <span className="block text-xs text-muted-foreground">Per vehicle</span>
                      <span className="block text-lg font-semibold leading-tight tabular-nums">
                        {money(kpis.monthlyRevenue.amount / fleet.total)}
                      </span>
                    </span>
                  )}

                  <ArrowUpRight className="mb-1 size-3.5 shrink-0 text-transparent transition-colors group-hover:text-muted-foreground" />
                </div>
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
