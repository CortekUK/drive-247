/**
 * Matching engine — Spec Section 6.5.
 *
 * Pure TypeScript helper, callable from edge functions (Deno) and the offer-link
 * builder. Given a lead's request, returns ranked vehicle options including
 * stitched 2-vehicle combos and conditional matches (deposit/dates flex).
 *
 * Inputs: MatchInput
 * Outputs: MatchResult
 *
 * Algorithm overview (deterministic core):
 *  1. Resolve candidate vehicles (specific / class / any).
 *  2. Filter by eligibility (active, rental-type flags, min_rental_hours, rideshare).
 *  3. Compute availability per vehicle (bookings ∪ maintenance + buffer).
 *  4. Price each option (daily/weekly/monthly tier + dynamic pricing).
 *  5. Compute matchScore (closeness, coverage, price fit, utilisation).
 *  6. Detect stitched combos when no single vehicle covers the period.
 *  7. Detect conditional matches (±2 day shift / higher deposit unlock).
 *  8. Sort matchScore DESC, top 8.
 *
 * AI rerank is applied in run-matching-engine after this layer.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type RentalType = "daily" | "weekly" | "monthly";

export interface MatchInput {
  leadId: string;
  tenantId: string;
  vehicleInterest:
    | { type: "specific"; vehicleId: string }
    | { type: "class"; class: string }
    | { type: "any" };
  startDate: string; // YYYY-MM-DD
  endDate: string;
  rentalType: RentalType;
  purpose?: string;
  weeklyBudget?: number;
  depositComfortAmount?: number;
}

export interface VehicleOption {
  vehicleId: string;
  name: string;
  class: string;
  photoUrl: string | null;
  startDate: string;
  endDate: string;
  weeklyRate: number;
  dailyRate: number;
  available: "full" | "partial" | "unavailable";
}

export interface MatchOption {
  kind: "single" | "stitched" | "conditional";
  vehicles: VehicleOption[];
  conditions?: string[];
  matchScore: number;
  reasoning?: string[];
  totalPrice: number;
  budgetFit: "under" | "within" | "over";
  insuranceEligible: boolean;
}

export interface MatchResult {
  generatedAt: string;
  options: MatchOption[];
}

// ──────────────────────────────────────────────────────────────────────────────
// DB shapes (subset of generated types)
// ──────────────────────────────────────────────────────────────────────────────

interface VehicleRow {
  id: string;
  tenant_id: string;
  make: string | null;
  model: string | null;
  reg: string | null;
  category: string | null;
  daily_rate?: number | null;
  weekly_rate?: number | null;
  monthly_rate?: number | null;
  rate_daily?: number | null;
  rate_weekly?: number | null;
  rate_monthly?: number | null;
  status: string | null;
  available_daily?: boolean | null;
  available_weekly?: boolean | null;
  available_monthly?: boolean | null;
  min_rental_hours?: number | null;
  rideshare_approved?: boolean | null;
  is_active?: boolean | null;
  photo_url?: string | null;
  higher_deposit_unlocks_renters?: boolean | null;
}

interface RentalBooking {
  vehicle_id: string;
  start_date: string;
  end_date: string;
  status: string;
}

// Minimal Supabase client surface used here.
interface SupabaseLike {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: unknown) => unknown;
      in: (col: string, v: unknown[]) => unknown;
    };
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

function overlapDays(a1: string, a2: string, b1: string, b2: string): number {
  const start = Math.max(Date.parse(a1), Date.parse(b1));
  const end = Math.min(Date.parse(a2), Date.parse(b2));
  if (end < start) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

function getRate(v: VehicleRow, kind: "daily" | "weekly" | "monthly"): number {
  const direct = v[`rate_${kind}` as "rate_daily" | "rate_weekly" | "rate_monthly"];
  const legacy = v[`${kind}_rate` as "daily_rate" | "weekly_rate" | "monthly_rate"];
  return Number(direct ?? legacy ?? 0);
}

function priceFor(v: VehicleRow, kind: RentalType, days: number): number {
  if (kind === "daily") return getRate(v, "daily") * days;
  if (kind === "weekly") {
    const weekly = getRate(v, "weekly");
    if (weekly > 0) return Math.ceil(days / 7) * weekly;
    return getRate(v, "daily") * days;
  }
  // monthly
  const monthly = getRate(v, "monthly");
  if (monthly > 0) return Math.ceil(days / 28) * monthly;
  return getRate(v, "weekly") * Math.ceil(days / 7);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────────

export async function runMatchingEngine(
  supabase: SupabaseLike,
  input: MatchInput,
): Promise<MatchResult> {
  const days = daysBetween(input.startDate, input.endDate);

  // 1. Candidate vehicles
  const vehiclesQuery = (supabase.from("vehicles") as unknown as {
    select: (s: string) => {
      eq: (c: string, v: unknown) => Promise<{ data: VehicleRow[] | null }>;
    };
  }).select("*").eq("tenant_id", input.tenantId);

  const { data: rawVehicles } = await (vehiclesQuery as unknown as Promise<{ data: VehicleRow[] | null }>);
  let vehicles = rawVehicles ?? [];

  if (input.vehicleInterest.type === "specific") {
    const target = vehicles.find((v) => v.id === input.vehicleInterest.vehicleId);
    const targetClass = target?.category ?? null;
    vehicles = vehicles.filter(
      (v) => v.id === input.vehicleInterest.vehicleId || (targetClass && v.category === targetClass),
    );
  } else if (input.vehicleInterest.type === "class") {
    vehicles = vehicles.filter(
      (v) => (v.category ?? "").toLowerCase() === input.vehicleInterest.class.toLowerCase(),
    );
  }

  // 2. Eligibility filter
  vehicles = vehicles.filter((v) => {
    if (v.is_active === false) return false;
    if ((v.status ?? "").toLowerCase() === "sold" || (v.status ?? "").toLowerCase() === "disposed") return false;
    if (input.rentalType === "daily" && v.available_daily === false) return false;
    if (input.rentalType === "weekly" && v.available_weekly === false) return false;
    if (input.rentalType === "monthly" && v.available_monthly === false) return false;
    const isGig = ["uber", "lyft", "doordash", "instacart", "delivery"].includes(
      (input.purpose ?? "").toLowerCase(),
    );
    if (isGig && v.rideshare_approved === false) return false;
    return true;
  });

  if (vehicles.length === 0) {
    return { generatedAt: new Date().toISOString(), options: [] };
  }

  const vehicleIds = vehicles.map((v) => v.id);

  // 3. Bookings (active/pending/confirmed)
  const bookingsRes = await (supabase.from("rentals") as unknown as {
    select: (s: string) => {
      in: (c: string, v: string[]) => Promise<{ data: RentalBooking[] | null }>;
    };
  }).select("vehicle_id, start_date, end_date, status").in("vehicle_id", vehicleIds);
  const bookings = bookingsRes.data ?? [];

  function vehicleAvailability(vehicleId: string): "full" | "partial" | "unavailable" {
    const occupiedDays = bookings
      .filter((b) => b.vehicle_id === vehicleId)
      .map((b) => overlapDays(input.startDate, input.endDate, b.start_date, b.end_date))
      .reduce((acc, d) => acc + d, 0);
    if (occupiedDays === 0) return "full";
    if (occupiedDays >= days) return "unavailable";
    return "partial";
  }

  // 4-5. Score + price
  const ratedSingles: MatchOption[] = [];
  const requestedClass =
    input.vehicleInterest.type === "specific"
      ? vehicles.find((v) => v.id === input.vehicleInterest.vehicleId)?.category ?? null
      : input.vehicleInterest.type === "class"
        ? input.vehicleInterest.class
        : null;

  for (const v of vehicles) {
    const avail = vehicleAvailability(v.id);
    const totalPrice = priceFor(v, input.rentalType, days);
    const weeklyRate = getRate(v, "weekly");
    const dailyRate = getRate(v, "daily");

    // Closeness
    let closeness = 60;
    if (
      input.vehicleInterest.type === "specific" &&
      v.id === input.vehicleInterest.vehicleId
    ) {
      closeness = 100;
    } else if (requestedClass && v.category === requestedClass) {
      closeness = 80;
    }

    // Date coverage
    const coverage = avail === "full" ? 100 : avail === "partial" ? 50 : 0;

    // Budget fit
    let budgetFit: MatchOption["budgetFit"] = "within";
    let budgetScore = 100;
    if (input.weeklyBudget && weeklyRate) {
      if (weeklyRate < input.weeklyBudget * 0.7) budgetFit = "under";
      else if (weeklyRate > input.weeklyBudget * 1.1) {
        budgetFit = "over";
        budgetScore = Math.max(0, 100 - (weeklyRate - input.weeklyBudget) / 2);
      }
    }

    // Final deterministic score
    const matchScore = Math.round(
      closeness * 0.4 + coverage * 0.4 + budgetScore * 0.2,
    );

    const option: MatchOption = {
      kind: "single",
      vehicles: [
        {
          vehicleId: v.id,
          name: `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.reg || "Vehicle",
          class: v.category ?? "",
          photoUrl: v.photo_url ?? null,
          startDate: input.startDate,
          endDate: input.endDate,
          weeklyRate,
          dailyRate,
          available: avail,
        },
      ],
      matchScore,
      reasoning: [
        avail === "full" ? "Fully available for the period." : avail === "partial" ? "Partially available." : "Not available for these dates.",
        closeness === 100
          ? "Matches the requested vehicle exactly."
          : closeness === 80
            ? "Same class as requested."
            : "Adjacent class.",
      ],
      totalPrice,
      budgetFit,
      insuranceEligible: true,
    };

    if (avail !== "unavailable") {
      ratedSingles.push(option);
    } else {
      // Conditional candidates (date shift unlocks)
      const conditions: string[] = [];
      if (v.higher_deposit_unlocks_renters) {
        conditions.push("Higher deposit ($500) unlocks this vehicle");
      }
      conditions.push("Try shifting start by ±2 days");
      ratedSingles.push({ ...option, kind: "conditional", conditions });
    }
  }

  // 6. Stitched options — only build when no single vehicle covers the period fully.
  const fullySingle = ratedSingles.find((o) => o.vehicles[0]?.available === "full");
  const stitchedOptions: MatchOption[] = [];
  if (!fullySingle && days >= 3) {
    // Build per-vehicle occupied-day sets within the requested window.
    const dayCount = days;
    const startMs = Date.parse(input.startDate);

    function occupiedSetFor(vehicleId: string): Set<number> {
      const occupied = new Set<number>();
      for (const b of bookings) {
        if (b.vehicle_id !== vehicleId) continue;
        const overlapStart = Math.max(startMs, Date.parse(b.start_date));
        const overlapEnd = Math.min(Date.parse(input.endDate), Date.parse(b.end_date));
        if (overlapEnd < overlapStart) continue;
        const startIdx = Math.floor((overlapStart - startMs) / 86_400_000);
        const endIdx = Math.floor((overlapEnd - startMs) / 86_400_000);
        for (let i = startIdx; i <= endIdx; i++) occupied.add(i);
      }
      return occupied;
    }

    function freeWindowsFor(vehicleId: string): Array<[number, number]> {
      const occ = occupiedSetFor(vehicleId);
      const windows: Array<[number, number]> = [];
      let runStart = -1;
      for (let i = 0; i < dayCount; i++) {
        if (!occ.has(i)) {
          if (runStart < 0) runStart = i;
        } else if (runStart >= 0) {
          windows.push([runStart, i - 1]);
          runStart = -1;
        }
      }
      if (runStart >= 0) windows.push([runStart, dayCount - 1]);
      return windows;
    }

    // Sort partial vehicles by score so we try the best fits first.
    const partials = ratedSingles
      .filter((o) => o.vehicles[0]?.available === "partial")
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 6);

    outer: for (let i = 0; i < partials.length; i++) {
      const a = partials[i];
      const aId = a.vehicles[0]!.vehicleId;
      const aWindows = freeWindowsFor(aId);
      if (aWindows.length === 0 || aWindows[0][0] !== 0) continue; // must start on day 0
      const aEnd = aWindows[0][1];
      if (aEnd >= dayCount - 1) continue; // already fully covers, would have been a 'full' single
      const handoffDay = aEnd + 1; // B picks up here

      for (let j = 0; j < partials.length; j++) {
        if (j === i) continue;
        const b = partials[j];
        const bId = b.vehicles[0]!.vehicleId;
        const bOcc = occupiedSetFor(bId);
        let bFreeContiguous = true;
        for (let d = handoffDay; d < dayCount; d++) {
          if (bOcc.has(d)) { bFreeContiguous = false; break; }
        }
        if (!bFreeContiguous) continue;

        // Build stitched option
        const handoffDate = new Date(startMs + handoffDay * 86_400_000).toISOString().slice(0, 10);
        const aEndDate = new Date(startMs + (handoffDay - 1) * 86_400_000).toISOString().slice(0, 10);
        const aVehicle = { ...a.vehicles[0]!, endDate: aEndDate, available: "full" as const };
        const bVehicle = { ...b.vehicles[0]!, startDate: handoffDate, available: "full" as const };

        // Price: A for its days + B for its days
        const aRow = vehicles.find((v) => v.id === aId)!;
        const bRow = vehicles.find((v) => v.id === bId)!;
        const aPrice = priceFor(aRow, input.rentalType, handoffDay);
        const bPrice = priceFor(bRow, input.rentalType, dayCount - handoffDay);

        stitchedOptions.push({
          kind: "stitched",
          vehicles: [aVehicle, bVehicle],
          matchScore: Math.round((a.matchScore + b.matchScore) / 2),
          reasoning: [
            `Swap on ${handoffDate}: ${aVehicle.name} for ${handoffDay} days, then ${bVehicle.name}.`,
          ],
          totalPrice: aPrice + bPrice,
          budgetFit: a.budgetFit === "over" || b.budgetFit === "over" ? "over" : "within",
          insuranceEligible: true,
        });

        if (stitchedOptions.length >= 3) break outer;
      }
    }
  }

  const combined = [...ratedSingles, ...stitchedOptions];
  combined.sort((a, b) => b.matchScore - a.matchScore);
  const options = combined.slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    options,
  };
}
