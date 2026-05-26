// Calculate and create/update excess mileage charges for a rental
// Called when return mileage is recorded or updated. Idempotent — deletes old charge, creates new if needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Tier logic inlined (matches pricing tiers)
function getMileageTier(rentalDays: number, monthlyTierDays: number = 30): 'daily' | 'weekly' | 'monthly' {
  if (rentalDays >= monthlyTierDays) return 'monthly';
  if (rentalDays >= 7) return 'weekly';
  return 'daily';
}

function calculateTotalMileageAllowance(
  vehicle: { daily_mileage: number | null; weekly_mileage: number | null; monthly_mileage: number | null },
  rentalDays: number,
  monthlyTierDays: number = 30
): number | null {
  const tier = getMileageTier(rentalDays, monthlyTierDays);
  let perUnit: number | null;
  switch (tier) {
    case 'daily': perUnit = vehicle.daily_mileage; break;
    case 'weekly': perUnit = vehicle.weekly_mileage; break;
    case 'monthly': perUnit = vehicle.monthly_mileage; break;
  }
  if (perUnit === null || perUnit === undefined) return null;

  switch (tier) {
    case 'daily': return rentalDays * perUnit;
    case 'weekly': return Math.ceil(rentalDays / 7) * perUnit;
    case 'monthly': return Math.ceil(rentalDays / monthlyTierDays) * perUnit;
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, tenantId } = await req.json();

    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    console.log("[EXCESS-MILEAGE] Calculating for rental:", rentalId);

    // Helper to delete existing excess mileage charge
    const deleteExistingCharge = async () => {
      const { data: existing } = await supabase
        .from("ledger_entries")
        .select("id")
        .eq("rental_id", rentalId)
        .eq("type", "Charge")
        .eq("category", "Excess Mileage");

      if (existing && existing.length > 0) {
        const ids = existing.map((e: any) => e.id);
        await supabase
          .from("ledger_entries")
          .delete()
          .in("id", ids);
        console.log("[EXCESS-MILEAGE] Deleted existing charge(s):", ids);
      }
    };

    // Fetch both key handovers for the rental
    const { data: handovers, error: handoverError } = await supabase
      .from("rental_key_handovers")
      .select("handover_type, mileage")
      .eq("rental_id", rentalId);

    if (handoverError) {
      console.error("[EXCESS-MILEAGE] Error fetching handovers:", handoverError);
      return errorResponse("Failed to fetch handovers", 500);
    }

    const givingHandover = handovers?.find((h: any) => h.handover_type === "giving");
    const receivingHandover = handovers?.find((h: any) => h.handover_type === "receiving");

    const pickupMileage = givingHandover?.mileage;
    const returnMileage = receivingHandover?.mileage;

    // If no return mileage or no pickup mileage, delete any existing charge and return
    if (!returnMileage || !pickupMileage) {
      await deleteExistingCharge();
      return jsonResponse({ success: true, noCharge: true, reason: "Missing mileage readings" });
    }

    // Fetch rental details including mileage overrides + unlimited-mileage flag
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("vehicle_id, customer_id, tenant_id, start_date, end_date, daily_mileage_override, weekly_mileage_override, monthly_mileage_override, excess_mileage_rate_override, is_unlimited_mileage")
      .eq("id", rentalId)
      .single();

    // Unlimited-mileage upgrade short-circuits the calculation entirely.
    // Also clean up any stale excess-mileage charge from a prior calculation.
    if (rental?.is_unlimited_mileage) {
      await deleteExistingCharge();
      console.log("[EXCESS-MILEAGE] Skipped — rental has unlimited mileage upgrade.");
      return jsonResponse({ success: true, skipped: true, reason: "unlimited_mileage" });
    }

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch tenant's monthly tier setting
    let monthlyTierDays = 30;
    if (effectiveTenantId) {
      const { data: tenantData } = await supabase
        .from("tenants")
        .select("monthly_tier_days")
        .eq("id", effectiveTenantId)
        .single();
      if (tenantData?.monthly_tier_days) monthlyTierDays = tenantData.monthly_tier_days;
    }

    // Calculate rental days
    let rentalDays = 1;
    if (rental.start_date && rental.end_date) {
      rentalDays = Math.max(1, Math.ceil(
        (new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)
      ));
    }

    // Fetch vehicle's per-tier mileage and excess_mileage_rate
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("daily_mileage, weekly_mileage, monthly_mileage, excess_mileage_rate")
      .eq("id", rental.vehicle_id)
      .single();

    if (vehicleError || !vehicle) {
      await deleteExistingCharge();
      return jsonResponse({ success: true, noCharge: true, reason: "Vehicle not found" });
    }

    // Apply rental-level overrides (admin can override mileage per-rental)
    const effectiveVehicle = {
      daily_mileage: rental.daily_mileage_override !== null && rental.daily_mileage_override !== undefined ? rental.daily_mileage_override : vehicle.daily_mileage,
      weekly_mileage: rental.weekly_mileage_override !== null && rental.weekly_mileage_override !== undefined ? rental.weekly_mileage_override : vehicle.weekly_mileage,
      monthly_mileage: rental.monthly_mileage_override !== null && rental.monthly_mileage_override !== undefined ? rental.monthly_mileage_override : vehicle.monthly_mileage,
    };
    const effectiveExcessRate = rental.excess_mileage_rate_override !== null && rental.excess_mileage_rate_override !== undefined
      ? rental.excess_mileage_rate_override
      : vehicle.excess_mileage_rate;

    const hasOverrides = rental.daily_mileage_override != null || rental.weekly_mileage_override != null || rental.monthly_mileage_override != null || rental.excess_mileage_rate_override != null;
    if (hasOverrides) {
      console.log("[EXCESS-MILEAGE] Using rental-level mileage overrides:", {
        daily: effectiveVehicle.daily_mileage, weekly: effectiveVehicle.weekly_mileage, monthly: effectiveVehicle.monthly_mileage, rate: effectiveExcessRate
      });
    }

    // Calculate tier-based total allowance using effective values
    const totalAllowance = calculateTotalMileageAllowance(effectiveVehicle, rentalDays, monthlyTierDays);
    const tier = getMileageTier(rentalDays, monthlyTierDays);

    // If unlimited mileage for this tier or no rate set, no charge
    if (totalAllowance === null || !effectiveExcessRate || effectiveExcessRate <= 0) {
      await deleteExistingCharge();
      return jsonResponse({
        success: true,
        noCharge: true,
        reason: totalAllowance === null ? `Unlimited mileage (${tier} tier)` : "No excess mileage rate set",
      });
    }

    // Calculate excess miles
    const milesDriven = returnMileage - pickupMileage;
    const excessMiles = milesDriven - totalAllowance;

    if (excessMiles <= 0) {
      await deleteExistingCharge();
      return jsonResponse({
        success: true,
        noCharge: true,
        reason: "Within allowance",
        milesDriven,
        allowedMileage: totalAllowance,
        tier,
      });
    }

    // Calculate charge amount
    const chargeAmount = Math.round(excessMiles * effectiveExcessRate * 100) / 100;

    console.log("[EXCESS-MILEAGE] Tier:", tier, "Allowance:", totalAllowance, "Excess:", excessMiles, "miles × rate:", effectiveExcessRate, "= charge:", chargeAmount, hasOverrides ? "(overrides applied)" : "");

    // Delete any existing excess mileage charge (idempotent recalculation)
    await deleteExistingCharge();

    // Insert new ledger entry
    const today = new Date().toISOString().split("T")[0];
    const { data: ledgerEntry, error: ledgerError } = await supabase
      .from("ledger_entries")
      .insert({
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: effectiveTenantId,
        entry_date: today,
        due_date: today,
        type: "Charge",
        category: "Excess Mileage",
        amount: chargeAmount,
        remaining_amount: chargeAmount,
        reference: `${excessMiles} excess miles (${tier} tier, ${totalAllowance} allowance) × ${effectiveExcessRate}/mile${hasOverrides ? ' [rental override]' : ''}`,
      })
      .select()
      .single();

    if (ledgerError) {
      console.error("[EXCESS-MILEAGE] Failed to create ledger entry:", ledgerError);
      return errorResponse("Failed to create excess mileage charge: " + ledgerError.message, 500);
    }

    console.log("[EXCESS-MILEAGE] Created charge:", ledgerEntry.id, "amount:", chargeAmount);

    // Finance Sync — enqueue mileage_charge for the accounting sync layer.
    // Non-fatal: a sync failure must never break the mileage-charge flow.
    if (effectiveTenantId) {
      try {
        const { data: tenantRow } = await supabase
          .from("tenants")
          .select("currency_code")
          .eq("id", effectiveTenantId)
          .maybeSingle();
        await supabase.rpc("enqueue_financial_event", {
          p_tenant_id: effectiveTenantId,
          p_event_type: "mileage_charge",
          p_amount_cents: Math.round(Number(chargeAmount) * 100),
          p_currency: (tenantRow?.currency_code as string) ?? "USD",
          p_rental_id: rentalId,
          p_customer_id: rental.customer_id ?? null,
          p_vehicle_id: rental.vehicle_id ?? null,
          p_source_table: "ledger_entries",
          p_source_id: ledgerEntry.id,
          p_description: `Excess mileage: ${excessMiles} miles × $${effectiveExcessRate}/mile`,
          p_metadata: { excess_miles: excessMiles, tier, rate: effectiveExcessRate, has_overrides: hasOverrides },
        });
      } catch (err) {
        console.error("[finance-sync] enqueue mileage_charge failed (non-fatal):", err);
      }
    }

    return jsonResponse({
      success: true,
      chargeId: ledgerEntry.id,
      excessMiles,
      chargeAmount,
      milesDriven,
      allowedMileage: totalAllowance,
      tier,
      rate: effectiveExcessRate,
      hasOverrides,
    });
  } catch (error: any) {
    console.error("[EXCESS-MILEAGE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
