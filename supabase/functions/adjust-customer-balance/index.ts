import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * adjust-customer-balance
 * ------------------------------------------------------------------
 * Lets an operator "edit" a customer's balance WITHOUT ever overwriting the
 * derived balance number (which is computed live from ledger_entries +
 * payg_accruals). Instead it posts a single auditable Adjustment ledger row:
 *
 *   - direction 'increase' → a positive Charge (customer owes more)
 *   - direction 'decrease' → a negative Charge (a credit note / write-off)
 *
 * Because balance is `sum(Charge.remaining_amount) + open PAYG`, this entry
 * flows straight into every balance view and stays perfectly in sync. The
 * FIFO allocator ignores negative-remaining rows (`remaining_amount > 0`), so
 * a decrease never gets "paid" by a stray credit. A positive adjustment, like
 * any charge, can be settled by existing credit via the normal triggers.
 *
 * Service-role only: ledger_entries writes are not exposed to the client.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      customerId,
      tenantId,
      amount,
      direction,
      reason,
    } = body as {
      customerId?: string;
      tenantId?: string;
      amount?: number;
      direction?: "increase" | "decrease";
      reason?: string;
    };

    if (!customerId) return errorResponse("customerId is required");
    if (!tenantId) return errorResponse("tenantId is required");
    if (direction !== "increase" && direction !== "decrease") {
      return errorResponse("direction must be 'increase' or 'decrease'");
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return errorResponse("amount must be a positive number");
    }
    if (!reason || !reason.trim()) {
      return errorResponse("reason is required");
    }

    // Verify the customer belongs to this tenant (defence in depth — the caller
    // is authenticated portal staff, but we never trust client-supplied tenant
    // scoping for a service-role write).
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) return errorResponse(customerError.message, 500);
    if (!customer || customer.tenant_id !== tenantId) {
      return errorResponse("Customer not found for this tenant", 404);
    }

    // Round to cents and sign by direction.
    const magnitude = Math.round(amt * 100) / 100;
    const signed = direction === "increase" ? magnitude : -magnitude;
    const today = new Date().toISOString().split("T")[0];

    // type='Charge', category='Adjustment'. rental_id NULL = account-level, so
    // the (rental_id, due_date, type, category, ...) unique index never
    // collides (NULLs are distinct), letting staff post multiple adjustments.
    const { data: entry, error: insertError } = await supabase
      .from("ledger_entries")
      .insert({
        customer_id: customerId,
        tenant_id: tenantId,
        rental_id: null,
        vehicle_id: null,
        type: "Charge",
        category: "Adjustment",
        amount: signed,
        remaining_amount: signed,
        entry_date: today,
        due_date: today,
        reference: reason.trim().slice(0, 500),
      })
      .select()
      .single();

    if (insertError) return errorResponse(insertError.message, 500);

    return jsonResponse({
      ok: true,
      entryId: entry.id,
      direction,
      amount: magnitude,
      signedAmount: signed,
    });
  } catch (error) {
    console.error("adjust-customer-balance error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
