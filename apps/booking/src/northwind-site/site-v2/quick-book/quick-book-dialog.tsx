"use client";

import Link from "next/link";
import * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Car,
  Check,
  FileText,
  IdCard,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react-nw";

import { formatIsoDateLabel } from "@nw/components/booking/time-utils";
import { Button } from "@nw/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "@nw/components/ui/dialog";
import { Skeleton } from "@nw/components/ui/skeleton";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import { PvDialogContent } from "@nw/portal-v2/dialog";

import { TripPicker } from "./trip-picker";
import { useQuickBook, type QuickBook, type QuickBookStep } from "./use-quick-book";

/**
 * Quick book — PROTOTYPE. "Book a car" opens this dialog instead of a page:
 * dates, car, pay. Top to bottom, as every v2 dialog: a centred title and one
 * line, the choices, then one big button.
 * Round, soft and a little bouncy. The logic is all in `use-quick-book.ts`.
 *
 * `QuickBookProvider` holds the one dialog, so a trigger inside a sheet or a
 * menu that unmounts on click still opens it. `QuickBookTrigger` is the button;
 * outside a provider it falls back to the ordinary /booking link.
 */

const QuickBookContext = createContext<(() => void) | null>(null);

export function QuickBookProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const launch = useCallback(() => setOpen(true), []);
  return (
    <QuickBookContext.Provider value={launch}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Mounted only while open, so closing starts the next one fresh. */}
        {open ? <QuickBookBody onClose={() => setOpen(false)} /> : null}
      </Dialog>
    </QuickBookContext.Provider>
  );
}

export const QuickBookTrigger = React.forwardRef<
  HTMLButtonElement & HTMLAnchorElement,
  React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }
>(function QuickBookTrigger({ onClick, children, ...props }, ref) {
  const launch = useContext(QuickBookContext);
  if (launch === null) {
    return (
      <Link ref={ref} href="/booking" onClick={onClick} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        onClick?.(event);
        launch();
      }}
      {...props}
    >
      {children}
    </button>
  );
});

/* ───────────────────────────────── the dialog ──────────────────────────── */

const STEP_NUMBER: Record<Exclude<QuickBookStep, "done">, number> = { when: 1, car: 2, pay: 3 };
const BACK_TO: Partial<Record<QuickBookStep, QuickBookStep>> = { car: "when", pay: "car" };

/** The button every screen ends on: a big friendly pill that squishes when pressed. */
const PRIMARY =
  "qb-press h-14 w-full rounded-full text-[16px] font-semibold shadow-none transition-transform duration-200 ease-out hover:scale-[1.015] active:scale-[0.97] motion-reduce:transition-none";

function QuickBookBody({ onClose }: { onClose: () => void }) {
  const qb = useQuickBook();
  const back = BACK_TO[qb.step];

  return (
    <PvDialogContent className="max-h-[calc(100svh-1rem)] w-[calc(100%-1rem)] max-w-[880px] gap-0 overflow-hidden rounded-[36px] p-0 sm:max-h-[calc(100svh-2rem)] sm:max-w-[880px] sm:rounded-[40px] sm:p-0">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* The controls float in the title's row, so no height goes to them. */}
        <div className="absolute inset-x-0 top-0 z-10 flex h-[72px] items-center gap-2 px-5 pr-14 sm:px-7">
          {back ? (
            <button
              type="button"
              onClick={() => qb.setStep(back)}
              aria-label="Back"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-pv-muted text-pv-fg transition-transform duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
            >
              <ArrowLeft aria-hidden className="size-4" />
            </button>
          ) : null}
          {qb.step !== "done" ? <StepDots current={STEP_NUMBER[qb.step]} /> : null}
        </div>

        <div key={qb.step} className="qb-screen flex flex-col px-5 pb-6 pt-[18px] sm:px-14 sm:pb-8">
          {qb.step === "when" ? <WhenScreen qb={qb} /> : null}
          {qb.step === "car" ? <CarScreen qb={qb} /> : null}
          {qb.step === "pay" ? <PayScreen qb={qb} /> : null}
          {qb.step === "done" ? <DoneScreen qb={qb} onClose={onClose} /> : null}
        </div>
      </div>
    </PvDialogContent>
  );
}

function StepDots({ current }: { current: number }) {
  return (
    <div className="hidden items-center gap-1.5 rounded-full bg-pv-muted px-3 py-2 sm:flex" aria-label={`Step ${current} of 3`}>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "h-2 rounded-full transition-all duration-300 ease-out",
            n === current ? "w-6 bg-pv-primary" : n < current ? "w-2 bg-pv-primary/50" : "w-2 bg-pv-border",
          )}
        />
      ))}
    </div>
  );
}

