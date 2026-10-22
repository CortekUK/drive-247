'use client';

/**
 * One booking, read-only — a calmer version of the operator portal v2 rental
 * record (components/rentals-v2/rental-detail). Owner's layout, Oct 22 2026:
 * one header line (back, car, reference, chips) over the booked date; one
 * tinted alert when money is owed; then two columns that end level — the car
 * and when & where on the left, the price breakdown and "Book another car" on
 * the right — and the payment, its progress drawn, across the full width. The
 * cards, alert and progress bar are the operator's (shared/portal-v2).
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * This page shows what the customer bought: the car, the dates and places, what
 * they were charged, what extras they picked, and whether the money landed. It
 * takes no actions — no cancel, no extend, no re-pay, no document signing. That
 * is deliberate. v1's equivalent is ~1,466 lines because it also owns the
 * extension checkout, the installment schedule, the BoldSign envelope and the
 * cancellation request; each of those is a WRITE against money or a contract
 * and none can be bolted on safely as a side-effect of a detail view.
 *
 * ── THE ID IN THE URL IS NOT TRUSTED ────────────────────────────────────────
 * `useCustomerRental` filters on `customer_id` AND `tenant_id`, both taken from
 * the session rather than the route, so a stranger's rental id returns nothing
 * and renders as "not found" — never as a permission error, which would confirm
 * the id exists.
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CircleAlert } from 'lucide-react-nw';

import { formatDate, formatDateTime, formatTimestamp } from '@nw/components/portal/format';
import { formatBookingDates, formatNights } from '@nw/portal-v2/rentals/format';
import { EmptyState, LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { PaymentStatusChip, RentalStatusChip, StatusChip } from '@nw/portal-v2/status-chip';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerPayments } from '@nw/hooks/use-customer-payments';
import { useCustomerRental } from '@nw/hooks/use-customer-rental';
import type { CustomerRentalDetail } from '@nw/hooks/use-customer-rental';
import { bookingCompletionState, type BookingCompletionState } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { useTenant } from '@nw/contexts/TenantContext';
import { calculateTotalMileageAllowance } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_OUTLINE } from '@portal-v2-shared/button-styles';
import { Card, CardAction, CardHeader, CardTitle } from '@portal-v2-shared/card';
import { AlertStripe } from '@nw/portal-v2/alert-bar';
import { InstalmentTrack, PaidBar } from '@nw/portal-v2/instalment-track';

/** Hover = fade only, 200ms, ease-out on / ease-in off (V2_PLAN §12). */
const HOVER_FADE = 'transition-colors duration-200 ease-in hover:ease-out motion-reduce:transition-none';

export default function RentalDetailPage() {
  const params = useParams<{ id: string }>();
  // `useParams` types a catch-all as `string[]`; this segment is a single
  // `[id]`, but narrowing rather than asserting keeps the page honest if the
  // route ever changes shape.
  const rawId = params?.id;
  const rentalId = Array.isArray(rawId) ? rawId[0] : rawId;

  const { rental, notFound, isLoading, isError, error, refetch } = useCustomerRental(rentalId);

  return (
    <div className="flex flex-col gap-5">
      {isError || isLoading || notFound || !rental ? (
        <div className="flex flex-col gap-2">
          <BackLink />
          <PageHeader title={isLoading ? 'Your rental' : 'Rental'} />
        </div>
      ) : (
        <RentalHeader rental={rental} />
      )}

      {isError ? (
        <LoadError
          title="We could not load this rental"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <DetailSkeleton />
      ) : notFound || !rental ? (
        <Panel>
          <EmptyState
            icon={CircleAlert}
            title="Rental not found"
            description="We could not find that rental on your account. It may have been made with a different email address."
            action={{ href: '/portal/rentals', label: 'Back to my rentals' }}
          />
        </Panel>
      ) : (
        <BookingDetail rental={rental} />
      )}
    </div>
  );
}

/* ──────────────────────────────── header ───────────────────────────────── */

function BackLink() {
  return (
    <Link
      href="/portal/rentals"
      aria-label="All rentals"
      className={cn(
        '-ml-2 grid size-9 shrink-0 place-items-center rounded-full text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
        HOVER_FADE,
      )}
    >
      <ArrowLeft aria-hidden className="size-4" />
    </Link>
  );
}

