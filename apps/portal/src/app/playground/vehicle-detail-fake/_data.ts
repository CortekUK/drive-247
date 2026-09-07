/**
 * Vehicle detail — the fake record, and the shape of it.
 *
 * DESIGN SANDBOX. Nothing here is real: no Supabase, no tenant, no network.
 * Every constant below is hardcoded demo data that `page.tsx` seeds `useState`
 * from, so the screen opens POPULATED and every interesting state is on screen
 * without anyone having to type a field in first.
 *
 * The demo record is tuned so that three things are amber the moment the page
 * loads — the listing has drifted, a certificate is inside its warning window,
 * and a service is overdue. Those are the three shapes of "produced from
 * something that has since moved", and they are the argument the screen makes.
 * A record where everything is fine demonstrates nothing.
 *
 * SHAPE IS GROUNDED IN THE REAL `vehicles` TABLE (74 columns) plus its
 * satellites, so the fake does not invent fields the product cannot store:
 *
 *   identity     reg, make, model, year, colour, vin, fuel_type, category,
 *                description
 *   rates        daily_rent, weekly_rent, monthly_rent, security_deposit,
 *                available_daily / _weekly / _monthly
 *   mileage      daily_mileage, weekly_mileage, monthly_mileage,
 *                excess_mileage_rate, unlimited_mileage_available +
 *                unlimited_mileage_price_daily/_weekly/_monthly
 *   handling     pickup_location_id, lockbox_code, lockbox_instructions,
 *                garaging_state
 *   availability blocked_dates (scoped to vehicle_id), is_paused,
 *                paused_reason, paused_at
 *   compliance   mot_due_date, tax_due_date, warranty_start/end_date
 *   upkeep       current_mileage, last_service_date, last_service_mileage,
 *                has_service_plan
 *   custody      has_logbook, has_spare_key, spare_key_holder,
 *                spare_key_notes, has_tracker, has_remote_immobiliser,
 *                security_notes  +  vehicle_files
 *   seasonal     vehicle_pricing_overrides, tenant_holidays,
 *                vehicle_daily_prices
 *   money        acquisition_type/date, purchase_price, monthly_payment,
 *                initial_payment, term_months, balloon, finance_start_date
 *                +  pnl_entries
 *   retirement   is_disposed, disposal_date, sale_proceeds, disposal_buyer,
 *                disposal_notes
 */

/* ── time ───────────────────────────────────────────────────────────────── */

/**
 * "Today" is pinned rather than read from the clock.
 *
 * The compliance maths (valid / expiring soon / expired) and the service
 * countdown are both measured against it, so pinning is what makes the same
 * three states show up every time the screen is opened — which is the only
 * reason it is worth looking at. It also keeps the server and client renders
 * identical, so there is no hydration mismatch to explain away.
 */
export const TODAY = "2026-09-04";
export const TODAY_MS = new Date(`${TODAY}T00:00:00`).getTime();

/** Miles between services — the rule that turns the odometer into a due date. */
export const SERVICE_INTERVAL_MILES = 10_000;

/** The window utilisation is measured over. */
export const UTILISATION_WINDOW_DAYS = 90;

/** Inside this many days, a certificate is flagged early rather than late. */
export const EXPIRY_WARNING_DAYS = 30;

/* ── option lists ───────────────────────────────────────────────────────── */

export const PICKUP_LOCATIONS = [
  { id: "loc-downtown", name: "Denver Downtown Hub", detail: "1420 Larimer St · open 07:00–21:00" },
  { id: "loc-airport", name: "DEN Airport — Lot C", detail: "Shuttle bay 4 · 24 hours" },
  { id: "loc-aurora", name: "Aurora Depot", detail: "By appointment only" },
] as const;

export const HANDOVER_METHODS = [
  { id: "in_person", name: "In person", detail: "A member of staff meets the customer" },
  { id: "lockbox", name: "Lockbox", detail: "Customer is sent a code and collects unattended" },
  { id: "delivery", name: "Delivery", detail: "Driven to the customer's address" },
] as const;

