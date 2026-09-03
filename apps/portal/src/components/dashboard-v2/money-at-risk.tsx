'use client';

import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Receipt } from 'lucide-react';
import { Card, CardContent } from '@/components/ui-v2/card';
import { Skeleton } from '@/components/ui-v2/skeleton';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format-utils';
import { useTenant } from '@/contexts/TenantContext';
import { useDashboardKPIs } from '@/hooks/use-dashboard-kpis';
import { useManagerPermissions } from '@/hooks/use-manager-permissions';

/**
 * What is owed right now.
 *
 * Costs nothing to fetch: the v2 dashboard already calls useDashboardKPIs on a
 * 60s interval and uses only `fleetUtilization`, throwing `overdue`, `dueToday`
 * and `finesOpen` away on every poll. React Query dedupes on the key, so this
 * reads the same response rather than issuing a second request.
 *
 * Tenant isolation is the edge function's job here: `dashboard-kpis` resolves
 * the caller's tenant from their JWT. There is no `.from()` in this file.
 */

function Row({
  label,
  count,
  amount,
  currencyCode,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  amount: number;
  currencyCode: string;
  tone: 'danger' | 'warn' | 'neutral';
  onClick: () => void;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            // Zero is a good outcome, so it reads as calm rather than as a
            // greyed-out version of an alarm.
            empty
              ? 'bg-muted text-muted-foreground'
              : tone === 'danger'
                ? 'bg-destructive/10 text-destructive'
                : tone === 'warn'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-primary/10 text-primary'
          )}
        >
          {empty ? <Check className="size-3.5" /> : <Receipt className="size-3.5" />}
        </span>
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-sm font-semibold tabular-nums">
          {formatCurrency(amount, currencyCode, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}
        </span>
        {count > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">· {count}</span>
        )}
        <ArrowUpRight className="size-3.5 text-transparent transition-colors group-hover:text-muted-foreground" />
      </span>
    </button>
  );
}

export function MoneyAtRisk({ className }: { className?: string }) {
  const router = useRouter();
  const { tenant } = useTenant();
  const { canView } = useManagerPermissions();
  const { data: kpis } = useDashboardKPIs();
  const currencyCode = tenant?.currency_code || 'USD';

  if (!canView('payments')) return null;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardContent className="flex flex-1 flex-col gap-1 p-4">
        <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Money at risk
        </h2>

        {!kpis ? (
          <div className="space-y-1.5 px-2 py-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-0.5">
            <Row
              label="Overdue"
              count={kpis.overdue.count}
              amount={kpis.overdue.amount}
              currencyCode={currencyCode}
              tone="danger"
              onClick={() => router.push('/payments')}
            />
            <Row
              label="Due today"
              count={kpis.dueToday.count}
              amount={kpis.dueToday.amount}
              currencyCode={currencyCode}
              tone="warn"
              onClick={() => router.push('/payments')}
            />
            <Row
              label="Open fines"
              count={kpis.finesOpen.count}
              amount={kpis.finesOpen.amount}
              currencyCode={currencyCode}
              tone="neutral"
              onClick={() => router.push('/fines')}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
