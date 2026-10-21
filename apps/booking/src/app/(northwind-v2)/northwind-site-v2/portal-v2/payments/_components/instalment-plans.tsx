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
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react-nw';

import { formatDate, relativeDayLabel } from '@nw/components/portal/format';
import { Panel } from '@nw/portal-v2/primitives';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@nw/components/ui/accordion';
import type {
  CustomerInstallment,
  CustomerInstallmentPlan,
  InstallmentState,
} from '@nw/hooks/use-customer-payments';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';

import { SectionTitle, StatusText } from './list-table';

type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const INSTALMENT_CHIP: Record<
  InstallmentState,
  { label: string; tone: ChipTone }
> = {
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  overdue: { label: 'Overdue', tone: 'danger' },
  due_today: { label: 'Due today', tone: 'warning' },
  scheduled: { label: 'Scheduled', tone: 'neutral' },
};

export function InstalmentPlans({ plans }: { plans: readonly CustomerInstallmentPlan[] }) {
  if (plans.length === 0) return null;

  return (
    <section id="plans" className="flex scroll-mt-24 flex-col gap-3">
      <SectionTitle
        title="Instalment plans"
        description="Each instalment is collected from your card automatically on its due date, so there is nothing to pay by hand."
      />
      {plans.map((plan) => (
        <PlanCard key={plan.id} plan={plan} />
      ))}
    </section>
  );
}

/* ───────────────────────────── one whole plan ──────────────────────────── */

/**
 * One card per plan: the car and booking, the cadence and amount, progress as
 * "2 of 4 paid", and — inline, not in a banner above — the instalment that is
 * late, or else the next one. The full schedule folds away underneath.
 */
function PlanCard({ plan }: { plan: CustomerInstallmentPlan }) {
  const { formatCurrency } = useTenantBranding();
  const percent = Math.round(plan.progress * 100);

  const late = plan.installments.filter((i) => i.state === 'overdue' || i.state === 'failed');
  const firstLate = late[0] ?? null;
  const next = firstLate ? null : (plan.installments.find((i) => i.state === 'due_today' || i.state === 'scheduled') ?? null);
  const nextWhen = next ? relativeDayLabel(next.dueDate) : null;

  const tone: ChipTone = plan.isComplete ? 'success' : late.length > 0 ? 'danger' : plan.isPending ? 'warning' : 'info';
  const statusLabel = plan.isComplete
    ? 'Complete'
    : late.length > 0
      ? 'Overdue'
      : plan.isPending
        ? 'Not started'
        : 'Active';

  return (
    <Panel>
      <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 text-[14px]">
            <span className="font-semibold text-pv-fg">{plan.rental?.vehicle?.displayName ?? 'Instalment plan'}</span>
            {plan.rental ? (
              <>
                <span className="text-pv-muted-fg"> · </span>
                <Link
                  href={`/portal/rentals/${plan.rental.id}`}
                  className="font-medium text-pv-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
                >
                  {plan.rental.reference}
                </Link>
              </>
            ) : null}
          </p>
          <StatusText tone={tone}>{statusLabel}</StatusText>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          <span className="text-pv-fg">
            {plan.planTypeLabel} · {formatCurrency(plan.instalmentAmount)} × {plan.count}
          </span>
          {/* By instalment COUNT, not amount: a customer tracks a plan as "2 of 4
              gone", and the two only agree when every instalment is the same size. */}
          <span className="flex items-center gap-2">
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={plan.count}
              aria-valuenow={plan.paidCount}
              aria-label="Instalments paid"
              className="h-1.5 w-24 overflow-hidden rounded-full bg-pv-tint"
            >
              <span className="block h-full rounded-full bg-pv-primary" style={{ width: `${percent}%` }} />
            </span>
            <span className="tabular-nums text-pv-fg">
              {plan.paidCount} of {plan.count} paid
            </span>
          </span>
          <span className="tabular-nums text-pv-muted-fg">
            {formatCurrency(plan.paid)} paid · {formatCurrency(plan.remaining)} to go
            {plan.upfrontAmount > 0 && !plan.upfrontPaid ? ` · ${formatCurrency(plan.upfrontAmount)} upfront not yet paid` : ''}
          </span>
        </div>

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
      </div>

      <Accordion type="single" collapsible className="border-t border-pv-border">
        <AccordionItem value="schedule" className="border-b-0">
          <AccordionTrigger className="min-h-10 px-4 py-2.5 text-[13px] font-medium text-pv-fg transition-colors duration-200 hover:bg-pv-row hover:no-underline motion-reduce:transition-none sm:px-5">
            Payment schedule
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-3 sm:px-5">
            <ul className="divide-y divide-pv-border">
              {plan.installments.map((instalment) => (
                <InstalmentRow key={instalment.id} instalment={instalment} />
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Panel>
  );
}

function InstalmentRow({ instalment }: { instalment: CustomerInstallment }) {
  const { formatCurrency } = useTenantBranding();
  const chip = INSTALMENT_CHIP[instalment.state];
  const paid = instalment.state === 'paid';

  return (
    <li className="flex items-center gap-3 py-3">
      {paid ? (
        <CheckCircle2
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-pv-success"
        />
      ) : instalment.state === 'overdue' || instalment.state === 'failed' ? (
        <AlertTriangle
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-pv-danger"
        />
      ) : (
        <Clock
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-pv-muted-fg"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-pv-fg">
          Instalment {instalment.number}
        </p>
        <p className="truncate text-xs text-pv-muted-fg">
          {paid && instalment.paidAt
            ? `Paid ${formatDate(instalment.paidAt.slice(0, 10))}`
            : formatDate(instalment.dueDate)}
        </p>
      </div>

      <span className="shrink-0 text-sm font-medium tabular-nums text-pv-fg">
        {formatCurrency(instalment.amount)}
      </span>
      <StatusText tone={chip.tone} className="w-20 shrink-0 text-right">
        {chip.label}
      </StatusText>
    </li>
  );
}