export const FUEL_TYPES = ["Gas", "Hybrid", "Electric", "Diesel"] as const;

export const CATEGORIES = ["Economy", "Midsize", "Full size", "SUV", "Luxury", "Van"] as const;

export const ACQUISITION_TYPES = ["Owned outright", "Financed", "Leased", "Consignment"] as const;

/** JS day numbers, so the set matches `tenants.weekend_days` (default `[6,0]`). */
export const WEEKDAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
] as const;

/* ── record shape ───────────────────────────────────────────────────────── */

export type Handover = (typeof HANDOVER_METHODS)[number]["id"];

export type Identity = {
  make: string;
  model: string;
  year: string;
  registration: string;
  colour: string;
  vin: string;
  fuelType: string;
  category: string;
  description: string;
};

export type Rates = {
  daily: number;
  weekly: number;
  monthly: number;
  deposit: number;
  availableDaily: boolean;
  availableWeekly: boolean;
  availableMonthly: boolean;
};

export type Mileage = {
  dailyMiles: number;
  weeklyMiles: number;
  monthlyMiles: number;
  excessPerMile: number;
  unlimitedAvailable: boolean;
  unlimitedDaily: number;
  unlimitedWeekly: number;
  unlimitedMonthly: number;
};

export type Extra = { id: string; name: string; perDay: number; enabled: boolean };

export type Holiday = {
  id: string;
  name: string;
  from: string;
  to: string;
  surchargePercent: number;
  /** A holiday this car opts out of — `vehicle_pricing_overrides.excluded`. */
  excluded: boolean;
};

/** A single calendar day priced by hand, overriding both base rate and surcharge. */
export type DayPrice = { id: string; date: string; price: number };

export type Seasonal = {
  weekendPercent: number;
  weekendDays: number[];
  holidays: Holiday[];
  dayPrices: DayPrice[];
};

export type Blackout = { id: string; from: string; to: string; reason: string };

export type Availability = {
  paused: boolean;
  pausedReason: string;
  pausedAt: string;
  blackouts: Blackout[];
};

export type Handling = {
  pickupId: string | null;
  handover: Handover;
  lockboxCode: string;
  lockboxInstructions: string;
  garagingState: string;
};

export type Compliance = {
  inspection: string;
  registration: string;
  warrantyStart: string;
  warrantyEnd: string;
};

export type ServiceRecord = {
  id: string;
  date: string;
  type: string;
  cost: number;
  mileage: number;
};

export type Maintenance = {
  /** Where the clock stands today. The next service is derived from it. */
  odometer: number;
  servicePlan: boolean;
  services: ServiceRecord[];
};

export type Custody = {
  hasLogbook: boolean;
  hasSpareKey: boolean;
  spareKeyHolder: string;
  spareKeyNotes: string;
  hasTracker: boolean;
  hasImmobiliser: boolean;
  securityNotes: string;
};

export type VehicleDoc = { id: string; name: string; kind: string; addedOn: string; size: string };

export type Photo = { id: string; label: string; src: string };

export type Rental = {
  id: string;
  customer: string;
  from: string;
  to: string;
  revenue: number;
  status: "Active" | "Completed" | "Cancelled";
};

export type Finance = {
  /** Where the car came from and what it cost — the start of its money story. */
  acquisitionType: string;
  acquisitionDate: string;
  purchasePrice: number;
  monthlyPayment: number;
  initialPayment: number;
  termMonths: number;
  balloon: number;
  startDate: string;
};

export type Retirement = {
  disposed: boolean;
  date: string;
  buyer: string;
  proceeds: number;
  notes: string;
};

/**
 * What the public listing was built from, frozen at the moment it was
 * published.
 *
 * It stores VALUES, not a timestamp, because "published before you edited it"
 * is a weaker claim than "shows a different price than you now charge". Only
 * the second one is worth interrupting an operator for, and only the second one
 * can be shown as a before/after they can act on.
 */
