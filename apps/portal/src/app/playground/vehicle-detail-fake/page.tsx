"use client";

/**
 * Vehicle control centre — DESIGN SANDBOX. Nothing here is real.
 *
 * No Supabase, no tenant, no auth, no react-query, no network of any kind. All
 * state is local, seeded from the hardcoded record in `_data.ts`, so this route
 * opens cold at /playground/vehicle-detail-fake and can be driven hard without
 * touching a single production row.
 *
 * It is the same argument the rental screen makes, applied to a car:
 *
 *   1. The vehicle ALREADY EXISTS. There is no Save and no Submit — a keystroke
 *      is the commit. A form that asks you to confirm you meant it is a form
 *      that does not trust its own record.
 *
 *   2. TWO RAILS THAT DO DIFFERENT JOBS. The left is navigation and nothing
 *      else — a plain grouped sidebar in `app-sidebar-v2`'s own measurements,
 *      which looks the same every time you glance at it. The right is the
 *      readout: status, what needs attention, and the numbers worth knowing.
 *
 *      An earlier pass hung a live summary and a colour state off every left
 *      rail row. It read well in a screenshot and worked badly: the eye is
 *      dragged left on every keystroke, and the rail stops being navigable by
 *      shape, because the thing you are trying to find by position keeps
 *      changing height and colour. Navigation is learned once. State is read
 *      constantly. They are not the same surface.
 *
 *   3. Nine tabs, not fifteen. The first cut had a tab for every concern in
 *      the schema; this one has a tab for every QUESTION an operator asks, and
 *      nothing on any tab that only explains. Three groups of inputs, then
 *      Record — the two things produced from them.
 *
 *   4. When an input moves under an output, the output says so ITSELF, in its
 *      own words, with the real before and after, and offers both ways out:
 *      republish, or accept that the published one still stands. Amber, never
 *      red — a rate going up after a listing went live is a Tuesday. Every one
 *      of those lands in the right rail as a row you can click to get to it.
 *
 * WHAT IS DELIBERATELY ABSENT. Tesla Fleet, Fleet Health, vehicle ownership
 * splits, per-vehicle expenses and Inshur eligibility are all on v1's vehicle
 * page and none are here — they are gated off the lean product in
 * `lib/lean-areas.ts`, so the canary does not carry them.
 */

import { useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarDays,
  Car,
  Globe,
  KeyRound,
  MapPin,
  Package,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { RailGroup, RailHeader, money, type Drift } from "@/app/playground/_shared";
import {
  DEMO_AVAILABILITY,
  DEMO_COMPLIANCE,
  DEMO_CUSTODY,
  DEMO_DOCS,
  DEMO_EVENTS,
  DEMO_EXTRAS,
  DEMO_FINANCE,
  DEMO_HANDLING,
  DEMO_IDENTITY,
  DEMO_LISTING_SNAPSHOT,
  DEMO_MAINTENANCE,
  DEMO_MILEAGE,
  DEMO_PHOTOS,
  DEMO_PUBLISHED_AT,
  DEMO_RATES,
  DEMO_RENTALS,
  DEMO_RETIREMENT,
  DEMO_SEASONAL,
  EXPIRY_WARNING_DAYS,
  HANDOVER_METHODS,
  PICKUP_LOCATIONS,
  SERVICE_INTERVAL_MILES,
  TODAY,
  UTILISATION_WINDOW_DAYS,
  type Availability,
  type Compliance,
  type Custody,
  type Extra,
  type Finance,
  type Handling,
  type Identity,
  type ListingSnapshot,
  type Maintenance,
  type Mileage,
  type Photo,
  type Rates,
  type Retirement,
  type Seasonal,
  type VehicleDoc,
  daysBetween,
  daysUntil,
  miles,
} from "./_data";
import { VehicleTab } from "./_tabs-car";
import { AddonsTab, RatesTab } from "./_tabs-money";
import { AvailabilityTab, PickupTab, type Blocker } from "./_tabs-going-out";
import { KeysDocsTab, UpkeepTab, type ComplianceRow, type Verdict } from "./_tabs-upkeep";
import { ListingTab, MoneyTab } from "./_tabs-record";
import { NavItem } from "./_ui";
import { OverviewRail, type Attention, type Vital } from "./_overview-rail";

/* ══════════════════════════════════════════════════════════════════════════
 * The rail
 * ═════════════════════════════════════════════════════════════════════════ */

type TabKey =
  | "vehicle"
  | "rates"
  | "addons"
  | "availability"
  | "pickup"
  | "upkeep"
  | "keys"
  | "listing"
  | "money";

/**
 * The left rail, in full. Static — it reads no state.
 *
 * Nine tabs, each answering one question. An earlier cut had fifteen; the
 * merges are recorded at the top of each tab file. `Record` is last because
 * both of its tabs are produced from the seven above.
 */
const GROUPS: { label: string; items: { key: TabKey; icon: typeof Car; label: string }[] }[] = [
  { label: "The car", items: [{ key: "vehicle", icon: Car, label: "Vehicle" }] },
  {
    label: "Pricing",
    items: [
      { key: "rates", icon: Banknote, label: "Rates & mileage" },
      { key: "addons", icon: Package, label: "Extras & surcharges" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "availability", icon: CalendarDays, label: "Availability" },
      { key: "pickup", icon: MapPin, label: "Pickup & handover" },
      { key: "upkeep", icon: ShieldCheck, label: "Compliance & servicing" },
      { key: "keys", icon: KeyRound, label: "Keys & documents" },
    ],
  },
  {
    label: "Record",
    items: [
      { key: "listing", icon: Globe, label: "Listing" },
      { key: "money", icon: TrendingUp, label: "Money" },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * Screen
 * ═════════════════════════════════════════════════════════════════════════ */

export default function VehicleDetailFakePage() {
  /* ── inputs ─────────────────────────────────────────────────────────── */
  const [identity, setIdentity] = useState<Identity>(DEMO_IDENTITY);
  const [rates, setRates] = useState<Rates>(DEMO_RATES);
  const [mileage, setMileage] = useState<Mileage>(DEMO_MILEAGE);
  const [extras, setExtras] = useState<Extra[]>(DEMO_EXTRAS);
  const [seasonal, setSeasonal] = useState<Seasonal>(DEMO_SEASONAL);
  const [availability, setAvailability] = useState<Availability>(DEMO_AVAILABILITY);
  const [handling, setHandling] = useState<Handling>(DEMO_HANDLING);
  const [compliance, setCompliance] = useState<Compliance>(DEMO_COMPLIANCE);
  const [maintenance, setMaintenance] = useState<Maintenance>(DEMO_MAINTENANCE);
  const [custody, setCustody] = useState<Custody>(DEMO_CUSTODY);
  const [docs, setDocs] = useState<VehicleDoc[]>(DEMO_DOCS);
  const [photos, setPhotos] = useState<Photo[]>(DEMO_PHOTOS);
  const [finance, setFinance] = useState<Finance>(DEMO_FINANCE);

  /* ── outputs ────────────────────────────────────────────────────────── */
  const [listingLive, setListingLive] = useState(true);
  const [publishedAt, setPublishedAt] = useState<Date | null>(DEMO_PUBLISHED_AT);

  /** What customers are actually being shown. NOT the live record. */
  const [snapshot, setSnapshot] = useState<ListingSnapshot | null>(DEMO_LISTING_SNAPSHOT);

  /**
   * The record as it stood when the operator last said "keep the published
   * one".
   *
   * This exists so that accepting drift does not have to lie. The obvious
   * implementation — re-snapshot on both buttons — makes "Keep the published
   * one" silently rewrite what the screen claims customers are seeing, so the
   * listing then reports today's price as the published one. Holding the
   * acknowledgement separately lets the drift stop nagging while `snapshot`
   * keeps telling the truth about the public page. Move the record again and
   * the acknowledgement no longer matches, so it speaks up again.
   */
  const [acknowledged, setAcknowledged] = useState<ListingSnapshot | null>(null);

  const [retirement, setRetirement] = useState<Retirement>(DEMO_RETIREMENT);

  const [tab, setTab] = useState<TabKey>("vehicle");

  /** Monotonic id source — a counter, not `Math.random`, so ids are stable
   *  across re-renders and nothing is generated during render. */
  const seq = useRef(100);
  const nextId = (prefix: string) => `${prefix}-${++seq.current}`;

  /** Rentals have no mutation UI here, so they are a constant, not state. */
  const rentals = DEMO_RENTALS;

  /* ── derived: identity & rates ──────────────────────────────────────── */

  const vehicleName = useMemo(
    () => [identity.year, identity.make, identity.model].filter(Boolean).join(" "),
    [identity],
  );

  const identityFilled = [
    identity.make,
    identity.model,
    identity.year,
    identity.registration,
    identity.colour,
    identity.vin,
  ].filter(Boolean).length;

  const identityComplete = Boolean(
    identity.make && identity.model && identity.year && identity.registration,
  );

  const ratesComplete = rates.daily > 0 && rates.deposit > 0;
  const ratesStarted =
    rates.daily > 0 || rates.weekly > 0 || rates.monthly > 0 || rates.deposit > 0;

  const activeDurations = useMemo(() => {
    const on: string[] = [];
    if (rates.availableDaily) on.push("Daily");
    if (rates.availableWeekly) on.push("Weekly");
    if (rates.availableMonthly) on.push("Monthly");
    return on;
  }, [rates]);

  const enabledExtras = useMemo(() => extras.filter((e) => e.enabled), [extras]);

  /**
   * Written by hand rather than through `money()`, which rounds to whole
   * dollars — an excess rate is cents-significant, and "$0 per extra mile" is
   * a different promise from "$0.35 per extra mile".
   */
  const allowanceText =
    mileage.dailyMiles > 0
      ? `${mileage.dailyMiles} mi/day · $${mileage.excessPerMile.toFixed(2)} per extra mile`
      : "No allowance set";

  /* ── derived: the listing snapshot vs the live record ───────────────── */

  const photoSignature = useMemo(() => photos.map((p) => p.label).join(" › "), [photos]);

  const currentSnapshot = useMemo<ListingSnapshot>(
    () => ({
      name: vehicleName || "Untitled vehicle",
      registration: identity.registration,
      colour: identity.colour,
      daily: rates.daily,
      weekly: rates.weekly,
      monthly: rates.monthly,
      deposit: rates.deposit,
      durations: activeDurations.join(", ") || "None",
      allowance: allowanceText,
      extras: enabledExtras.map((e) => e.name).join(", "),
      photos: photoSignature,
    }),
    [vehicleName, identity, rates, activeDurations, allowanceText, enabledExtras, photoSignature],
  );

  /** The operator has already answered for exactly this state of the record. */
  const driftAcknowledged =
    acknowledged !== null && JSON.stringify(acknowledged) === JSON.stringify(currentSnapshot);

  /**
   * The drift table.
   *
   * Only fields the public listing actually shows are compared. Blocked dates,
   * the odometer, compliance and the lockbox code all move without making the
   * listing stale, and that asymmetry is deliberate: it teaches which inputs
   * the output is really built from.
   */
  const drift = useMemo<Drift[]>(() => {
    if (!listingLive || !snapshot || driftAcknowledged) return [];
    const rows: Drift[] = [];
    const push = (label: string, was: string, now: string) => {
      if (was !== now) rows.push({ label, was: was || "—", now: now || "—" });
    };

    push("Vehicle", snapshot.name, currentSnapshot.name);
    push("Registration", snapshot.registration, currentSnapshot.registration);
    push("Colour", snapshot.colour, currentSnapshot.colour);
    push("Daily rate", `${money(snapshot.daily)}/day`, `${money(currentSnapshot.daily)}/day`);
    push("Weekly rate", `${money(snapshot.weekly)}/week`, `${money(currentSnapshot.weekly)}/week`);
    push("Monthly rate", `${money(snapshot.monthly)}/month`, `${money(currentSnapshot.monthly)}/month`);
    push("Deposit", money(snapshot.deposit), money(currentSnapshot.deposit));
    push("Bookable as", snapshot.durations, currentSnapshot.durations);
    push("Mileage", snapshot.allowance, currentSnapshot.allowance);
    push("Extras", snapshot.extras || "None", currentSnapshot.extras || "None");

    if (snapshot.photos !== currentSnapshot.photos) {
      const describe = (sig: string) => {
        const list = sig ? sig.split(" › ") : [];
        return list.length ? `${list.length} photos · cover ${list[0]}` : "No photos";
      };
      rows.push({
        label: "Photos",
        was: describe(snapshot.photos),
        now: describe(currentSnapshot.photos),
      });
    }
    return rows;
  }, [listingLive, snapshot, currentSnapshot, driftAcknowledged]);

  const listingStale = drift.length > 0;

  /* ── derived: compliance ────────────────────────────────────────────── */

  const verdictOf = (iso: string): Verdict => {
    if (!iso) return "unset";
    const d = daysUntil(iso);
    if (d < 0) return "expired";
    if (d <= EXPIRY_WARNING_DAYS) return "soon";
    return "valid";
  };

  /**
   * Inspection and registration decide whether the car may legally go out.
   * The warranty does not — it decides who pays for the next repair. Painting
   * all three the same colour is how an operator learns to ignore the colour.
   */
  const complianceRows = useMemo<ComplianceRow[]>(
    () =>
      (
        [
          {
            key: "inspection" as const,
            label: "Inspection",
            date: compliance.inspection,
            blocking: true,
          },
          {
            key: "registration" as const,
            label: "Registration",
            date: compliance.registration,
            blocking: true,
          },
          {
            key: "warrantyEnd" as const,
            label: "Warranty",
            date: compliance.warrantyEnd,
            blocking: false,
          },
        ] satisfies Omit<ComplianceRow, "verdict">[]
      ).map((r) => ({ ...r, verdict: verdictOf(r.date) })),
    [compliance],
  );

  const complianceSet = complianceRows.filter((r) => r.verdict !== "unset").length;
  const complianceBlocking = complianceRows.filter((r) => r.blocking && r.verdict === "expired");
  const complianceSoon = complianceRows.filter((r) => r.verdict === "soon");

  /* ── derived: maintenance ───────────────────────────────────────────── */

  const lastService = useMemo(
    () =>
      maintenance.services.length
        ? maintenance.services.slice().sort((a, b) => b.mileage - a.mileage)[0]
        : null,
    [maintenance.services],
  );
  const nextServiceMileage = lastService ? lastService.mileage + SERVICE_INTERVAL_MILES : null;
  const milesToService = nextServiceMileage !== null ? nextServiceMileage - maintenance.odometer : null;
  const serviceOverdue = milesToService !== null && milesToService <= 0;
  const serviceSpend = maintenance.services.reduce((sum, s) => sum + s.cost, 0);

  /* ── derived: rentals & money ───────────────────────────────────────── */

  const counted = rentals.filter((r) => r.status !== "Cancelled");
  const totalRevenue = counted.reduce((sum, r) => sum + r.revenue, 0);
  const daysOnHire = counted.reduce((sum, r) => sum + daysBetween(r.from, r.to), 0);
  const utilisation = Math.min(100, Math.round((daysOnHire / UTILISATION_WINDOW_DAYS) * 100));
  const activeRentals = rentals.filter((r) => r.status === "Active");
  const hasActiveRental = activeRentals.length > 0;

  /** Whole months from the finance start to today, never past the term. */
  const monthsElapsed = useMemo(() => {
    if (!finance.startDate) return 0;
    const start = new Date(`${finance.startDate}T00:00:00`);
    const now = new Date(`${TODAY}T00:00:00`);
    const months =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth()) -
      (now.getDate() < start.getDate() ? 1 : 0);
    return Math.max(0, Math.min(months, finance.termMonths || months));
  }, [finance]);

  const financePaid = finance.initialPayment + monthsElapsed * finance.monthlyPayment;
  const contractTotal =
    finance.initialPayment + finance.termMonths * finance.monthlyPayment + finance.balloon;
  const net = totalRevenue - financePaid - serviceSpend;

  /* ── derived: what is stopping this car being booked ────────────────── */

  const blockers = useMemo<Blocker[]>(() => {
    const list: Blocker[] = [];

    if (retirement.disposed) {
      list.push({
        key: "retired",
        label: "Retired from the fleet",
        detail: `Sold ${retirement.date ? `on ${retirement.date}` : ""}${retirement.buyer ? ` to ${retirement.buyer}` : ""}`.trim(),
        severity: "hard",
      });
    }

    if (availability.paused) {
      list.push({
        key: "paused",
        label: "Paused",
        detail: availability.pausedReason || "No reason recorded",
        severity: "hard",
      });
    }

    for (const r of complianceBlocking) {
      list.push({
        key: `cert-${r.key}`,
        label: `${r.label} expired`,
        detail: `Ran out ${Math.abs(daysUntil(r.date))} days ago. The car comes back the moment the date is renewed.`,
        severity: "hard",
      });
    }

    if (!listingLive && !retirement.disposed) {
      list.push({
        key: "unlisted",
        label: "Not on the booking site",
        detail: "The record exists but nothing about this car is public.",
        severity: "hard",
      });
    }

    if (activeDurations.length === 0) {
      list.push({
        key: "no-durations",
        label: "No hire length is switched on",
        detail: "Daily, weekly and monthly are all off, so nothing can be quoted.",
        severity: "hard",
      });
    }

    /*
     * An open rental blocks the DATES it covers, not the car. A car due back on
     * Friday is perfectly bookable from Saturday, and treating it as unavailable
     * outright is how an operator turns away a booking they could have taken.
     * An OVERDUE rental is the exception: it has no end, so it blocks everything
     * until somebody closes it — and it is almost always a rental that was
     * forgotten rather than a car that is still out.
     */
    for (const r of activeRentals) {
      const overdue = r.to < TODAY;
      list.push({
        key: `rental-${r.id}`,
        label: overdue ? `Open rental past its end date` : "Out on hire",
        detail: overdue
          ? `${r.customer}'s rental ended ${Math.abs(daysUntil(r.to))} days ago and is still open.`
          : `${r.customer} has it until ${r.to}.`,
        severity: overdue ? "hard" : "soft",
      });
    }

    if (availability.blackouts.length) {
      const upcoming = availability.blackouts.filter((b) => b.to >= TODAY);
      if (upcoming.length) {
        list.push({
          key: "blackouts",
          label: `${upcoming.length} blocked period${upcoming.length === 1 ? "" : "s"}`,
          detail: upcoming.map((b) => b.reason).join(" · "),
          severity: "soft",
        });
      }
    }

    return list;
  }, [
    retirement,
    availability,
    complianceBlocking,
    listingLive,
    activeDurations,
    activeRentals,
  ]);

  const hardBlockers = blockers.filter((b) => b.severity === "hard");

  /**
   * The hard blockers that are a FAULT rather than a choice.
   *
   * "Not on the booking site" is a hard blocker — nobody can book an unlisted
   * car — but it is also exactly what the operator asked for when they pressed
   * Unlist. Colouring a deliberate act amber and counting it under "needs
   * attention" teaches people that amber means nothing. So it still appears in
   * Availability's list of reasons, and it is kept out of the status chip and
   * out of the amber count.
   */
  const faultBlockers = hardBlockers.filter((b) => b.key !== "unlisted");

  /** Why the listing is up but unbookable — the one sentence Listing needs. */
  const suspendedReason = faultBlockers.length
    ? `${faultBlockers[0].label.toLowerCase()} — ${faultBlockers[0].detail}`
    : null;

  /* ── derived: the header status, computed and never chosen ──────────── */

  const status = retirement.disposed
    ? { label: "Retired", tone: "muted" as const }
    : availability.paused
      ? { label: "Paused", tone: "warning" as const }
      : faultBlockers.length
        ? { label: "Off the road", tone: "warning" as const }
        : hasActiveRental
          ? { label: "On hire", tone: "success" as const }
          : listingLive
            ? { label: "Listed", tone: "success" as const }
            : identityComplete && ratesComplete
              ? { label: "Ready", tone: "primary" as const }
              : { label: "Draft", tone: "muted" as const };

  /* ── the right rail: what wants doing, and the numbers ─────────────── */

  /**
   * Everything that wants an operator's attention, as rows that can be clicked
   * through to the tab that owns the problem.
   *
   * The list is built from the domain, not from the navigation, which is what
   * lets the left rail stay static. An amber line that says something is wrong
   * without saying where just moves the hunt somewhere else, so every row here
   * carries the tab it belongs to.
   *
   * An EXPIRED WARRANTY is deliberately not in here. It has already happened,
   * it stops nothing, and there is no action to take — it belongs on the
   * Compliance tab as a fact, not in a list of things to do.
   */
  const attention = useMemo<Attention<TabKey>[]>(() => {
    const list: Attention<TabKey>[] = [];

    if (listingStale) {
      list.push({
        key: "listing",
        target: "listing",
        label: `Listing is ${drift.length} change${drift.length === 1 ? "" : "s"} behind`,
        detail: "Republish it, or accept the published one",
      });
    }

    for (const r of complianceBlocking) {
      list.push({
        key: `cert-${r.key}`,
        target: "upkeep",
        label: `${r.label} expired`,
        detail: `Ran out ${Math.abs(daysUntil(r.date))} days ago — the car is off the site`,
      });
    }

    for (const r of complianceSoon) {
      list.push({
        key: `soon-${r.key}`,
        target: "upkeep",
        label: `${r.label} expires in ${daysUntil(r.date)} days`,
        detail: r.blocking
          ? "Renew it before it takes the car off the site"
          : "Cover ends — repairs stop being paid for",
      });
    }

    if (serviceOverdue) {
      list.push({
        key: "service",
        target: "upkeep",
        label: `Service overdue by ${miles(Math.abs(milesToService!))}`,
        detail: `Due at ${miles(nextServiceMileage!)}, odometer reads ${miles(maintenance.odometer)}`,
      });
    }

    if (availability.paused) {
      list.push({
        key: "paused",
        target: "availability",
        label: "Paused — not bookable",
        detail: availability.pausedReason || "No reason recorded",
      });
    }

    for (const r of activeRentals.filter((r) => r.to < TODAY)) {
      list.push({
        key: `overdue-${r.id}`,
        target: "availability",
        label: `${r.customer}'s rental is overdue`,
        detail: "Still open past its end date, so the car cannot be re-let",
      });
    }

    if (activeDurations.length === 0) {
      list.push({
        key: "durations",
        target: "rates",
        label: "No hire length is switched on",
        detail: "Nothing can be quoted for this car",
      });
    }

    if (handling.handover === "lockbox" && !handling.lockboxCode) {
      list.push({
        key: "lockbox",
        target: "pickup",
        label: "Lockbox handover with no code",
        detail: "Customers would get instructions and nothing to open the box",
      });
    }

    if (photos.length === 0) {
      list.push({
        key: "photos",
        target: "vehicle",
        label: "No photographs",
        detail: "A listing without photos takes a fraction of the bookings",
      });
    }

    return list;
  }, [
    listingStale,
    drift.length,
    complianceBlocking,
    complianceSoon,
    serviceOverdue,
    milesToService,
    nextServiceMileage,
    maintenance.odometer,
    availability,
    activeRentals,
    activeDurations,
    handling,
    photos,
  ]);

  /**
   * The numbers worth seeing without opening anything.
   *
   * Six, not sixteen. A glance panel that lists everything is a tab, and the
   * tabs are three inches to the left.
   */
  const vitals: Vital[] = [
    {
      label: "Daily rate",
      value: rates.daily ? `${money(rates.daily)}/day` : "Not set",
      hint: rates.deposit ? `${money(rates.deposit)} deposit` : undefined,
    },
    { label: "Odometer", value: miles(maintenance.odometer) },
    {
      label: "Next service",
      value:
        nextServiceMileage === null
          ? "No history"
          : serviceOverdue
            ? `${miles(Math.abs(milesToService!))} over`
            : `in ${miles(milesToService!)}`,
      hint: nextServiceMileage !== null ? `due at ${miles(nextServiceMileage)}` : undefined,
      tone: serviceOverdue ? "warning" : "default",
    },
    {
      label: "Utilisation",
      value: `${utilisation}%`,
      hint: `${daysOnHire} of ${UTILISATION_WINDOW_DAYS} days`,
    },
    {
      label: "Earned",
      value: money(totalRevenue),
      hint: `${counted.length} rental${counted.length === 1 ? "" : "s"}`,
    },
    {
      label: net >= 0 ? "Ahead by" : "Behind by",
      value: money(Math.abs(net)),
      hint: "after finance & servicing",
      tone: net >= 0 ? "success" : "warning",
    },
  ];

  /** Where the public listing stands, in the fewest words that are still true. */
  const listingLine = !listingLive
    ? "Not listed"
    : listingStale
      ? `Live · ${drift.length} behind`
      : driftAcknowledged
        ? "Live · kept as published"
        : "Live";

  /* ── mutations ──────────────────────────────────────────────────────── */

  const publishListing = () => {
    setListingLive(true);
    setPublishedAt(new Date());
    setSnapshot(currentSnapshot);
    setAcknowledged(null);
  };

  /** The published page stands. Record the answer without touching what it says. */
  const acceptDrift = () => setAcknowledged(currentSnapshot);

  const unlist = () => {
    setListingLive(false);
    setPublishedAt(null);
    setSnapshot(null);
    setAcknowledged(null);
  };

  /**
   * Retiring a car takes it off the site on the way out.
   *
   * The next state is computed from `retirement` and the two setters called
   * side by side, NOT with `unlist()` inside a `setRetirement` updater. An
   * updater must be pure — React is free to call it twice, and under
   * StrictMode it does, which would run the unlist twice and, more to the
   * point, is a state update fired from inside another state computation.
   */
  const changeRetirement = (fn: (r: Retirement) => Retirement) => {
    const next = fn(retirement);
    setRetirement(next);
    if (next.disposed && !retirement.disposed) unlist();
  };

  /* ═══════════════════════════════════════════════════════════════════════
   * Render
   *
   * No top header bar, and the rail carries no border — both copied from the
   * rental screen, which took them from northwind's own chrome. The dashboard
   * layout calls deleting that header row "the single most visible difference
   * between the two designs", so a bordered full-width strip is the fastest way
   * to make a screen read as v1. The page's identity lives in the scoped rail
   * header instead, exactly as it does for Settings.
   * ══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="flex h-screen bg-background bg-app-gradient">
      {/* ── left rail — NAVIGATION ONLY ───────────────────────────────
          Plain grouped nav in `app-sidebar-v2`'s own measurements. It reads no
          state on purpose: a sidebar you can find things in by position has to
          look the same every time you look at it. How the record is DOING is
          the right rail's job. */}
      <aside className="flex w-[280px] shrink-0 flex-col">
        <RailHeader
          backHref="/playground"
          title={vehicleName || "Untitled vehicle"}
          subtitle={identity.registration || "No registration yet"}
        />

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {GROUPS.map((group, i) => (
            <RailGroup key={group.label} label={group.label} first={i === 0}>
              {group.items.map((item) => (
                <NavItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  active={tab === item.key}
                  onClick={() => setTab(item.key)}
                />
              ))}
            </RailGroup>
          ))}
        </div>
      </aside>

      {/* ── panel ──────────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
        {tab === "vehicle" && (
          <VehicleTab
            identity={identity}
            onIdentity={setIdentity}
            photos={photos}
            onPhotos={setPhotos}
            makeId={() => nextId("ph")}
          />
        )}

        {tab === "rates" && (
          <RatesTab rates={rates} onRates={setRates} mileage={mileage} onMileage={setMileage} />
        )}

        {tab === "addons" && (
          <AddonsTab
            extras={extras}
            onExtras={setExtras}
            seasonal={seasonal}
            onSeasonal={setSeasonal}
            dailyRate={rates.daily}
            makeId={() => nextId("ad")}
          />
        )}

        {tab === "availability" && (
          <AvailabilityTab
            availability={availability}
            onChange={setAvailability}
            blockers={blockers}
            makeId={() => nextId("bo")}
          />
        )}

        {tab === "pickup" && <PickupTab handling={handling} onChange={setHandling} />}

        {tab === "upkeep" && (
          <UpkeepTab
            rows={complianceRows}
            compliance={compliance}
            onCompliance={setCompliance}
            maintenance={maintenance}
            onMaintenance={setMaintenance}
            nextServiceMileage={nextServiceMileage}
            milesToService={milesToService}
            overdue={serviceOverdue}
            makeId={() => nextId("sv")}
          />
        )}

        {tab === "keys" && (
          <KeysDocsTab
            custody={custody}
            onCustody={setCustody}
            docs={docs}
            onDocs={setDocs}
            makeId={() => nextId("doc")}
          />
        )}

        {tab === "listing" && (
          <ListingTab
            live={listingLive}
            publishedAt={publishedAt}
            drift={drift}
            snapshot={snapshot}
            current={currentSnapshot}
            photoCount={photos.length}
            canPublish={identityComplete && ratesComplete}
            acknowledged={driftAcknowledged}
            suspendedReason={suspendedReason}
            onPublish={publishListing}
            onAcceptDrift={acceptDrift}
            onUnlist={unlist}
          />
        )}

        {tab === "money" && (
          <MoneyTab
            rentals={rentals}
            totalRevenue={totalRevenue}
            daysOnHire={daysOnHire}
            utilisation={utilisation}
            finance={finance}
            onFinance={setFinance}
            serviceSpend={serviceSpend}
            financePaid={financePaid}
            contractTotal={contractTotal}
            monthsElapsed={monthsElapsed}
            net={net}
            retirement={retirement}
            onRetirement={changeRetirement}
            hasActiveRental={hasActiveRental}
          />
        )}
      </main>

      {/* ── right rail — THE READOUT ───────────────────────────────────
          A matched pair with the left rail: same h-11 header row, the border
          flipped to `border-l` so the two frame the content between them. This
          is where the state of the record lives — status, what wants doing, and
          the six numbers worth knowing. Every attention row is a link into the
          tab that owns it.

          The rail owns its own tab strip and scroll region, so it sits directly
          in the aside's flex column; a wrapping body div here would double the
          side padding and trap the sticky strip. */}
      <aside className="flex w-[340px] shrink-0 flex-col border-l border-foreground/10">
        <OverviewRail<TabKey>
          name={vehicleName}
          plate={identity.registration}
          coverSrc={photos[0]?.src ?? null}
          statusLabel={status.label}
          statusTone={status.tone}
          listingLine={listingLine}
          attention={attention}
          vitals={vitals}
          events={DEMO_EVENTS}
          onJump={setTab}
        />
      </aside>
    </div>
  );
}
