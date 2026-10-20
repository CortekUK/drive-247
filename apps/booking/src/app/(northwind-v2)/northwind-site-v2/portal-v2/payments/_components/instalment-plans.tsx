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
 * So a booking on an active or pending plan is deliberately excluded from the
 * Pay panel above (`PLAN_BLOCK_REASON` in `use-customer-payments.ts`) and says
 * why on screen. The schedule below states exactly what will be taken and when,
 * which is the part a customer needs in order to keep money in the account.
 */

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock } from 'lucide-react-nw';

import { formatDate, relativeDayLabel } from '@nw/components/portal/format';
import { Panel, PanelHeader } from '@nw/portal-v2/primitives';
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

export function InstalmentPlans({
  plans,
  next,
}: {
  plans: readonly CustomerInstallmentPlan[];
  next: {
    plan: CustomerInstallmentPlan;
    installment: CustomerInstallment;
  } | null;
}) {
  if (plans.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <SectionTitle
        title="Instalment plans"
        description="Each instalment is collected from your card automatically on its due date."
      />

      {next ? <NextInstalment plan={next.plan} installment={next.installment} /> : null}

      {plans.map((plan) => (
        <PlanPanel key={plan.id} plan={plan} />
      ))}
    </section>
  );
}

/* ─────────────────────────── the next payment ──────────────────────────── */

function NextInstalment({
  plan,
  installment,
}: {
  plan: CustomerInstallmentPlan;
  installment: CustomerInstallment;
}) {
  const { formatCurrency } = useTenantBranding();
  const urgent = installment.state === 'overdue' || installment.state === 'failed';
  const when = relativeDayLabel(installment.dueDate);

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-4 py-3.5 sm:px-5',
        urgent
          ? 'border-pv-danger/20 bg-pv-danger-light'
          : 'border-pv-border bg-pv-card',
      )}
    >
      {urgent ? (
        <AlertTriangle
          aria-hidden
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-pv-danger"
        />
      ) : (
        <CalendarClock
          aria-hidden
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-pv-muted-fg"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-pv-fg">
          {installment.state === 'failed'
            ? 'A payment did not go through'
            : installment.state === 'overdue'
              ? 'A payment is overdue'
              : 'Next payment'}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-pv-muted-fg">
          {formatCurrency(installment.amount)} — instalment {installment.number} of{' '}
          {plan.count}
          {plan.rental?.vehicle ? ` on ${plan.rental.vehicle.displayName}` : ''}.
          {installment.state === 'failed'
            ? ' We will try again, and the operator will be in touch if it keeps failing.'
            : ` Due ${formatDate(installment.dueDate)}${when ? ` (${when})` : ''}.`}
        </p>
        {installment.failureReason ? (
          <p className="mt-1 text-xs text-pv-danger">{installment.failureReason}</p>
        ) : null}
      </div>

      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-pv-fg">
        {formatCurrency(installment.amount)}
      </span>
    </div>
  );
}

/* ───────────────────────────── one whole plan ──────────────────────────── */

function PlanPanel({ plan }: { plan: CustomerInstallmentPlan }) {
  const { formatCurrency } = useTenantBranding();
  const percent = Math.round(plan.progress * 100);

  const tone: ChipTone = plan.isComplete
    ? 'success'
    : plan.statusRaw.toLowerCase() === 'overdue'
      ? 'danger'
      : plan.isPending
        ? 'warning'
        : 'info';

  const statusLabel = plan.isComplete
    ? 'Complete'
    : plan.isPending
      ? 'Not started'
      : plan.statusRaw.toLowerCase() === 'overdue'
        ? 'Overdue'
        : 'Active';

  return (
    <Panel>
      <PanelHeader
        title={plan.rental?.vehicle?.displayName ?? 'Instalment plan'}
        action={<StatusText tone={tone}>{statusLabel}</StatusText>}
      />

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-pv-muted-fg">
            {plan.planTypeLabel} · {formatCurrency(plan.instalmentAmount)} ×{' '}
            {plan.count}
          </p>
          {plan.rental ? (
            <Link
              href={`/portal/rentals/${plan.rental.id}`}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-pv-link underline-offset-4 transition-colors duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
            >
              {plan.rental.reference}
            </Link>
          ) : null}
        </div>

        {/* Progress by instalment COUNT, not by amount: a customer tracks a
            plan as "3 of 8 gone", and the two only agree when every instalment
            is the same size, which a re-planned schedule breaks. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-pv-muted-fg">
              {plan.paidCount} of {plan.count} paid
            </span>
            <span className="tabular-nums text-pv-muted-fg">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={plan.count}
            aria-valuenow={plan.paidCount}
            aria-label="Instalments paid"
            className="h-2 w-full overflow-hidden rounded-full bg-pv-tint"
          >
            <div
              className="h-full rounded-full bg-pv-primary"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-pv-row px-4 py-3 sm:grid-cols-4">
          <Figure label="Paid" value={formatCurrency(plan.paid)} />
          <Figure label="Remaining" value={formatCurrency(plan.remaining)} />
          <Figure
            label="Upfront"
            value={formatCurrency(plan.upfrontAmount)}
            caption={plan.upfrontPaid ? 'Paid' : 'Not yet paid'}
          />
          <Figure
            label="Next due"
            value={
              plan.isComplete ? '—' : (formatDate(plan.nextDueDate) ?? 'Not set')
            }
          />
        </dl>
      </div>

      <Accordion type="single" collapsible className="border-t border-pv-border">
        <AccordionItem value="schedule" className="border-b-0">
          <AccordionTrigger className="min-h-11 px-4 py-3 text-sm font-semibold text-pv-fg transition-colors duration-200 hover:bg-pv-row hover:no-underline motion-reduce:transition-none sm:px-5">
            Payment schedule
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 sm:px-5">
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

function Figure({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-pv-muted-fg">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-pv-fg">
        {value}
      </dd>
      {caption ? (
        <dd className="truncate text-xs text-pv-muted-fg">{caption}</dd>
      ) : null}
    </div>
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
