"use client";

/**
 * The rental control centre's one read of the rental.
 *
 * Called TWICE per screen — once by the stage rail in
 * `shared/layout/app-sidebar-v2.tsx`, once by `rental-detail-v2.tsx` — and that
 * is deliberate rather than sloppy. The rail lives inside the app sidebar, a
 * sibling of the page, so there is no component that could hold this state for
 * both without a new provider wrapping the whole dashboard. React Query already
 * solves it: one query key, one in-flight request, one cache entry, two
 * consumers. Nothing is fetched twice, and the rail can never show a customer
 * the panel disagrees with.
 *
 * The query itself is v1's, from `(dashboard)/rentals/[id]/page.tsx:675` —
 * same table, same two joins by their explicit FK names, same
 * `.eq("tenant_id", …)` scoping, same `.maybeSingle()`. Three columns are added
 * to the customer join (`created_at`, `date_of_birth`,
 * `identity_verification_status`) because the Customer stage shows them and the
 * dialogs it opens require `date_of_birth`; nothing is removed, and the WHERE
 * clause is untouched. V2_PLAN §5: a v2 screen may present differently, it may
 * not read more broadly.
 *
 * The key is `rental-detail-v2`, NOT v1's `["rental", id, tenant?.id]`. The two
 * queries select different column sets, and sharing a key would mean whichever
 * screen mounted second read the other's narrower row out of the cache — a
 * missing `date_of_birth` with no error anywhere.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

/* ── the joined row ─────────────────────────────────────────────────────── */

export type RentalCustomer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  date_of_birth: string | null;
  /** 'verified' | 'manually_verified' | 'pending' | 'rejected' | null. */
  identity_verification_status: string | null;
  license_number: string | null;
  license_state: string | null;
  is_blocked: boolean | null;
  blocked_reason: string | null;
};

export type RentalVehicle = {
  id: string;
  reg: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string | null;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  lockbox_code: string | null;
  lockbox_instructions: string | null;
};

/** The rental row as it comes back, with its two joins. */
export type RentalRow = Record<string, any> & {
  id: string;
  rental_number: string | null;
  status: string | null;
  start_date: string;
  end_date: string | null;
  pickup_time: string | null;
  return_time: string | null;
  customer_id: string | null;
  vehicle_id: string | null;
  tenant_id: string | null;
  customers: RentalCustomer | null;
  vehicles: RentalVehicle | null;
};

/** The tone the status chip wears. Mirrors the list's own status colours. */
export type StatusTone = "muted" | "success" | "warning" | "primary" | "destructive";

/**
 * The rental, plus the handful of facts the rail and every stage would
 * otherwise each derive for themselves — and derive slightly differently.
 */
export type RentalDetailV2 = {
  rental: RentalRow;
  customer: RentalCustomer | null;
  vehicle: RentalVehicle | null;

  /** For the rail's Customer line, and the screen's title. */
  customerName: string | null;
  /** For the rail's Vehicle line: what an operator calls the car. */
  vehicleName: string | null;
  /** "Model 3 · ABC123" — the car AND its plate, for headings with room. */
  vehicleLabel: string | null;

  /** "4 Sep → 11 Sep". No year: the rail has 280px. */
  dateRangeShort: string | null;
  /** "4 Sep 2026 → 11 Sep 2026", for the panel. */
  dateRangeLong: string | null;
  /** Whole days between the two dates, or null when the end is open. */
  days: number | null;

  status: { value: string; label: string; tone: StatusTone };
  /** "RNT-2049", or null on a rental that was never numbered. */
  rentalNumber: string | null;
};

/* ── derivation ─────────────────────────────────────────────────────────── */

/** "4 Sep" — built at LOCAL midnight, see `fmtDate` in `_kit.tsx`. */
const shortDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
      })
    : null;

const longDate = (iso: string | null | undefined) =>
  iso
    ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

/**
 * `rentals.status` → a label and a tone.
 *
 * The five values are the ones the rentals list filters on
 * (`rentals-filter-panel.tsx`), so the detail screen and the list can never
 * describe the same rental differently. An unknown value is shown verbatim in
 * the neutral tone rather than swallowed — a status nobody has seen before is
 * worth showing, not hiding.
 */
