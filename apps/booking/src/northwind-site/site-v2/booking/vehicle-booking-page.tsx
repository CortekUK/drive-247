"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CarFront,
  CheckCircle2,
  Clock,
  RotateCw,
  TriangleAlert,
} from "lucide-react-nw";
import Link from "next/link";

import { bookingDocumentsHref } from "@nw/components/booking/payment-panel-logic";
import { formatClockLabel, formatIsoDateLabel } from "@nw/components/booking/time-utils";
import {
  useVehicleBooking,
  type PaidBookingHandoff,
} from "@nw/components/booking/use-vehicle-booking";
import { Button } from "@nw/components/ui/button";
import { Skeleton } from "@nw/components/ui/skeleton";
import { cn } from "@nw/lib/utils";
import { CARD, CardHeading, EmptyState, ICON_TILE, SITE_CONTAINER } from "@nw/site-v2/kit";

import { CheckoutTotal, MobileCheckoutBar, PriceBlock } from "./booking-checkout";
import { BookingForm } from "./booking-form";
import { PaymentPanel } from "./payment-panel";
import { VehicleCard } from "./vehicle-card";

/**
 * /booking/[vehicleId] — v2. Same export and props as
 * `components/booking/vehicle-booking-page`, and the SAME brain: every piece of
 * seeding, availability, pricing, validation, the booking write, the payment
 * handoff and the abandoned-booking tracking comes from `useVehicleBooking`,
 * which the current page also runs. Only the markup is v2's.
 *
 * LAYOUT — a record page. Left: the car (photos + overview), then the form.
 * Right: a sticky booking card — the trip at a glance, the itemised bill, the
 * total and the CTA. On a phone it is one column (car, form, bill) with the
 * total and the button pinned to the foot of the screen.
 */
export function VehicleBookingPage({ vehicleId }: { vehicleId: string }) {
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
    return (
      <StatePanel
        icon={<TriangleAlert className="size-5" strokeWidth={1.75} />}
        title="This site is not available"
        body={tenantError}
      />
    );
  }

  if (vehicleLoading || tenantLoading || !hydrated) {
    return <BookingPageSkeleton />;
  }

  if (notFound) {
    return (
      <StatePanel
        icon={<CarFront className="size-5" strokeWidth={1.75} />}
        title="We could not find that vehicle"
        body="It may have been removed from the fleet, or the link may be wrong."
        action={
          <Button asChild variant="brand" size="lg" className="mt-2">
            <Link href="/fleet">Browse the fleet</Link>
          </Button>
        }
      />
    );
  }

  if (isError || !vehicle) {
    return (
      <StatePanel
        icon={<TriangleAlert className="size-5" strokeWidth={1.75} />}
        title="We could not load this vehicle"
        body="Something went wrong on our side. Please try again."
        action={
          <Button variant="brand" size="lg" className="mt-2" onClick={() => void refetch()}>
            <RotateCw strokeWidth={2} />
            Try again
          </Button>
        }
      />
    );
  }

  const priceBlock = <PriceBlock {...priceBlockProps} />;

  return (
    /* `pb-32` on a phone reserves the fixed checkout bar, plus air. */
    <div className={cn(SITE_CONTAINER, "pb-32 pt-6 md:pt-8 lg:pb-16")}>
      <Link
        href="/fleet"
        className="-my-1.5 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-pv-muted-fg transition-colors duration-200 hover:text-pv-fg motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Back to the fleet
      </Link>

      <header className="mt-3">
        <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.035em] text-pv-fg md:text-[40px]">
          {vehicle.displayName}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-pv-muted-fg">
          Choose your dates and tell us who is driving. The price updates as you go, and you see the full total
          before you pay.
        </p>
      </header>

      {/* The durable surface after a payment — see v1's page for why it exists. */}
      {paidHandoff !== null ? <PaidBookingNotice handoff={paidHandoff} /> : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          <VehicleCard vehicle={vehicle} />

          {/*
            One delegated `focusout` listener — the hook's `handleFormBlur` maps
            the control's DOM id to the field whose error it may now reveal.
          */}
          <div onBlur={handleFormBlur}>
            <BookingForm {...formProps} />
          </div>

          {/* On a phone the bill follows the form that produces it. */}
          <div className="lg:hidden">{priceBlock}</div>
        </div>

        {/*
          THE STICKY BOOKING CARD. Capped to the viewport so the total and the
          button never fall below the fold: the trip and the bill scroll inside
          the inner div, and `overflow` lives there — never on the sticky
          <aside> itself, which would kill `position: sticky`.
        */}
        <aside className="hidden lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100svh-7rem)] lg:flex-col lg:self-start">
          <div className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[scrollbar-width:thin]">
            <TripCard
              pickupDate={form.pickupDate}
              pickupTime={form.pickupTime}
              dropoffDate={form.dropoffDate}
              dropoffTime={form.dropoffTime}
              rentalDays={validation.rentalDays}
            />
            {priceBlock}
          </div>
          <div className="shrink-0 pt-4">
            <CheckoutTotal {...checkout} />
          </div>
        </aside>
      </div>

      {/* Unmounted, not hidden, while the payment dialog is open (see v1). */}
      {paymentOpen ? null : <MobileCheckoutBar {...checkout} />}

      <PaymentPanel {...paymentPanelProps} />
    </div>
  );
}

/* ───────────────────────────── the trip at a glance ─────────────────────── */

/**
 * The dates the bill is for, at the top of the booking card. Read-only — the
 * fields themselves are in the form — with a link that takes the customer to
 * them, so the card never pretends to be a second place to edit the same thing.
 */
