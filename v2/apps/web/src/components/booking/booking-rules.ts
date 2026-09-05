/**
 * The tenant's booking rules, resolved once.
 *
 * Every fallback in here is a decision, and the decisions are ported from v1 —
 * where they are scattered across three files that do not agree with each
 * other. Pulling them into one pure function is the point: the sidebar, the
 * validator and the calendar all ask the same object, so they cannot drift.
 */

import type { Tenant } from "@/contexts/TenantContext";
import type { PickupLocation } from "@/lib/vehicles/types";

import { buildTimeSlots, normalizeClock } from "./time-utils";
import type { DeliveryOption } from "@/lib/stores/booking-store";

/**
 * Fallback minimum driver age when `tenants.minimum_rental_age` is unset.
 *
 * v1 disagrees with itself: `apps/booking/src/app/booking/page.tsx:147` uses
 * `|| 18`, while `MultiStepBookingWidget.tsx:3550` — the validator that
 * actually blocks the booking in the live multi-step flow — uses `|| 21`.
 *
 * v2 picks 21, once, here. The two failure modes are not symmetrical: refusing
 * a 19-year-old an operator would have accepted costs a booking the operator
 * can recover by setting the column; renting to someone under an operator's
 * (unset) policy is an insurance and compliance problem that cannot be undone.
 * The conservative floor is the right default for a value nobody configured.
 *
 * Note `??`, not `||`: `||` would treat a deliberate 0 as unset.
 */
export const DEFAULT_MINIMUM_RENTAL_AGE = 21;

/** v1's fallbacks for the duration and notice rules. */
export const DEFAULT_MAX_RENTAL_DAYS = 90;
export const DEFAULT_LEAD_TIME_HOURS = 24;
export const DEFAULT_MONTHLY_TIER_DAYS = 30;

export interface DeliveryModeAvailability {
  fixed: boolean;
  location: boolean;
  area: boolean;
  /** Every enabled mode, in presentation order. */
  enabled: DeliveryOption[];
  /**
   * True when the customer has a real choice to make. With one enabled mode
   * there is nothing to ask — v1 renders the plain address fields instead of a
   * radio group with a single option in it.
   */
  showChooser: boolean;
}

export interface BookingRules {
  /**
   * Minimum billable hours: `max(1, min_rental_days * 24 + min_rental_hours)`.
   * Ported verbatim from MultiStepBookingWidget.tsx:2545 and :3151.
   */
  minRentalHours: number;
  maxRentalDays: number;
  leadTimeHours: number;
  minimumAge: number;
  monthlyTierDays: number;
  /** The OPERATOR's zone — lead time is judged there, not in the customer's. */
  operatorTimezone: string;
  /** Selectable pickup / return times, bounded by working hours when enforced. */
  timeSlots: string[];
  workingHours: { open: string; close: string } | null;
  bufferMinutes: number;
  installmentsEnabled: boolean;
  smsConsentRequired: boolean;
  /**
   * Whether money is taken at the end of this form.
   *
   * Always true today, and the constant is deliberate. v1's "enquiry" tenants —
   * who are quoted a total but charged nothing until key handover — are chosen
   * by a HARDCODED ID LIST in `apps/booking/src/config/tenant-config.ts`
   * (`isEnquiryBasedTenant`), not by any column. `tenants.enquiries_enabled` is
   * a different setting entirely: it shows an "Enquiry" button in v1's nav for
   * customers whose dates have no availability, and it is on by default. Wiring
   * this to that column would silently stop collecting payment from every
   * tenant who has it on — which is most of them.
   *
   * The field exists so the payment workstream has one place to make this real
   * once there is a column that means it. See the handoff.
   */
  collectPaymentUpfront: boolean;
  fixedPickupAddress: string | null;
  fixedReturnAddress: string | null;
}

/**
 * `America/Chicago` is v1's hardcoded last resort (MultiStepBookingWidget.tsx:3174)
 * when neither the customer nor the tenant names a zone. Kept so a lead-time
 * rejection here matches one there.
 */
const FALLBACK_TIMEZONE = "America/Chicago";

export function deriveBookingRules(tenant: Tenant | null): BookingRules {
  const minDays = tenant?.min_rental_days ?? 0;
  const minHours = tenant?.min_rental_hours ?? 1;

  const enforceWorkingHours =
    tenant?.working_hours_enabled === true &&
    tenant?.working_hours_always_open !== true;

  const open = normalizeClock(tenant?.working_hours_open);
  const close = normalizeClock(tenant?.working_hours_close);

  return {
    minRentalHours: Math.max(1, minDays * 24 + minHours),
    maxRentalDays: tenant?.max_rental_days ?? DEFAULT_MAX_RENTAL_DAYS,
    leadTimeHours: tenant?.booking_lead_time_hours ?? DEFAULT_LEAD_TIME_HOURS,
    minimumAge: tenant?.minimum_rental_age ?? DEFAULT_MINIMUM_RENTAL_AGE,
    monthlyTierDays:
      tenant?.monthly_tier_days && tenant.monthly_tier_days > 0
        ? tenant.monthly_tier_days
        : DEFAULT_MONTHLY_TIER_DAYS,
    operatorTimezone: tenant?.timezone ?? FALLBACK_TIMEZONE,
    timeSlots: buildTimeSlots({ enforceWorkingHours, open, close }),
    workingHours: enforceWorkingHours && open && close ? { open, close } : null,
    bufferMinutes: tenant?.buffer_time_minutes ?? 0,
    installmentsEnabled: tenant?.installments_enabled === true,
    smsConsentRequired: tenant?.integration_twilio_sms === true,
    collectPaymentUpfront: true,
    fixedPickupAddress: nonEmpty(tenant?.fixed_pickup_address),
    fixedReturnAddress: nonEmpty(tenant?.fixed_return_address),
  };
}

function nonEmpty(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Which of the three pickup/return arrangements this tenant actually offers.
 *
 * Ported from apps/booking/src/app/booking/page.tsx:437-445. Two details carry
 * real weight:
 *
 *  - `fixed` defaults to TRUE when the column is null. A tenant with nothing
 *    configured still has to be bookable from their own address, and an empty
 *    mode list would take the vehicle off sale.
 *  - `location` needs BOTH the flag and at least one location row. The flag on
 *    its own would render an empty picker the customer cannot satisfy — and
 *    this tenant has three location rows with the flag OFF, which is precisely
 *    the case that would go wrong if the rows alone were consulted.
 */
export function resolveDeliveryModes(
  tenant: Tenant | null,
  pickupLocations: readonly PickupLocation[],
): DeliveryModeAvailability {
  const fixed = tenant?.fixed_address_enabled ?? true;
  const location =
    tenant?.multiple_locations_enabled === true && pickupLocations.length > 0;
  const area = tenant?.area_around_enabled === true;

  const enabled: DeliveryOption[] = [];
  if (fixed) enabled.push("fixed");
  if (location) enabled.push("location");
  if (area) enabled.push("area");

  // Nothing enabled at all is a broken configuration; self-pickup is the only
  // arrangement that needs no extra setting, so it is the safe floor.
  if (enabled.length === 0) {
    return {
      fixed: true,
      location: false,
      area: false,
      enabled: ["fixed"],
      showChooser: false,
    };
  }

  return { fixed, location, area, enabled, showChooser: enabled.length > 1 };
}
