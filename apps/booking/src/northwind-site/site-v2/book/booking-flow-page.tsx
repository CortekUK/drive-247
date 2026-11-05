"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Globe, Loader2, Lock } from "lucide-react-nw";

import { Dialog, DialogDescription, DialogTitle } from "@nw/components/ui/dialog";
import { Skeleton } from "@nw/components/ui/skeleton";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import { PvDialogContent } from "@nw/portal-v2/dialog";
import { BookingPageSkeleton } from "@nw/site-v2/booking/vehicle-booking-page";
import { SITE_CONTAINER } from "@nw/site-v2/kit";

import { CarStep } from "./car-step";
import { TimeCard } from "./time-picker";
import { TripCalendar, prettyDate, type TripEnd } from "./trip-calendar";
import { StartOver, TripOverview } from "./trip-overview";
import { useBookingFlow, type BookingFlow, type FlowStep } from "./use-booking-flow";

/**
 * /booking — the booking flow on a page of its own (v2). Booking is long and
 * it is where most visitors end up, so it is not a dialog: the steps and the
 * step's title centred across the top, the step itself on the left and the
 * overview of the booking on the right, with the way on at its foot. On a
 * phone the overview folds into a bar along the bottom.
 *
 *   1  Trip details   dates and times
 *   2  Your car       the free cars, priced for the trip
 *   3  Checkout       the car's own page: where, extras, details, payment
 *
 * State and rules: `use-booking-flow.ts`.
 */

const STEPS: { key: FlowStep | "checkout"; label: string }[] = [
  { key: "trip", label: "Trip details" },
  { key: "car", label: "Your car" },
  { key: "checkout", label: "Checkout" },
];

export function BookingFlowPage() {
  const flow = useBookingFlow();
  const primary = usePrimaryAction(flow);
  // Which time card is open; a quick length opens the return's.
  const [active, setActive] = useState<TripEnd>("pickup");

  // On to checkout: its page's own skeleton, straight away.
  if (flow.pending === "checkout") return <BookingPageSkeleton />;

  return (
    <div className={cn(SITE_CONTAINER, "pt-6 sm:pt-10")}>
      <Stepper flow={flow} />

      {!flow.restored || (flow.pending && flow.pending !== flow.step) ? (
        <StepSkeleton step={flow.pending === "car" ? "car" : "trip"} />
      ) : (
        <div key={flow.step} className="qb-screen">
          {flow.step === "trip" ? <TripHeading flow={flow} onLength={() => setActive("return")} /> : <CarHeading flow={flow} />}

          <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
            <div className="min-w-0">{flow.step === "trip" ? <TripStep flow={flow} active={active} setActive={setActive} /> : <CarStep flow={flow} />}</div>

            {/* The overview and, under it, the way on. Sticks below the site's bar. */}
            <aside className="sticky top-[88px] hidden lg:block">
              <TripOverview
                flow={flow}
                footer={
                  <>
                    <PrimaryButton primary={primary} className="w-full" />
                    <p className="mt-2 text-center text-[12px] text-pv-muted-fg">
                      {flow.step === "trip" ? "Step 1 of 3 · nothing is charged yet" : "Step 2 of 3 · nothing is charged yet"}
                    </p>
                  </>
                }
              />
            </aside>
          </div>
        </div>
      )}

      <PhoneBar flow={flow} primary={primary} />
      <div aria-hidden className="h-10 lg:h-16" />
    </div>
  );
}

/* ── loading ───────────────────────────────────────────────────────────── */

/** A step while it loads, laid out like the step so nothing jumps when it lands. */
function StepSkeleton({ step }: { step: FlowStep }) {
  const bar = "bg-pv-muted";
  return (
    <div aria-busy aria-label="Loading">
      <div className="mx-auto mt-8 flex max-w-2xl flex-col items-center sm:mt-10">
        <Skeleton className={cn("h-10 w-3/4 max-w-[420px] rounded-xl", bar)} />
        <Skeleton className={cn("mt-3.5 h-4 w-full max-w-[460px]", bar)} />
        <div className="mt-5 flex gap-2">
          {[0, 1, 2, 3].map((n) => (
            <Skeleton key={n} className={cn("h-9 w-20 rounded-full", bar)} />
          ))}
        </div>
      </div>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-10">
        {step === "trip" ? (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Skeleton className={cn("h-[420px] w-full rounded-[28px]", bar)} />
            <div className="space-y-3">
              <Skeleton className={cn("h-[400px] w-full rounded-[24px]", bar)} />
              <Skeleton className={cn("h-[78px] w-full rounded-[24px]", bar)} />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Skeleton className={cn("h-10 w-full rounded-full", bar)} />
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((n) => (
                <Skeleton key={n} className={cn("h-[300px] w-full rounded-2xl", bar)} />
              ))}
            </div>
          </div>
        )}
        <Skeleton className={cn("hidden h-[460px] w-full rounded-[28px] lg:block", bar)} />
      </div>
    </div>
  );
}

