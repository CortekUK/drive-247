import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * SANDBOX copy of `send-return-reminders` — Dev Panel "Time Machine" ONLY.
 *
 * This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
 * has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
 * and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
 * owned by that one designated test tenant. A `preview: true` request performs
 * ZERO writes / ZERO notify invocations and just reports which rentals its
 * due-criteria would match (used by route.ts for the blast-radius pre-check).
 *
 * The real `send-return-reminders` cron is never modified and keeps serving
 * every customer on its schedule. A bug here therefore cannot reach a real
 * customer: this function only ever touches the single rental id it is handed,
 * in the designated test tenant.
 *
 * Reminder logic below is copied VERBATIM from send-return-reminders so the
 * sandbox exercises the same behaviour; the ONLY differences are the
 * fail-closed guard, the preview branch, the tenant-lock, and the AUDIT FIX:
 * instead of enumerating ALL reminder-enabled tenants and then re-filtering
 * rentals by id, we FIRST resolve the target rental's tenant_id and constrain
 * the tenants query to that single tenant.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;
  // FAIL-CLOSED: without the designated-tenant env this sandbox must not run at all.
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === "string" ? body.only_rental_id.trim() : "";
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: "sandbox: a valid only_rental_id (UUID) is required" }, 400);
  }

  try {
    const now = new Date();
    console.log(`[SandboxReturnReminder] Running at ${now.toISOString()}`);

    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from("rentals").select("id, tenant_id").eq("id", onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: "sandbox: rental not found" }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: "sandbox: rental is not in the designated test tenant" }, 403);
    }

    // 1. Find tenants with return reminders enabled — AUDIT FIX: constrained to
    //    the target rental's tenant (never enumerate all enabled tenants).
    const { data: tenants, error: tenantError } = await supabase
      .from("tenants")
      .select("id, return_reminder_hours")
      .eq("return_reminder_enabled", true)
      .eq("id", target.tenant_id);

    if (tenantError) {
      console.error("[SandboxReturnReminder] Error fetching tenants:", tenantError);
      throw tenantError;
    }

    if (!tenants || tenants.length === 0) {
      console.log("[SandboxReturnReminder] Target tenant does not have return reminders enabled");
      if (preview) return json({ success: true, preview: true, matchedRentalIds: [] });
      return json({ success: true, processed: 0 });
    }

    // ── Build the working set: run the source's per-tenant driver query (VERBATIM),
    //    ALWAYS hard-scoped to the one rental id, WITHOUT any writes. This lets the
    //    preview branch report matches with zero side-effects, and the processing
    //    loop below reuses the exact rows the criteria matched. ────────────────
    const work: Array<{ tenant: any; rentals: any[] }> = [];
    const matchedRentalIds: string[] = [];

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
      // Sandbox scoping — ALWAYS hard-restrict to the one rental (no global path).
      rentalQuery = rentalQuery.eq("id", onlyRentalId);
      const { data: rentals, error: rentalError } = await rentalQuery;

      if (rentalError) {
        console.error(`[SandboxReturnReminder] Error fetching rentals for tenant ${tenant.id}:`, rentalError);
        continue;
      }

      if (!rentals || rentals.length === 0) continue;

      work.push({ tenant, rentals });
      for (const r of rentals) matchedRentalIds.push(r.id);
    }

    // ── PREVIEW (blast-radius) — zero writes / zero notify, just report matches. ──
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    let totalProcessed = 0;
    let totalFailed = 0;

    for (const { tenant, rentals } of work) {
      for (const rental of rentals) {
        try {
          const customer = rental.customers as any;
          const vehicle = rental.vehicles as any;

          if (!customer || !vehicle) {
            console.warn(`[SandboxReturnReminder] Missing customer/vehicle for rental ${rental.id}`);
            continue;
          }

          if (!customer.email) {
            console.warn(`[SandboxReturnReminder] No email for customer on rental ${rental.id}`);
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

          console.log(`[SandboxReturnReminder] Sending ${reminderType} for rental ${rental.rental_number || rental.id}`);

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
            console.error(`[SandboxReturnReminder] notify error for rental ${rental.id}:`, notifyError);
            totalFailed++;
            continue;
          }

          // 4. Stamp return_reminder_sent_at
          await supabase
            .from("rentals")
            .update({ return_reminder_sent_at: now.toISOString() })
            .eq("id", rental.id);

          totalProcessed++;
          console.log(`[SandboxReturnReminder] Sent for rental ${rental.rental_number || rental.id}`);
        } catch (rentalErr: any) {
          console.error(`[SandboxReturnReminder] Error processing rental ${rental.id}:`, rentalErr);
          totalFailed++;
        }
      }
    }

    console.log(`[SandboxReturnReminder] Done. Processed: ${totalProcessed}, Failed: ${totalFailed}`);

    return json({ success: true, processed: totalProcessed, failed: totalFailed, matchedRentalIds });
  } catch (error: any) {
    console.error("[SandboxReturnReminder] Fatal error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
