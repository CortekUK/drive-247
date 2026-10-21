'use client';

/**
 * Instalment plans, READ-ONLY — and still read-only after balance payments were
 * wired up on this page.
 *
 * v1's equivalent carries four money-moving buttons — Pay early, Pay off
 * remaining, Retry, Activate & pay upfront — plus a card-update dialog. None of
 * them is here, and the original reason has since expired: staging now has its
 * own Stripe webhook endpoint, so a card payment CAN be exercised end to end
 * (see `pay-balances.tsx`, which does exactly that). These buttons stay absent
 * for a different and more durable reason.
 *
 * A plan's instalments are collected server-side against the SAME
 * `ledger_entries` charge rows a lump-sum payment would clear. Paying that
 * charge off through the booking endpoint would settle the debt without
 * touching `scheduled_installments`, leaving the schedule collecting money
 * against a balance that is already zero — an operator then has to unwind it.
 * Doing this properly needs `pay-installment-early` / `create-upfront-checkout`
 * to be the path, and those move the schedule as well as the money. Wiring the
 * generic balance endpoint here instead would be a button that appears to work
 * and quietly corrupts the plan.
 *
 * So a booking on an active or pending plan is left out of the Pay panel above
 * altogether, and the section heading below says the plan collects it. The schedule below states exactly what will be taken and when,
 * which is the part a customer needs in order to keep money in the account.
 *
 * One card per plan (owner, Oct 22 2026): the overdue instalment is named
 * inside its plan's card; the separate banner above the plans is gone.
 */

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react-nw';

import { formatDate, relativeDayLabel } from '@nw/components/portal/format';
import type { CustomerInstallmentPlan } from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { InstalmentTrack } from '@nw/portal-v2/instalment-track';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@portal-v2-shared/card';

import { StatusText } from './list-table';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function InstalmentPlans({ plans }: { plans: readonly CustomerInstallmentPlan[] }) {
  if (plans.length === 0) return null;

  return (
    <section id="plans" className="flex scroll-mt-24 flex-col gap-5">
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </section>
  );
}

/* ───────────────────────────── one whole plan ──────────────────────────── */

/**
 * One plan, in the operator's card: the car and booking in the header with
 * the plan's state; the cadence and amount; the instalments drawn as a
 * segmented bar, each with its date and state under it; and the late one, if
 * any, named in a line of its own.
 */
function PlanCard({ plan }: { plan: CustomerInstallmentPlan }) {
  const { formatCurrency } = useTenantBranding();

  const late = plan.installments.filter((i) => i.state === 'overdue' || i.state === 'failed');
  const firstLate = late[0] ?? null;
  const next = firstLate ? null : (plan.installments.find((i) => i.state === 'due_today' || i.state === 'scheduled') ?? null);
  const nextWhen = next ? relativeDayLabel(next.dueDate) : null;

  const tone: ChipTone = plan.isComplete ? 'success' : late.length > 0 ? 'danger' : plan.isPending ? 'warning' : 'info';
  const statusLabel = plan.isComplete ? 'Complete' : late.length > 0 ? 'Overdue' : plan.isPending ? 'Not started' : 'Active';

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-pv-border py-4">
        <CardTitle>Instalment plan</CardTitle>
        <CardDescription>
          {plan.rental?.vehicle?.displayName ?? 'Your booking'}
          {plan.rental ? (
            <>
              {' · '}
              <Link
                href={`/portal/rentals/${plan.rental.id}`}
                className="font-medium text-pv-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
              >
                {plan.rental.reference}
              </Link>
            </>
          ) : null}
        </CardDescription>
        <CardAction>
          <StatusText tone={tone}>{statusLabel}</StatusText>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-pv-fg">
            <span className="font-semibold">
              {plan.paidCount} of {plan.count}
            </span>{' '}
            <span className="text-pv-muted-fg">
              paid · {plan.planTypeLabel.toLowerCase()} {formatCurrency(plan.instalmentAmount)}
            </span>
          </p>
          <p className="text-[12px] tabular-nums text-pv-muted-fg">
            {formatCurrency(plan.paid)} paid · {formatCurrency(plan.remaining)} to go
          </p>
        </div>

        <InstalmentTrack plan={plan} />

        {firstLate ? (
          <p className="flex items-start gap-2 text-[13px] font-medium text-pv-danger">
            <AlertTriangle aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
            <span>
              Instalment {firstLate.number} of {plan.count} · {formatCurrency(firstLate.amount)} · due{' '}
              {formatDate(firstLate.dueDate)} · {firstLate.state === 'failed' ? 'payment failed' : 'overdue'}
              {late.length > 1 ? ` · ${late.length - 1} more overdue` : ''}
              {firstLate.failureReason ? ` (${firstLate.failureReason})` : ''}
            </span>
          </p>
        ) : next ? (
          <p className="text-[13px] text-pv-muted-fg">
            Next: instalment {next.number}, {formatCurrency(next.amount)}, on {formatDate(next.dueDate)}
            {nextWhen ? ` (${nextWhen})` : ''}.
          </p>
        ) : null}

        <p className="border-t border-pv-border pt-3 text-[12px] text-pv-muted-fg">
          Collected from your card automatically on each due date
          {plan.upfrontAmount > 0 && !plan.upfrontPaid ? `. ${formatCurrency(plan.upfrontAmount)} upfront is not yet paid.` : '.'}
        </p>
      </CardContent>
    </Card>
  );
}