/**
 * Back, the car, the reference and the chips on one line, the booked date
 * under it (owner, Oct 22 2026). The payment chip is left off while the
 * status line below says the same thing.
 *
 * The Booked / Paid / Picked up / Returned rail that sat under this is gone:
 * payment and pickup happen in no fixed order (a car goes out on an
 * instalment plan before it is paid off), so the rail drew ticks after an
 * unticked step, and the chips already say where the rental is.
 */
function RentalHeader({ rental }: { rental: CustomerRentalDetail }) {
  const money = useRentalMoney(rental);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <BackLink />
        <h1 className="font-heading text-2xl font-bold tracking-normal text-pv-fg sm:text-3xl">
          {rental.vehicle?.displayName ?? 'Your rental'}
        </h1>
        <span className="text-[15px] tabular-nums text-pv-muted-fg">{rental.reference}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <RentalStatusChip lifecycle={rental.lifecycle} />
          {/* An "unpaid" chip only ever came from `rentals.payment_status`,
              which goes stale; what is owed is the line below, from the ledger. */}
          {money === null && rental.paymentState !== 'unpaid' ? <PaymentStatusChip state={rental.paymentState} /> : null}
          {rental.isExtended ? <StatusChip tone="info">Extended</StatusChip> : null}
        </span>
      </div>
      {rental.createdAt ? (
        <p className="text-sm text-pv-muted-fg">Booked {formatTimestamp(rental.createdAt)}</p>
      ) : null}
    </div>
  );
}

/**
 * What this rental still owes, from the ledger Finances reads, and the one
 * thing to do about it; null when nothing is owed.
 */
function useRentalMoney(rental: CustomerRentalDetail): {
  amount: number;
  overdue: boolean;
  dueDate: string | null;
  action: 'pay' | 'plan';
} | null {
  const { payableBalances, activePlans, isLoading } = useCustomerPayments();
  if (rental.lifecycle === 'cancelled' || isLoading) return null;

  const row = payableBalances.find((candidate) => candidate.rentalId === rental.id);
  if (row) {
    const onPlan = row.blockedReason !== null || activePlans.some((plan) => plan.rentalId === rental.id);
    return { amount: row.amount, overdue: row.isOverdue, dueDate: row.nextDueDate, action: onPlan ? 'plan' : 'pay' };
  }
  return null;
}

/**
 * This rental's money, as an alert stripe (alert-bar.tsx): the amount, and Pay
 * right there — the customer pays every rental here, including ones the
 * operator created. A plan-collected balance says so instead.
 */
function MoneyLine({ rental }: { rental: CustomerRentalDetail }) {
  const { formatCurrency } = useTenantBranding();
  const money = useRentalMoney(rental);
  if (money === null) return null;

  const title = money.overdue
    ? `${formatCurrency(money.amount)} is overdue${money.dueDate ? ` since ${formatDate(money.dueDate)}` : ''}`
    : `${formatCurrency(money.amount)} to pay${money.dueDate ? ` by ${formatDate(money.dueDate)}` : ''}`;

  return (
    <AlertStripe
      item={{
        key: 'money',
        variant: money.overdue ? 'red' : 'yellow',
        title,
        description: money.action === 'pay' ? 'Pay it by card now' : 'Your instalment plan collects it from your card on each due date',
        action: money.action === 'pay' ? { label: 'Pay now', payRentalId: rental.id } : undefined,
      }}
    />
  );
}

/* ─────────────────────────────── the detail ────────────────────────────── */

/** A card in the operator's form: the shared Card, a titled header over a rule, then rows. */
function DetailCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardHeader className="border-b border-pv-border py-4">
        <CardTitle>{title}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      {children}
    </Card>
  );
}

/** A label beside a value, at the operator's table row height. */
function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-pv-border px-6 py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-[13px] text-pv-muted-fg sm:w-36">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-pv-fg">
        {value}
        {hint ? <span className="mt-0.5 block text-xs font-normal text-pv-muted-fg">{hint}</span> : null}
      </dd>
    </div>
  );
}

