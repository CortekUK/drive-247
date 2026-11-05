"use client";

import { Car, Globe, MapPin, Pencil, RotateCcw } from "lucide-react-nw";

import { formatClockLabel } from "@nw/components/booking/time-utils";
import { rentalCaption } from "@nw/components/booking/price-lines";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import { IllustratedCar } from "@nw/site-v2/illustrations/home-scenes";

import { prettyDate } from "./trip-calendar";
import type { BookingFlow } from "./use-booking-flow";

/**
 * The overview: the booking as it stands, filled in as the customer goes —
 * the trip (with its length and time zone), where, the car, and the price.
 * Every section has its way back to the step that sets it, and "Start over"
 * clears the lot (a second tap confirms, so one slip doesn't). A sticky rail
 * beside the steps on a desktop; the same card in a dialog on a phone.
 */
export function TripOverview({
  flow,
  onNavigate,
  footer,
}: {
  flow: BookingFlow;
  onNavigate?: () => void;
  /** Under the price — on a desktop, the step's way on. */
  footer?: React.ReactNode;
}) {
  const { formatCurrency } = useTenantBranding();
  const { trip, chosen } = flow;
  const go = (step: "trip" | "car") => {
    onNavigate?.();
    flow.goTo(step);
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-pv-border bg-pv-card">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="text-[17px] font-bold tracking-[-0.02em] text-pv-fg">Your trip</h2>
        <StartOver
          onConfirm={() => {
            onNavigate?.();
            flow.startOver();
          }}
          disabled={!flow.tripTouched && !chosen}
        />
      </div>

      {/* When. */}
      <Section title="When" onEdit={flow.step !== "trip" ? () => go("trip") : undefined} editLabel="Edit dates and times">
        <ol className="relative space-y-3 pl-6">
          <span aria-hidden className="absolute bottom-3 left-[7px] top-3 w-0.5 rounded-full bg-pv-primary/25" />
          <TimelineRow label="Pickup" date={trip.pickupDate} time={trip.pickupTime} />
          <li className="relative">
            <span className="inline-flex rounded-full bg-pv-tint px-2.5 py-0.5 text-[11.5px] font-semibold text-pv-primary">
              {flow.days} {flow.days === 1 ? "day" : "days"}
            </span>
          </li>
          <TimelineRow label="Return" date={trip.dropoffDate} time={trip.dropoffTime} />
        </ol>
        <p className="mt-3 flex items-start gap-1.5 text-[12px] leading-snug text-pv-muted-fg">
          <Globe aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            {flow.operatorZone.city} time{flow.operatorZone.short ? ` (${flow.operatorZone.short})` : ""}
            {flow.viewerDiffers ? " — not your device's time zone" : ""}
          </span>
        </p>
      </Section>

      {/* Where — the location step comes later; the operator's own address shows when it is fixed. */}
      <Section title="Where">
        <p className="flex items-start gap-2 text-[13px] text-pv-muted-fg">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          {flow.rules.fixedPickupAddress ? (
            <span className="text-pv-fg">{flow.rules.fixedPickupAddress}</span>
          ) : (
            <span>Pickup and return are chosen at checkout.</span>
          )}
        </p>
      </Section>

      {/* The car. */}
      <Section title="Car" onEdit={chosen && flow.step !== "car" ? () => go("car") : undefined} editLabel="Change car">
        {chosen ? (
          <div key={chosen.vehicle.id} className="qb-rise-in flex items-center gap-3">
            <span className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-pv-tint/60">
              {chosen.fleet.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
                <img src={chosen.fleet.photoUrl} alt="" className="size-full object-cover" />
              ) : (
                <IllustratedCar id="nwbfov" className="w-[86%]" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-pv-fg">{chosen.fleet.name}</span>
              <span className="block truncate text-[12px] text-pv-muted-fg">
                {[chosen.fleet.categoryLabel, chosen.fleet.year].filter(Boolean).join(" · ")}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-pv-border p-3">
            <Car aria-hidden className="size-5 shrink-0 text-pv-muted-fg" />
            <span className="text-[13px] text-pv-muted-fg">
              {flow.step === "car" ? "Choose a car from the list." : "Next, you'll choose your car."}
              {flow.cheapest && !flow.carsLoading ? (
                <span className="block font-semibold text-pv-fg">From {formatCurrency(flow.cheapest.quote.grandTotal)} for these dates</span>
              ) : null}
            </span>
          </div>
        )}
      </Section>

      {/* The price, once there is a car to price. */}
      {chosen ? (
        <div key={`${chosen.vehicle.id}-${chosen.quote.grandTotal}`} className="qb-rise-in border-t border-pv-border bg-pv-muted/40 px-5 py-4">
          <dl className="space-y-2 text-[13px]">
            <Line label="Rental" caption={rentalCaption(chosen.quote, formatCurrency)} value={formatCurrency(chosen.quote.vehicleTotal)} />
            {chosen.quote.serviceFee > 0 ? <Line label="Service fee" value={formatCurrency(chosen.quote.serviceFee)} /> : null}
            {chosen.quote.taxAmount > 0 ? (
              <Line label={`Tax (${chosen.quote.taxPercentage}%)`} value={formatCurrency(chosen.quote.taxAmount)} />
            ) : null}
            {chosen.quote.depositIsCharged && chosen.quote.chargedSecurityDeposit > 0 ? (
              <Line label="Security deposit" value={formatCurrency(chosen.quote.chargedSecurityDeposit)} />
            ) : null}
          </dl>
          <div className="mt-3 flex items-baseline justify-between border-t border-pv-border pt-3">
            <span className="text-[14px] font-semibold text-pv-fg">Total so far</span>
            <span className="text-[22px] font-extrabold tabular-nums tracking-[-0.02em] text-pv-fg">
              {formatCurrency(chosen.quote.grandTotal)}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-pv-muted-fg">
            {!chosen.quote.depositIsCharged && chosen.quote.depositHeldAmount > 0
              ? `A refundable ${formatCurrency(chosen.quote.depositHeldAmount)} deposit is held on your card. `
              : ""}
            Extras and cover can be added at checkout.
          </p>
        </div>
      ) : null}

      {footer ? <div className="border-t border-pv-border p-4">{footer}</div> : null}
    </div>
  );
}

function Section({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit?: () => void;
  editLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-pv-border px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-pv-muted-fg">{title}</h3>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={editLabel}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-pv-link hover:bg-pv-muted"
          >
            <Pencil aria-hidden className="size-3" />
            Edit
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function TimelineRow({ label, date, time }: { label: string; date: string; time: string }) {
  return (
    <li className="relative">
      <span aria-hidden className="absolute -left-6 top-1 size-4 rounded-full border-[3px] border-pv-primary bg-pv-card" />
      <span className="block text-[11.5px] font-medium text-pv-muted-fg">{label}</span>
      <span key={`${date}${time}`} className="qb-pop-text block text-[14px] font-semibold text-pv-fg">
        {prettyDate(date)} · {formatClockLabel(time)}
      </span>
    </li>
  );
}

function Line({ label, caption, value }: { label: string; caption?: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-pv-muted-fg">
        {label}
        {caption ? <span className="block text-[11.5px] opacity-80">{caption}</span> : null}
      </dt>
      <dd className="shrink-0 tabular-nums font-medium text-pv-fg">{value}</dd>
    </div>
  );
}

/** "Start over", then "Tap again to clear" for three seconds. */
/** Clears the trip and the car and goes back to step 1, in one tap. */
export function StartOver({ onConfirm, disabled, className }: { onConfirm: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onConfirm}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-pv-muted-fg transition-colors duration-200 hover:bg-pv-muted hover:text-pv-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
        className,
      )}
    >
      <RotateCcw aria-hidden className="size-3.5" />
      Start over
    </button>
  );
}