const STATUS_TONES: Record<string, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "success" },
  upcoming: { label: "Upcoming", tone: "primary" },
  pending: { label: "Pending", tone: "warning" },
  completed: { label: "Completed", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "destructive" },
};

function deriveStatus(value: string | null | undefined) {
  const key = (value ?? "").toLowerCase();
  const known = STATUS_TONES[key];
  if (known) return { value: key, ...known };
  return {
    value: key,
    label: value ? value.charAt(0).toUpperCase() + value.slice(1) : "No status",
    tone: "muted" as StatusTone,
  };
}

/** Everything the rail and the stages read off a rental, computed once. */
export function deriveRentalDetail(rental: RentalRow): RentalDetailV2 {
  const customer = rental.customers ?? null;
  const vehicle = rental.vehicles ?? null;

  const vehicleName =
    vehicle && (vehicle.make || vehicle.model)
      ? [vehicle.make, vehicle.model].filter(Boolean).join(" ")
      : (vehicle?.reg ?? null);

  const vehicleLabel = vehicle
    ? vehicleName && vehicleName !== vehicle.reg
      ? `${vehicleName} · ${vehicle.reg}`
      : vehicle.reg
    : null;

  const from = shortDate(rental.start_date);
  const to = shortDate(rental.end_date);
  const fromLong = longDate(rental.start_date);
  const toLong = longDate(rental.end_date);

  // A rental with no return date recorded has a start and no end. It gets an
  // arrow with nothing after it rather than falling back to the start date
  // twice, which would read as a same-day hire.
  const dateRangeShort = from ? (to ? `${from} → ${to}` : `${from} → open`) : null;
  const dateRangeLong = fromLong ? (toLong ? `${fromLong} → ${toLong}` : `${fromLong} → open-ended`) : null;

  let days: number | null = null;
  if (rental.start_date && rental.end_date) {
    const a = new Date(`${String(rental.start_date).slice(0, 10)}T00:00:00`).getTime();
    const b = new Date(`${String(rental.end_date).slice(0, 10)}T00:00:00`).getTime();
    if (Number.isFinite(a) && Number.isFinite(b)) days = Math.max(0, Math.round((b - a) / 86_400_000));
  }

  return {
    rental,
    customer,
    vehicle,
    customerName: customer?.name ?? null,
    vehicleName,
    vehicleLabel,
    dateRangeShort,
    dateRangeLong,
    days,
    status: deriveStatus(rental.status),
    rentalNumber: rental.rental_number ?? null,
  };
}

/* ── the hook ───────────────────────────────────────────────────────────── */

/**
 * The rental behind `/rentals/<id>`, for the canary's control centre.
 *
 * `rentalId` is nullable so the sidebar can call this unconditionally on every
 * page and simply not fetch when it is not on a rental — hooks may not be
 * called conditionally, and `enabled` is how React Query expresses that.
 */
export function useRentalDetailV2(rentalId: string | null | undefined) {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["rental-detail-v2", rentalId, tenant?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select(
          `
          *,
          customers!rentals_customer_id_fkey(
            id, name, email, phone, created_at, date_of_birth,
            identity_verification_status, license_number, license_state,
            is_blocked, blocked_reason
          ),
          vehicles!rentals_vehicle_id_fkey(
            id, reg, make, model, year, status,
            daily_rent, weekly_rent, monthly_rent,
            lockbox_code, lockbox_instructions
          )
        `
        )
        .eq("id", rentalId!)
        .eq("tenant_id", tenant!.id)
        .maybeSingle();

      if (error) throw error;
      // `null` rather than a throw: "this rental is not yours / no longer
      // exists" is a screen the page renders, not an error state. v1 throws
      // here and shows its generic error card; the control centre would rather
      // say what happened.
      return (data as RentalRow | null) ?? null;
    },
    enabled: !!rentalId && !!tenant?.id,
  });

  const detail = useMemo(
    () => (query.data ? deriveRentalDetail(query.data) : null),
    [query.data]
  );

  return {
    detail,
    isLoading: query.isLoading,
    /** The query ran and came back with nothing — wrong tenant, or deleted. */
    notFound: query.isSuccess && query.data === null,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
