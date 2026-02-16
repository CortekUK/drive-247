// Calculate and create/update excess mileage charges for a rental
// Called when return mileage is recorded or updated. Idempotent — deletes old charge, creates new if needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

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

    // Fetch rental details (vehicle_id, customer_id)
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("vehicle_id, customer_id, tenant_id")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch vehicle's allowed_mileage and excess_mileage_rate
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("allowed_mileage, excess_mileage_rate")
      .eq("id", rental.vehicle_id)
      .single();

    if (vehicleError || !vehicle) {
      await deleteExistingCharge();
      return jsonResponse({ success: true, noCharge: true, reason: "Vehicle not found" });
    }

    // If unlimited mileage or no rate set, no charge
    if (vehicle.allowed_mileage === null || !vehicle.excess_mileage_rate || vehicle.excess_mileage_rate <= 0) {
      await deleteExistingCharge();
      return jsonResponse({
        success: true,
        noCharge: true,
        reason: vehicle.allowed_mileage === null ? "Unlimited mileage" : "No excess mileage rate set",
      });
    }

    // Calculate excess miles
    const milesDriven = returnMileage - pickupMileage;
    const excessMiles = milesDriven - vehicle.allowed_mileage;

    if (excessMiles <= 0) {
      await deleteExistingCharge();
      return jsonResponse({
        success: true,
        noCharge: true,
        reason: "Within allowance",
        milesDriven,
        allowedMileage: vehicle.allowed_mileage,
      });
    }

    // Calculate charge amount
    const chargeAmount = Math.round(excessMiles * vehicle.excess_mileage_rate * 100) / 100;

    console.log("[EXCESS-MILEAGE] Excess:", excessMiles, "miles × rate:", vehicle.excess_mileage_rate, "= charge:", chargeAmount);

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
        reference: `${excessMiles} excess miles × ${vehicle.excess_mileage_rate}/mile`,
      })
      .select()
      .single();

    if (ledgerError) {
      console.error("[EXCESS-MILEAGE] Failed to create ledger entry:", ledgerError);
      return errorResponse("Failed to create excess mileage charge: " + ledgerError.message, 500);
    }

    console.log("[EXCESS-MILEAGE] Created charge:", ledgerEntry.id, "amount:", chargeAmount);

    return jsonResponse({
      success: true,
      chargeId: ledgerEntry.id,
      excessMiles,
      chargeAmount,
      milesDriven,
      allowedMileage: vehicle.allowed_mileage,
      rate: vehicle.excess_mileage_rate,
    });
  } catch (error: any) {
    console.error("[EXCESS-MILEAGE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
