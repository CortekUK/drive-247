import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Scheduled lockbox code sender (cron).
 *
 * Finds lockbox rentals whose send time has arrived (based on tenant offset)
 * and triggers notify-lockbox-code for each. Logs every event to lockbox_send_log.
 *
 * Send time = approved_at + lockbox_send_offset_minutes
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const now = new Date();
    console.log(`[LockboxCron] Running at ${now.toISOString()}`);

    // 1. Find tenants with auto-send enabled
    const { data: tenants, error: tenantError } = await supabase
      .from("tenants")
      .select("id, lockbox_send_offset_minutes, lockbox_default_instructions, lockbox_notification_methods")
      .not("lockbox_send_offset_minutes", "is", null);

    if (tenantError) {
      console.error("[LockboxCron] Error fetching tenants:", tenantError);
      throw tenantError;
    }

    if (!tenants || tenants.length === 0) {
      console.log("[LockboxCron] No tenants with auto-send enabled");
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalProcessed = 0;
    let totalFailed = 0;

    for (const tenant of tenants) {
      const offsetMinutes = tenant.lockbox_send_offset_minutes ?? 0;

      // 2. Find lockbox rentals for this tenant that haven't been sent yet
      const { data: rentals, error: rentalError } = await supabase
        .from("rentals")
        .select(`
          id,
          rental_number,
          start_date,
          pickup_time,
          pickup_location,
          customer_id,
          vehicle_id,
          tenant_id,
          approved_at,
          customers!rentals_customer_id_fkey (
            id, name, email, phone
          ),
          vehicles!rentals_vehicle_id_fkey (
            id, make, model, reg, lockbox_code, lockbox_instructions
          )
        `)
        .eq("tenant_id", tenant.id)
        .eq("delivery_method", "lockbox")
        .eq("approval_status", "approved")
        .is("lockbox_sent_at", null)
        .not("approved_at", "is", null)
        .in("status", ["Pending", "Active", "Approved"]);

      if (rentalError) {
        console.error(`[LockboxCron] Error fetching rentals for tenant ${tenant.id}:`, rentalError);
        continue;
      }

      if (!rentals || rentals.length === 0) continue;

      for (const rental of rentals) {
        try {
          // Calculate the send time: approved_at + offset minutes
          if (!rental.approved_at) continue;
          const approvedAt = new Date(rental.approved_at);
          const sendAt = new Date(approvedAt.getTime() + offsetMinutes * 60 * 1000);

          // Skip if send time hasn't arrived yet
          if (sendAt > now) continue;

          const customer = rental.customers as any;
          const vehicle = rental.vehicles as any;

          if (!customer || !vehicle) {
            console.warn(`[LockboxCron] Missing customer/vehicle for rental ${rental.id}`);
            continue;
          }

          if (!vehicle.lockbox_code) {
            console.warn(`[LockboxCron] No lockbox code set for vehicle ${vehicle.id} on rental ${rental.id}`);
            continue;
          }

          console.log(`[LockboxCron] Sending lockbox code for rental ${rental.rental_number || rental.id}`);

          // 3. Call notify-lockbox-code — respect tenant's notification method preferences
          const methods: string[] = Array.isArray(tenant.lockbox_notification_methods)
            ? tenant.lockbox_notification_methods
            : ["email"];
          const shouldEmail = methods.includes("email");
          const shouldSms = methods.includes("sms");
          const shouldWhatsapp = methods.includes("whatsapp");

          const { data: notifyResult, error: notifyError } = await supabase.functions.invoke(
            "notify-lockbox-code",
            {
              body: {
                customerName: customer.name || "Customer",
                customerEmail: customer.email,
                customerPhone: customer.phone || "",
                vehicleName: `${vehicle.make || ""} ${vehicle.model || ""}`.trim(),
                vehicleReg: vehicle.reg,
                lockboxCode: vehicle.lockbox_code,
                lockboxInstructions: vehicle.lockbox_instructions || "",
                deliveryAddress: rental.pickup_location || "",
                bookingRef: rental.rental_number || rental.id,
                tenantId: tenant.id,
                defaultInstructions: tenant.lockbox_default_instructions || null,
                sendEmail: shouldEmail,
                sendSms: shouldSms,
                sendWhatsapp: shouldWhatsapp,
              },
            }
          );

          const channelsSent = [shouldEmail && "email", shouldSms && "sms", shouldWhatsapp && "whatsapp"].filter(Boolean).join(", ") || "email";

          if (notifyError) {
            console.error(`[LockboxCron] notify-lockbox-code error for rental ${rental.id}:`, notifyError);
            // Log failure
            await supabase.from("lockbox_send_log").insert({
              rental_id: rental.id,
              tenant_id: tenant.id,
              event_type: "failed",
              channel: channelsSent,
              scheduled_for: sendAt.toISOString(),
              details: `Auto-send failed: ${notifyError.message || "Unknown error"}`,
            });
            totalFailed++;
            continue;
          }

          // 4. Stamp lockbox_sent_at
          await supabase
            .from("rentals")
            .update({ lockbox_sent_at: now.toISOString() })
            .eq("id", rental.id);

          // 5. Log the send event
          await supabase.from("lockbox_send_log").insert({
            rental_id: rental.id,
            tenant_id: tenant.id,
            event_type: "sent",
            channel: channelsSent,
            scheduled_for: sendAt.toISOString(),
            details: `Auto-sent lockbox code via ${channelsSent} to ${customer.email}${shouldSms && customer.phone ? ` / ${customer.phone}` : ""}`,
          });

          totalProcessed++;
          console.log(`[LockboxCron] Successfully sent for rental ${rental.rental_number || rental.id}`);
        } catch (rentalErr: any) {
          console.error(`[LockboxCron] Error processing rental ${rental.id}:`, rentalErr);
          totalFailed++;
        }
      }
    }

    console.log(`[LockboxCron] Done. Processed: ${totalProcessed}, Failed: ${totalFailed}`);

    return new Response(
      JSON.stringify({ success: true, processed: totalProcessed, failed: totalFailed }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[LockboxCron] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
