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

    // Already fully converted? Surface the existing pair.
    // (Truly idempotent: both customer_id AND converted_to_rental_id must be set.)
    if (lead.customer_id && lead.converted_to_rental_id) {
      // Verify the rental still actually exists — if not, we'll heal below.
      const { data: existingRental } = await supabase
        .from("rentals")
        .select("id")
        .eq("id", lead.converted_to_rental_id)
        .maybeSingle();
      if (existingRental) {
        return jsonResponse({
          customerId: lead.customer_id,
          rentalId: lead.converted_to_rental_id,
          status: "already_converted",
        });
      }
      // Rental row vanished (manual delete / data drift) — fall through and
      // recreate it using the existing customer_id below.
    }

    // For brand-new conversions we still require deposit_paid/pickup_scheduled.
    // But for HEALING a stuck half-conversion (customer set, no rental), we allow
    // any stage — the operator already committed to this customer somehow.
    if (!lead.customer_id && !CONVERTIBLE_STAGES.includes(lead.stage)) {
      return errorResponse(`Lead must be in deposit_paid or pickup_scheduled (current: ${lead.stage})`, 400);
    }

    const appData = (lead.application_data ?? {}) as Record<string, unknown>;
    const addr = (appData.address ?? {}) as Record<string, string | null | undefined>;

    // 2. Reuse existing customer if one matches (by lead.customer_id OR email).
    // Without this, every conversion creates a duplicate customer row for any
    // repeat-applicant.
    let customerId: string | null = null;
    if (lead.customer_id) {
      const { data: existing } = await supabase
        .from("customers")
        .select("id")
        .eq("id", lead.customer_id)
        .maybeSingle();
      if (existing) customerId = existing.id;
    }
    if (!customerId && lead.email) {
      const { data: existingByEmail } = await supabase
        .from("customers")
        .select("id")
        .eq("tenant_id", lead.tenant_id)
        .eq("email", lead.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingByEmail) customerId = existingByEmail.id;
    }

    if (!customerId) {
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
        return errorResponse(custErr?.message ?? "Failed to create customer", 500);
      }
      customerId = customer.id;
    }
    const customer = { id: customerId };

    // 3. Link customer_users if auth.users row exists for this email.
    // (Use the admin API — the auth schema can't be queried via .from("auth.users").
     // The old PostgREST attempt crashed with "...catch is not a function" because
     // the query builder doesn't have a .catch method; it returns a thenable, not
     // a Promise until awaited. Customer-user linking is best-effort anyway.)
    try {
      const { data: users } = await (supabase as unknown as {
        auth: { admin: { listUsers: (opts: { page?: number; perPage?: number }) => Promise<{ data: { users: Array<{ id: string; email?: string }> } }> } };
      }).auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = users?.users?.find((u) => u.email?.toLowerCase() === lead.email.toLowerCase());
      if (match?.id && customer.id) {
        await supabase
          .from("customer_users")
          .insert({ customer_id: customer.id, auth_user_id: match.id })
          .select()
          .single()
          .then(undefined, () => null); // ignore "already linked" conflicts
      }
    } catch (e) {
      console.error("convert-lead-to-rental customer_users link (non-fatal):", e);
    }

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

    // 6. Create rental.
    // CHECK constraints on rentals are picky about casing/values:
    //   status            ∈ Pending|Active|Closed|Rejected|Cancelled  (capitalised)
    //   rental_period_type∈ Daily|Weekly|Monthly                       (capitalised)
    //   approval_status   ∈ pending|approved|rejected                  (lowercase!)
    //   payment_status    ∈ pending|fulfilled|failed|refunded          (no "Paid")
    // Previous version used "Confirmed", "Paid", "Approved" and "weekly" — every
    // single one violated a check constraint, causing the rental insert to fail
    // silently after the customer was created. That's the GHULMA half-conversion.
    const monthlyAmount = body.pricing?.monthlyAmount ?? Number(appData.weeklyBudget ?? 0) * 4 ?? 0;
    const rawPeriod = String(body.pricing?.rentalPeriodType ?? lead.rental_type ?? "weekly").toLowerCase();
    const rentalPeriodType =
      rawPeriod === "daily" ? "Daily" : rawPeriod === "monthly" ? "Monthly" : "Weekly";

    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .insert({
        tenant_id: lead.tenant_id,
        customer_id: customer.id,
        vehicle_id: lead.vehicle_id,
        start_date: lead.start_date ?? new Date().toISOString().slice(0, 10),
        end_date: lead.end_date,
        monthly_amount: monthlyAmount,
        status: "Active",
        rental_period_type: rentalPeriodType,
        source: "lead_conversion",
        payment_status: "fulfilled", // Deposit captured at deposit_paid stage
        approval_status: "approved",
      })
      .select("id")
      .single();
    if (rentalErr || !rental) {
      console.error("convert-lead-to-rental rental insert error:", rentalErr);
      // Don't blind-delete the customer — they may already have other rentals
      // (this is exactly the GHULMA case: existing customer with prior rentals,
      // half-conversion deleted the only thing keeping their history alive).
      // Surface the actual postgres error so the operator can act.
      return errorResponse(
        rentalErr?.message
          ? `Failed to create rental: ${rentalErr.message}`
          : "Failed to create rental",
        500,
      );
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