export type ListingSnapshot = {
  name: string;
  registration: string;
  colour: string;
  daily: number;
  weekly: number;
  monthly: number;
  deposit: number;
  durations: string;
  allowance: string;
  extras: string;
  photos: string;
};

/* ══════════════════════════════════════════════════════════════════════════
 * The demo record
 *
 * A black 2023 Honda Accord, so the identity matches `car4.jpeg` — the six
 * photographs in `public/images/playground/` are a silver Civic, a blue Fusion,
 * a red Malibu, a black Accord, a white Elantra and a blue Sentra. Naming this
 * one a Tesla would put a picture of a Honda on a card that says Tesla, which
 * is the one thing a design sandbox full of real photographs must not do.
 * ═════════════════════════════════════════════════════════════════════════ */

export const DEMO_IDENTITY: Identity = {
  make: "Honda",
  model: "Accord Sport",
  year: "2023",
  registration: "6HNA118",
  colour: "Black",
  vin: "1HGCV1F34PA004471",
  fuelType: "Hybrid",
  category: "Midsize",
  description:
    "Hybrid saloon, one owner from new. Apple CarPlay, adaptive cruise, heated front seats. Winter tyres fitted November to March.",
};

export const DEMO_RATES: Rates = {
  daily: 95,
  weekly: 570,
  monthly: 2_050,
  deposit: 400,
  availableDaily: true,
  availableWeekly: true,
  availableMonthly: false,
};

export const DEMO_MILEAGE: Mileage = {
  dailyMiles: 150,
  weeklyMiles: 900,
  monthlyMiles: 3_000,
  excessPerMile: 0.35,
  unlimitedAvailable: true,
  unlimitedDaily: 25,
  unlimitedWeekly: 140,
  unlimitedMonthly: 480,
};

export const DEMO_EXTRAS: Extra[] = [
  { id: "ex-seat", name: "Child seat", perDay: 8, enabled: true },
  { id: "ex-driver", name: "Additional driver", perDay: 12, enabled: true },
  { id: "ex-toll", name: "Toll pass", perDay: 5, enabled: true },
  { id: "ex-wifi", name: "Mobile hotspot", perDay: 6, enabled: false },
  { id: "ex-ski", name: "Ski rack", perDay: 9, enabled: false },
];

export const DEMO_SEASONAL: Seasonal = {
  weekendPercent: 15,
  weekendDays: [6, 0],
  holidays: [
    {
      id: "hol-thanks",
      name: "Thanksgiving week",
      from: "2026-11-25",
      to: "2026-11-30",
      surchargePercent: 25,
      excluded: false,
    },
    {
      id: "hol-xmas",
      name: "Christmas & New Year",
      from: "2026-12-20",
      to: "2027-01-02",
      surchargePercent: 30,
      excluded: false,
    },
    {
      id: "hol-july",
      name: "Independence Day",
      from: "2027-07-02",
      to: "2027-07-06",
      surchargePercent: 20,
      excluded: true,
    },
  ],
  dayPrices: [{ id: "dp-1", date: "2026-12-31", price: 210 }],
};

export const DEMO_AVAILABILITY: Availability = {
  paused: false,
  pausedReason: "",
  pausedAt: "",
  blackouts: [
    { id: "bo-1", from: "2026-09-18", to: "2026-09-22", reason: "Annual service + inspection" },
    { id: "bo-2", from: "2026-12-24", to: "2026-12-27", reason: "Owner use over the holidays" },
  ],
};

export const DEMO_HANDLING: Handling = {
  pickupId: "loc-downtown",
  handover: "lockbox",
  lockboxCode: "4471",
  lockboxInstructions: "Rear left wheel arch — magnetic box tucked behind the mudflap.",
  garagingState: "Colorado",
};

/**
 * One certificate inside its warning window, one comfortably valid, and a
 * warranty that has already run out — so all three verdicts are on screen at
 * once, and the difference between a blocking expiry and a non-blocking one is
 * visible without anyone editing a date.
 */
