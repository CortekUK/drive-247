'use client';

/**
 * Instalment plans, READ-ONLY.
 *
 * v1's equivalent carries four money-moving buttons — Pay early, Pay off
 * remaining, Retry, Activate & pay upfront — plus a card-update dialog. None of
 * them is here. Each is a WRITE against a live card through
 * `pay-installment-early` / `create-upfront-checkout`, and on staging those
 * functions settle through a Stripe account whose webhooks fire into
 * PRODUCTION, so there is no environment in which the button could have been
 * exercised before shipping it. A payment button that has never been pressed is
 * not a feature. The schedule below states exactly what will be taken and when,
 * which is the part a customer needs in order to keep money in the account.
 */

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock } from 'lucide-react';

import { formatDate, relativeDayLabel } from '@/components/portal/format';
import { Panel, PanelHeader } from '@/components/portal/primitives';
import { StatusChip } from '@/components/portal/status-chip';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type {
  CustomerInstallment,
  CustomerInstallmentPlan,
  InstallmentState,
} from '@/hooks/use-customer-payments';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';

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
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-brand-text">Instalment plans</h2>

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
        'flex items-start gap-3 rounded-[14px] border px-4 py-3.5',
        urgent
          ? 'border-danger-subtle bg-danger-light'
          : 'border-brand-border-soft bg-brand-card',
      )}
    >
      {urgent ? (
        <AlertTriangle
          aria-hidden
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-danger"
        />
      ) : (
        <CalendarClock
          aria-hidden
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-brand-text-subtle"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-brand-text">
          {installment.state === 'failed'
            ? 'A payment did not go through'
            : installment.state === 'overdue'
              ? 'A payment is overdue'
              : 'Next payment'}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">
          {formatCurrency(installment.amount)} — instalment {installment.number} of{' '}
          {plan.count}
          {plan.rental?.vehicle ? ` on ${plan.rental.vehicle.displayName}` : ''}.
          {installment.state === 'failed'
            ? ' We will try again, and the operator will be in touch if it keeps failing.'
            : ` Due ${formatDate(installment.dueDate)}${when ? ` (${when})` : ''}.`}
        </p>
        {installment.failureReason ? (
          <p className="mt-1 text-xs text-danger">{installment.failureReason}</p>
        ) : null}
      </div>

      <span className="shrink-0 text-sm font-medium tabular-nums text-brand-text">
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
        action={<StatusChip tone={tone}>{statusLabel}</StatusChip>}
      />

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-brand-text-soft">
            {plan.planTypeLabel} · {formatCurrency(plan.instalmentAmount)} ×{' '}
            {plan.count}
          </p>
          {plan.rental ? (
            <Link
              href={`/portal/bookings/${plan.rental.id}`}
              className="inline-flex min-h-11 items-center text-sm text-brand-text-soft underline-offset-4 hover:text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
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
            <span className="text-brand-text-subtle">
              {plan.paidCount} of {plan.count} paid
            </span>
            <span className="tabular-nums text-brand-text-subtle">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={plan.count}
            aria-valuenow={plan.paidCount}
            aria-label="Instalments paid"
            className="h-1.5 w-full overflow-hidden rounded-full bg-brand-stone"
          >
            <div
              className="h-full rounded-full bg-brand-forest transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <Accordion type="single" collapsible className="border-t border-brand-border-soft">
        <AccordionItem value="schedule" className="border-b-0">
          <AccordionTrigger className="min-h-11 px-4 py-3 text-sm font-medium text-brand-text hover:no-underline sm:px-5">
            Payment schedule
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 sm:px-5">
            <ul className="divide-y divide-brand-border-soft">
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
      <dt className="truncate text-xs text-brand-text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums text-brand-text">
        {value}
      </dd>
      {caption ? (
        <dd className="truncate text-xs text-brand-text-subtle">{caption}</dd>
      ) : null}
    </div>
  );
}

function InstalmentRow({ instalment }: { instalment: CustomerInstallment }) {
  const { formatCurrency } = useTenantBranding();
  const chip = INSTALMENT_CHIP[instalment.state];
  const paid = instalment.state === 'paid';

  return (
    <li className="flex items-center gap-3 py-2.5">
      {paid ? (
        <CheckCircle2
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-success"
        />
      ) : instalment.state === 'overdue' || instalment.state === 'failed' ? (
        <AlertTriangle
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-danger"
        />
      ) : (
        <Clock
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-brand-text-subtle"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-brand-text">
          Instalment {instalment.number}
        </p>
        <p className="truncate text-xs text-brand-text-subtle">
          {paid && instalment.paidAt
            ? `Paid ${formatDate(instalment.paidAt.slice(0, 10))}`
            : formatDate(instalment.dueDate)}
        </p>
      </div>

      <span className="shrink-0 text-sm tabular-nums text-brand-text">
        {formatCurrency(instalment.amount)}
      </span>
      <StatusChip tone={chip.tone} className="shrink-0">
        {chip.label}
      </StatusChip>
    </li>
  );
}