/** The whole /booking page while its route loads (`loading.tsx`). */
export function BookingFlowSkeleton() {
  const bar = "bg-pv-muted";
  return (
    <div className={cn(SITE_CONTAINER, "pt-6 sm:pt-10")}>
      <div className="flex justify-center gap-6">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className={cn("h-9 w-28 rounded-full", bar)} />
        ))}
      </div>
      <StepSkeleton step="trip" />
      <div aria-hidden className="h-10 lg:h-16" />
    </div>
  );
}

/* ── the steps along the top ───────────────────────────────────────────── */

function Stepper({ flow }: { flow: BookingFlow }) {
  const index = flow.step === "trip" ? 0 : 1;
  return (
    <nav aria-label="Booking steps" className="flex justify-center">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEPS.map((step, i) => {
          const done = i < index;
          const current = i === index;
          // Back to any finished step; on to the car once the trip is valid.
          const reachable = step.key === "trip" || (step.key === "car" && flow.tripValid);
          return (
            <li key={step.key} className="flex items-center gap-1.5 sm:gap-2">
              {i > 0 ? <span aria-hidden className={cn("h-0.5 w-4 rounded-full sm:w-8", done || current ? "bg-pv-primary" : "bg-pv-border")} /> : null}
              <button
                type="button"
                disabled={!reachable || current}
                aria-current={current ? "step" : undefined}
                onClick={() => step.key !== "checkout" && flow.goTo(step.key)}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-full pl-1 pr-3 text-[13px] font-semibold transition-colors duration-200 disabled:cursor-default",
                  current ? "bg-pv-tint text-pv-primary" : reachable ? "cursor-pointer text-pv-fg hover:bg-pv-muted" : "text-pv-muted-fg",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full text-[12px] font-bold tabular-nums",
                    current || done ? "bg-pv-primary text-pv-primary-fg" : "bg-pv-muted text-pv-muted-fg",
                  )}
                >
                  {done ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn(!current && "max-sm:sr-only")}>{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A step's title and one line under it, centred over the page; then its controls. */
function StepHeading({ title, description, children }: { title: string; description: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mx-auto mt-8 max-w-2xl text-center sm:mt-10">
      <h1 className="text-[28px] font-extrabold leading-[1.08] tracking-[-0.04em] text-pv-fg sm:text-[40px]">{title}</h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-pv-muted-fg">{description}</p>
      {children ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </header>
  );
}

/* ── 1. trip details ───────────────────────────────────────────────────── */

const LENGTHS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
];

function TripHeading({ flow, onLength }: { flow: BookingFlow; onLength: () => void }) {
  const minDays = Math.max(1, Math.ceil(flow.rules.minRentalHours / 24));
  const lengths = LENGTHS.filter((l) => l.days >= minDays && l.days <= flow.rules.maxRentalDays);

  return (
    <StepHeading title="When do you need it?" description="Pick your pickup and return days, then the times. Or start from a length:">
      {lengths.map((l) => (
        <button
          key={l.days}
          type="button"
          aria-pressed={flow.days === l.days}
          onClick={() => {
            flow.setLength(l.days);
            onLength();
          }}
          className={cn(
            "h-9 cursor-pointer rounded-full px-4 text-[13px] font-semibold transition-all duration-200 active:scale-95",
            flow.days === l.days ? "bg-pv-fg text-pv-card" : "bg-pv-muted text-pv-fg hover:bg-pv-tint",
          )}
        >
          {l.label}
        </button>
      ))}
      <StartOver onConfirm={flow.startOver} disabled={!flow.tripTouched && !flow.chosen} className="lg:hidden" />
    </StepHeading>
  );
}

function TripStep({ flow, active, setActive }: { flow: BookingFlow; active: TripEnd; setActive: (end: TripEnd) => void }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <TripCalendar
        flow={flow}
        onPicked={setActive}
        notice={flow.tripValid && !flow.carsLoading && !flow.carsError && flow.cars.length === 0 ? "Every car is booked on those days. Try moving them." : null}
      />

      <div className="space-y-3">
        <TimeCard
          end="pickup"
          active={active === "pickup"}
          onActivate={() => setActive("pickup")}
          date={flow.trip.pickupDate}
          value={flow.trip.pickupTime}
          slots={flow.rules.timeSlots}
          isOpen={(slot) => flow.isPickupSlotOpen(flow.trip.pickupDate, slot)}
          onChange={(pickupTime) => flow.updateTrip({ pickupTime })}
          operatorZone={flow.rules.operatorTimezone}
          viewerZone={flow.viewerZone}
          viewerDiffers={flow.viewerDiffers}
        />
        <TimeCard
          end="return"
          active={active === "return"}
          onActivate={() => setActive("return")}
          date={flow.trip.dropoffDate}
          value={flow.trip.dropoffTime}
          slots={flow.rules.timeSlots}
          isOpen={RETURN_ALWAYS_OPEN}
          onChange={(dropoffTime) => flow.updateTrip({ dropoffTime })}
          operatorZone={flow.rules.operatorTimezone}
          viewerZone={flow.viewerZone}
          viewerDiffers={flow.viewerDiffers}
        />
        <p className="flex items-start gap-2 px-1 text-[12px] leading-snug text-pv-muted-fg">
          <Globe aria-hidden className="mt-px size-3.5 shrink-0 text-pv-primary" />
          <span>
            Times are <strong className="font-semibold text-pv-fg">{flow.operatorZone.city} time</strong>
            {flow.operatorZone.name ? ` (${flow.operatorZone.name})` : ""}.
            {flow.viewerDiffers ? ` Your device is on ${flow.viewerZone.replace(/_/g, " ")}, so your time shows too.` : null}
          </span>
        </p>
      </div>
    </div>
  );
}

/** The return is always at least a day after a legal pickup, so every slot is open. */
const RETURN_ALWAYS_OPEN = () => true;

/* ── 2. the car ────────────────────────────────────────────────────────── */

function CarHeading({ flow }: { flow: BookingFlow }) {
  return (
    <StepHeading
      title="Choose your car"
      description={
        <>
          Free from <span className="font-semibold text-pv-fg">{prettyDate(flow.trip.pickupDate)}</span> to{" "}
          <span className="font-semibold text-pv-fg">{prettyDate(flow.trip.dropoffDate)}</span>, priced for the whole trip.
        </>
      }
    >
      <button
        type="button"
        onClick={() => flow.goTo("trip")}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-pv-muted px-4 text-[13px] font-semibold text-pv-fg transition-colors duration-200 hover:bg-pv-tint"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to trip details
      </button>
      <StartOver onConfirm={flow.startOver} disabled={!flow.tripTouched && !flow.chosen} className="lg:hidden" />
    </StepHeading>
  );
}

/* ── the way on: in the overview on a desktop, in a bottom bar on a phone ── */

type PrimaryAction = {
  label: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  icon: typeof ArrowRight;
};

function usePrimaryAction(flow: BookingFlow): PrimaryAction {
  const count = flow.cars.length;
  if (flow.step === "trip") {
    return {
      label: !flow.tripValid
        ? "Choose your dates"
        : flow.carsLoading
          ? "Finding cars…"
          : count === 0
            ? "No cars free then"
            : `See ${count === 1 ? "1 car" : `${count} cars`}`,
      disabled: !flow.tripValid || flow.carsLoading || count === 0,
      loading: flow.carsLoading,
      onClick: () => flow.goTo("car"),
      icon: ArrowRight,
    };
  }
  return {
    label: flow.chosen ? "Continue to checkout" : "Choose a car",
    disabled: !flow.chosen,
    loading: false,
    onClick: flow.continueToCheckout,
    icon: Lock,
  };
}

function PrimaryButton({ primary, className }: { primary: PrimaryAction; className?: string }) {
  const Icon = primary.icon;
  return (
    <button
      type="button"
      disabled={primary.disabled}
      onClick={primary.onClick}
      className={cn(
        "qb-press inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-pv-primary px-6 text-[15px] font-semibold text-pv-primary-fg transition-transform duration-200 ease-out hover:scale-[1.015] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 motion-reduce:transition-none",
        className,
      )}
    >
      {primary.loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
      {primary.label}
      {!primary.loading && !primary.disabled ? <Icon aria-hidden className="size-4" strokeWidth={2.25} /> : null}
    </button>
  );
}

/**
 * Below the desktop width: a solid bar pinned to the bottom of the flow (sticky,
 * so it parks above the site footer instead of covering it), with the trip at
 * a glance — tap it for the full overview — and the way on.
 */
function PhoneBar({ flow, primary }: { flow: BookingFlow; primary: PrimaryAction }) {
  const { formatCurrency } = useTenantBranding();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const total = flow.chosen?.quote.grandTotal ?? null;

  return (
    <>
      <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-pv-border bg-pv-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-6 md:px-6 lg:hidden">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSummaryOpen(true)} className="min-w-0 flex-1 cursor-pointer rounded-2xl px-1 py-1 text-left">
            <span className="block truncate text-[12px] text-pv-muted-fg">
              {prettyDate(flow.trip.pickupDate)} – {prettyDate(flow.trip.dropoffDate)} · {flow.days}d
            </span>
            <span className="block truncate text-[14px] font-semibold text-pv-fg underline decoration-pv-border underline-offset-4">
              {total !== null ? formatCurrency(total) : "Trip summary"}
            </span>
          </button>
          <PrimaryButton primary={primary} />
        </div>
      </div>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        {/* No corner ×: it would sit on "Start over". Done, Escape or the scrim close it. */}
        <PvDialogContent variant="site" showCloseButton={false} className="max-h-[calc(100dvh-2rem)] gap-2 overflow-y-auto p-2 sm:max-w-md sm:p-2">
          <DialogTitle className="sr-only">Your trip</DialogTitle>
          <DialogDescription className="sr-only">The booking so far.</DialogDescription>
          <TripOverview flow={flow} onNavigate={() => setSummaryOpen(false)} />
          <button
            type="button"
            onClick={() => setSummaryOpen(false)}
            className="h-12 w-full shrink-0 cursor-pointer rounded-full bg-pv-muted text-[15px] font-semibold text-pv-fg hover:bg-pv-tint"
          >
            Done
          </button>
        </PvDialogContent>
      </Dialog>
    </>
  );
}
