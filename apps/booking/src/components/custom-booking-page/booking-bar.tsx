"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import MultiStepBookingWidget from "@/components/MultiStepBookingWidget";
import { useTenant } from "@/contexts/TenantContext";
import { useBookingStore } from "@/stores/booking-store";
import { CbpDatePicker, CbpSelect, FieldShell } from "./field-ui";
import { Icon } from "./icons";
import { Reveal } from "./reveal";
import type { CbpContent, CbpLocationOption } from "./use-site-content";

/* ========================================================================== *
 * The booking panel.
 *
 * The BAR is this design's own — the reference's tabbed panel over a single
 * row of fields. What it drives is the app's EXISTING reservation engine: it
 * writes `MultiStepBookingWidget`'s own `formData` into the shared Zustand
 * store and hands the customer to the vehicle step, so availability, extras,
 * insurance, identity checks, pricing and Stripe checkout all run exactly
 * where they already do. None of that is reimplemented here.
 *
 * The engine stays unmounted until the customer searches, so the page shows
 * one trip-details form rather than two, and the tab rail gives way to the
 * engine's own progress UI once it takes over.
 *
 * It deliberately does not navigate to `/booking`: `next.config.ts` 307s that
 * route and everything under it to `/`, so the standalone booking page is
 * retired and the embedded widget IS this app's booking flow.
 * ========================================================================== */

const TABS = [
  { key: "where", label: "Pick-up & Return", icon: "car" },
  { key: "when",  label: "Dates & Time",     icon: "calendar" },
  { key: "what",  label: "Vehicle Type",     icon: "gear" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Half-hour grid for the time listboxes. Values stay `HH:mm` — the shape
 *  the reservation engine parses. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  const period = h >= 12 ? "PM" : "AM";
  return {
    value: String(h).padStart(2, "0") + ":" + m,
    label: (h % 12 === 0 ? 12 : h % 12) + ":" + m + " " + period,
  };
});

