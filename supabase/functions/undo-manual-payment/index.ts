import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface UndoManualPaymentRequest {
  rentalId: string;
  category: string;
  tenantId: string;
  reason?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, category, tenantId, reason } =
      (await req.json()) as UndoManualPaymentRequest;

    if (!rentalId || !category || !tenantId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "rentalId, category, and tenantId are required",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the caller can read this rental (RLS enforces tenant scoping for app_users)
    const { data: rental, error: rentalErr } = await userClient
      .from("rentals")
      .select("id, tenant_id")
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental not found or access denied" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (rental.tenant_id !== tenantId) {
      return new Response(
        JSON.stringify({ success: false, error: "Tenant mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Block if any refunds exist for this rental + category
    const { data: refunds, error: refundsErr } = await admin
      .from("ledger_entries")
      .select("id")
      .eq("rental_id", rentalId)
      .eq("tenant_id", tenantId)
      .eq("type", "Refund")
      .eq("category", category);

    if (refundsErr) throw refundsErr;
    if (refunds && refunds.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Cannot undo: this category has refunds against it. Use Refund instead.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find all charges in this rental + category
    const { data: charges, error: chargesErr } = await admin
      .from("ledger_entries")
      .select("id, amount, remaining_amount")
      .eq("rental_id", rentalId)
      .eq("tenant_id", tenantId)
      .eq("type", "Charge")
      .eq("category", category);

    if (chargesErr) throw chargesErr;
    if (!charges || charges.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No charges found for this category" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const chargeIds = charges.map((c) => c.id);
    const chargeMap: Record<string, { remaining_amount: number }> = {};
    charges.forEach((c) => {
      chargeMap[c.id] = { remaining_amount: Number(c.remaining_amount) };
    });

    // Find allocations against these charges, joined to manual (non-Stripe) payments
    const { data: applications, error: appsErr } = await admin
      .from("payment_applications")
      .select(
        `
        id,
        charge_entry_id,
        amount_applied,
        payment_id,
        payments!inner (
          id,
          stripe_payment_intent_id,
          status,
          refund_status
        )
      `
      )
      .in("charge_entry_id", chargeIds);

    if (appsErr) throw appsErr;

    const manualApps = (applications || []).filter((a: any) => {
      const p = a.payments;
      if (!p) return false;
      if (p.stripe_payment_intent_id) return false;
      if (p.status === "Reversed") return false;
      if (p.refund_status === "completed" || p.refund_status === "processing")
        return false;
      return true;
    });

    if (manualApps.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No manual payment allocations to undo for this category",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group affected applications by payment_id and reverse them
    const affectedPaymentIds = new Set<string>();
    let totalUndone = 0;

    for (const app of manualApps) {
      const applied = Number(app.amount_applied);
      const charge = chargeMap[app.charge_entry_id];

      // Restore the charge's remaining_amount
      if (charge) {
        const newRemaining = charge.remaining_amount + applied;
        const { error: updErr } = await admin
          .from("ledger_entries")
          .update({
            remaining_amount: newRemaining,
            updated_at: new Date().toISOString(),
          })
          .eq("id", app.charge_entry_id);
        if (updErr) {
          console.error("Failed to restore charge", app.charge_entry_id, updErr);
          continue;
        }
        chargeMap[app.charge_entry_id].remaining_amount = newRemaining;
      }

      // Delete the matching pnl entry (source_ref = `${paymentId}_${chargeId}`)
      const sourceRef = `${app.payment_id}_${app.charge_entry_id}`;
      await admin.from("pnl_entries").delete().eq("source_ref", sourceRef);

      // Delete the allocation row
      await admin.from("payment_applications").delete().eq("id", app.id);

      affectedPaymentIds.add(app.payment_id);
      totalUndone += applied;
    }

    // For each affected payment, decide whether to delete it entirely or keep
    let paymentsDeleted = 0;
    let paymentsKept = 0;

    for (const paymentId of affectedPaymentIds) {
      const { data: remainingApps, error: remErr } = await admin
        .from("payment_applications")
        .select("id")
        .eq("payment_id", paymentId);

      if (remErr) {
        console.error("Failed to count remaining apps for payment", paymentId, remErr);
        continue;
      }

      if (!remainingApps || remainingApps.length === 0) {
        // No allocations left → delete payment ledger entry, then payment row
        await admin
          .from("ledger_entries")
          .delete()
          .eq("payment_id", paymentId)
          .eq("type", "Payment");

        // Belt-and-braces: clear any P&L entries still linked to this payment
        await admin.from("pnl_entries").delete().eq("payment_id", paymentId);

        const { error: delErr } = await admin
          .from("payments")
          .delete()
          .eq("id", paymentId);

        if (delErr) {
          console.error("Failed to delete payment", paymentId, delErr);
          continue;
        }
        paymentsDeleted++;
      } else {
        // Allocations remain elsewhere — recompute payment.remaining_amount
        const { data: paymentRow } = await admin
          .from("payments")
          .select("amount")
          .eq("id", paymentId)
          .maybeSingle();

        const totalApplied = remainingApps.length
          ? (
              await admin
                .from("payment_applications")
                .select("amount_applied")
                .eq("payment_id", paymentId)
            ).data?.reduce((sum: number, r: any) => sum + Number(r.amount_applied), 0) ?? 0
          : 0;

        const newRemaining = Math.max(
          0,
          Number(paymentRow?.amount ?? 0) - totalApplied
        );
        const newStatus = totalApplied > 0 && totalApplied < Number(paymentRow?.amount ?? 0)
          ? "Partial"
          : totalApplied === 0
            ? "Credit"
            : "Applied";

        await admin
          .from("payments")
          .update({
            remaining_amount: newRemaining,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", paymentId);

        paymentsKept++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Manual payments undone",
        details: {
          rentalId,
          category,
          allocationsReversed: manualApps.length,
          paymentsDeleted,
          paymentsKept,
          totalUndone,
          reason: reason || null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("undo-manual-payment error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
