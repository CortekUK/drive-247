"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { sanitizeTripAddress, withTripIntent } from "@/lib/booking/trip-intent";
import { cn } from "@/lib/utils";

/** Shipped copy, used only when the operator has written nothing. */
const DEFAULT_SUBMIT_LABEL = "Book a Car";

type LocationSearchFormProps = {
  className?: string;
  /**
   * The hero CTA's label, from `home_hero.book_cta_text`.
   *
   * This is the operator's own copy and it WINS over the constant above — the
   * default is a fallback for an unconfigured tenant, not a house string to
   * paint over a configured one. It arrives as a prop rather than through
   * `useCmsSection` on purpose: the hero is a Server Component that has already
   * loaded this section, so passing it down costs nothing, whereas reading it
   * here would add a browser round-trip and swap the label of the page's
   * primary CTA after hydration.
   */
  submitLabel?: string | null;
};

export function LocationSearchForm({
  className,
  submitLabel,
}: LocationSearchFormProps) {
  const router = useRouter();
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");

  const label = submitLabel?.trim() ? submitLabel.trim() : DEFAULT_SUBMIT_LABEL;

  /**
   * ── WHAT HAPPENS WITH TWO EMPTY FIELDS ───────────────────────────────────
   * It still navigates. This is the home page's primary call to action and the
   * flow is vehicle-first: nobody can be asked where they want a car delivered
   * before they have chosen one, so neither field is required to start. An
   * empty submit is simply "show me the cars" and lands on the fleet with no
   * banner — which is the page the CTA would have gone to anyway. Blocking it
   * would put a validation error in front of a customer whose only mistake was
   * pressing the button that says "book".
   *
   * The addresses go through `sanitizeTripAddress` on the way OUT as well as on
   * the way in, so the link we generate is one our own parser accepts intact —
   * no trailing-space "address" that survives here and reads as blank on /fleet.
   */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(
      withTripIntent("/booking", {
        pickup: sanitizeTripAddress(pickup),
        dropoff: sanitizeTripAddress(dropoff),
      }),
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className={cn("flex w-full max-w-[360px] flex-col gap-4", className)}
    >
      <Field
        id="pickup"
        label="Pick-up Location"
        value={pickup}
        onChange={setPickup}
        dotColor="#181a17"
        trailing={<MapPin className="size-4 text-brand-ring-dark" strokeWidth={1.5} />}
      />
      <Field
        id="dropoff"
        label="Drop-off Location"
        value={dropoff}
        onChange={setDropoff}
        dotColor="#df232a"
      />
      <div className="pt-4">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-forest px-7 py-[11.5px] text-[13.5px] leading-[20.25px] text-white shadow-[0px_4px_6px_-1px_rgba(0,0,0,0.1),0px_2px_4px_-2px_rgba(0,0,0,0.1)] transition-opacity hover:opacity-90"
        >
          {label}
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  trailing?: React.ReactNode;
  dotColor: string;
};

function Field({ id, label, value, onChange, trailing, dotColor }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] leading-[16.5px] text-brand-text-soft"
      >
        {label}
      </label>
      <div className="relative flex items-center rounded-[8px] border border-white bg-white px-[17px] py-[13px] shadow-[0px_2px_4px_rgba(0,0,0,0.04)]">
        <span
          aria-hidden
          className="size-[11px] shrink-0 rounded-full border-2"
          style={{ borderColor: dotColor }}
        />
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter Address"
          className="flex-1 bg-transparent pl-3 text-[13.5px] text-brand-text placeholder:text-brand-placeholder focus:outline-none"
        />
        {trailing && <span className="ml-2 shrink-0">{trailing}</span>}
      </div>
    </div>
  );
}
