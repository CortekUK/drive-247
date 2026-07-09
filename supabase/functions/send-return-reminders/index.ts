import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Scheduled return reminder sender (cron).
 *
 * Finds active rentals whose return date is approaching (within tenant's
 * configured return_reminder_hours) and triggers notify-rental-reminder
 * for each. Stamps return_reminder_sent_at to prevent duplicates.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Optional sandbox scoping. When `only_rental_id` is supplied (by the Time
  // Machine sandbox control), reminders are restricted to that ONE rental so a
  // manual dispatch can never touch another tenant's rentals. Absent (the
  // production cron) = unchanged global behaviour: process all due rentals.
  let onlyRentalId: string | null = null;
  try {
    const reqBody = await req.json();
    onlyRentalId = typeof reqBody?.only_rental_id === "string" ? reqBody.only_rental_id : null;
  } catch { /* no/invalid body — global cron run */ }

  try {
    const now = new Date();
    console.log(`[ReturnReminder] Running at ${now.toISOString()}`);

    // 1. Find tenants with return reminders enabled
    const { data: tenants, error: tenantError } = await supabase
      .from("tenants")
      .select("id, return_reminder_hours")
      .eq("return_reminder_enabled", true);

    if (tenantError) {
      console.error("[ReturnReminder] Error fetching tenants:", tenantError);
      throw tenantError;
    }

    if (!tenants || tenants.length === 0) {
      console.log("[ReturnReminder] No tenants with return reminders enabled");
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalProcessed = 0;
    let totalFailed = 0;

    for (const tenant of tenants) {
      const reminderHours = tenant.return_reminder_hours ?? 24;

      // Calculate the cutoff: rentals ending within reminderHours from now
      const cutoff = new Date(now.getTime() + reminderHours * 60 * 60 * 1000);

      // 2. Find active rentals approaching their end date that haven't been reminded
      let rentalQuery = supabase
        .from("rentals")
        .select(`
          id,
          rental_number,
          end_date,
          return_time,
          return_location,
          customer_id,
          vehicle_id,
          tenant_id,
          customers!rentals_customer_id_fkey (
            id, name, email, phone
          ),
          vehicles!rentals_vehicle_id_fkey (
            id, make, model, reg
          )
        `)
        .eq("tenant_id", tenant.id)
        .in("status", ["Active", "Approved", "Pending"])
        .is("return_reminder_sent_at", null)
        .lte("end_date", cutoff.toISOString().split("T")[0])
        .gte("end_date", now.toISOString().split("T")[0]);
      // Sandbox scoping — hard-restrict to one rental when requested.
      if (onlyRentalId) rentalQuery = rentalQuery.eq("id", onlyRentalId);
      const { data: rentals, error: rentalError } = await rentalQuery;

      if (rentalError) {
        console.error(`[ReturnReminder] Error fetching rentals for tenant ${tenant.id}:`, rentalError);
        continue;
      }

      if (!rentals || rentals.length === 0) continue;

      for (const rental of rentals) {
        try {
          const customer = rental.customers as any;
          const vehicle = rental.vehicles as any;

          if (!customer || !vehicle) {
            console.warn(`[ReturnReminder] Missing customer/vehicle for rental ${rental.id}`);
            continue;
          }

          if (!customer.email) {
            console.warn(`[ReturnReminder] No email for customer on rental ${rental.id}`);
            continue;
          }

          // Determine reminder type based on end_date vs now
          const endDate = new Date(`${rental.end_date}T${rental.return_time || "17:00"}`);
          const hoursUntilReturn = (endDate.getTime() - now.getTime()) / (1000 * 60 * 60);

          let reminderType: "return_24h" | "return_today" | "overdue" = "return_24h";
          if (hoursUntilReturn <= 0) {
            reminderType = "overdue";
          } else if (hoursUntilReturn <= 12) {
            reminderType = "return_today";
          }

          const vehicleName = `${vehicle.make || ""} ${vehicle.model || ""}`.trim();

          console.log(`[ReturnReminder] Sending ${reminderType} for rental ${rental.rental_number || rental.id}`);

          // 3. Call notify-rental-reminder
          const { error: notifyError } = await supabase.functions.invoke(
            "notify-rental-reminder",
            {
              body: {
                customerName: customer.name || "Customer",
                customerEmail: customer.email,
                customerPhone: customer.phone || "",
                vehicleName,
                vehicleReg: vehicle.reg || "",
                bookingRef: rental.rental_number || rental.id,
                reminderType,
                returnDate: rental.end_date,
                returnTime: rental.return_time || "",
                returnLocation: rental.return_location || "",
                daysOverdue: reminderType === "overdue" ? Math.ceil(Math.abs(hoursUntilReturn) / 24) : undefined,
                tenantId: tenant.id,
                rentalId: rental.id,
              },
            }
          );

          if (notifyError) {
            console.error(`[ReturnReminder] notify error for rental ${rental.id}:`, notifyError);
            totalFailed++;
            continue;
          }

          // 4. Stamp return_reminder_sent_at
          await supabase
            .from("rentals")
            .update({ return_reminder_sent_at: now.toISOString() })
            .eq("id", rental.id);

          totalProcessed++;
          console.log(`[ReturnReminder] Sent for rental ${rental.rental_number || rental.id}`);
        } catch (rentalErr: any) {
          console.error(`[ReturnReminder] Error processing rental ${rental.id}:`, rentalErr);
          totalFailed++;
        }
      }
    }

    console.log(`[ReturnReminder] Done. Processed: ${totalProcessed}, Failed: ${totalFailed}`);

    return new Response(
      JSON.stringify({ success: true, processed: totalProcessed, failed: totalFailed }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[ReturnReminder] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
