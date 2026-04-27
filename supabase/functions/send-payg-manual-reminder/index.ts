import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Fire a single PAYG reminder on demand, regardless of the tenant
 * `payg_auto_reminders_enabled` toggle. Used by the "Send reminder" button
 * in the portal PAYG dialog.
 *
 * Body: { rental_id: string }
 * Auth: verify_jwt = true (operator action)
 */

interface Rental {
  id: string;
  rental_number: string | null;
  tenant_id: string;
  customer_id: string;
  payg_start_ts: string;
  payg_reminder_count: number;
  is_pay_as_you_go: boolean;
  status: string;
  payg_closed_at: string | null;
  customers: { id: string; name: string | null; email: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtCurrency(amount: number, code: string | null): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
    }).format(amount);
  } catch {
    return `${(code || "USD")} ${Number(amount).toFixed(2)}`;
  }
}

function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmailHtml(args: {
  customerName: string;
  rentalRef: string;
  invoiceRef: string;
  daysActive: number;
  totalOutstanding: number;
  currencyCode: string | null;
  companyName: string;
}): string {
  const safeCustomer = escapeHtml(args.customerName);
  const safeRef = escapeHtml(args.rentalRef);
  const safeInvoice = escapeHtml(args.invoiceRef);
  const safeCompany = escapeHtml(args.companyName);
  const totalFmt = escapeHtml(fmtCurrency(args.totalOutstanding, args.currencyCode));

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8" /><title>Payment Reminder</title></head>
    <body style="margin:0; padding:24px; background:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#374151;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:32px;">
        <h1 style="margin:0 0 8px; color:#111827; font-size:24px; font-weight:600;">Payment Reminder</h1>
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Rental ${safeRef} · Invoice ${safeInvoice}</p>
        <p style="margin:0 0 16px;">Hi ${safeCustomer},</p>
        <p style="margin:0 0 16px;">Your Pay-As-You-Go rental with <strong>${safeCompany}</strong> has been active for <strong>${args.daysActive} day${args.daysActive === 1 ? "" : "s"}</strong> and has an outstanding balance.</p>
        <p style="margin:0 0 16px; padding:16px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb;">Current balance: <strong style="font-size:18px; color:#111827;">${totalFmt}</strong></p>
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">Please log in to your customer portal to settle the outstanding invoice.</p>
        <p style="margin:24px 0 0; color:#9ca3af; font-size:12px;">— ${safeCompany}</p>
      </div>
    </body>
    </html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "POST required" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { rental_id } = await req.json().catch(() => ({}));
    if (!rental_id || typeof rental_id !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "rental_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: rental } = await supabase
      .from("rentals")
      .select(`
        id, rental_number, tenant_id, customer_id, payg_start_ts,
        payg_reminder_count, is_pay_as_you_go, status, payg_closed_at,
        customers!rentals_customer_id_fkey ( id, name, email )
      `)
      .eq("id", rental_id)
      .single();

    if (!rental) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const r = rental as unknown as Rental;

    if (!r.is_pay_as_you_go) {
      return new Response(
        JSON.stringify({ success: false, error: "Not a PAYG rental" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("currency_code, name")
      .eq("id", r.tenant_id)
      .single();

    const { data: openAccruals } = await supabase
      .from("payg_accruals")
      .select("id, accrual_day_index, daily_rate, tax_amount, service_fee_amount")
      .eq("rental_id", r.id)
      .eq("invoice_status", "open")
      .order("accrual_day_index", { ascending: false });

    const latestOpen = openAccruals && openAccruals.length > 0 ? openAccruals[0] : null;
    if (!latestOpen) {
      return new Response(
        JSON.stringify({ success: false, error: "No outstanding invoice to remind" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalOutstanding = (openAccruals ?? []).reduce(
      (sum, a: any) =>
        sum + Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0),
      0,
    );

    if (!r.customers?.email) {
      return new Response(
        JSON.stringify({ success: false, error: "Customer has no email on file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date();
    const daysActive = Math.floor((now.getTime() - new Date(r.payg_start_ts).getTime()) / DAY_MS);
    const invoiceRef = `pg-${String(latestOpen.accrual_day_index).padStart(3, "0")}`;

    const html = buildEmailHtml({
      customerName: r.customers.name || "Customer",
      rentalRef: r.rental_number || r.id,
      invoiceRef,
      daysActive: Math.max(0, daysActive),
      totalOutstanding,
      currencyCode: tenant?.currency_code ?? null,
      companyName: tenant?.name ?? "Drive247",
    });

    const subject = `Payment Reminder — ${fmtCurrency(totalOutstanding, tenant?.currency_code ?? null)} outstanding (${r.rental_number || r.id})`;

    const { data: sendResult, error: sendErr } = await supabase.functions.invoke(
      "aws-ses-email",
      { body: { to: r.customers.email, subject, html } },
    );

    const success = !sendErr && (sendResult as any)?.success !== false;
    const reminderNumber = (r.payg_reminder_count || 0) + 1;

    await supabase.from("payg_reminder_log").insert({
      rental_id: r.id,
      tenant_id: r.tenant_id,
      accrual_id: latestOpen.id,
      sent_at: now.toISOString(),
      reminder_number: reminderNumber,
      outstanding_amount: totalOutstanding,
      days_active: Math.max(0, daysActive),
      days_overdue: Math.max(0, daysActive),
      channel: "email",
      recipient: r.customers.email,
      success,
      error_message: success ? null : (sendErr?.message ?? "Unknown error"),
    });

    if (!success) {
      return new Response(
        JSON.stringify({ success: false, error: sendErr?.message ?? "Email send failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabase.rpc("increment_payg_reminder_count", {
      p_rental_id: r.id,
      p_last_sent_at: now.toISOString(),
    }).then(async ({ error: rpcErr }) => {
      if (rpcErr) {
        await supabase
          .from("rentals")
          .update({
            payg_last_reminder_sent_at: now.toISOString(),
            payg_reminder_count: reminderNumber,
          })
          .eq("id", r.id);
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        reminder_number: reminderNumber,
        invoice: invoiceRef,
        outstanding: totalOutstanding,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[PaygManualReminder] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
