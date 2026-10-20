'use client';

/**
 * One booking, read-only — a calmer version of the operator portal v2 rental
 * record (components/rentals-v2/rental-detail): a page header naming the car,
 * a short stage rail saying where the booking has got to, then the record in
 * cards — the car, when and where, extras — with the money in a column of its
 * own beside them.
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
import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Gauge,
  IdCard,
  MapPin,
  Package,
  Receipt,
} from 'lucide-react-nw';

import { formatDate, formatDateTime, formatTimestamp } from '@nw/components/portal/format';
import { formatBookingDates, formatNights } from '@nw/portal-v2/rentals/format';
import {
  DetailList,
  DetailRow,
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
  PanelHeader,
} from '@nw/portal-v2/primitives';
import { PaymentStatusChip, RentalStatusChip, StatusChip } from '@nw/portal-v2/status-chip';
import { Button } from '@nw/components/ui/button';
import { Skeleton } from '@nw/components/ui/skeleton';
import { useCustomer } from '@nw/hooks/use-customer';
import { useCustomerRental } from '@nw/hooks/use-customer-rental';
import type { CustomerRentalDetail } from '@nw/hooks/use-customer-rental';
import { bookingCompletionState, type BookingCompletionState } from '@nw/hooks/use-customer-rentals';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { useTenant } from '@nw/contexts/TenantContext';
import { calculateTotalMileageAllowance } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/portal/rentals"
          className={cn(
            '-ml-2 inline-flex h-9 w-fit items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
            HOVER_FADE,
          )}
        >
          <ArrowLeft aria-hidden className="size-4" />
          All rentals
        </Link>

        {isError || isLoading || notFound || !rental ? (
          <PageHeader
            title={isLoading ? 'Your rental' : 'Rental'}
            description="The car, your dates and pickup, and what you paid."
          />
        ) : (
          <PageHeader
            title={rental.vehicle?.displayName ?? 'Your rental'}
            description={`Rental ${rental.reference}${
              rental.createdAt ? `, made ${formatTimestamp(rental.createdAt)}` : ''
            }. Your dates, pickup and what you paid.`}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <RentalStatusChip lifecycle={rental.lifecycle} />
                <PaymentStatusChip state={rental.paymentState} />
                {rental.isExtended ? <StatusChip tone="info">Extended</StatusChip> : null}
              </div>
            }
          />
        )}
      </div>

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

/* ─────────────────────────────── stage rail ────────────────────────────── */

/**
 * Where the booking has got to, as four steps — the operator record's stage
 * rail, reduced to the moments a customer lives through. Every step is read
 * straight off fields the page already has (`paymentState`, `lifecycle`);
 * nothing is inferred, so the rail can never say a car was collected that was
 * not. The first step not yet done is the one marked as current.
 *
 * Not drawn for a cancelled booking: the cancellation notice is the whole story.
 */
function StageRail({ rental }: { rental: CustomerRentalDetail }) {
  const pickedUp = rental.lifecycle === 'on_rent' || rental.lifecycle === 'completed';
  const steps = [
    { key: 'booked', label: 'Booked', done: true },
    {
      key: 'paid',
      label: rental.paymentState === 'refunded' ? 'Refunded' : 'Paid',
      done: rental.paymentState === 'paid' || rental.paymentState === 'refunded',
    },
    { key: 'pickup', label: 'Picked up', done: pickedUp },
    { key: 'return', label: 'Returned', done: rental.lifecycle === 'completed' },
  ];
  const currentIndex = steps.findIndex((step) => !step.done);

  return (
    <Panel className="px-4 py-4 sm:px-6">
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const current = index === currentIndex;
          return (
            <li key={step.key} className={cn('flex items-center', index < steps.length - 1 && 'flex-1')}>
              <span className="flex flex-col items-center gap-1.5 sm:flex-row sm:gap-2.5">
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums',
                    step.done
                      ? 'bg-pv-primary text-white'
                      : current
                        ? 'bg-pv-card text-pv-primary ring-2 ring-pv-primary'
                        : 'bg-pv-muted text-pv-muted-fg',
                  )}
                >
                  {step.done ? <Check aria-hidden className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    'whitespace-nowrap text-[12px] sm:text-[13px]',
                    step.done || current ? 'font-semibold text-pv-fg' : 'font-medium text-pv-muted-fg',
                  )}
                >
                  {step.label}
                  <span className="sr-only">{step.done ? ' (done)' : current ? ' (next)' : ''}</span>
                </span>
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'mx-2 mb-5 h-0.5 flex-1 rounded-full sm:mx-4 sm:mb-0',
                    step.done && steps[index + 1].done ? 'bg-pv-primary' : 'bg-pv-border',
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ─────────────────────────────── the detail ────────────────────────────── */