/** Title (level with the controls) and one friendly line, centred. */
function Heading({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="px-12 text-center sm:px-24">
      <DialogTitle className="text-[20px] font-bold leading-9 tracking-[-0.03em] text-pv-fg sm:text-[28px]">
        {title}
      </DialogTitle>
      {description ? (
        <DialogDescription className="mx-auto mt-1.5 max-w-[440px] text-[15px] leading-relaxed text-pv-muted-fg sm:text-base">
          {description}
        </DialogDescription>
      ) : (
        <DialogDescription className="sr-only">Choose your pickup and return days.</DialogDescription>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  return formatIsoDateLabel(iso).replace(/, \d{4}$/, "");
}

function tripLabel(qb: QuickBook): string {
  return `${shortDate(qb.trip.pickupDate)} to ${shortDate(qb.trip.dropoffDate)}`;
}

/* ── 1. when ───────────────────────────────────────────────────────────── */

function WhenScreen({ qb }: { qb: QuickBook }) {
  const { formatCurrency } = useTenantBranding();
  const count = qb.cars.length;
  const label = !qb.tripValid
    ? "Choose your dates"
    : qb.carsLoading
      ? "Finding cars…"
      : count === 0
        ? "No cars free then"
        : `See ${count === 1 ? "1 car" : `${count} cars`} · from ${formatCurrency(qb.cars[0].quote.grandTotal)}`;

  return (
    <>
      <Heading title="When do you need it?" />
      <div className="mt-5">
        <TripPicker qb={qb} />
      </div>
      <Button
        variant="brand"
        className={cn(PRIMARY, "mt-5")}
        disabled={!qb.tripValid || qb.carsLoading || count === 0}
        onClick={() => qb.setStep("car")}
      >
        {qb.carsLoading ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
        {label}
        {!qb.carsLoading && count > 0 ? <ArrowRight aria-hidden strokeWidth={2.25} /> : null}
      </Button>
    </>
  );
}

/* ── 2. car ────────────────────────────────────────────────────────────── */

function CarScreen({ qb }: { qb: QuickBook }) {
  const { formatCurrency } = useTenantBranding();

  return (
    <>
      <Heading title="Pick your ride" />
      <div className="mt-6">
        {qb.carsLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} className="h-[230px] w-full rounded-[28px] bg-pv-muted" />
            ))}
          </div>
        ) : qb.carsError ? (
          <Notice title="I couldn't load the cars" body="Please try again in a moment." />
        ) : qb.cars.length === 0 ? (
          <Notice title="Nothing is free for those days" body="Go back and move them by a day." />
        ) : (
          <ul className="-mx-5 flex snap-x justify-center-safe gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-14 sm:px-14 [&::-webkit-scrollbar]:hidden">
            {qb.cars.map(({ vehicle, quote }, i) => (
              <li key={vehicle.id} className="qb-rise-in w-[220px] shrink-0 snap-start sm:w-[244px]" style={{ animationDelay: `${i * 60}ms` }}>
                <button
                  type="button"
                  onClick={() => qb.chooseCar(vehicle.id)}
                  className="group flex w-full cursor-pointer flex-col rounded-[28px] bg-pv-muted p-3 text-left transition-all duration-200 ease-out hover:scale-[1.015] hover:bg-pv-tint active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/20 motion-reduce:transition-none"
                >
                  <span className="relative grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-[22px] bg-pv-card">
                    {vehicle.primaryPhotoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={vehicle.primaryPhotoUrl}
                        alt=""
                        className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-110 motion-reduce:transition-none"
                      />
                    ) : (
                      <Car aria-hidden className="size-7 text-pv-muted-fg" strokeWidth={1.5} />
                    )}
                  </span>
                  <span className="min-w-0 px-2 pt-3.5">
                    <span className="block truncate text-[16px] font-semibold text-pv-fg sm:text-[17px]">{vehicle.displayName}</span>
                  </span>
                  <span className="flex items-end justify-between px-2 pb-1.5 pt-3">
                    <span className="block text-[20px] font-bold leading-none tracking-[-0.03em] tabular-nums text-pv-fg">
                      {formatCurrency(quote.grandTotal)}
                    </span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-pv-primary">
                      Choose
                      <ArrowRight aria-hidden className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/* ── 3. pay ────────────────────────────────────────────────────────────── */

function PayScreen({ qb }: { qb: QuickBook }) {
  const { formatCurrency } = useTenantBranding();
  if (!qb.chosen) return null;
  const { vehicle } = qb.chosen;
  const total = qb.finalQuote?.ready ? qb.finalQuote.grandTotal : null;
  const offerProtection = qb.protectionPrice !== null || qb.protectionLoading;

  return (
    <>
      <Heading title="Almost yours" />

      <div className="mt-6 space-y-5">
        {offerProtection ? (
          <div role="radiogroup" aria-label="Cover for the car" className="grid grid-cols-2 gap-3 sm:gap-4">
            <CoverOption
              selected={qb.protect}
              onSelect={() => qb.setProtect(true)}
              icon={<ShieldCheck aria-hidden className="size-5" strokeWidth={2} />}
              title="Protect my trip"
              price={qb.protectionPrice === null ? "…" : `+${formatCurrency(qb.protectionPrice)}`}
            />
            <CoverOption
              selected={!qb.protect}
              onSelect={() => qb.setProtect(false)}
              icon={<FileText aria-hidden className="size-5" strokeWidth={2} />}
              title="I have my own"
              price={formatCurrency(0)}
            />
          </div>
        ) : null}

        {qb.isGuest ? (
          <div>
            <label htmlFor="qb-email" className="sr-only">
              Where should I send your booking?
            </label>
            <input
              id="qb-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="Your email, for the booking"
              value={qb.guestEmail}
              onChange={(event) => qb.setGuestEmail(event.target.value)}
              className="h-14 w-full rounded-full border-2 border-transparent bg-pv-muted px-6 text-center text-base text-pv-fg outline-none transition-all duration-200 placeholder:text-pv-muted-fg/80 hover:bg-pv-tint focus-visible:border-pv-primary focus-visible:bg-pv-card"
            />
          </div>
        ) : (
          <p className="text-center text-[13px] text-pv-muted-fg">
            Booking as <span className="font-semibold text-pv-fg">{qb.customer.displayName}</span>
          </p>
        )}

      </div>

      <Button variant="brand" className={cn(PRIMARY, "mt-6")} disabled={!qb.canPay} onClick={qb.pay}>
        {qb.paying ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Lock aria-hidden strokeWidth={2.25} />}
        {qb.paying ? "Holding your car…" : total === null ? "Pay" : `Pay ${formatCurrency(total)}`}
      </Button>
    </>
  );
}

function CoverOption({
  selected,
  onSelect,
  icon,
  title,
  price,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  price: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[28px] border-2 p-4 text-left sm:gap-4 sm:p-5 transition-all duration-200 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/20 motion-reduce:transition-none",
        selected ? "border-pv-primary bg-pv-tint" : "border-transparent bg-pv-muted hover:bg-pv-tint/60",
      )}
    >
      <span
        key={String(selected)}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full",
          selected ? "qb-pop-text bg-pv-primary text-pv-primary-fg" : "bg-pv-card text-pv-muted-fg",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[15px] font-semibold text-pv-fg">{title}</span>
          <span className="text-[13px] font-bold tabular-nums text-pv-primary">{price}</span>
        </span>
      </span>
    </button>
  );
}

/* ── done ──────────────────────────────────────────────────────────────── */

function DoneScreen({ qb, onClose }: { qb: QuickBook; onClose: () => void }) {
  const vehicle = qb.chosen?.vehicle;
  const needs = useMemo(
    () => [
      { icon: IdCard, title: "Your licence and a selfie", body: "About two minutes, on your phone." },
      ...(qb.protect ? [] : [{ icon: FileText, title: "Your insurance policy", body: "A photo or a PDF is fine." }]),
    ],
    [qb.protect],
  );

  return (
    <>
      <span className="qb-pop-text mx-auto mb-4 grid size-14 place-items-center rounded-full bg-pv-success-light text-pv-success">
        <Check aria-hidden className="size-7" strokeWidth={2.5} />
      </span>
      <Heading
        title={vehicle ? `The ${vehicle.displayName} is yours` : "Your car is held"}
        description={`${tripLabel(qb)}. ${qb.isGuest ? `I've sent the details to ${qb.guestEmail.trim()}.` : "It's in your bookings now."}`}
      />


      <div className="mx-auto mt-6 w-full max-w-[560px]">
        <ul className="grid gap-3 sm:auto-cols-fr sm:grid-flow-col">
          {needs.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              className="qb-rise-in flex items-center gap-4 rounded-[24px] bg-pv-muted p-4"
              style={{ animationDelay: `${120 + i * 80}ms` }}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-pv-card text-pv-primary">
                <Icon aria-hidden className="size-5" strokeWidth={2} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold text-pv-fg">{title}</span>
                <span className="block text-[13px] text-pv-muted-fg">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:gap-3">
      <Button asChild variant="brand" className={cn(PRIMARY, "sm:flex-1")}>
        <Link href={qb.isGuest ? "/signup" : "/portal/verification"} onClick={onClose}>
          Verify now
          <ArrowRight aria-hidden strokeWidth={2.25} />
        </Link>
      </Button>
      <button
        type="button"
        onClick={onClose}
        className="h-12 w-full cursor-pointer rounded-full text-[15px] font-medium text-pv-muted-fg transition-colors duration-200 hover:bg-pv-muted hover:text-pv-fg sm:h-14 sm:w-auto sm:px-8"
      >
        I'll do it later
      </button>
      </div>
      <p className="mt-3 text-center text-[11px] text-pv-muted-fg">Prototype: no booking was made and no card was charged.</p>
    </>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[28px] bg-pv-muted px-6 py-10 text-center">
      <p className="text-[16px] font-semibold text-pv-fg">{title}</p>
      <p className="mt-1.5 text-[14px] text-pv-muted-fg">{body}</p>
    </div>
  );
}
