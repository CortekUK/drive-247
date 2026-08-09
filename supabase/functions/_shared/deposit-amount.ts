// Single source of truth for "how much deposit should we hold on this rental?"
//
// Two functions place deposit holds and they disagreed:
//
//   place-deposit-hold   — override → per-vehicle (GMT only) → tenant global
//   create-hold-checkout — override → tenant global          (deposit_mode ignored)
//
// So the portal's "Add Hold" button under-held every GMT vehicle priced above
// the tenant global (GMT's Tesla: $200 configured, $100 authorised), while the
// automatic path held the right amount. The amount a renter is told about and
// the amount actually ringfenced must not depend on which button was pressed.
//
// This module is that resolution, extracted verbatim from place-deposit-hold so
// both callers land on the same number.

/** Tenant columns this resolver needs. Add to your `.select()` verbatim. */
export const DEPOSIT_AMOUNT_TENANT_COLUMNS =
  "global_deposit_amount, security_deposit_enabled, deposit_mode";

/** Rental columns this resolver needs. Add to your `.select()` verbatim. */
export const DEPOSIT_AMOUNT_RENTAL_COLUMNS = "vehicle_id, deposit_amount_override";

/**
 * Tenants whose per-vehicle `deposit_mode` is actually honoured.
 *
 * SCOPED DELIBERATELY. The other `per_vehicle` tenants run
 * `global_deposit_amount = 0`, so honouring `deposit_mode` for them would start
 * placing holds they do not collect today — a rollout decision, not a bug fix.
 * Widening this set changes what real customers are charged: do it deliberately.
 */
export const PER_VEHICLE_DEPOSIT_TENANT_IDS: ReadonlySet<string> = new Set([
  "ada84c6f-eb17-43b6-a14d-d16518165349", // globalmotiontransport (GMT)
]);

/** Where the resolved figure came from. Persisted on the deposit_hold_links ledger. */
export type DepositAmountSource =
  | "rental_override"
  | "vehicle_security_deposit"
  | "tenant_global";

export interface ResolvedDepositAmount {
  /** Major units (dollars), not cents. 0 means "no hold". */
  amount: number;
  /** Provenance of `amount`. */
  source: DepositAmountSource;
  /** The tenant-default figure before any per-rental override was applied. */
  baseAmount: number;
  /** The per-rental override, or null when unset. An explicit 0 is NOT null. */
  overrideAmount: number | null;
}

export interface DepositAmountTenant {
  global_deposit_amount?: number | string | null;
  deposit_mode?: string | null;
}

export interface DepositAmountRental {
  vehicle_id?: string | null;
  deposit_amount_override?: number | string | null;
}

/** Just enough of the supabase-js client to read one vehicle row. */
type SupabaseLike = { from: (table: string) => any };

/**
 * Resolve the deposit amount for a rental.
 *
 * Precedence:
 *   1. `rentals.deposit_amount_override` when it is non-NULL — INCLUDING an
 *      explicit 0, which means the operator unchecked the deposit for this
 *      rental and wants no hold. Treating 0 as "unset" is how a $150 default
 *      hold used to get placed against an operator who opted out.
 *   2. `vehicles.security_deposit`, but only for a `per_vehicle` tenant that is
 *      in PER_VEHICLE_DEPOSIT_TENANT_IDS and only when the vehicle carries a
 *      non-NULL figure.
 *   3. `tenants.global_deposit_amount`.
 *
 * Never throws: a vehicle lookup that fails falls back to the tenant global
 * rather than aborting the hold. Under-holding is recoverable; a thrown
 * exception on the money path is not.
 */
export async function resolveDepositAmount(
  supabase: SupabaseLike,
  args: {
    tenantId: string;
    tenant: DepositAmountTenant;
    rental: DepositAmountRental;
  }
): Promise<ResolvedDepositAmount> {
  const { tenantId, tenant, rental } = args;

  const rawOverride = rental.deposit_amount_override;
  const overrideAmount =
    rawOverride !== null && rawOverride !== undefined ? Number(rawOverride) : null;
  const normalisedOverride =
    overrideAmount !== null && Number.isFinite(overrideAmount) ? overrideAmount : null;

  let baseAmount = Number(tenant.global_deposit_amount) || 0;
  let baseSource: DepositAmountSource = "tenant_global";

  if (
    tenant.deposit_mode === "per_vehicle" &&
    PER_VEHICLE_DEPOSIT_TENANT_IDS.has(tenantId) &&
    rental.vehicle_id
  ) {
    try {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("security_deposit")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (vehicle && vehicle.security_deposit != null) {
        baseAmount = Number(vehicle.security_deposit) || 0;
        baseSource = "vehicle_security_deposit";
      }
    } catch (err) {
      console.warn(
        `[DEPOSIT-AMOUNT] per-vehicle lookup failed for vehicle ${rental.vehicle_id}; ` +
          `falling back to tenant global:`,
        err
      );
    }
  }

  const amount = normalisedOverride !== null ? normalisedOverride : baseAmount;
  const source: DepositAmountSource =
    normalisedOverride !== null ? "rental_override" : baseSource;

  return { amount, source, baseAmount, overrideAmount: normalisedOverride };
}