/** yyyy-MM-dd for a date `days` from today, in the browser's own timezone. */
function isoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BookingPanel({ c }: { c: CbpContent }) {
  const { tenant } = useTenant();
  const setFormData = useBookingStore(s => s.setFormData);
  const setCurrentStep = useBookingStore(s => s.setCurrentStep);
  const setHighestStepReached = useBookingStore(s => s.setHighestStepReached);
  const currentStep = useBookingStore(s => s.currentStep);

  const pickupOptions = c.pickupOptions;
  const returnOptions = c.returnOptions;

  const [tab, setTab] = useState<TabKey>("where");
  // Default to the operator's first offering — for most that is collection
  // from their own address, which is the answer the customer would pick.
  const [pickupId, setPickupId] = useState(() => pickupOptions[0]?.id ?? "");
  const [pickupText, setPickupText] = useState("");
  const [differentReturn, setDifferentReturn] = useState(false);
  const [returnId, setReturnId] = useState(() => returnOptions[0]?.id ?? "");
  const [returnText, setReturnText] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("10:00");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("10:30");
  const [category, setCategory] = useState("");
  const [today, setToday] = useState("");
  const [searched, setSearched] = useState(false);

  // Seeded after mount, never during render: the server and the browser sit in
  // different timezones, so computing "tomorrow" inline would put a different
  // date in the HTML than in the first client render and trip hydration.
  useEffect(() => {
    setToday(isoDate(0));
    setPickupDate(isoDate(1));
    setReturnDate(isoDate(3));
  }, []);

  // If the customer walks the engine back to step one, hand the bar back too.
  useEffect(() => { if (currentStep <= 1) setSearched(false); }, [currentStep]);

  /** The address to book against, plus the delivery point when there is one. */
  const resolve = (id: string, text: string, opts: CbpLocationOption[]) => {
    const picked = opts.find(o => o.id === id) ?? opts[0] ?? null;
    if (!picked) return { picked: null, value: text.trim(), fee: 0, locationId: "" };
    if (picked.kind === "custom") return { picked, value: text.trim(), fee: 0, locationId: "" };
    return {
      picked, value: picked.address,
      fee: picked.kind === "location" ? picked.fee : 0,
      locationId: picked.kind === "location" ? picked.id : "",
    };
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pick = resolve(pickupId, pickupText, pickupOptions);
    const drop = differentReturn ? resolve(returnId, returnText, returnOptions) : pick;

    if (!pick.value) { setTab("where"); return toast.error("Please choose a pick-up location"); }
    if (!drop.value) { setTab("where"); return toast.error("Please choose a return location"); }
    // The engine's validateStep1 rejects addresses that are too short or carry
    // no letters. Mirror only that much, so a typed address never reaches the
    // vehicle step in a shape the engine would have refused; every richer rule
    // it applies still runs there, unchanged.
    for (const [label, v] of [["pick-up", pick.value], ["return", drop.value]] as const) {
      if (v.length < 5 || !/[a-zA-Z]{3,}/.test(v)) {
        setTab("where");
        return toast.error(`Please enter a complete ${label} address`);
      }
    }
    if (!pickupDate || !returnDate) { setTab("when"); return toast.error("Please choose your dates"); }

    // Duration and lead time, read from the SAME tenant settings the engine
    // reads so the two cannot disagree. This is a pre-check for a better error
    // at the point of entry, not a replacement — the engine still enforces all
    // of it before any booking is created.
    const start = new Date(`${pickupDate}T${pickupTime}:00`);
    const end = new Date(`${returnDate}T${returnTime}:00`);
    const hours = (end.getTime() - start.getTime()) / 36e5;
    if (hours <= 0) { setTab("when"); return toast.error("Return must be after pick-up"); }

    const minHours = Math.max(1, (tenant?.min_rental_days ?? 0) * 24 + (tenant?.min_rental_hours ?? 1));
    if (hours < minHours) {
      const d = Math.floor(minHours / 24), h = minHours % 24;
      const parts = [d ? `${d} day${d !== 1 ? "s" : ""}` : "", h ? `${h} hour${h !== 1 ? "s" : ""}` : ""].filter(Boolean);
      setTab("when");
      return toast.error(`Minimum rental period is ${parts.join(" ")}`);
    }
    const maxDays = tenant?.max_rental_days ?? 90;
    if (hours / 24 > maxDays) { setTab("when"); return toast.error(`Maximum rental period is ${maxDays} days`); }

    const lead = tenant?.booking_lead_time_hours ?? 24;
    if (lead > 0 && (start.getTime() - Date.now()) / 36e5 < lead) {
      setTab("when");
      return toast.error(`Bookings need at least ${lead} hours' notice`);
    }

    // The engine's own step-one state. Dates are `yyyy-MM-dd` and times
    // `HH:mm`, which is exactly what it parses back out.
    setFormData(prev => ({
      ...prev,
      pickupLocation: pick.value,
      dropoffLocation: drop.value,
      pickupDate, dropoffDate: returnDate,
      pickupTime, dropoffTime: returnTime,
      // A configured delivery point carries its id and fee; the operator's own
      // address and a customer-typed one carry neither, which is exactly how
      // the engine distinguishes them.
      pickupLocationId: pick.locationId,
      returnLocationId: drop.locationId,
      pickupDeliveryFee: pick.fee,
      returnDeliveryFee: drop.fee,
    }));

    setHighestStepReached(2);
    setCurrentStep(2);
    setSearched(true);
    requestAnimationFrame(() => {
      document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    // Rendered inside the hero section, which owns the surrounding spacing —
    // no wrap and no negative pull here, or the panel would be offset twice.
    <section id="booking" className="scroll-mt-24">
      <Reveal className="cbp-card overflow-hidden !rounded-[var(--r-xl)] shadow-[var(--shadow-lg)]">
        {/* ------------------------------------------------------- tab rail */}
        <div className="flex overflow-x-auto border-b border-[var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-on={tab === t.key}
              aria-pressed={tab === t.key}
              className="cbp-tab"
            >
              <Icon name={t.icon} className="h-4 w-4 shrink-0" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ------------------------------------------------------------ form
            One form across all three tabs: the tabs scope which fields are
            visible on a narrow screen, and every field shows at once from
            `lg` up, exactly as the reference lays it out. Fields stay mounted
            either way, so switching tabs never discards what was typed. */}
        <form onSubmit={submit} className="p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-end xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.05fr)_minmax(150px,1fr)_minmax(132px,.8fr)_minmax(150px,1fr)_minmax(132px,.8fr)_auto] xl:gap-2.5">
            <Field label="Pick-up Location" show={tab === "where"}>
              <LocationField
                label="Pick-up Location" options={pickupOptions}
                value={pickupId} onChange={setPickupId}
                text={pickupText} setText={setPickupText}
              />
            </Field>

            <Field label="Return Location" show={tab === "where"}>
              {differentReturn ? (
                <LocationField
                  label="Return Location" options={returnOptions}
                  value={returnId} onChange={setReturnId}
                  text={returnText} setText={setReturnText}
                />
              ) : (
                <div className="cbp-field-shell">
                  <Icon name="pin" className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                  <button
                    type="button"
                    onClick={() => setDifferentReturn(true)}
                    className="cbp-field truncate text-left text-[var(--body)] hover:text-[var(--brand)]"
                  >
                    Same as pick-up
                  </button>
                </div>
              )}
            </Field>

            <Field label="Pick-up Date" show={tab === "when"}>
              <CbpDatePicker label="Pick-up date" value={pickupDate} min={today} onChange={setPickupDate} />
            </Field>

            <Field label="Pick-up Time" show={tab === "when"}>
              <CbpSelect label="Pick-up time" icon="clock" value={pickupTime} onChange={setPickupTime} options={TIME_OPTIONS} />
            </Field>

            <Field label="Return Date" show={tab === "when"}>
              <CbpDatePicker label="Return date" value={returnDate} min={pickupDate || today} onChange={setReturnDate} />
            </Field>

            <Field label="Return Time" show={tab === "when"}>
              <CbpSelect label="Return time" icon="clock" value={returnTime} onChange={setReturnTime} options={TIME_OPTIONS} />
            </Field>

            {/* Vehicle type only exists once the operator has categorised the
                fleet — an "Any type" select with nothing behind it is a dead
                control, so it is omitted rather than shown empty. */}
            {c.categories.length > 0 && (
              <Field label="Vehicle Type" show={tab === "what"} className="lg:col-span-6 lg:col-start-1 lg:mt-2">
                <CbpSelect
                  label="Vehicle type" icon="car" value={category} onChange={setCategory}
                  options={[{ value: "", label: "Any Type" },
                            ...c.categories.map(cat => ({ value: cat, label: cat }))]}
                />
              </Field>
            )}

            <button type="submit" className="cbp-btn cbp-btn-primary h-[42px] w-full lg:w-auto">
              <Icon name="search" className="h-4 w-4 shrink-0" />
              Find My Ride
              <Icon name="arrow" className="cbp-arrow h-4 w-4 shrink-0" />
            </button>
          </div>

          {/* The reference's "Return to different location" checkbox. */}
          {returnOptions.length > 1 && (
            <label className={`mt-3 inline-flex cursor-pointer items-center gap-2 text-[13px] text-[var(--body)] ${tab === "where" ? "" : "hidden lg:inline-flex"}`}>
              <input
                type="checkbox"
                checked={differentReturn}
                onChange={e => setDifferentReturn(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              Return to different location
            </label>
          )}
        </form>

        {c.booking.trustPoints.length > 0 && !searched && (
          <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--line-2)] px-5 py-3.5">
            {c.booking.trustPoints.map(p => (
              <li key={p} className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--body)]">
                <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                {p}
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {/* ------------------------------------------------ the real engine */}
      {searched && (
        <div className="cbp-rise mt-8">
          <MultiStepBookingWidget />
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A labelled field. Below `lg` only the active tab's fields are shown, which
 * is what makes the reference's tab rail meaningful on a phone; from `lg` up
 * every field is visible at once and the tabs act as jump targets.
 */
function Field({
  label, show, className = "", children,
}: { label: string; show: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`${show ? "block" : "hidden lg:block"} ${className}`}>
      <span className="cbp-label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

/**
 * How a customer states where they are collecting or returning.
 *
 * Driven entirely by what the operator offers:
 *   one fixed option  -> a plain, already-answered line. Nothing to choose and
 *                        nothing to type; asking would be asking a question
 *                        with a single possible answer.
 *   several options   -> a listbox, with a text box appearing only when the
 *                        chosen option is delivery to the customer's address.
 */
function LocationField({
  label, options, value, onChange, text, setText,
}: {
  label: string;
  options: CbpLocationOption[];
  value: string;
  onChange: (id: string) => void;
  text: string;
  setText: (v: string) => void;
}) {
  const selected = options.find(o => o.id === value) ?? options[0];
  const single = options.length === 1;
  const needsTyping = selected?.kind === "custom";

  // One option and nothing to type: FieldShell is the static, already-answered
  // presentation — no trigger, no menu.
  if (single && !needsTyping) {
    return <FieldShell label={label} icon="pin" value={selected.label} sub={selected.address} />;
  }

  return (
    <div className="space-y-2">
      {!single && (
        <CbpSelect
          label={label}
          icon="pin"
          value={selected?.id ?? ""}
          onChange={onChange}
          options={options.map(o => ({
            value: o.id,
            label: o.label,
            sub: o.kind === "location" && o.fee > 0 ? `+${o.fee}` : undefined,
            detail: o.kind === "custom" ? undefined : o.address,
          }))}
        />
      )}

      {needsTyping && (
        <div className="cbp-fld">
          <Icon name="pin" className="cbp-fld-icon" />
          <input
            type="text" value={text} onChange={e => setText(e.target.value)}
            placeholder="Street, city"
            className="cbp-fld-body w-full bg-transparent outline-none placeholder:font-medium placeholder:text-[var(--field-muted)]"
            aria-label={label}
          />
        </div>
      )}
    </div>
  );
}
