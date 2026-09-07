"use client";

/**
 * Vehicle control centre — the canary's vehicle detail screen.
 *
 * Rendered by `(dashboard)/vehicles/[id]/page.tsx` behind `useV2('vehicles')`
 * and nothing else, per V2_PLAN §3. v1's page below that branch is untouched
 * and keeps serving the other 56 tenants byte for byte.
 *
 * The argument it makes, in four parts:
 *
 *   1. THE VEHICLE ALREADY EXISTS. There is no Save and no Submit — a
 *      keystroke is the commit, coalesced into one UPDATE by
 *      `use-vehicle-record.ts`. A form that asks you to confirm you meant it
 *      is a form that does not trust its own record.
 *
 *   2. TWO RAILS THAT DO DIFFERENT JOBS. The left is navigation and nothing
 *      else, and it is not drawn here: the APP SIDEBAR becomes it while a
 *      vehicle is open (`shared/layout/app-sidebar-v2.tsx`), exactly as it
 *      becomes the Settings rail on `/settings` and the stage rail on a
 *      rental. It reads no record state on purpose — a rail you find things in
 *      by position has to look the same every time you glance at it. The right
 *      rail, which this file does draw, is the opposite: status, what needs
 *      attention, the numbers worth knowing. Navigation is learned once; state
 *      is read constantly. They are not the same surface.
 *
 *      The two share the section through `?section=` and `sections.ts`, and
 *      nothing else — they are siblings under `(dashboard)/layout.tsx` with no
 *      provider between them, so the URL is the only channel they both have.
 *
 *   3. NINE TABS, NOT FIFTEEN. A tab for every QUESTION an operator asks,
 *      not one for every concern in the schema. Three groups of inputs, then
 *      Record — the two things produced from them.
 *
 *   4. ONE ANSWER TO "WHY CAN'T THIS BE BOOKED?". v1 spreads it over a pause
 *      card, a blocked-dates card, a banner about an open rental, and a
 *      certificate expiry with no UI at all. Here it is one `blockers` list,
 *      computed once, shown on Availability, summarised on Listing, and
 *      surfaced as clickable rows in the right rail.
 *
 * WHAT IS DELIBERATELY ABSENT. Tesla Fleet, Fleet Health, vehicle ownership
 * splits, per-vehicle expenses and INSHUR eligibility are all on v1's vehicle
 * page and none are here — they are gated off the lean product in
 * `lib/lean-areas.ts`, so the canary does not carry them. Nothing is removed;
 * the routes, hooks and edge functions behind them still serve everyone else.
 */

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { useRentalSettings } from "@/hooks/use-rental-settings";
import { useBlockedDates } from "@/hooks/use-blocked-dates";
import { usePickupLocations } from "@/hooks/use-pickup-locations";
import { useRentalExtras } from "@/hooks/use-rental-extras";
import { useTenantHolidays } from "@/hooks/use-tenant-holidays";
import { useVehicleDailyPrices } from "@/hooks/use-vehicle-daily-prices";
import { useVehicleDisposal } from "@/hooks/use-vehicle-disposal";
import { useVehicleEvents } from "@/hooks/use-vehicle-events";
import { useVehicleExtras } from "@/hooks/use-vehicle-extras";
import { useVehicleFiles } from "@/hooks/use-vehicle-files";
import { useVehiclePricingOverrides } from "@/hooks/use-vehicle-pricing-overrides";
import { useVehicleServices } from "@/hooks/use-vehicle-services";
import { useWeekendPricing } from "@/hooks/use-weekend-pricing";
import { getSiteV2BaseUrl } from "@/lib/site-v2-url";
import type { DistanceUnit } from "@/lib/format-utils";

import { FormatProvider, daysBetween, daysUntil, todayISO } from "./kit";
import { readSection, sectionHref, type SectionId } from "./sections";
import { OverviewRail, type Attention, type Vital } from "./overview-rail";
import { VehicleTab } from "./tab-vehicle";
import { RatesTab } from "./tab-rates";
import { AddonsTab } from "./tab-addons";
import { AvailabilityTab, type Blocker } from "./tab-availability";
import { PickupTab } from "./tab-pickup";
import { UpkeepTab, type ComplianceRow, type Verdict } from "./tab-upkeep";
import { KeysDocsTab } from "./tab-keys";
import { ListingTab } from "./tab-listing";
import { MoneyTab } from "./tab-money";
import {
  useVehiclePL,
  useVehiclePhotos,
  useVehicleRecord,
  useVehicleRentals,
} from "./use-vehicle-record";

