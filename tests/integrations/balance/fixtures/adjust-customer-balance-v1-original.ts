// FROZEN FIXTURE — do not edit.
//
// The request handler of supabase/functions/adjust-customer-balance/index.ts
// exactly as it stood at commit 61f877d1, BEFORE the v2 "Adjust balance"
// operations were added and the handler moved into core.ts. It is the v1
// contract the Edit Balance dialog depends on.
//
// tests/integrations/balance/adjust-customer-balance-contract.test.ts drives
// this copy and the real core.ts with the same requests and the same recording
// fake client, and requires identical responses and identical writes — so the
// v2 additions are provably invisible to a v1 caller.
//
// Everything between the marker lines is verbatim (lines 23–127 of the file at
// 61f877d1: the body of the `Deno.serve(async (req) => { … })` callback). Only
// the wrapper around it is added: the callback becomes a function, `Deno.env`
// and `createClient` are handed in instead of being globals/imports.
import { handleCors, jsonResponse, errorResponse } from "../../../../supabase/functions/_shared/cors.ts";

export function makeOriginalHandler(
  createClient: (url: string, key: string) => any,
  env: Record<string, string>,
): (req: Request) => Promise<Response> {
  const Deno = { env: { get: (k: string): string | undefined => env[k] } };
  return async (req: Request) => {
// ---- verbatim from adjust-customer-balance/index.ts @ 61f877d1 ----
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
      rentalId,
      extensionId,
    } = body as {
      customerId?: string;
      tenantId?: string;
      amount?: number;
      direction?: "increase" | "decrease";
      reason?: string;
      // Optional scoping. Omitted => account-level, exactly as before.
      rentalId?: string;
      extensionId?: string;
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
        // Scoping, when supplied. This matters more than it looks: the rental
        // page's Balance Due is two disjoint halves. The non-extension half
        // discards any category whose remaining is <= 0, so a negative
        // Adjustment is thrown away there. The extension half is the
        // rental_extension_totals view, whose LATERAL keys on extension_id with
        // NO sign or category filter — so ONLY an extension-scoped credit
        // actually moves the number an operator is looking at. An account-level
        // adjustment (both null) shifts that tile by exactly $0.00.
        ...(rentalId ? { rental_id: rentalId } : {}),
        ...(extensionId ? { extension_id: extensionId } : {}),
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
// ---- end verbatim ----
  };
}