export const DEMO_COMPLIANCE: Compliance = {
  inspection: "2026-09-22",
  registration: "2027-03-14",
  warrantyStart: "2026-02-14",
  warrantyEnd: "2026-08-20",
};

export const DEMO_MAINTENANCE: Maintenance = {
  /**
   * 32,140 against a last service at 21,400 puts the next service — due at
   * 31,400 — 740 miles in the past, so servicing opens amber and overdue.
   */
  odometer: 32_140,
  servicePlan: true,
  services: [
    { id: "sv-1", date: "2026-06-12", type: "Tyre rotation + alignment", cost: 120, mileage: 21_400 },
    { id: "sv-2", date: "2026-03-02", type: "Annual service", cost: 480, mileage: 17_900 },
    { id: "sv-3", date: "2025-11-18", type: "Front brake pads", cost: 310, mileage: 13_050 },
  ],
};

export const DEMO_CUSTODY: Custody = {
  hasLogbook: true,
  hasSpareKey: true,
  spareKeyHolder: "Denver Downtown Hub — key safe",
  spareKeyNotes: "Tagged 6HNA118. Signed out in the key book.",
  hasTracker: true,
  hasImmobiliser: false,
  securityNotes: "Tracker is a Vodafone S5. Immobiliser quoted but not yet fitted.",
};

export const DEMO_DOCS: VehicleDoc[] = [
  { id: "doc-1", name: "Title / V5C", kind: "Ownership", addedOn: "2026-02-16", size: "412 KB" },
  { id: "doc-2", name: "Fleet insurance certificate", kind: "Insurance", addedOn: "2026-03-14", size: "1.1 MB" },
  { id: "doc-3", name: "Purchase invoice", kind: "Finance", addedOn: "2026-02-14", size: "88 KB" },
  { id: "doc-4", name: "Last inspection report", kind: "Compliance", addedOn: "2025-09-23", size: "640 KB" },
];

export const DEMO_PHOTOS: Photo[] = [
  { id: "ph-1", label: "Front 3/4", src: "/images/playground/car4.jpeg" },
  { id: "ph-2", label: "Rear 3/4", src: "/images/playground/car3.jpeg" },
  { id: "ph-3", label: "Interior — front", src: "/images/playground/car1.jpeg" },
  { id: "ph-4", label: "Wheels", src: "/images/playground/car6.jpeg" },
];

export const DEMO_RENTALS: Rental[] = [
  { id: "rn-1", customer: "Marcus Bell", from: "2026-08-28", to: "2026-09-08", revenue: 1_045, status: "Active" },
  { id: "rn-2", customer: "Priya Raman", from: "2026-08-10", to: "2026-08-17", revenue: 665, status: "Completed" },
  { id: "rn-3", customer: "Dan Okoye", from: "2026-07-19", to: "2026-07-26", revenue: 665, status: "Completed" },
  { id: "rn-4", customer: "Elena Vasquez", from: "2026-06-30", to: "2026-07-06", revenue: 570, status: "Completed" },
  { id: "rn-5", customer: "Tom Bridger", from: "2026-06-14", to: "2026-06-16", revenue: 0, status: "Cancelled" },
];

export const DEMO_FINANCE: Finance = {
  acquisitionType: "Financed",
  acquisitionDate: "2026-02-14",
  purchasePrice: 31_400,
  monthlyPayment: 486,
  initialPayment: 3_200,
  termMonths: 48,
  balloon: 9_800,
  startDate: "2026-02-14",
};

export const DEMO_RETIREMENT: Retirement = {
  disposed: false,
  date: "",
  buyer: "",
  proceeds: 0,
  notes: "",
};

/** Published a fortnight ago — long enough for the record to have moved on. */
export const DEMO_PUBLISHED_AT = new Date("2026-08-21T09:40:00");

/**
 * What the live listing was published from — deliberately NOT today's record.
 *
 * The rate has since gone up by $8, the deposit by $50, monthly hire has been
 * switched off and a fourth photo was added. So the drift banner is on screen
 * the moment the page opens, with four real rows in it, and nobody has to guess
 * what it looks like in anger.
 */