/* ══════════════════════════════════════════════════════════════════════════
 * Rules the screen measures against
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Miles (or km) between services.
 *
 * A constant, because `vehicles` carries no per-car interval — the only place
 * one exists is Fleet Health's maintenance rules, which the lean product does
 * not carry. It is shown in the Servicing hint rather than applied silently,
 * so an operator can see the rule that produced the number.
 */
const SERVICE_INTERVAL = { miles: 10_000, km: 16_000 } as const;

/** The window utilisation is measured over. */
const UTILISATION_WINDOW_DAYS = 90;

/** Inside this many days, a certificate is flagged early rather than late. */
const EXPIRY_WARNING_DAYS = 30;

/** Rental statuses that mean the car is spoken for right now. */
const OPEN_RENTAL_STATUSES = ["Active", "Pending", "Confirmed"];

/* ══════════════════════════════════════════════════════════════════════════
 * Screen
 * ═════════════════════════════════════════════════════════════════════════ */

export function VehicleDetailV2({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant, tenantSlug } = useTenant();
  const { canEdit } = useManagerPermissions();
  const readOnly = !canEdit("vehicles");

  const currencyCode = tenant?.currency_code || "USD";
  const distanceUnit = (tenant?.distance_unit || "miles") as DistanceUnit;
  const serviceInterval = SERVICE_INTERVAL[distanceUnit];

  /**
   * The open section lives in the URL and NOWHERE else.
   *
   * There used to be local state here, mirrored into the address bar with
   * `history.replaceState` — cheaper per click, because `router.replace`
   * re-runs the route. It stopped being viable the moment the nav rail moved
   * out of this file and into `app-sidebar-v2`: `replaceState` writes the URL
   * without notifying anything subscribed to `useSearchParams`, so the rail
   * would have kept highlighting the section the operator had just left.
   *
   * The rail and this panel are siblings under `(dashboard)/layout.tsx` with no
   * provider between them, so the URL is the only channel they both already
   * have. `readSection` makes a typo'd or stale `?section=` land on Vehicle
   * rather than on a blank screen.
   */
  const section = readSection(searchParams.get("section"));

  /**
   * Move to another section.
   *
   * `replace`, not `push`: nine sections behind one car would mean an operator
   * who looked at all of them has to press Back nine times to leave the car.
   * `scroll: false` because the frame does not scroll — each column scrolls its
   * own content, so there is no page scroll position for Next to restore, and
   * its default would fight the panel's own scroll container.
   */
  const goToSection = useCallback(
    (next: SectionId) => {
      router.replace(sectionHref(vehicleId, next), { scroll: false });
    },
    [router, vehicleId],
  );

  /* ── data ───────────────────────────────────────────────────────────── */

  const { vehicle, isLoading, notFound, patch, patchNow, saving } = useVehicleRecord(vehicleId);
  const { photos, upload, remove, makeCover, isUploading } = useVehiclePhotos(vehicleId);
  const { rentals } = useVehicleRentals(vehicleId);
  const { pl } = useVehiclePL(vehicleId);
  const { events, isLoading: eventsLoading } = useVehicleEvents(vehicleId);
  const { serviceRecords, addService, deleteService } = useVehicleServices(vehicleId);
  const { files, uploadFile, deleteFile, downloadFile, isUploading: isUploadingFile } =
    useVehicleFiles(vehicleId);
  const { blockedDates, addBlockedDate, deleteBlockedDate } = useBlockedDates(vehicleId);
  const { locations } = usePickupLocations();
  const { extras: allExtras } = useRentalExtras();
  const { vehicleExtras, upsertVehicleExtraPrice, removeVehicleExtraPrice } =
    useVehicleExtras(vehicleId);
  const { holidays } = useTenantHolidays();
  const { overrides, upsertOverride, resetOverride } = useVehiclePricingOverrides(vehicleId);
  const { prices: dayPrices, setPrices, clearPrices } = useVehicleDailyPrices(vehicleId);
  const { settings: weekend } = useWeekendPricing();
  const { settings: rentalSettings } = useRentalSettings();
  const { disposeVehicle, undoDisposal, isDisposing } = useVehicleDisposal(vehicleId);

  /* ── derived: identity ──────────────────────────────────────────────── */

  const vehicleName = useMemo(
    () =>
      vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ").trim() : "",
    [vehicle?.year, vehicle?.make, vehicle?.model],
  );

  const activeDurations = useMemo(() => {
    if (!vehicle) return [] as string[];
    const on: string[] = [];
    if (vehicle.available_daily) on.push("Daily");
    if (vehicle.available_weekly) on.push("Weekly");
    if (vehicle.available_monthly) on.push("Monthly");
    return on;
  }, [vehicle?.available_daily, vehicle?.available_weekly, vehicle?.available_monthly]);

  /* ── derived: compliance ────────────────────────────────────────────── */

  const verdictOf = (iso: string | null): Verdict => {
    if (!iso) return "unset";
    const d = daysUntil(iso);
    if (d < 0) return "expired";
    if (d <= EXPIRY_WARNING_DAYS) return "soon";
    return "valid";
  };

  /**
   * Inspection and registration decide whether the car may legally go out. The
   * warranty does not — it decides who pays for the next repair. Painting all
   * three the same colour is how an operator learns to ignore the colour.
   */
  const complianceRows = useMemo<ComplianceRow[]>(() => {
    if (!vehicle) return [];
    return (
      [
        { key: "mot_due_date" as const, label: "Inspection", date: vehicle.mot_due_date, blocking: true },
        { key: "tax_due_date" as const, label: "Registration", date: vehicle.tax_due_date, blocking: true },
        {
          key: "warranty_end_date" as const,
          label: "Warranty",
          date: vehicle.warranty_end_date,
          blocking: false,
        },
      ] as Omit<ComplianceRow, "verdict">[]
    ).map((r) => ({ ...r, verdict: verdictOf(r.date) }));
  }, [vehicle?.mot_due_date, vehicle?.tax_due_date, vehicle?.warranty_end_date]);

  const complianceBlocking = complianceRows.filter((r) => r.blocking && r.verdict === "expired");
  const complianceSoon = complianceRows.filter((r) => r.verdict === "soon");

  /* ── derived: servicing ─────────────────────────────────────────────── */

  const lastService = useMemo(() => {
    const withMileage = serviceRecords.filter((s) => Number(s.mileage) > 0);
    if (withMileage.length === 0) return null;
    return withMileage.slice().sort((a, b) => Number(b.mileage) - Number(a.mileage))[0];
  }, [serviceRecords]);

  // Prefer the newest service RECORD, but fall back to the denormalised column
  // — a car imported with a last-service reading and no service rows still gets
  // a due figure, which is most of the fleet on day one.
  const lastServiceMileage =
    lastService?.mileage ?? (vehicle?.last_service_mileage ? Number(vehicle.last_service_mileage) : null);
  const nextServiceMileage =
    lastServiceMileage != null ? lastServiceMileage + serviceInterval : null;
  const odometer = Number(vehicle?.current_mileage) || 0;
  const distToService =
    nextServiceMileage != null && odometer > 0 ? nextServiceMileage - odometer : null;
  const serviceOverdue = distToService != null && distToService <= 0;
  const serviceSpend = serviceRecords.reduce((sum, s) => sum + (Number(s.cost) || 0), 0);

  /* ── derived: rentals ───────────────────────────────────────────────── */

  const today = todayISO();

  const openRentals = useMemo(
    () => rentals.filter((r) => OPEN_RENTAL_STATUSES.includes(r.status) && r.end_date >= today),
    [rentals, today],
  );
  const overdueRentals = useMemo(
    () => rentals.filter((r) => r.status === "Active" && r.end_date < today),
    [rentals, today],
  );
  const hasOpenRental = openRentals.length > 0 || overdueRentals.length > 0;

  /** Days on hire inside the utilisation window, clipped to it at both ends. */
  const daysOnHire = useMemo(() => {
    const windowStart = new Date(Date.now() - UTILISATION_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return rentals
      .filter((r) => r.status !== "Cancelled" && r.end_date >= windowStart && r.start_date <= today)
      .reduce((sum, r) => {
        const from = r.start_date < windowStart ? windowStart : r.start_date;
        const to = r.end_date > today ? today : r.end_date;
        return sum + daysBetween(from, to);
      }, 0);
  }, [rentals, today]);

  const utilisation = Math.min(100, Math.round((daysOnHire / UTILISATION_WINDOW_DAYS) * 100));

  /* ── derived: what is stopping this car being booked ─────────────────── */

  /**
   * One list, computed once, read in three places.
   *
   * The rules match what the booking site actually does — `/fleet` hides a car
   * whose status is Disposed or Sold, that is paused, or that has all three
   * hire lengths switched off (`apps/booking/src/app/fleet/page.tsx`), and
   * `use-fleet-list.ts` applies the same three. So this list is not a second
   * opinion about visibility; it is the same rules, said out loud.
   */
  const blockers = useMemo<Blocker[]>(() => {
    if (!vehicle) return [];
    const list: Blocker[] = [];

    if (vehicle.is_disposed || vehicle.status === "Disposed" || vehicle.status === "Sold") {
      list.push({
        key: "retired",
        label: "Retired from the fleet",
        detail: [
          vehicle.disposal_date ? `Sold on ${vehicle.disposal_date}` : "Marked as sold",
          vehicle.disposal_buyer ? `to ${vehicle.disposal_buyer}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        severity: "hard",
      });
    }

    if (vehicle.is_paused) {
      list.push({
        key: "paused",
        label: "Paused",
        detail: vehicle.paused_reason || "No reason recorded",
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

    if (!Number(vehicle.daily_rent)) {
      list.push({
        key: "no-rate",
        label: "No daily rate",
        detail: "Every quote is worked out from the daily rate, including the weekly one.",
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

    /*
     * An open rental blocks the DATES it covers, not the car. A car due back on
     * Friday is perfectly bookable from Saturday, and treating it as
     * unavailable outright is how an operator turns away a booking they could
     * have taken. An OVERDUE rental is the exception: it has no end, so it
     * holds everything until somebody closes it — and it is almost always a
     * rental that was forgotten rather than a car that is still out.
     */
    for (const r of overdueRentals) {
      list.push({
        key: `overdue-${r.id}`,
        label: "Open rental past its end date",
        detail: `${r.customer_name}'s rental ended ${Math.abs(daysUntil(r.end_date))} days ago and is still open.`,
        severity: "hard",
      });
    }

    for (const r of openRentals) {
      list.push({
        key: `rental-${r.id}`,
        label: r.status === "Active" ? "Out on hire" : `Held by a ${r.status.toLowerCase()} booking`,
        detail: `${r.customer_name} has it until ${r.end_date}.`,
        severity: "soft",
      });
    }

    const upcomingBlocks = blockedDates.filter((b) => b.end_date >= today);
    if (upcomingBlocks.length) {
      list.push({
        key: "blackouts",
        label: `${upcomingBlocks.length} blocked period${upcomingBlocks.length === 1 ? "" : "s"}`,
        detail: upcomingBlocks.map((b) => b.reason || "No reason recorded").join(" · "),
        severity: "soft",
      });
    }

    return list;
  }, [vehicle, activeDurations, complianceBlocking, overdueRentals, openRentals, blockedDates, today]);

  const hardBlockers = blockers.filter((b) => b.severity === "hard");
  const isListed = hardBlockers.length === 0;

  /** Which tab fixes a given blocker — so the Listing tab's rows can be clicked. */
  const jumpFor = useCallback((key: string): SectionId | null => {
    if (key === "retired") return "money";
    if (key === "paused") return "availability";
    if (key === "no-durations" || key === "no-rate") return "rates";
    if (key.startsWith("cert-")) return "upkeep";
    if (key.startsWith("overdue-")) return "availability";
    return null;
  }, []);

  /* ── derived: the header status, computed and never chosen ───────────── */

  const status = useMemo<{ label: string; tone: "muted" | "success" | "warning" | "primary" }>(() => {
    if (!vehicle) return { label: "Loading", tone: "muted" };
    if (vehicle.is_disposed) return { label: "Retired", tone: "muted" };
    if (vehicle.is_paused) return { label: "Paused", tone: "warning" };
    if (hardBlockers.length) return { label: "Off the road", tone: "warning" };
    if (overdueRentals.length || openRentals.some((r) => r.status === "Active"))
      return { label: "On hire", tone: "success" };
    return { label: "Listed", tone: "success" };
  }, [vehicle, hardBlockers.length, overdueRentals.length, openRentals]);

  /* ── derived: the right rail ────────────────────────────────────────── */

  /**
   * The daily mileage term, as the Listing preview states it.
   *
   * Deliberately NOT routed through `resolveAgreementMileage`: that resolver
   * answers "what does THIS rental's agreement say", and picks daily, weekly or
   * monthly from the rental's own duration. A car sitting in the fleet has no
   * rental and therefore no tier, so there is no single agreement term to
   * resolve — the honest thing to show is the daily default the booking site
   * quotes, labelled as such.
   *
   * What it DOES borrow is that module's rule, because the screen and the
   * signed agreement must not describe the same car differently:
   *
   *   "Unlimited" is reachable ONLY from an explicit unlimited flag.
   *
   * This used to read `if (!daily) return "Unlimited"`, which meant a car whose
   * allowance nobody had filled in was advertised here as having no limit —
   * while its agreement would print "Not specified" and its excess-mileage rate
   * would still be chargeable. `agreement-mileage.ts` calls that case out in so
   * many words ("Nothing configured. Say so — do NOT imply unlimited"), and it
   * is the one wording on this screen an operator could be held to.
   */
  const allowanceText = useMemo(() => {
    if (!vehicle) return "";
    const unit = distanceUnit === "miles" ? "mi" : "km";
    // The paid upgrade is the only route to "Unlimited" — matching the
    // resolver, which reads the rental's `is_unlimited_mileage` and nothing
    // else. On the car, the equivalent is that the upgrade is offered at all.
    if (vehicle.unlimited_mileage_available) {
      const daily = Number(vehicle.daily_mileage) || 0;
      const base = daily ? `${daily.toLocaleString("en-US")} ${unit}/day` : "Not specified";
      return `${base} · unlimited available`;
    }
    const daily = Number(vehicle.daily_mileage) || 0;
    if (!daily) return "Not specified";
    const excess = Number(vehicle.excess_mileage_rate) || 0;
    return `${daily.toLocaleString("en-US")} ${unit}/day${
      excess ? ` · ${excess} per extra ${unit}` : ""
    }`;
  }, [
    vehicle?.daily_mileage,
    vehicle?.excess_mileage_rate,
    vehicle?.unlimited_mileage_available,
    distanceUnit,
  ]);

  const offeredExtras = useMemo(
    () => vehicleExtras.map((v) => v.extra_name).filter(Boolean).join(", "),
    [vehicleExtras],
  );

  const attention = useMemo<Attention<SectionId>[]>(() => {
    if (!vehicle) return [];
    const list: Attention<SectionId>[] = [];

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
      const unit = distanceUnit === "miles" ? "mi" : "km";
      list.push({
        key: "service",
        target: "upkeep",
        label: `Service overdue by ${Math.abs(distToService!).toLocaleString("en-US")} ${unit}`,
        detail: `Due at ${nextServiceMileage!.toLocaleString("en-US")}, odometer reads ${odometer.toLocaleString("en-US")}`,
      });
    }

    if (vehicle.is_paused) {
      list.push({
        key: "paused",
        target: "availability",
        label: "Paused — not bookable",
        detail: vehicle.paused_reason || "No reason recorded",
      });
    }

    for (const r of overdueRentals) {
      list.push({
        key: `overdue-${r.id}`,
        target: "availability",
        label: `${r.customer_name}'s rental is overdue`,
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

    if (!Number(vehicle.daily_rent)) {
      list.push({
        key: "rate",
        target: "rates",
        label: "No daily rate",
        detail: "Every quote is worked out from it, including the weekly one",
      });
    }

    if (vehicle.lockbox_instructions && !vehicle.lockbox_code) {
      list.push({
        key: "lockbox",
        target: "pickup",
        label: "Lockbox with no code",
        detail: "Customers would get the instructions and nothing to open the box",
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
    vehicle,
    complianceBlocking,
    complianceSoon,
    serviceOverdue,
    distToService,
    nextServiceMileage,
    odometer,
    overdueRentals,
    activeDurations,
    photos.length,
    distanceUnit,
  ]);

  const vitals = useMemo<Vital[]>(() => {
    if (!vehicle) return [];
    const unit = distanceUnit === "miles" ? "mi" : "km";
    const cur = (n: number) => new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(n);
    const deposit =
      rentalSettings?.deposit_mode === "global"
        ? Number(rentalSettings?.global_deposit_amount) || 0
        : Number(vehicle.security_deposit) || 0;

    return [
      {
        label: "Daily rate",
        value: vehicle.daily_rent ? `${cur(Number(vehicle.daily_rent))}/day` : "Not set",
        hint: deposit ? `${cur(deposit)} deposit` : undefined,
        tone: vehicle.daily_rent ? "default" : "warning",
      },
      {
        label: "Odometer",
        value: odometer ? `${odometer.toLocaleString("en-US")} ${unit}` : "Not recorded",
      },
      {
        label: "Next service",
        value:
          nextServiceMileage === null
            ? "No history"
            : distToService === null
              ? "Needs an odometer"
              : serviceOverdue
                ? `${Math.abs(distToService).toLocaleString("en-US")} ${unit} over`
                : `in ${distToService.toLocaleString("en-US")} ${unit}`,
        hint:
          nextServiceMileage !== null
            ? `due at ${nextServiceMileage.toLocaleString("en-US")}`
            : undefined,
        tone: serviceOverdue ? "warning" : "default",
      },
      {
        label: "Utilisation",
        value: `${utilisation}%`,
        hint: `${daysOnHire} of the last ${UTILISATION_WINDOW_DAYS} days`,
      },
      {
        label: "Brought in",
        value: cur(pl.revenue),
        hint: `${rentals.length} rental${rentals.length === 1 ? "" : "s"}`,
      },
      {
        label: pl.net >= 0 ? "Ahead by" : "Behind by",
        value: cur(Math.abs(pl.net)),
        hint: "from the P&L ledger",
        tone: pl.net >= 0 ? "success" : "warning",
      },
    ];
  }, [
    vehicle,
    odometer,
    nextServiceMileage,
    distToService,
    serviceOverdue,
    utilisation,
    daysOnHire,
    pl,
    rentals.length,
    currencyCode,
    distanceUnit,
    rentalSettings?.deposit_mode,
    rentalSettings?.global_deposit_amount,
  ]);

  const listingLine = isListed
    ? "On the booking site"
    : `Hidden · ${hardBlockers.length} reason${hardBlockers.length === 1 ? "" : "s"}`;

  /* ══════════════════════════════════════════════════════════════════════
   * Render
   * ═════════════════════════════════════════════════════════════════════ */

  if (isLoading) return <LoadingFrame />;

  if (notFound || !vehicle) {
    return (
      <div className="flex h-[calc(100dvh-1rem)] items-center justify-center">
        <div className="max-w-sm text-center">
          <h2 className="font-heading text-xl font-medium">We can&rsquo;t find that vehicle</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have been deleted, or it belongs to a different account.
          </p>
          <a href="/vehicles" className="mt-5 inline-block text-sm font-medium text-primary">
            Back to Vehicles
          </a>
        </div>
      </div>
    );
  }

  const hidePlate =
    (tenant as { hide_vehicle_registration?: boolean } | null)?.hide_vehicle_registration === true;

  return (
    <FormatProvider currencyCode={currencyCode} distanceUnit={distanceUnit}>
      {/* The dashboard `<main>` is `p-4`, so the frame is the viewport less
          that 1rem — the same sum `cms-v2/cms-visual-editor` does. `-m-4` is
          deliberately NOT used: it would let the rail bleed under the app
          sidebar's rounded inset.

          TWO columns, not three. The nav rail that used to sit here moved into
          `shared/layout/app-sidebar-v2.tsx`, which BECOMES it while a vehicle is
          open — the same way it becomes the Settings rail on `/settings` and the
          stage rail on a rental. Drawing it here as well would stack two
          sidebars side by side inside `(dashboard)/layout.tsx`. The two agree
          on which section is showing through `?section=` and `sections.ts`, and
          share nothing else. */}
      <div className="flex h-[calc(100dvh-1rem)] min-h-[600px]">
        {/* ── panel ─────────────────────────────────────────────────────── */}
        <main className="relative min-w-0 flex-1 overflow-hidden px-8 py-6">
          {/* The only trace of the write path on screen, and it earns its place:
              there is no Save button, so an operator who types into a field has
              nothing else telling them the keystroke was committed. It cannot
              live in the rail any more — the sidebar holds its own
              `useVehicleRecord` instance, whose `saving` is always false because
              it never writes. Absent unless a write is genuinely in flight. */}
          {saving && (
            <span className="pointer-events-none absolute right-8 top-7 z-10 text-[11px] text-muted-foreground">
              Saving…
            </span>
          )}

          {section === "vehicle" && (
            <VehicleTab
              vehicle={vehicle}
              patch={patch}
              photos={photos}
              onUpload={upload}
              onRemovePhoto={remove}
              onMakeCover={makeCover}
              isUploading={isUploading}
              readOnly={readOnly}
            />
          )}

          {section === "rates" && (
            <RatesTab
              vehicle={vehicle}
              patch={patch}
              patchNow={patchNow}
              depositMode={(rentalSettings?.deposit_mode as "global" | "per_vehicle") ?? null}
              globalDeposit={rentalSettings?.global_deposit_amount ?? null}
              monthlyTierDays={Number(tenant?.monthly_tier_days) || 28}
              readOnly={readOnly}
            />
          )}

          {section === "addons" && (
            <AddonsTab
              vehicleId={vehicleId}
              dailyRate={Number(vehicle.daily_rent) || 0}
              allExtras={allExtras}
              vehicleExtras={vehicleExtras}
              // These are `mutateAsync`, and each hook already toasts its own
              // failure — swallow the rejection so a handled error does not also
              // surface as an unhandled promise rejection in the console.
              onAssignExtra={(extraId, price) => {
                upsertVehicleExtraPrice({ extraId, price }).catch(() => {});
              }}
              onRemoveExtra={(extraId) => {
                removeVehicleExtraPrice(extraId).catch(() => {});
              }}
              weekendPercent={Number(weekend?.weekend_surcharge_percent) || 0}
              weekendDays={weekend?.weekend_days ?? [6, 0]}
              holidays={holidays}
              overrides={overrides}
              onUpsertOverride={(o) => {
                upsertOverride(o).catch(() => {});
              }}
              onResetOverride={(ruleType, holidayId) => {
                resetOverride({ ruleType, holidayId }).catch(() => {});
              }}
              dayPrices={dayPrices}
              onSetDayPrice={(date, price) => {
                setPrices([{ date, price }]).catch(() => {});
              }}
              onClearDayPrice={(date) => {
                clearPrices([date]).catch(() => {});
              }}
              readOnly={readOnly}
            />
          )}

          {section === "availability" && (
            <AvailabilityTab
              blockers={blockers}
              paused={vehicle.is_paused}
              pausedReason={vehicle.paused_reason}
              pausedAt={vehicle.paused_at}
              onPause={(reason) =>
                patchNow({
                  is_paused: true,
                  paused_reason: reason,
                  paused_at: new Date().toISOString(),
                })
              }
              onResume={() =>
                patchNow({ is_paused: false, paused_reason: null, paused_at: null })
              }
              blockedDates={blockedDates}
              onAddBlock={(from, to, reason) =>
                addBlockedDate({
                  start_date: new Date(`${from}T00:00:00`),
                  end_date: new Date(`${to}T00:00:00`),
                  reason,
                  vehicle_id: vehicleId,
                })
              }
              onRemoveBlock={deleteBlockedDate}
              readOnly={readOnly}
            />
          )}

          {section === "pickup" && (
            <PickupTab
              vehicle={vehicle}
              patch={patch}
              patchNow={patchNow}
              locations={locations}
              lockboxEnabled={!!rentalSettings?.lockbox_enabled}
              lockboxCodeLength={rentalSettings?.lockbox_code_length ?? 4}
              readOnly={readOnly}
            />
          )}

          {section === "upkeep" && (
            <UpkeepTab
              vehicle={vehicle}
              patch={patch}
              patchNow={patchNow}
              rows={complianceRows}
              services={serviceRecords}
              onAddService={(input) => addService(input)}
              onDeleteService={(sid) => deleteService(sid)}
              serviceInterval={serviceInterval}
              nextServiceMileage={nextServiceMileage}
              distToService={distToService}
              overdue={serviceOverdue}
              readOnly={readOnly}
            />
          )}

          {section === "keys" && (
            <KeysDocsTab
              vehicle={vehicle}
              patch={patch}
              patchNow={patchNow}
              files={files}
              onUpload={uploadFile}
              onDownload={downloadFile}
              onDelete={deleteFile}
              isUploading={isUploadingFile}
              readOnly={readOnly}
            />
          )}

          {section === "listing" && (
            <ListingTab<SectionId>
              live={isListed}
              blockers={blockers}
              jumpFor={jumpFor}
              onJump={goToSection}
              siteUrl={getSiteV2BaseUrl(tenantSlug)}
              name={vehicleName}
              plate={vehicle.reg}
              hidePlate={hidePlate}
              colour={vehicle.colour}
              description={vehicle.description}
              photoCount={photos.length}
              daily={Number(vehicle.daily_rent) || 0}
              weekly={Number(vehicle.weekly_rent) || 0}
              monthly={Number(vehicle.monthly_rent) || 0}
              deposit={
                rentalSettings?.deposit_mode === "global"
                  ? Number(rentalSettings?.global_deposit_amount) || 0
                  : Number(vehicle.security_deposit) || 0
              }
              durations={activeDurations.join(", ")}
              allowance={allowanceText}
              extras={offeredExtras}
            />
          )}

          {section === "money" && (
            <MoneyTab
              vehicle={vehicle}
              patch={patch}
              rentals={rentals}
              pl={pl}
              serviceSpend={serviceSpend}
              utilisation={utilisation}
              daysOnHire={daysOnHire}
              utilisationWindow={UTILISATION_WINDOW_DAYS}
              hasOpenRental={hasOpenRental}
              onDispose={(input) => {
                disposeVehicle(input).catch(() => {});
              }}
              onUndoDispose={() => {
                undoDisposal().catch(() => {});
              }}
              isDisposing={isDisposing}
              readOnly={readOnly}
            />
          )}
        </main>

        {/* ── right rail — THE READOUT ────────────────────────────────────
            A matched pair with the left rail: same h-11 header row, the border
            flipped to `border-l` so the two frame the content between them. */}
        <aside className="hidden w-[336px] shrink-0 flex-col border-l border-foreground/10 xl:flex">
          <OverviewRail<SectionId>
            name={vehicleName}
            plate={hidePlate ? "" : vehicle.reg}
            coverSrc={photos[0]?.photo_url ?? vehicle.photo_url ?? null}
            statusLabel={status.label}
            statusTone={status.tone}
            listingLine={listingLine}
            attention={attention}
            vitals={vitals}
            events={events}
            eventsLoading={eventsLoading}
            onJump={goToSection}
          />
        </aside>
      </div>
    </FormatProvider>
  );
}

/* ── first paint ───────────────────────────────────────────────────────── */

/**
 * The frame, drawn before the record lands.
 *
 * Deliberately the real two-column shape rather than a centred spinner: the
 * layout does not jump when the data arrives, so the operator's eye is already
 * in the right place. The nav rail is not skeletoned here because it is not
 * this page's to draw — the sidebar renders it immediately from the URL, which
 * needs no fetch.
 */
function LoadingFrame() {
  return (
    <div className="flex h-[calc(100dvh-1rem)] min-h-[600px]">
      <main className="min-w-0 flex-1 space-y-6 px-8 py-6">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-muted/60" />
        <div className="h-56 animate-pulse rounded-4xl bg-muted/40" />
        <div className="h-64 animate-pulse rounded-4xl bg-muted/40" />
      </main>
      <aside className="hidden w-[336px] shrink-0 flex-col gap-4 border-l border-foreground/10 p-3 xl:flex">
        <div className="h-40 animate-pulse rounded-3xl bg-muted/40" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted/40" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />
      </aside>
    </div>
  );
}