function TripCard({
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
    if (day === "") return "Not chosen yet";
    return time ? `${day} · ${formatClockLabel(time)}` : day;
  };

  return (
    <section className={cn(CARD, "p-5")}>
      <div className="flex items-start gap-3">
        <span className={ICON_TILE}>
          <CalendarDays className="size-4" strokeWidth={1.75} />
        </span>
        <CardHeading
          title="Your trip"
          description={
            rentalDays !== null && rentalDays > 0
              ? `${rentalDays} day${rentalDays === 1 ? "" : "s"}`
              : "Choose your dates to see the price."
          }
        />
      </div>

      <dl className="mt-4 space-y-3 text-[14px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-pv-muted-fg">Pickup</dt>
          <dd className="text-right font-medium tabular-nums text-pv-fg">{leg(pickupDate, pickupTime)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-pv-muted-fg">Return</dt>
          <dd className="text-right font-medium tabular-nums text-pv-fg">{leg(dropoffDate, dropoffTime)}</dd>
        </div>
      </dl>

      <a
        href="#pickup-date"
        className="mt-4 inline-flex min-h-9 items-center text-[13px] font-medium text-pv-link hover:underline"
      >
        Change dates
      </a>
    </section>
  );
}

/* ─────────────────────── the paid-but-not-confirmed notice ───────────────── */

/**
 * v2 of v1's `PaidBookingNotice`, with the same words and the same rule: it may
 * not say the booking is confirmed. Payment has been taken, the insurance
 * document is outstanding, and an operator still has to approve.
 */
function PaidBookingNotice({ handoff }: { handoff: PaidBookingHandoff }) {
  const settled = handoff.kind === "succeeded";
  const href = settled && handoff.documentsToken !== null ? bookingDocumentsHref(handoff.documentsToken) : null;

  return (
    <div
      role="status"
      className={cn(
        "pv2-enter mt-6 rounded-2xl border px-4 py-4 sm:px-5",
        settled ? "border-pv-success/25 bg-pv-success-light" : "border-pv-primary/20 bg-pv-tint",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {settled ? (
            <CheckCircle2 aria-hidden strokeWidth={1.75} className="size-5 text-pv-success" />
          ) : (
            <Clock aria-hidden strokeWidth={1.75} className="size-5 text-pv-primary" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-pv-fg">
            {settled ? "Payment received" : "Payment is being confirmed"}
          </h2>
          <p className="mt-1 text-[14px] leading-relaxed text-pv-muted-fg">
            {settled
              ? "One step left before we can confirm this booking: a copy of your insurance document. An operator reviews it and we will email you as soon as your booking is confirmed."
              : "Your bank has not settled this yet. We will email you the moment it clears, with a link to send your insurance document."}
          </p>

          {handoff.rentalNumber !== null ? (
            <p className="mt-2 text-xs text-pv-muted-fg">
              Booking reference <span className="font-medium text-pv-fg">{handoff.rentalNumber}</span>
            </p>
          ) : null}

          {href !== null ? (
            <>
              <Button asChild variant="brand" size="lg" className="mt-3 h-11 w-full sm:w-auto">
                <Link href={href}>
                  Send my insurance document
                  <ArrowRight aria-hidden strokeWidth={2} />
                </Link>
              </Button>
              <p className="mt-3 text-xs leading-relaxed text-pv-muted-fg">
                Don&rsquo;t have it to hand? You can do this later — we have emailed you the same link. It is
                valid for seven days, and if it expires that page will send you a fresh one.
              </p>
            </>
          ) : settled ? (
            <p className="mt-3 text-xs leading-relaxed text-pv-muted-fg">
              We are sending a link to your email so you can send your insurance document. It is valid for seven
              days — if it expires, that page will send you a fresh one.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────── states ───────────────────────────── */

/** The loading state, laid out like the page it precedes so nothing jumps. */
export function BookingPageSkeleton() {
  const bar = "bg-pv-muted";
  return (
    <div className={cn(SITE_CONTAINER, "pb-32 pt-6 md:pt-8 lg:pb-16")}>
      <Skeleton className={cn("h-5 w-32", bar)} />
      <Skeleton className={cn("mt-5 h-10 w-2/3 max-w-md rounded-lg", bar)} />
      <Skeleton className={cn("mt-3 h-4 w-full max-w-xl", bar)} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="space-y-6">
          <div className={cn(CARD, "overflow-hidden")}>
            <Skeleton className={cn("aspect-[16/10] w-full rounded-none md:aspect-[16/9]", bar)} />
            <div className="space-y-3 p-5">
              <Skeleton className={cn("h-6 w-1/3", bar)} />
              <Skeleton className={cn("h-16 w-full rounded-[10px]", bar)} />
            </div>
          </div>
          <div className={cn(CARD, "space-y-4 p-5")}>
            <Skeleton className={cn("h-4 w-28", bar)} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton className={cn("h-11 rounded-[10px]", bar)} />
              <Skeleton className={cn("h-11 rounded-[10px]", bar)} />
              <Skeleton className={cn("h-11 rounded-[10px]", bar)} />
              <Skeleton className={cn("h-11 rounded-[10px]", bar)} />
            </div>
          </div>
        </div>
        <div className="hidden space-y-4 lg:block">
          <Skeleton className={cn("h-40 w-full rounded-2xl", bar)} />
          <Skeleton className={cn("h-64 w-full rounded-2xl", bar)} />
        </div>
      </div>
    </div>
  );
}

function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn(SITE_CONTAINER, "py-16 md:py-24")}>
      <EmptyState className="mx-auto max-w-md" icon={icon} title={title} description={body} action={action} />
    </div>
  );
}
