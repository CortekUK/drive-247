'use client';

/**
 * Template 2 ("Glass") — one car, and booking it (/template-2/booking/<id>),
 * opened from any car on the Template 2 pages.
 *
 *   the car     one glass pane, like the home page's car picker: the photos
 *               (arrows, swipe-free thumbnails, a "2 of 5" counter) beside the
 *               name, what kind of car it is, its rates by the day, week and
 *               month, the description and the specs, and "Choose your dates"
 *   the booking the form in a glass pane on the left; on the right, sticky,
 *               the trip at a glance, the itemised bill, the total and the
 *               button. On a phone: car, form, bill, with the total pinned to
 *               the foot of the screen
 *
 * The SAME brain as site-v2's page: everything — seeding, availability,
 * pricing, validation, the booking write, payment and the paid-booking
 * notice — is `useVehicleBooking`, and the form, bill and payment parts are
 * site-v2's own components. Inside `.g2-skin` (styles/site.css) their colour
 * tokens turn to glass, so they read as Template 2 without a second copy of
 * the booking logic to keep in step.
 */

import Link from 'next/link';
import { ArrowLeft, CalendarDays, CarFront, ChevronLeft, ChevronRight, ImageOff, RotateCw, TriangleAlert } from 'lucide-react-nw';

import { useVehicleGallery } from '@nw/components/booking/use-vehicle-gallery';
import { formatClockLabel, formatIsoDateLabel } from '@nw/components/booking/time-utils';
import { useVehicleBooking } from '@nw/components/booking/use-vehicle-booking';
import { describeVehicle } from '@nw/components/booking/vehicle-facts';
import { useTenantBranding } from '@nw/hooks/use-tenant-branding';
import { cn } from '@nw/lib/utils';
import type { Vehicle } from '@nw/lib/vehicles/types';
import { CheckoutTotal, MobileCheckoutBar, PriceBlock } from '@nw/site-v2/booking/booking-checkout';
import { BookingForm } from '@nw/site-v2/booking/booking-form';
import { PaymentPanel } from '@nw/site-v2/booking/payment-panel';
import { PaidBookingNotice } from '@nw/site-v2/booking/vehicle-booking-page';
import { t2Href } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const PAGE = 'mx-auto w-full max-w-[1320px] px-3 sm:px-5';
const RATE_COLUMNS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

