/**
 * convert-lead-to-rental — Spec Section 6.9.
 *
 * Atomic conversion: lead → customer → rental, with conversation preserved
 * (lead_id stays, customer_id is ADDED).
 *
 * Steps (single transaction-like sequence; rolled back on any failure where possible):
 *   1. Validate lead.stage IN ('deposit_paid','pickup_scheduled').
 *   2. Create customers row from lead identity + application_data.
 *   3. Link customer_users if auth.users exists (else queue invite — V2 stub).
 *   4. Update leads.customer_id = <new>, converted_at = NOW().
 *   5. Update conversations.customer_id = <new>.
 *   6. Create rentals row from accepted_vehicle_id, dates, etc.
 *   7. Set leads.stage='converted', converted_to_rental_id=<new>.
 *   8. Emit lead.converted (DB trigger handles this), rental.created.
 *   9. Insert lead_activity 'converted'.
 *  10. Mark all running automations on this lead as stopped.
 *
 * Returns: { customerId, rentalId }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  leadId?: string;
  pricing?: {
    monthlyAmount?: number;
    rentalPeriodType?: "daily" | "weekly" | "monthly";
  };
}

const CONVERTIBLE_STAGES = ["deposit_paid", "pickup_scheduled"];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.leadId) return errorResponse("leadId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Validate
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", body.leadId)
      .maybeSingle();
    if (leadErr || !lead) return errorResponse("Lead not found", 404);
    if (!CONVERTIBLE_STAGES.includes(lead.stage)) {
      return errorResponse(`Lead must be in deposit_paid or pickup_scheduled (current: ${lead.stage})`, 400);
    }
    if (lead.customer_id) {
      // Already converted — just return the existing pair
      return jsonResponse({
        customerId: lead.customer_id,
        rentalId: lead.converted_to_rental_id,
        status: "already_converted",
      });
    }

    const appData = (lead.application_data ?? {}) as Record<string, unknown>;
    const addr = (appData.address ?? {}) as Record<string, string | null | undefined>;

    // 2. Create customer
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .insert({
        tenant_id: lead.tenant_id,
        type: "Individual",
        name: lead.full_name,
        email: lead.email,
        phone: lead.phone,
        status: "Active",
        license_number: (appData.licenceNumber as string | undefined) ?? null,
        address: addr.line1 ?? null,
        city: addr.city ?? null,
        state: addr.state ?? null,
        postal_code: addr.postalCode ?? null,
        country: addr.country ?? null,
        is_gig_driver: ["uber", "lyft", "doordash", "instacart", "delivery"].includes(
          String(appData.purpose ?? "").toLowerCase(),
        ),
      })
      .select("id")
      .single();
    if (custErr || !customer) {
      console.error("convert-lead-to-rental customer insert error:", custErr);
      return errorResponse("Failed to create customer", 500);
    }

    // 3. Link customer_users if auth.users row exists for this email
    const { data: authMatch } = await supabase
      .from("auth.users" as never)
      .select("id")
      .eq("email", lead.email)
      .maybeSingle()
      .catch(() => ({ data: null }));
    if ((authMatch as { id?: string } | null)?.id) {
      await supabase.from("customer_users").insert({
        customer_id: customer.id,
        auth_user_id: (authMatch as { id: string }).id,
      });
    }
    // (V2: queue invite email when no auth.users row exists)

    // 4. Update lead with customer_id + converted_at
    await supabase
      .from("leads")
      .update({
        customer_id: customer.id,
        converted_at: new Date().toISOString(),
      })
      .eq("id", lead.id);

    // 5. Add customer_id to the conversation (preserve lead_id)
    await supabase
      .from("conversations")
      .update({ customer_id: customer.id })
      .eq("lead_id", lead.id);

    // 6. Create rental
    const monthlyAmount = body.pricing?.monthlyAmount ?? Number(appData.weeklyBudget ?? 0) * 4 ?? 0;
    const rentalPeriodType = body.pricing?.rentalPeriodType ?? lead.rental_type ?? "weekly";

    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        tenant_id: lead.tenant_id,
        customer_id: customer.id,
        vehicle_id: lead.vehicle_id,
        start_date: lead.start_date ?? new Date().toISOString().slice(0, 10),
        end_date: lead.end_date,
        monthly_amount: monthlyAmount,
        status: "Confirmed",
        rental_period_type: rentalPeriodType,
        source: "lead_conversion",
        payment_status: "Paid", // Deposit captured at deposit_paid stage
        approval_status: "Approved",
      })
      .select("id")
      .single();
    if (rentalErr || !rental) {
      console.error("convert-lead-to-rental rental insert error:", rentalErr);
      // Best-effort rollback of customer
      await supabase.from("customers").delete().eq("id", customer.id);
      return errorResponse("Failed to create rental", 500);
    }

    // 7. Lead → converted (DB trigger emits lead.converted)
    await supabase
      .from("leads")
      .update({
        stage: "converted",
        converted_to_rental_id: rental.id,
      })
      .eq("id", lead.id);

    // 8. Emit rental.created (separate channel — DB triggers don't watch rentals yet)
    await supabase.rpc("notify_automation_event", {
      p_event_type: "rental.created",
      p_tenant_id: lead.tenant_id,
      p_entity_type: "rental",
      p_entity_id: rental.id,
      p_payload: { lead_id: lead.id, customer_id: customer.id },
    });

    // 9. Activity row
    await supabase.from("lead_activity").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      actor_type: "staff",
      event_type: "converted",
      payload: { customer_id: customer.id, rental_id: rental.id },
    });

    // 10. Stop running automations on this lead
    await supabase
      .from("automation_runs")
      .update({ status: "stopped", ended_at: new Date().toISOString() })
      .eq("entity_type", "lead")
      .eq("entity_id", lead.id)
      .in("status", ["running", "waiting"]);

    return jsonResponse({
      customerId: customer.id,
      rentalId: rental.id,
      status: "converted",
    });
  } catch (err) {
    console.error("convert-lead-to-rental error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
