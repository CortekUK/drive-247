"use client";

import {
  ArrowLeft,
  ArrowRight,
  CarFront,
  CheckCircle2,
  Clock,
  RotateCw,
  TriangleAlert,
} from "lucide-react-nw";
import Link from "next/link";

import { Button } from "@nw/components/ui/button";
import { Skeleton } from "@nw/components/ui/skeleton";
import { cn } from "@nw/lib/utils";

import {
  CheckoutTotal,
  MobileCheckoutBar,
  PriceBlock,
} from "./booking-checkout";
import { BookingForm } from "./booking-form";
import { bookingDocumentsHref, PaymentPanel } from "./payment-panel";
import { useVehicleBooking, type PaidBookingHandoff } from "./use-vehicle-booking";
import { VehicleCard } from "./vehicle-card";

/**
 * /booking/[vehicleId] — one vehicle, one page.
 *
 * This component owns the data and the decisions; the card, the form and the
 * checkout pieces are presentational. There is no wizard: everything the
 * customer must tell us before paying is on screen at once, and the bill
 * re-prices on every change because `useBookingQuote` recomputes from the same
 * inputs the form renders.
 *
 * LAYOUT — the vehicle is the left rail and the form is the right column, and
 * the rail is DOM-first so a phone stacks car-then-form with no `order-*`
 * rewriting of the reading order. See the grid below for why the rail scrolls
 * internally rather than growing past the fold.
 *
 * The data and the decisions live in `use-vehicle-booking.ts` (shared with the
 * v2 site's page); this file is the v1 markup over them.
 *
 * PAYMENT happens in this page too. "Continue to payment" opens `PaymentPanel`
 * — Stripe Elements mounted in a dialog over this form — rather than handing the
 * customer to Stripe's hosted checkout. The button is greyed out until the whole
 * form validates, and says which fields are outstanding while it is.
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
    paidHandoff,
    paymentOpen,
    checkout,
    priceBlockProps,
    formProps,
    paymentPanelProps,
    handleFormBlur,
  } = useVehicleBooking(vehicleId);

  /* ── states ───────────────────────────────────────────────────────────── */

  if (tenantError) {
    return (
      <StatePanel
        icon={TriangleAlert}
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
        icon={CarFront}
        title="We could not find that vehicle"
        body="It may have been removed from the fleet, or the link may be wrong."
        action={
          <Button asChild variant="brand" size="lg">
            <Link href="/fleet">Browse the fleet</Link>
          </Button>
        }
      />
    );
  }

  if (isError || !vehicle) {
    return (
      <StatePanel
        icon={TriangleAlert}
        title="We could not load this vehicle"
        body="Something went wrong on our side. Please try again."
        action={
          <Button variant="brand" size="lg" onClick={() => void refetch()}>
            <RotateCw strokeWidth={2} />
            Try again
          </Button>
        }
      />
    );
  }

  const priceBlock = <PriceBlock {...priceBlockProps} />;

  return (
    /* `pb-24` on a phone reserves the 65px fixed checkout bar, plus air. */
    <div className="container-page pt-4 pb-24 lg:pt-8 lg:pb-12">
      <Link
        href="/fleet"
        className="-my-1.5 inline-flex min-h-11 items-center gap-1.5 text-sm text-brand-text-soft transition-colors hover:text-brand-text"
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        Back to the fleet
      </Link>

      {/*
        THE DURABLE SURFACE. The payment dialog is dismissible and the fixed
        mobile bar is unmounted while it is open, so without this the only trace
        of a completed payment was one grey sentence under the total — and the
        route to the outstanding upload step existed nowhere on the page at all.
        It sits above the form deliberately: the form is now the least useful
        thing on screen.
      */}
      {paidHandoff !== null ? <PaidBookingNotice handoff={paidHandoff} /> : null}

      {/*
        VEHICLE LEFT (~38%), FORM RIGHT (~62%) — and the vehicle is FIRST in the
        DOM, so the phone's single column reads car-then-form without an
        `order-*` utility divorcing the visual order from the tab order.
      */}
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-8 xl:gap-10">
        <aside
          className={cn(
            "space-y-4",
            /*
              THE STICKY RAIL, and why it is capped rather than left to flow.

              A sticky element taller than the viewport pins its TOP and parks
              everything below the fold — which is exactly where the total and
              the button would end up. So the rail is a flex column no taller
              than the screen: the car and the itemised bill scroll inside it if
              they must, and the total-and-CTA sits outside that scroller and
              never moves.

              `overflow` lives on the INNER div, never on the <aside> — overflow
              on the sticky element's own box (or any ancestor) kills `position:
              sticky` outright. That is the mistake the previous pass made.

              The cap is `100svh - 11rem`, not `- 3rem` to match `top-6`. 11rem
              is roughly what sits above the rail before you scroll — navbar
              plus the back link — so the total and the button are on screen at
              scroll depth ZERO too, not only once the rail has stuck. Measured:
              the rail starts at y=165, so a 3rem cap put the CTA at y=954 on a
              900px screen. Under-filling the stuck rail by ~150px is the price,
              and it is the right one.
            */
            "lg:sticky lg:top-6 lg:col-start-1 lg:row-start-1 lg:flex lg:max-h-[calc(100svh-11rem)] lg:flex-col lg:space-y-0 lg:self-start",
          )}
        >
          <div className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2 lg:[scrollbar-gutter:stable] lg:[scrollbar-width:thin] lg:[&::-webkit-scrollbar]:w-1.5 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-brand-border">
            <VehicleCard vehicle={vehicle} />
            {/*
              The bill belongs beside the car on a desktop. On a phone it moves
              below the form — quoting a total above the dates that produce it
              is a number with nothing behind it.
            */}
            <div className="hidden lg:block">{priceBlock}</div>
          </div>

          <div className="hidden lg:block lg:shrink-0 lg:pt-3">
            <CheckoutTotal {...checkout} />
          </div>
        </aside>

        {/*
          `onBlur` here, not on each field: React's onBlur is `focusout`, which
          bubbles, so one listener on the wrapper sees every control leave focus.
          See `handleFormBlur` for why that matters now the CTA is disabled.
        */}
        <div className="lg:col-start-2 lg:row-start-1" onBlur={handleFormBlur}>
          <BookingForm {...formProps} />

          <div className="mt-5 lg:hidden">{priceBlock}</div>
        </div>
      </div>

      {/*
        The fixed bar is UNMOUNTED while the payment dialog is open, not merely
        layered under it. At 360px the dialog's confirm button and the bar occupy
        the same 65px of screen, and a scrim the customer cannot see through is
        still a scrim they can tap by accident.
      */}
      {paymentOpen ? null : <MobileCheckoutBar {...checkout} />}

      <PaymentPanel {...paymentPanelProps} />
    </div>
  );
}

