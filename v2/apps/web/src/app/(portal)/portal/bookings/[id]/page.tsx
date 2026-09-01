'use client';

/**
 * One booking, read-only.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * This page shows what the customer bought: the car, the dates and places, what
 * they were charged, what extras they picked, and whether the money landed. It
 * takes no actions — no cancel, no extend, no re-pay, no document signing. That
 * is deliberate. v1's equivalent is ~1,466 lines because it also owns the
 * extension checkout, the installment schedule, the BoldSign envelope and the
 * cancellation request; each of those is a WRITE against money or a contract
 * and none can be bolted on safely as a side-effect of a detail view. See the
 * handoff notes for the exact list left out.
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
  CircleAlert,
  CircleCheck,
  Clock,
  Gauge,
  IdCard,
  Package,
  Receipt,
} from 'lucide-react';

import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatTimestamp,
} from '@/components/portal/format';
import {
  DetailList,
  DetailRow,
  EmptyState,
  LoadError,
  Panel,
  PanelHeader,
} from '@/components/portal/primitives';
import {
  PaymentStatusChip,
  RentalStatusChip,
  StatusChip,
} from '@/components/portal/status-chip';
import { VehiclePhoto } from '@/components/fleet/vehicle-photo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomer } from '@/hooks/use-customer';
import { useCustomerRental } from '@/hooks/use-customer-rental';
import type { CustomerRentalDetail } from '@/hooks/use-customer-rental';
import {
  bookingCompletionState,
  type BookingCompletionState,
} from '@/hooks/use-customer-rentals';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useTenant } from '@/contexts/TenantContext';
import { calculateTotalMileageAllowance } from '@/lib/domain';
import { cn } from '@/lib/utils';

export default function BookingDetailPage() {
  const params = useParams<{ id: string }>();
  // `useParams` types a catch-all as `string[]`; this segment is a single
  // `[id]`, but narrowing rather than asserting keeps the page honest if the
  // route ever changes shape.
  const rawId = params?.id;
  const rentalId = Array.isArray(rawId) ? rawId[0] : rawId;

  const { rental, notFound, isLoading, isError, error, refetch } =
    useCustomerRental(rentalId);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/portal/bookings"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-sm text-brand-text-soft transition-colors hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
      >
        <ArrowLeft aria-hidden strokeWidth={1.75} className="size-4" />
        All bookings
      </Link>

      {isError ? (
        <LoadError
          title="We could not load this booking"
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
            title="Booking not found"
            description="We could not find that booking on your account. It may have been made with a different email address."
            action={{ href: '/portal/bookings', label: 'Back to my bookings' }}
          />
        </Panel>
      ) : (
        <BookingDetail rental={rental} />
      )}
    </div>
  );
}

/* ─────────────────────────────── the detail ────────────────────────────── */

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

  return (
    <>
      {/* ── Heading ──────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <RentalStatusChip lifecycle={rental.lifecycle} />
          <PaymentStatusChip state={rental.paymentState} />
          {rental.isExtended ? <StatusChip tone="info">Extended</StatusChip> : null}
        </div>
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.02em] text-brand-text sm:text-3xl">
            {vehicleName}
          </h1>
          <p className="mt-1.5 text-sm text-brand-text-soft">
            {rental.reference}
            {rental.createdAt ? (
              <span className="text-brand-text-subtle">
                {' · booked '}
                {formatTimestamp(rental.createdAt)}
              </span>
            ) : null}
          </p>
        </div>
      </header>

      {/* ── Anything the customer must know before the detail ────────────── */}
      {rental.lifecycle === 'cancelled' ? (
        <Notice tone="danger" title="This booking was cancelled">
          {rental.cancellationReason
            ? `Reason recorded: ${rental.cancellationReason}.`
            : 'If you did not expect this, contact us and we will look into it.'}
        </Notice>
      ) : rental.cancellationRequested ? (
        <Notice tone="warning" title="Cancellation requested">
          We have your request and are processing it. The booking stays active
          until we confirm.
        </Notice>
      ) : rental.paymentState === 'unpaid' ? (
        <Notice tone="warning" title="Payment outstanding">
          {formatCurrency(rental.breakdown.total)} has not been settled yet. Your
          reservation is not confirmed until it clears — contact us if you have
          already paid.
        </Notice>
      ) : null}

      <DocumentsPanel rental={rental} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* ── Left column ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Vehicle */}
          <Panel className="overflow-hidden">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
              <VehiclePhoto
                url={rental.vehicle?.imageUrl ?? null}
                alt={vehicleName}
                className="w-full shrink-0 sm:aspect-auto sm:h-32 sm:w-44"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                  <p className="text-base font-medium text-brand-text">{vehicleName}</p>
                  {rental.vehicle?.registration ? (
                    <p className="mt-0.5 text-sm text-brand-text-soft">
                      {rental.vehicle.registration}
                    </p>
                  ) : null}
                </div>

                {specs.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {specs.map((spec) => (
                      <span
                        key={spec}
                        className="rounded-full bg-brand-stone px-2.5 py-1 text-xs text-brand-text-soft"
                      >
                        {spec}
                      </span>
                    ))}
                  </div>
                ) : null}

                <p className="flex items-start gap-2 text-xs leading-relaxed text-brand-text-soft">
                  <Gauge
                    aria-hidden
                    strokeWidth={1.75}
                    className="mt-px size-3.5 shrink-0 text-brand-text-subtle"
                  />
                  <span>
                    {rental.isUnlimitedMileage ? (
                      <span className="font-medium text-brand-text">
                        Unlimited mileage included
                      </span>
                    ) : allowance !== null ? (
                      <>
                        <span className="font-medium text-brand-text">
                          {allowance.toLocaleString()}
                          {distanceLabel ? ` ${distanceLabel}` : ''} included
                        </span>
                        {rental.mileage.excessRate !== null &&
                        rental.mileage.excessRate > 0 ? (
                          <>
                            {' · '}
                            {formatCurrency(rental.mileage.excessRate)} per extra{' '}
                            {distanceLabel ?? 'unit'}
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

          {/* Dates */}
          <Panel>
            <PanelHeader title="Dates" />
            <div className="px-4 sm:px-5">
              <DetailList>
                <DetailRow
                  label="Rental period"
                  value={formatDateRange(rental.startDate, rental.endDate)}
                  hint={
                    rental.nights !== null
                      ? `${rental.nights} day${rental.nights === 1 ? '' : 's'}${
                          rental.periodType ? ` · ${rental.periodType} rate` : ''
                        }`
                      : undefined
                  }
                />
                <DetailRow
                  label="Pick up"
                  value={formatDateTime(rental.startDate, rental.pickupTime)}
                />
                <DetailRow
                  label="Return"
                  value={formatDateTime(rental.endDate, rental.returnTime)}
                />
                {/*
                  Only meaningful on an extended booking — on every other rental
                  `previous_end_date` is null, and `DetailRow` drops the row.
                */}
                <DetailRow
                  label="Originally due back"
                  value={rental.isExtended ? formatDate(rental.previousEndDate) : null}
                  hint={rental.isExtended ? 'This booking was extended.' : undefined}
                />
              </DetailList>
            </div>
          </Panel>

          {/* Locations */}
          <Panel>
            <PanelHeader
              title={delivered ? 'Delivery & collection' : 'Pick up & return'}
            />
            <div className="px-4 sm:px-5">
              <DetailList>
                <DetailRow
                  label={delivered ? 'Delivered to' : 'Pick up from'}
                  value={rental.deliveryAddress ?? rental.pickupLocation}
                  hint={
                    rental.deliveryFee && rental.deliveryFee > 0
                      ? `Delivery ${formatCurrency(rental.deliveryFee)}`
                      : undefined
                  }
                />
                <DetailRow
                  label={rental.collectionAddress ? 'Collected from' : 'Return to'}
                  value={rental.collectionAddress ?? rental.returnLocation}
                  hint={
                    rental.collectionFee && rental.collectionFee > 0
                      ? `Collection ${formatCurrency(rental.collectionFee)}`
                      : undefined
                  }
                />
              </DetailList>
            </div>
          </Panel>

          {/* Extras — what was bought, not what it cost. The money is in the
              breakdown; repeating it here would give two places to disagree. */}
          {rental.extras.length > 0 ? (
            <Panel>
              <PanelHeader title="Extras" />
              <ul className="divide-y divide-brand-border-soft">
                {rental.extras.map((extra) => (
                  <li
                    key={extra.id}
                    className="flex items-start gap-3 px-4 py-3 sm:px-5"
                  >
                    <Package
                      aria-hidden
                      strokeWidth={1.75}
                      className="mt-0.5 size-4 shrink-0 text-brand-text-subtle"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-brand-text">
                        {extra.name}
                        {extra.quantity > 1 ? (
                          <span className="text-brand-text-subtle">
                            {' × '}
                            {extra.quantity}
                          </span>
                        ) : null}
                      </p>
                      {extra.description ? (
                        <p className="mt-0.5 text-xs leading-relaxed text-brand-text-soft">
                          {extra.description}
                        </p>
                      ) : null}
                    </div>
                    {extra.perDay ? (
                      <span className="shrink-0 text-xs text-brand-text-subtle">
                        per day
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        {/* ── Right column: the money ───────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Panel>
            <PanelHeader title="Price breakdown" />
            <div className="px-4 py-1 sm:px-5">
              {rental.breakdown.lines.map((line) => (
                <div
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="min-w-0 text-sm text-brand-text-soft">
                    {line.label}
                    {line.caption ? (
                      <span className="mt-0.5 block text-xs text-brand-text-subtle">
                        {line.caption}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-sm tabular-nums',
                      line.isCredit ? 'text-success' : 'text-brand-text',
                    )}
                  >
                    {line.isCredit ? '−' : ''}
                    {formatCurrency(line.amount)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-brand-border-soft px-4 py-3 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-brand-text">Total</span>
                <span className="text-lg font-semibold tabular-nums text-brand-text">
                  {formatCurrency(rental.breakdown.total)}
                </span>
              </div>
              {!rental.breakdown.fromInvoice ? (
                <p className="mt-2 text-xs leading-relaxed text-brand-text-subtle">
                  We do not have an itemised invoice for this booking, so this is
                  the agreed total only. Ask us for a breakdown any time.
                </p>
              ) : null}
              {rental.breakdown.securityDeposit > 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-brand-text-subtle">
                  Includes a {formatCurrency(rental.breakdown.securityDeposit)}{' '}
                  security deposit, refunded after the car comes back.
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Payment" />
            <div className="px-4 sm:px-5">
              <DetailList>
                <DetailRow
                  label="Status"
                  value={<PaymentStatusChip state={rental.paymentState} />}
                />
                <DetailRow label="Invoice" value={rental.breakdown.invoiceNumber} />
                <DetailRow
                  label="Issued"
                  value={formatDate(rental.breakdown.invoiceDate)}
                />
                <DetailRow label="Due" value={formatDate(rental.breakdown.dueDate)} />
                <DetailRow
                  label="Promo code"
                  value={rental.promoCode}
                />
              </DetailList>
            </div>
            <div className="border-t border-brand-border-soft px-4 py-3 sm:px-5">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-brand-text-subtle">
                <Receipt aria-hidden strokeWidth={1.75} className="mt-px size-3.5 shrink-0" />
                <span>
                  Receipts and saved payment methods are moving into this portal
                  shortly. In the meantime, email us for a copy of any invoice.
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
    title: 'Booking confirmed',
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
        step.tone === 'warning' && 'border-warning-med',
        step.tone === 'success' && 'border-success-med',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            'mt-0.5 size-5 shrink-0',
            step.tone === 'warning' && 'text-warning',
            step.tone === 'info' && 'text-info',
            step.tone === 'success' && 'text-success',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-brand-text">{step.title}</h2>
            <StatusChip
              tone={step.tone === 'warning' ? 'warning' : step.tone === 'success' ? 'success' : 'info'}
            >
              {step.chip}
            </StatusChip>
          </div>

          {state === 'awaiting_documents' ? (
            <div className="mt-1.5 flex flex-col gap-1.5 text-sm leading-relaxed text-brand-text-soft">
              <p>
                Your booking is paid, but it is <strong className="font-medium text-brand-text">not complete</strong>{' '}
                until we have your driving licence and a photo of yourself. We
                sent a secure upload link to{' '}
                {sentTo ? (
                  <span className="font-medium text-brand-text">{sentTo}</span>
                ) : (
                  'the email address on your booking'
                )}
                .
              </p>
              {/*
                7 days, per the product decision — and an expired link is a
                recoverable state, not a dead end: the page it opens offers to
                send a fresh one. Saying so here stops a customer who is a week
                late from assuming they have to start again.
              */}
              <p className="text-brand-text-subtle">
                The link lasts 7 days. If yours has expired, open it anyway and
                it will offer to email you a new one. Cannot find it? Check your
                spam folder, or contact us and we will send it again.
              </p>
            </div>
          ) : state === 'documents_in_review' ? (
            <p className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">
              Thank you — we have your documents and are checking them now.
              There is nothing else for you to do. We will email you as soon as
              your booking is confirmed.
            </p>
          ) : state === 'awaiting_approval' ? (
            <p className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">
              Your documents have been accepted. Your booking is with our team
              for a final check, and we will email you as soon as it is
              confirmed.
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed text-brand-text-soft">
              Your documents were accepted and your booking is confirmed
              {rental.documentsCompletedAt
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
        'flex items-start gap-3 rounded-[14px] border px-4 py-3.5',
        tone === 'danger'
          ? 'border-danger-subtle bg-danger-light'
          : 'border-warning-med bg-warning-light',
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'danger' ? 'text-danger' : 'text-warning',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-text">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-brand-text-soft">{children}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────────── skeleton ──────────────────────────────── */

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-8 w-56 bg-brand-stone" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full rounded-[14px] bg-brand-stone" />
          <Skeleton className="h-48 w-full rounded-[14px] bg-brand-stone" />
        </div>
        <Skeleton className="h-64 w-full rounded-[14px] bg-brand-stone" />
      </div>
    </div>
  );
}
