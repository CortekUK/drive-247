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
  Gauge,
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
import { useCustomerRental } from '@/hooks/use-customer-rental';
import type { CustomerRentalDetail } from '@/hooks/use-customer-rental';
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
