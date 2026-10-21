'use client';

/**
 * Payment progress, drawn: the operator's instalment progress bar (the 2px
 * rounded bar on the rental's instalment plan card) split into one segment per
 * instalment, each in its state's colour, with that instalment's date and state
 * under its own segment. A booking without a plan gets the single bar: paid of
 * total. Used by Finances (one per plan) and the rental page.
 *
 * Colour is status only: paid in the accent, late in red, due today in amber,
 * still to come in the track colour.
 */

import { formatDate } from '@nw/components/portal/format';
import type { CustomerInstallmentPlan, InstallmentState } from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

const SEGMENT: Record<InstallmentState, string> = {
  paid: 'bg-pv-primary',
  overdue: 'bg-pv-danger',
  failed: 'bg-pv-danger',
  due_today: 'bg-pv-warning',
  scheduled: 'bg-pv-tint',
};

const STATE_TEXT: Record<InstallmentState, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'text-pv-success' },
  overdue: { label: 'Overdue', className: 'text-pv-danger' },
  failed: { label: 'Failed', className: 'text-pv-danger' },
  due_today: { label: 'Due today', className: 'text-pv-warning' },
  scheduled: { label: 'Scheduled', className: 'text-pv-muted-fg' },
};

export function InstalmentTrack({ plan, compact = false }: { plan: CustomerInstallmentPlan; compact?: boolean }) {
  const { formatCurrency } = useTenantBranding();
  const items = plan.installments;

  return (
    <div className="flex flex-col gap-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={plan.count}
        aria-valuenow={plan.paidCount}
        aria-label={`${plan.paidCount} of ${plan.count} instalments paid`}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <span key={item.id} className={cn('h-2 rounded-full', SEGMENT[item.state])} title={`Instalment ${item.number}`} />
        ))}
      </div>
      {compact ? null : (
        <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}>
          {items.map((item) => {
            const state = STATE_TEXT[item.state];
            return (
              <li key={item.id} className="min-w-0">
                <p className="truncate text-[12px] font-medium tabular-nums text-pv-fg">{formatCurrency(item.amount)}</p>
                <p className="truncate text-[11px] tabular-nums text-pv-muted-fg">
                  {item.state === 'paid' && item.paidAt ? formatDate(item.paidAt.slice(0, 10)) : formatDate(item.dueDate)}
                </p>
                <p className={cn('truncate text-[11px] font-medium', state.className)}>{state.label}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** One booking's money as a single bar: what has been paid of what it costs. */
export function PaidBar({ paid, total }: { paid: number; total: number }) {
  const { formatCurrency } = useTenantBranding();
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((paid / total) * 100))) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Paid"
        className="h-2 w-full overflow-hidden rounded-full bg-pv-tint"
      >
        <div className={cn('h-full rounded-full', percent >= 100 ? 'bg-pv-success' : 'bg-pv-primary')} style={{ width: `${percent}%` }} />
      </div>
      <p className="flex justify-between text-[12px] tabular-nums text-pv-muted-fg">
        <span>
          <span className="font-medium text-pv-fg">{formatCurrency(paid)}</span> paid
        </span>
        <span>of {formatCurrency(total)}</span>
      </p>
    </div>
  );
}