/** A label and a value on one line, for the narrow money column. */
function SideRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-pv-muted-fg">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[13px] font-medium text-pv-fg">{value}</dd>
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
        <Notice tone="danger" title="This rental was cancelled">
          {rental.cancellationReason
            ? `Reason recorded: ${rental.cancellationReason}.`
            : 'If you did not expect this, contact us and we will look into it.'}
        </Notice>
      ) : rental.cancellationRequested ? (
        <Notice tone="warning" title="Cancellation requested">
          We have your request and are processing it. The rental stays active until we confirm.
        </Notice>
      ) : rental.paymentState === 'unpaid' ? (
        <Notice tone="warning" title="Payment outstanding">
          {formatCurrency(rental.breakdown.total)} has not been settled yet. Your reservation is not
          confirmed until it clears — contact us if you have already paid.
        </Notice>
      ) : null}

      {rental.lifecycle !== 'cancelled' ? <StageRail rental={rental} /> : null}

      <DocumentsPanel rental={rental} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* ── Left column: the record ───────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Vehicle */}
          <Panel className="overflow-hidden">
            <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
              <span className="grid aspect-[16/10] w-full shrink-0 place-items-center overflow-hidden rounded-xl bg-pv-tint sm:w-52">
                {rental.vehicle?.imageUrl ? (
                  <img
                    src={rental.vehicle.imageUrl}
                    alt={vehicleName}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <CarFront aria-hidden strokeWidth={1.5} className="size-8 text-pv-primary" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div>
                  <p className="text-[18px] font-semibold tracking-[-0.01em] text-pv-fg">{vehicleName}</p>
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
                  <Gauge aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
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
          </Panel>

          {/* When & where — one card, because the customer reads them together:
              when do I collect it, and from where. */}
          <Panel>
            <PanelHeader title={delivered ? 'When & where · delivery' : 'When & where'} />
            <div className="px-4 sm:px-5">
              <DetailList>
                <DetailRow
                  label="Rental period"
                  value={formatBookingDates(rental.startDate, rental.endDate)}
                  hint={
                    nights ? `${nights}${rental.periodType ? ` · ${rental.periodType} rate` : ''}` : undefined
                  }
                />
                <DetailRow label="Pick up" value={formatDateTime(rental.startDate, rental.pickupTime)} />
                <DetailRow label="Return" value={formatDateTime(rental.endDate, rental.returnTime)} />
                {/*
                  Only meaningful on an extended booking — on every other rental
                  `previous_end_date` is null, and `DetailRow` drops the row.
                */}
                <DetailRow
                  label="Originally due back"
                  value={rental.isExtended ? formatDate(rental.previousEndDate) : null}
                  hint={rental.isExtended ? 'This rental was extended.' : undefined}
                />
                <DetailRow
                  label={delivered ? 'Delivered to' : 'Pick up from'}
                  value={pickupPlace}
                  hint={
                    rental.deliveryFee && rental.deliveryFee > 0
                      ? `Delivery ${formatCurrency(rental.deliveryFee)}`
                      : undefined
                  }
                />
                <DetailRow
                  label={rental.collectionAddress ? 'Collected from' : 'Return to'}
                  value={returnPlace}
                  hint={
                    rental.collectionFee && rental.collectionFee > 0
                      ? `Collection ${formatCurrency(rental.collectionFee)}`
                      : undefined
                  }
                />
              </DetailList>
              {/* No place recorded on either end: say so, rather than leave a
                  card with a header and nothing under it. */}
              {!pickupPlace && !returnPlace ? (
                <p className="flex items-start gap-2 border-t border-pv-border py-3 text-[13px] leading-relaxed text-pv-muted-fg">
                  <MapPin aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
                  No pick-up or return address is recorded on this rental. Contact us if you need it.
                </p>
              ) : null}
            </div>
          </Panel>

          {/* Extras — what was bought, not what it cost. The money is in the
              breakdown; repeating it here would give two places to disagree. */}
          {rental.extras.length > 0 ? (
            <Panel>
              <PanelHeader title="Extras" />
              <ul className="divide-y divide-pv-border">
                {rental.extras.map((extra) => (
                  <li key={extra.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-pv-tint">
                      <Package aria-hidden strokeWidth={1.75} className="size-4 text-pv-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-pv-fg">
                        {extra.name}
                        {extra.quantity > 1 ? (
                          <span className="text-pv-muted-fg">
                            {' × '}
                            {extra.quantity}
                          </span>
                        ) : null}
                      </p>
                      {extra.description ? (
                        <p className="mt-0.5 text-[13px] leading-relaxed text-pv-muted-fg">{extra.description}</p>
                      ) : null}
                    </div>
                    {extra.perDay ? <span className="shrink-0 text-[12px] text-pv-muted-fg">per day</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        {/* ── Right column: the money ───────────────────────────────────── */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-2">
          <Panel>
            <PanelHeader title="Price breakdown" />
            <div className="px-4 py-1.5 sm:px-5">
              {rental.breakdown.lines.map((line) => (
                <div key={line.key} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 text-[13px] text-pv-muted-fg">
                    {line.label}
                    {line.caption ? <span className="mt-0.5 block text-[12px] text-pv-muted-fg/80">{line.caption}</span> : null}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[13px] font-medium tabular-nums',
                      line.isCredit ? 'text-pv-success' : 'text-pv-fg',
                    )}
                  >
                    {line.isCredit ? '−' : ''}
                    {formatCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-pv-border px-4 py-4 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold text-pv-fg">Total</span>
                <span className="text-[22px] font-bold tracking-[-0.02em] tabular-nums text-pv-fg">
                  {formatCurrency(rental.breakdown.total)}
                </span>
              </div>
              {!rental.breakdown.fromInvoice ? (
                <p className="mt-2 text-[12px] leading-relaxed text-pv-muted-fg">
                  We do not have an itemised invoice for this rental, so this is the agreed total only. Ask us for
                  a breakdown any time.
                </p>
              ) : null}
              {rental.breakdown.securityDeposit > 0 ? (
                <p className="mt-2 text-[12px] leading-relaxed text-pv-muted-fg">
                  Includes a {formatCurrency(rental.breakdown.securityDeposit)} security deposit, refunded after the
                  car comes back.
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Payment" />
            <dl className="divide-y divide-pv-border px-4 sm:px-5">
              <SideRow label="Status" value={<PaymentStatusChip state={rental.paymentState} />} />
              <SideRow label="Invoice" value={rental.breakdown.invoiceNumber} />
              <SideRow label="Issued" value={formatDate(rental.breakdown.invoiceDate)} />
              <SideRow label="Due" value={formatDate(rental.breakdown.dueDate)} />
              <SideRow label="Promo code" value={rental.promoCode} />
            </dl>
            <div className="border-t border-pv-border px-4 py-3.5 sm:px-5">
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-pv-muted-fg">
                <Receipt aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
                <span>
                  Receipts and saved payment methods are moving into this portal shortly. In the meantime, email us
                  for a copy of any invoice.
                </span>
              </p>
            </div>
          </Panel>

          <Button asChild variant="brand-outline" className="h-11 w-full">
            <Link href="/booking">Book another car</Link>
          </Button>
        </div>
      </div>
    </>
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
      icon: typeof IdCard;
      /** Chip text mirroring the state, so the panel says it as well as shows it. */
      chip: string;
    }
  >
> = {
  awaiting_documents: {
    title: 'We need your documents',
    tone: 'warning',
    icon: IdCard,
    chip: 'Action needed',
  },
  documents_in_review: {
    // Not "Documents complete". Received is a fact; complete is a verdict we
    // have not reached yet.
    title: 'Documents received — being checked',
    tone: 'info',
    icon: Clock,
    chip: 'Under review',
  },
  awaiting_approval: {
    title: 'Documents accepted — with our team',
    tone: 'info',
    icon: Clock,
    chip: 'Under review',
  },
  approved: {
    title: 'Rental confirmed',
    tone: 'success',
    icon: CircleCheck,
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

  const Icon = step.icon;

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
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'mt-0.5 size-5 shrink-0',
            step.tone === 'warning' && 'text-pv-warning',
            step.tone === 'info' && 'text-pv-primary',
            step.tone === 'success' && 'text-pv-success',
          )}
        />
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

/* ──────────────────────────────── notices ──────────────────────────────── */

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warning' | 'danger';
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === 'danger' ? CircleAlert : CalendarDays;
  return (
    <div
      className={cn(
        'flex items-start gap-3.5 rounded-2xl border px-4 py-4 sm:px-5',
        tone === 'danger' ? 'border-pv-danger/25 bg-pv-danger-light' : 'border-pv-warning/30 bg-pv-warning-light',
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn('mt-0.5 size-5 shrink-0', tone === 'danger' ? 'text-pv-danger' : 'text-pv-warning')}
      />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-pv-fg">{title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-pv-fg/75">{children}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <Skeleton className="h-[60px] w-full rounded-2xl bg-pv-tint" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-44 w-full rounded-2xl bg-pv-tint" />
          <Skeleton className="h-64 w-full rounded-2xl bg-pv-tint" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl bg-pv-tint" />
      </div>
    </div>
  );
}