/* ─────────────────────── the paid-but-not-confirmed notice ───────────────── */

/**
 * The block that stays on the page after the payment dialog is closed.
 *
 * ── EVERY SENTENCE HERE IS CHOSEN AGAINST ONE RULE ──────────────────────────
 * It may not say the booking is confirmed, complete or booked. It is not:
 * payment has been taken, the documents are outstanding, and an OPERATOR still
 * has to approve. The confirmation email is sent by `notify-booking-approved`
 * from the portal at that approval, and telling a customer otherwise is how
 * somebody turns up at a depot for keys nobody is going to hand over.
 *
 * The primary action is the upload link when there is a token to build one
 * from. When there is not — the endpoint has not been redeployed, or this is a
 * stash from before the field existed — it says the link was emailed, which is
 * true (the settlement path sends it) and is the one honest fallback. A dead
 * link is never rendered.
 *
 * `processing` gets no link at all. The bank has not taken the money yet, and
 * inviting someone to dig out their insurance certificate for a payment that may
 * still be declined is work we should not be asking for.
 */
function PaidBookingNotice({ handoff }: { handoff: PaidBookingHandoff }) {
  const settled = handoff.kind === "succeeded";
  const href =
    settled && handoff.documentsToken !== null
      ? bookingDocumentsHref(handoff.documentsToken)
      : null;

  return (
    <div
      // `role="status"` rather than `alert`: this is the outcome of something
      // the customer just did on purpose, not an interruption.
      role="status"
      className={cn(
        "mt-4 rounded-[18px] border px-4 py-4 sm:px-5",
        settled
          ? "border-success-med bg-success-light"
          : "border-info-med bg-info-light",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          {settled ? (
            <CheckCircle2 aria-hidden strokeWidth={1.75} className="size-5 text-success" />
          ) : (
            <Clock aria-hidden strokeWidth={1.75} className="size-5 text-info" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-brand-text">
            {settled ? "Payment received" : "Payment is being confirmed"}
          </h2>

          <p className="mt-1 text-sm leading-relaxed text-brand-text-soft">
            {settled
              ? "One step left before we can confirm this booking: a copy of your insurance document. An operator reviews it and we will email you as soon as your booking is confirmed."
              : "Your bank has not settled this yet. We will email you the moment it clears, with a link to send your insurance document."}
          </p>

          {handoff.rentalNumber !== null ? (
            <p className="mt-2 text-xs text-brand-text-subtle">
              Booking reference{" "}
              <span className="font-medium text-brand-text">
                {handoff.rentalNumber}
              </span>
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
              {/*
                Shown ALONGSIDE the button, not instead of it. Someone who has the
                button in front of them is exactly the person who does not yet know
                they may leave and come back — the certificate is usually in another
                app, or an email from their insurer, or on paper. Without this they
                either abandon the page hunting for it or assume the booking dies if
                they close the tab. Naming the seven days here is the point: an
                unbounded "later" reads as "never actually required".
              */}
              <p className="mt-3 text-xs leading-relaxed text-brand-text-subtle">
                Don&rsquo;t have it to hand? You can do this later — we have emailed
                you the same link. It is valid for seven days, and if it expires that
                page will send you a fresh one.
              </p>
            </>
          ) : settled ? (
            <p className="mt-3 text-xs leading-relaxed text-brand-text-subtle">
              We are sending a link to your email so you can send your insurance
              document. It is valid for seven days — if it expires, that page will
              send you a fresh one.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────── helpers ───────────────────────────── */

/**
 * The loading state, laid out like the page it precedes.
 *
 * Same column split, same order, so nothing jumps sideways when the real
 * content lands — the vehicle rail on the left, the form on the right.
 */
function BookingPageSkeleton() {
  return (
    <div className="container-page pt-4 pb-24 lg:pt-8 lg:pb-12">
      <Skeleton className="h-5 w-32 bg-brand-stone" />

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,38fr)_minmax(0,62fr)] lg:gap-8 xl:gap-10">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <div className="overflow-hidden rounded-[18px] border border-brand-border-soft bg-white">
            <Skeleton className="aspect-[16/10] w-full rounded-none bg-brand-stone" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-6 w-2/3 bg-brand-stone" />
              <Skeleton className="h-5 w-1/3 bg-brand-stone" />
              <Skeleton className="h-24 w-full rounded-[12px] bg-brand-stone" />
            </div>
          </div>
          <Skeleton className="hidden h-56 w-full rounded-[18px] bg-brand-stone lg:block" />
        </div>

        <div className="space-y-4 rounded-[18px] border border-brand-border-soft bg-white p-4 sm:p-5 lg:col-start-2 lg:row-start-1">
          <Skeleton className="h-3 w-24 bg-brand-stone" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
          </div>
          <Skeleton className="h-3 w-28 bg-brand-stone" />
          <Skeleton className="h-20 w-full bg-brand-stone" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
            <Skeleton className="h-11 bg-brand-stone" />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatePanel({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof CarFront;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="container-page py-20">
      <div className="mx-auto max-w-md rounded-[18px] border border-brand-border-soft bg-white px-6 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-brand-stone">
          <Icon
            aria-hidden
            strokeWidth={1.5}
            className="size-5 text-brand-text-soft"
          />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-brand-text">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-brand-text-soft">{body}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