export const DEMO_LISTING_SNAPSHOT: ListingSnapshot = {
  name: "2023 Honda Accord Sport",
  registration: "6HNA118",
  colour: "Black",
  daily: 87,
  weekly: 570,
  monthly: 2_050,
  deposit: 350,
  durations: "Daily, Weekly, Monthly",
  allowance: "150 mi/day · $0.35 per extra mile",
  extras: "Child seat, Additional driver, Toll pass",
  photos: "Front 3/4 › Rear 3/4 › Interior — front",
};

/* ══════════════════════════════════════════════════════════════════════════
 * Maths that reads the constants above
 *
 * Lives here rather than in `_ui` because every one of these is measured
 * against `TODAY` or `SERVICE_INTERVAL_MILES`, and a helper that silently
 * reads a different "today" than the record was tuned for is how a screen
 * ends up demonstrating the wrong three states.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Signed days from TODAY. Negative is in the past. */
export const daysUntil = (iso: string) =>
  Math.round((new Date(`${iso}T00:00:00`).getTime() - TODAY_MS) / 86_400_000);

export const daysBetween = (from: string, to: string) =>
  Math.max(
    0,
    Math.round(
      (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000,
    ),
  );

/**
 * Tolerant parse. An operator mid-keystroke — "0.", "$12", "" — is not an
 * error, so anything unparseable reads as 0 rather than NaN, which would
 * propagate into every total on the screen as "NaN".
 */
export const num = (v: string) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const miles = (n: number) => `${n.toLocaleString("en-US")} mi`;

/* ══════════════════════════════════════════════════════════════════════════
 * Activity
 *
 * Grounded in `vehicle_events` — a real table with a real hook
 * (`use-vehicle-events.ts`) and, in v1, zero UI consumers. The data pipe has
 * been sitting there ready the whole time; there has simply never been a
 * surface to put a vehicle's own history on. The right rail is that surface.
 * ═════════════════════════════════════════════════════════════════════════ */

export type EventKind =
  | "created"
  | "listing"
  | "pricing"
  | "rental"
  | "service"
  | "photo"
  | "compliance"
  | "document";

export type VehicleEvent = {
  id: string;
  kind: EventKind;
  /** What happened, in the operator's words. */
  label: string;
  /** Who did it. `System` for anything the platform did on its own. */
  actor: string;
  /** A label, not a Date — rendering `new Date()` on the server and again on
   *  hydration earns a mismatch warning for no benefit. */
  at: string;
};

export const DEMO_EVENTS: VehicleEvent[] = [
  { id: "ev-1", kind: "pricing", label: "Daily rate raised to $95", actor: "Ghulam", at: "2 Sep · 4:12 PM" },
  { id: "ev-2", kind: "pricing", label: "Monthly hire switched off", actor: "Ghulam", at: "2 Sep · 4:11 PM" },
  { id: "ev-3", kind: "photo", label: "Photo added — Wheels", actor: "Ghulam", at: "2 Sep · 4:08 PM" },
  { id: "ev-4", kind: "rental", label: "Went out to Marcus Bell", actor: "System", at: "28 Aug · 10:02 AM" },
  { id: "ev-5", kind: "compliance", label: "Warranty cover ended", actor: "System", at: "20 Aug · 12:00 AM" },
  { id: "ev-6", kind: "listing", label: "Published to the booking site", actor: "Ghulam", at: "21 Aug · 9:40 AM" },
  { id: "ev-7", kind: "rental", label: "Came back from Priya Raman", actor: "System", at: "17 Aug · 5:30 PM" },
  { id: "ev-8", kind: "service", label: "Tyre rotation + alignment logged", actor: "Dani", at: "12 Jun · 2:20 PM" },
  { id: "ev-9", kind: "document", label: "Fleet insurance certificate filed", actor: "Ghulam", at: "14 Mar · 11:05 AM" },
  { id: "ev-10", kind: "created", label: "Vehicle added to the fleet", actor: "Ghulam", at: "14 Feb · 9:00 AM" },
];