function BookingDetail({ rental }: { rental: CustomerRentalDetail }) {
  const { formatCurrency, distanceLabel } = useTenantBranding();
  const { tenant } = useTenant();

  const vehicleName = rental.vehicle?.displayName ?? 'Vehicle';

  const specs = [
    rental.vehicle?.year ? String(rental.vehicle.year) : null,
    rental.vehicle?.colour,
    rental.vehicle?.fuelType,
    rental.vehicle?.category,
  ].filter((value): value is string => typeof value === 'string' && value !== '');

  // Derived from the allowance THIS booking was sold (override-aware), not from
  // the vehicle's current listing. `null` back from the engine means the tier is
  // unlimited, which is a different statement from "we do not know".
  const allowance =
    rental.nights !== null
      ? calculateTotalMileageAllowance(
          {
            daily_mileage: rental.mileage.daily,
            weekly_mileage: rental.mileage.weekly,
            monthly_mileage: rental.mileage.monthly,
          },
          rental.nights,
          tenant?.monthly_tier_days ?? 30,
        )
      : null;

  const delivered = rental.deliveryMethod === 'delivery' || !!rental.deliveryAddress;
  const pickupPlace = rental.deliveryAddress ?? rental.pickupLocation;
  const returnPlace = rental.collectionAddress ?? rental.returnLocation;
  const nights = formatNights(rental.nights);

  return (
    <>
      {/* ── Anything the customer must know before the detail ────────────── */}
      {rental.lifecycle === 'cancelled' ? (
        <AlertStripe
          item={{
            key: 'cancelled',
            variant: 'red',
            title: 'This rental was cancelled',
            description: rental.cancellationReason ?? 'If you did not expect this, contact us and we will look into it',
          }}
        />
      ) : rental.cancellationRequested ? (
        <AlertStripe
          item={{
            key: 'cancel-requested',
            variant: 'yellow',
            title: 'Cancellation requested',
            description: 'We have your request. The rental stays active until we confirm it',
          }}
        />
      ) : (
        <MoneyLine rental={rental} />
      )}

      <DocumentsPanel rental={rental} />

      {/*
        Two columns that end level: the car and when & where on the left, the
        price on the right with "Book another car" under it. The payment, with
        its progress drawn, runs the full width beneath both.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-stretch">
        {/* ── Left column: the record ──────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Vehicle */}
          <Card className="gap-0 py-0">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <span className="grid aspect-[16/10] w-full shrink-0 place-items-center overflow-hidden rounded-2xl bg-pv-tint sm:w-44">
                {rental.vehicle?.imageUrl ? (
                  <img
                    src={rental.vehicle.imageUrl}
                    alt={vehicleName}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div>
                  <p className="font-heading text-base font-semibold text-pv-fg">{vehicleName}</p>
                  {rental.vehicle?.registration ? (
                    <p className="mt-0.5 text-[13px] text-pv-muted-fg">{rental.vehicle.registration}</p>
                  ) : null}
                </div>

                {specs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {specs.map((spec) => (
                      <span
                        key={spec}
                        className="inline-flex h-6 items-center rounded-full bg-pv-tint px-2.5 text-[12px] font-medium text-pv-fg/75"
                      >
                        {spec}
                      </span>
                    ))}
                  </div>
                ) : null}

                <p className="flex items-start gap-2 text-[13px] leading-relaxed text-pv-muted-fg">
                  <span>
                    {rental.isUnlimitedMileage ? (
                      <span className="font-medium text-pv-fg">Unlimited mileage included</span>
                    ) : allowance !== null ? (
                      <>
                        <span className="font-medium text-pv-fg">
                          {allowance.toLocaleString()}
                          {distanceLabel ? ` ${distanceLabel}` : ''} included
                        </span>
                        {rental.mileage.excessRate !== null && rental.mileage.excessRate > 0 ? (
                          <>
                            {' · '}
                            {formatCurrency(rental.mileage.excessRate)} per extra {distanceLabel ?? 'unit'}
                          </>
                        ) : null}
                      </>
                    ) : (
                      'Mileage allowance is confirmed on your rental agreement.'
                    )}
                  </span>
                </p>
              </div>
            </div>
          </Card>

          {/* When & where — one card, because the customer reads them together:
              when do I collect it, and from where. Grows to meet the right column. */}
          <DetailCard title={delivered ? 'When & where · delivery' : 'When & where'} className="flex-1">
            <dl>
              <Row
                label="Rental period"
                value={formatBookingDates(rental.startDate, rental.endDate)}
                hint={nights ? `${nights}${rental.periodType ? ` · ${rental.periodType} rate` : ''}` : undefined}
              />
              <Row label="Pick up" value={formatDateTime(rental.startDate, rental.pickupTime)} />
              <Row label="Return" value={formatDateTime(rental.endDate, rental.returnTime)} />
              {/* Only on an extended booking — elsewhere `previous_end_date` is null and the row drops. */}
              <Row
                label="Originally due back"
                value={rental.isExtended ? formatDate(rental.previousEndDate) : null}
                hint={rental.isExtended ? 'This rental was extended.' : undefined}
              />
              <Row
                label={delivered ? 'Delivered to' : 'Pick up from'}
                value={pickupPlace}
                hint={rental.deliveryFee && rental.deliveryFee > 0 ? `Delivery ${formatCurrency(rental.deliveryFee)}` : undefined}
              />
              <Row
                label={rental.collectionAddress ? 'Collected from' : 'Return to'}
                value={returnPlace}
                hint={
                  rental.collectionFee && rental.collectionFee > 0 ? `Collection ${formatCurrency(rental.collectionFee)}` : undefined
                }
              />
              {rental.extras.length > 0 ? (
                <Row
                  label="Extras"
                  value={rental.extras.map((extra) => `${extra.name}${extra.quantity > 1 ? ` × ${extra.quantity}` : ''}`).join(', ')}
                />
              ) : null}
            </dl>
            {/* No place recorded on either end: say so, rather than leave a gap. */}
            {!pickupPlace && !returnPlace ? (
              <p className="flex items-start gap-2 border-t border-pv-border px-6 py-3 text-[13px] leading-relaxed text-pv-muted-fg">
                No pick-up or return address is recorded on this rental. Contact us if you need it.
              </p>
            ) : null}
          </DetailCard>
        </div>

        {/* ── Right column: the price ───────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <DetailCard title="Price breakdown" className="flex-1">
            <div className="px-6 py-2">
              {rental.breakdown.lines.map((line) => (
                <div key={line.key} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 text-[13px] text-pv-muted-fg">
                    {line.label}
                    {line.caption ? <span className="mt-0.5 block text-[12px] text-pv-muted-fg/80">{line.caption}</span> : null}
                  </span>
                  <span
                    className={cn('shrink-0 text-[13px] font-medium tabular-nums', line.isCredit ? 'text-pv-success' : 'text-pv-fg')}
                  >
                    {line.isCredit ? '−' : ''}
                    {formatCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-auto border-t border-pv-border px-6 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold text-pv-fg">Total</span>
                <span className="text-[22px] font-bold tracking-[-0.02em] tabular-nums text-pv-fg">
                  {formatCurrency(rental.breakdown.total)}
                </span>
              </div>
              {!rental.breakdown.fromInvoice ? (
                <p className="mt-2 text-[12px] leading-relaxed text-pv-muted-fg">
                  We do not have an itemised invoice for this rental, so this is the agreed total only. Ask us for a
                  breakdown any time.
                </p>
              ) : null}
              {rental.breakdown.securityDeposit > 0 ? (
                <p className="mt-2 text-[12px] leading-relaxed text-pv-muted-fg">
                  Includes a {formatCurrency(rental.breakdown.securityDeposit)} security deposit, refunded after the car
                  comes back.
                </p>
              ) : null}
            </div>
          </DetailCard>

          <Link href="/booking" className={cn(V2_BUTTON_OUTLINE, 'h-11 w-full')}>
            Book another car
          </Link>
        </div>
      </div>

      <PaymentCard rental={rental} />
    </>
  );
}

/**
 * The payment, drawn: on an instalment plan, the plan's instalments as the
 * segmented bar with each one's amount, date and state; otherwise one bar of
 * what has been paid of the total. Beside it the invoice facts. Status is not
 * repeated: it is the header chip or the alert above.
 */
function PaymentCard({ rental }: { rental: CustomerRentalDetail }) {
  const { payableBalances, activePlans, isLoading } = useCustomerPayments();
  if (isLoading || rental.lifecycle === 'cancelled') return null;

  const plan = activePlans.find((candidate) => candidate.rentalId === rental.id) ?? null;
  const owed = payableBalances.find((row) => row.rentalId === rental.id)?.amount ?? 0;
  const paid = Math.max(0, rental.breakdown.total - owed);

  const facts = [
    { label: 'Invoice', value: rental.breakdown.invoiceNumber },
    { label: 'Issued', value: formatDate(rental.breakdown.invoiceDate) },
    { label: 'Due', value: formatDate(rental.breakdown.dueDate) },
    { label: 'Promo code', value: rental.promoCode },
  ].filter((fact): fact is { label: string; value: string } => typeof fact.value === 'string' && fact.value !== '');

  return (
    <DetailCard
      title={plan ? 'Payment · instalment plan' : 'Payment'}
      action={
        plan ? (
          <span className="text-[13px] text-pv-muted-fg">
            <span className="font-semibold text-pv-fg">
              {plan.paidCount} of {plan.count}
            </span>{' '}
            paid · {plan.planTypeLabel.toLowerCase()}
          </span>
        ) : null
      }
    >
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">{plan ? <InstalmentTrack plan={plan} /> : <PaidBar paid={paid} total={rental.breakdown.total} />}</div>
        {facts.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:border-l lg:border-pv-border lg:pl-6">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[12px] text-pv-muted-fg">{fact.label}</dt>
                <dd className="truncate text-sm font-medium tabular-nums text-pv-fg" title={fact.value}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </DetailCard>
  );
}

/* ─────────────────────────── the document gate ─────────────────────────── */

/**
 * Copy per completion state.
 *
 * ── THE COPY RULE, AND WHY IT IS ABSOLUTE ───────────────────────────────────
 * Uploading documents does NOT confirm a booking. The operator can still reject
 * it, and the confirmation email is sent from the APPROVAL step, not from the
 * upload. So nothing on the `submitted` rung may say "confirmed", "complete",
 * "all done" or any synonym — a customer who reads that and stops watching
 * their inbox will not see a rejection. Only `approved` — which is the state
 * the confirmation email is keyed on — is allowed to use the word.
 *
 * `awaiting_payment` and `cancelled` are absent by design: the payment notice
 * above already owns the first, and a dead booking is not waiting on anything.
 */
const DOCUMENT_STEP: Partial<
  Record<
    BookingCompletionState,
    {
      title: string;
      tone: 'warning' | 'info' | 'success';
      /** Chip text mirroring the state, so the panel says it as well as shows it. */
      chip: string;
    }
  >
> = {
  awaiting_documents: {
    title: 'We need your documents',
    tone: 'warning',
    chip: 'Action needed',
  },
  documents_in_review: {
    // Not "Documents complete". Received is a fact; complete is a verdict we
    // have not reached yet.
    title: 'Documents received — being checked',
    tone: 'info',
    chip: 'Under review',
  },
  awaiting_approval: {
    title: 'Documents accepted — with our team',
    tone: 'info',
    chip: 'Under review',
  },
  approved: {
    title: 'Rental confirmed',
    tone: 'success',
    chip: 'Confirmed',
  },
};

/**
 * Where the booking has got to on the document gate, and whose move it is.
 *
 * ── NO UPLOAD BUTTON HERE, DELIBERATELY ─────────────────────────────────────
 * The upload surface is the tokenised public route from the emailed link, and
 * this page has no token — it is reached from a session. A button here could
 * not mint one, so it would either dead-end or need this page to become a
 * writer of verification state, which it must never be (`identity_verifications`
 * has RLS off and grants anon UPDATE, so anything the browser writes there can
 * be made to lie). Pointing at the email is the only honest option.
 *
 * ── ONLY FOR BOOKINGS THAT ACTUALLY HAVE A GATE ─────────────────────────────
 * `documents_status` defaults to 'not_required', which is what every rental an
 * operator creates in the portal carries, and what every booking taken before
 * this flow existed carries. Rendering "your booking is not complete until we
 * have your documents" against one of those would invent a requirement that
 * was never asked of that customer, so the panel is silent unless the gate is
 * really open on this booking.
 */
function DocumentsPanel({ rental }: { rental: CustomerRentalDetail }) {
  const { email } = useCustomer();

  const documents = (rental.documentsStatus ?? '').trim().toLowerCase();
  // 'not_required' and anything unrecognised: no gate, so nothing to say.
  const gated =
    documents === 'pending' ||
    documents === 'submitted' ||
    documents === 'verified' ||
    documents === 'rejected';
  if (!gated) return null;

  const state = bookingCompletionState(rental);
  const step = DOCUMENT_STEP[state];
  // 'awaiting_payment' and 'cancelled' fall out here — see DOCUMENT_STEP.
  if (!step) return null;

  // Don't celebrate a rental that is already over. 'approved' stays true for
  // the life of the row, so without this a booking returned six months ago
  // still leads with "Booking confirmed". The three states that are still
  // waiting on somebody are shown whatever the dates say — a paid booking
  // whose documents never arrived stays open on purpose, and hiding the ask
  // once its start date slips past would bury exactly the rows that need
  // chasing.
  if (
    state === 'approved' &&
    (rental.lifecycle === 'completed' || rental.lifecycle === 'cancelled')
  ) {
    return null;
  }

  // The address the link was sent to. `useCustomer` reads `customers.email`,
  // which is the same row the booking hangs off (`rentals.customer_id`), so
  // this really is where it went. Falls back to a description rather than a
  // blank when the profile has no email on it.
  const sentTo = email && email.trim() !== '' ? email.trim() : null;

  return (
    <Panel
      className={cn(
        step.tone === 'warning' && 'border-pv-warning/40',
        step.tone === 'success' && 'border-pv-success/40',
      )}
    >
      <div className="flex items-start gap-3.5 px-4 py-4 sm:px-5">

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-pv-fg">{step.title}</h2>
            <StatusChip
              tone={step.tone === 'warning' ? 'warning' : step.tone === 'success' ? 'success' : 'info'}
            >
              {step.chip}
            </StatusChip>
          </div>

          {state === 'awaiting_documents' ? (
            <div className="mt-1.5 flex flex-col gap-1.5 text-[14px] leading-relaxed text-pv-muted-fg">
              <p>
                Your rental is paid, but it is <strong className="font-semibold text-pv-fg">not complete</strong>{' '}
                until we have your driving licence and a photo of yourself. We
                sent a secure upload link to{' '}
                {sentTo ? (
                  <span className="font-medium text-pv-fg">{sentTo}</span>
                ) : (
                  'the email address on your rental'
                )}
                .
              </p>
              {/*
                7 days, per the product decision — and an expired link is a
                recoverable state, not a dead end: the page it opens offers to
                send a fresh one. Saying so here stops a customer who is a week
                late from assuming they have to start again.
              */}
              <p className="text-pv-muted-fg">
                The link lasts 7 days. If yours has expired, open it anyway and
                it will offer to email you a new one. Cannot find it? Check your
                spam folder, or contact us and we will send it again.
              </p>
            </div>
          ) : state === 'documents_in_review' ? (
            <p className="mt-1.5 text-[14px] leading-relaxed text-pv-muted-fg">
              Thank you — we have your documents and are checking them now.
              There is nothing else for you to do. We will email you as soon as
              your rental is confirmed.
            </p>
          ) : state === 'awaiting_approval' ? (
            <p className="mt-1.5 text-[14px] leading-relaxed text-pv-muted-fg">
              Your documents have been accepted. Your rental is with our team
              for a final check, and we will email you as soon as it is
              confirmed.
            </p>
          ) : (
            <p className="mt-1.5 text-[14px] leading-relaxed text-pv-muted-fg">
              {/*
                Only claim the documents were accepted when they actually were.
                An operator may approve over unverified documents ("Approve
                Anyway"), which lands here with `documents_status` still
                'pending' or 'submitted' — the booking is genuinely confirmed,
                but saying their documents cleared would be a second, false
                statement riding on a true one.
              */}
              {documents === 'verified'
                ? 'Your documents were accepted and your rental is confirmed'
                : 'Your rental is confirmed'}
              {documents === 'verified' && rental.documentsCompletedAt
                ? ` — documents cleared ${formatTimestamp(rental.documentsCompletedAt)}`
                : ''}
              . We will be in touch with your pick-up details.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-44 w-full rounded-2xl bg-pv-tint" />
          <Skeleton className="h-64 w-full rounded-2xl bg-pv-tint" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl bg-pv-tint" />
      </div>
    </div>
  );
}