export function Template2CarPage({ vehicleId }: { vehicleId: string }) {
  const {
    hydrated,
    tenantLoading,
    tenantError,
    vehicle,
    vehicleLoading,
    notFound,
    isError,
    refetch,
    form,
    validation,
    paidHandoff,
    paymentOpen,
    checkout,
    priceBlockProps,
    formProps,
    paymentPanelProps,
    handleFormBlur,
  } = useVehicleBooking(vehicleId);

  if (tenantError) {
    return <State icon={TriangleAlert} title="This site is not available" body={tenantError} />;
  }
  if (vehicleLoading || tenantLoading || !hydrated) return <Skeleton />;
  if (notFound) {
    return (
      <State icon={CarFront} title="We could not find that car" body="It may have been taken out of the fleet, or the link may be wrong.">
        <Link href={t2Href('/fleet')} className={cn('g2-cta inline-flex h-12 items-center rounded-full px-6 text-[15px] font-semibold', FOCUS)}>
          See all cars
        </Link>
      </State>
    );
  }
  if (isError || !vehicle) {
    return (
      <State icon={TriangleAlert} title="We could not load this car" body="Something went wrong on our side. Try again in a moment.">
        <button
          type="button"
          onClick={() => void refetch()}
          className={cn('g2-cta inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold', FOCUS)}
        >
          <RotateCw aria-hidden className="size-4" strokeWidth={2.25} />
          Try again
        </button>
      </State>
    );
  }

  const priceBlock = <PriceBlock {...priceBlockProps} />;

  return (
    <div className="pb-32 lg:pb-3">
      <section aria-labelledby="g2-car-title" className={cn(PAGE, 'pb-3 pt-[84px] sm:pt-[96px]')}>
        <CarPane vehicle={vehicle} />
      </section>

      <div className={cn(PAGE, 'g2-skin')}>
        {/* The durable surface after a payment: it may not say "confirmed". */}
        {paidHandoff !== null ? (
          <div className="g2-glass mb-3 rounded-[32px] p-3 sm:p-4 [&>div]:mt-0">
            <PaidBookingNotice handoff={paidHandoff} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-3">
            <div className="g2-glass rounded-[32px] p-3 sm:rounded-[40px] sm:p-5">
              <h2 className="px-2 pb-4 pt-3 text-center text-[26px] font-semibold tracking-[-0.04em] text-[var(--g2-ink)] sm:pt-4 sm:text-[32px]">
                Book this car.
              </h2>
              {/* One delegated `focusout` listener: the hook maps the control's id to its field. */}
              <div onBlur={handleFormBlur}>
                <BookingForm {...formProps} />
              </div>
            </div>
            {/* On a phone the bill follows the form that produces it. */}
            <div className="g2-glass rounded-[32px] p-3 lg:hidden">{priceBlock}</div>
          </div>

          {/* Sticky, capped to the screen: the bill scrolls inside, the total and button never leave. */}
          <aside className="hidden lg:sticky lg:top-[96px] lg:flex lg:max-h-[calc(100svh-108px)] lg:flex-col lg:self-start">
            <div className="g2-glass flex min-h-0 flex-1 flex-col rounded-[36px] p-3">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <Trip
                  pickupDate={form.pickupDate}
                  pickupTime={form.pickupTime}
                  dropoffDate={form.dropoffDate}
                  dropoffTime={form.dropoffTime}
                  rentalDays={validation.rentalDays}
                />
                {priceBlock}
              </div>
              <div className="shrink-0 pt-3">
                <CheckoutTotal {...checkout} />
              </div>
            </div>
          </aside>
        </div>

        {/* Unmounted, not hidden, while the payment dialog is open. */}
        {paymentOpen ? null : <MobileCheckoutBar {...checkout} />}
        <PaymentPanel {...paymentPanelProps} />
      </div>
    </div>
  );
}

/* ────────────────────────────── the car ────────────────────────────── */

function CarPane({ vehicle }: { vehicle: Vehicle }) {
  const { formatCurrency, distanceLabel } = useTenantBranding();
  const { categoryLabel, offeredRates, specs } = describeVehicle(vehicle, { formatCurrency, distanceLabel });
  const chips = [
    categoryLabel,
    vehicle.mileageIsUnlimited ? 'Unlimited mileage' : null,
    vehicle.isPaused ? 'Not taking bookings right now' : null,
  ].filter((chip): chip is string => chip !== null);

  return (
    <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        <Gallery vehicle={vehicle} />

        <div className="flex min-w-0 flex-col px-2 pb-2 sm:px-3 lg:py-3 lg:pr-4">
          <Link
            href={t2Href('/fleet')}
            className={cn(
              '-ml-1 inline-flex h-10 w-fit items-center gap-1.5 rounded-full px-1 text-[14px] font-medium text-[var(--g2-ink-soft)] transition-colors duration-200 hover:text-[var(--g2-ink)]',
              FOCUS,
            )}
          >
            <ArrowLeft aria-hidden className="size-4" strokeWidth={2.25} />
            All cars
          </Link>

          <h1
            id="g2-car-title"
            className="mt-2 text-[34px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[46px]"
          >
            {vehicle.displayName}
          </h1>

          {chips.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-1.5 text-[13px] font-medium text-[var(--g2-ink-soft)]">
              {chips.map((chip) => (
                <li key={chip} className="rounded-full bg-white/70 px-3 py-1.5">
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}

          {offeredRates.length > 0 ? (
            <dl className={cn('mt-6 grid rounded-[24px] bg-white/60 shadow-[inset_0_1px_0_#fff]', RATE_COLUMNS[offeredRates.length] ?? 'grid-cols-3')}>
              {offeredRates.map((rate, index) => (
                <div
                  key={rate.label}
                  className={cn(
                    'min-w-0 px-3 py-3.5 sm:px-5 sm:py-4',
                    index > 0 && 'relative before:absolute before:inset-y-4 before:left-0 before:w-px before:bg-[var(--g2-ink)]/10',
                  )}
                >
                  <dt className="text-[12.5px] font-medium text-[var(--g2-ink-soft)]">{rate.label.replace(/^per /, 'A ')}</dt>
                  <dd className="mt-1.5 truncate text-[17px] font-semibold leading-none tracking-[-0.035em] text-[var(--g2-ink)] tabular-nums sm:text-[26px]">
                    {formatCurrency(rate.amount ?? 0)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {vehicle.description ? (
            <p className="mt-5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)]">{vehicle.description}</p>
          ) : null}

          {specs.length > 0 ? (
            <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
              {specs.map((spec) => (
                <div key={spec.label} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--g2-ink-soft)]">
                    <spec.icon aria-hidden strokeWidth={2} className="size-3.5 text-[var(--g2-accent-ink)]" />
                    {spec.label}
                  </dt>
                  <dd className="mt-1 truncate text-[15px] font-medium text-[var(--g2-ink)]">{spec.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <a
            href="#pickup-date"
            className={cn('g2-cta mt-7 inline-flex h-12 w-fit items-center gap-2 rounded-full px-7 text-[15px] font-semibold lg:mt-auto', FOCUS)}
          >
            <CalendarDays aria-hidden className="size-4" strokeWidth={2.25} />
            Choose your dates
          </a>
        </div>
      </div>
    </div>
  );
}

function Gallery({ vehicle }: { vehicle: Vehicle }) {
  const { index, setIndex, usable, active, step, markFailed } = useVehicleGallery(vehicle.images);

  if (!active) {
    return (
      <div className="g2-well g2-tray flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-[28px]">
        <ImageOff aria-hidden strokeWidth={1.75} className="size-7 text-[var(--g2-ink-soft)]" />
        <p className="text-[14px] text-[var(--g2-ink-soft)]">No photos yet</p>
      </div>
    );
  }
  const position = Math.min(index, usable.length - 1);

  return (
    <div className="min-w-0">
      <div className="relative overflow-hidden rounded-[28px] bg-white/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={active.url}
          src={active.url}
          alt={vehicle.displayName}
          className="g2-swap-fade aspect-[16/10] w-full object-cover"
          onError={() => markFailed(active.url)}
        />
        {usable.length > 1 ? (
          <>
            <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
              {([-1, 1] as const).map((direction) => {
                const Icon = direction < 0 ? ChevronLeft : ChevronRight;
                return (
                  <button
                    key={direction}
                    type="button"
                    onClick={() => step(direction)}
                    aria-label={direction < 0 ? 'Previous photo' : 'Next photo'}
                    className={cn(
                      'g2-glass-thin pointer-events-auto grid size-11 place-items-center rounded-full text-[var(--g2-ink)] transition-transform duration-200 hover:scale-105 active:scale-95',
                      FOCUS,
                    )}
                  >
                    <Icon className="size-5" strokeWidth={2.25} />
                  </button>
                );
              })}
            </div>
            <span className="absolute bottom-3 left-3">
              <span className="g2-glass-thin block rounded-full px-3 py-1 text-[12.5px] font-semibold tabular-nums text-[var(--g2-ink)]">
                {position + 1} of {usable.length}
              </span>
            </span>
          </>
        ) : null}
      </div>

      {usable.length > 1 ? (
        <ul className="mt-2 flex gap-2 overflow-x-auto p-1 [scrollbar-width:none]">
          {usable.map((image, slot) => (
            <li key={image.url}>
              <button
                type="button"
                aria-label={`Show photo ${slot + 1}`}
                aria-current={slot === position}
                onClick={() => setIndex(slot)}
                className={cn(
                  'block h-16 w-24 shrink-0 overflow-hidden rounded-[16px] transition-[opacity,box-shadow] duration-200',
                  slot === position
                    ? 'shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--g2-accent)]'
                    : 'opacity-70 hover:opacity-100',
                  FOCUS,
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" loading="lazy" className="size-full object-cover" onError={() => markFailed(image.url)} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── the trip at a glance ─────────────────────────── */

/** The dates the bill is for. Read-only: the fields are in the form, which "Change dates" goes to. */
function Trip({
  pickupDate,
  pickupTime,
  dropoffDate,
  dropoffTime,
  rentalDays,
}: {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
  rentalDays: number | null;
}) {
  const leg = (date: string, time: string) => {
    const day = formatIsoDateLabel(date);
    if (day === '') return 'Not chosen yet';
    return time ? `${day}, ${formatClockLabel(time)}` : day;
  };
  return (
    <section className="rounded-[24px] bg-white/60 p-5 shadow-[inset_0_1px_0_#fff]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--g2-ink)]">Your trip</h2>
        <p className="text-[13.5px] text-[var(--g2-ink-soft)]">
          {rentalDays !== null && rentalDays > 0 ? `${rentalDays} day${rentalDays === 1 ? '' : 's'}` : 'No dates yet'}
        </p>
      </div>
      <dl className="mt-4 space-y-3 text-[14px]">
        {[
          ['Pick-up', leg(pickupDate, pickupTime)],
          ['Return', leg(dropoffDate, dropoffTime)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--g2-ink-soft)]">{label}</dt>
            <dd className="text-right font-medium tabular-nums text-[var(--g2-ink)]">{value}</dd>
          </div>
        ))}
      </dl>
      <a href="#pickup-date" className={cn('mt-4 inline-flex h-9 items-center rounded text-[13.5px] font-semibold text-[var(--g2-accent-ink)] hover:underline', FOCUS)}>
        Change dates
      </a>
    </section>
  );
}

/* ─────────────────────────────── states ─────────────────────────────── */

function State({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: typeof CarFront;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(PAGE, 'pb-3 pt-[84px] sm:pt-[96px]')}>
      <div className="g2-glass flex flex-col items-center rounded-[32px] px-6 py-20 text-center sm:rounded-[44px]">
        <span className="grid size-14 place-items-center rounded-full bg-white/80 text-[var(--g2-accent-ink)]">
          <Icon aria-hidden className="size-6" strokeWidth={2} />
        </span>
        <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.035em] text-[var(--g2-ink)] sm:text-[32px]">{title}</h1>
        <p className="mt-2 max-w-[28rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)]">{body}</p>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  );
}

/** Laid out like the page it precedes, so nothing jumps when the car arrives. */
function Skeleton() {
  const bar = 'animate-pulse rounded-full bg-white/60 motion-reduce:animate-none';
  return (
    <div aria-busy className={cn(PAGE, 'pb-3 pt-[84px] sm:pt-[96px]')}>
      <div className="g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
          <div className="aspect-[16/10] animate-pulse rounded-[28px] bg-white/50 motion-reduce:animate-none" />
          <div className="space-y-4 px-3 py-4">
            <div className={cn(bar, 'h-5 w-24')} />
            <div className={cn(bar, 'h-11 w-3/4')} />
            <div className={cn(bar, 'h-8 w-1/2')} />
            <div className="h-20 animate-pulse rounded-[24px] bg-white/50 motion-reduce:animate-none" />
          </div>
        </div>
      </div>
    </div>
  );
}
