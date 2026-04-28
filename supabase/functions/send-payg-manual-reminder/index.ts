import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/resend-service.ts";

// --- Inline email template helpers (vendored from _shared/email-template-service.ts).
// Same shape as the shared module so MCP deploys don't have to upload the 34KB shared file.
const DEFAULT_PAYG_REMINDER_TEMPLATE = {
  subject: "Payment Reminder — {{outstanding_amount}} outstanding ({{rental_number}})",
  content: `<h1>Payment Reminder</h1>

<p>Dear {{customer_name}},</p>

<p>This is a friendly reminder that your Pay-As-You-Go rental with <strong>{{company_name}}</strong> currently has an outstanding balance. With Pay-As-You-Go, charges accrue automatically each day the vehicle is in your possession and are added to a single rolling invoice until you pay.</p>

<hr>

<h2>Outstanding Balance</h2>

<table>
  <tr><td><strong>Current Balance:</strong></td><td>{{outstanding_amount}}</td></tr>
  <tr><td><strong>Latest Invoice:</strong></td><td>{{invoice_ref}}</td></tr>
  <tr><td><strong>Days Active:</strong></td><td>{{days_active}}</td></tr>
</table>

<hr>

<h2>Rental Details</h2>

<table>
  <tr><td><strong>Rental Reference:</strong></td><td>{{rental_number}}</td></tr>
  <tr><td><strong>Vehicle:</strong></td><td>{{vehicle_make}} {{vehicle_model}}</td></tr>
  <tr><td><strong>Registration:</strong></td><td>{{vehicle_reg}}</td></tr>
</table>

<hr>

<h2>How to Pay</h2>

<ol>
  <li><strong>Log into your customer portal</strong> to see the latest invoice and your full charge timeline</li>
  <li><strong>Settle invoice {{invoice_ref}}</strong> using your saved payment method</li>
  <li><strong>Receive instant confirmation</strong> — paid charges roll out of your balance and a fresh cycle begins</li>
</ol>

<p><em>Already paid? You can disregard this message — your payment may still be processing and will reconcile shortly.</em></p>

<hr>

<h2>Need Help?</h2>

<ul>
  <li><strong>Email:</strong> {{company_email}}</li>
  <li><strong>Phone:</strong> {{company_phone}}</li>
</ul>

<p>Thank you for renting with {{company_name}}.</p>

<p>Kind regards,<br>
<strong>The {{company_name}} Team</strong></p>`,
};

async function getEmailTemplate(
  client: any,
  tenantId: string,
  templateKey: string,
): Promise<{ subject: string; content: string; isCustom: boolean }> {
  try {
    const { data, error } = await client
      .from("email_templates")
      .select("subject, template_content")
      .eq("tenant_id", tenantId)
      .eq("template_key", templateKey)
      .eq("is_active", true)
      .maybeSingle();
    if (!error && data?.subject && data?.template_content) {
      console.log(`[payg_reminder] using custom template for tenant ${tenantId}`);
      return { subject: data.subject, content: data.template_content, isCustom: true };
    }
  } catch (err) {
    console.warn(`[payg_reminder] template lookup failed, using default:`, err);
  }
  if (templateKey === "payg_reminder") {
    return { ...DEFAULT_PAYG_REMINDER_TEMPLATE, isCustom: false };
  }
  return { subject: "", content: "", isCustom: false };
}

function replaceTemplateVariables(template: string, data: Record<string, string | undefined>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value ?? "");
  }
  result = result.replace(/\{\{[^}]+\}\}/g, "");
  return result;
}
// --- End inline email template helpers

/**
 * Fire a single PAYG reminder on demand.
 *
 * Mirrors the email content of the automated cron (`send-payg-reminders`) but
 * bypasses ALL gating except the bare-minimum sanity checks (open invoice +
 * customer email). Used by the "Send reminder" button on the rental detail
 * page so an operator can nudge a customer without waiting for the cron.
 *
 * Body:    { rental_id: string }
 * Auth:    verify_jwt = true (operator action — see verify_jwt setting on deploy)
 * Returns: 200 with { success, email_sent, logged, reminder_number, invoice,
 *          outstanding, error? }. Non-2xx is reserved for genuine server faults
 *          (DB unreachable, malformed request) so the UI can distinguish
 *          "email-send failed but we logged the attempt" from "function crashed".
 *
 * Always increments the reminder log so the admin sees an audit row even when
 * the downstream SES call fails.
 */

interface Rental {
  id: string;
  rental_number: string | null;
  tenant_id: string;
  customer_id: string;
  payg_start_ts: string | null;
  payg_reminder_count: number;
  is_pay_as_you_go: boolean;
  status: string;
  payg_paused: boolean;
  payg_closed_at: string | null;
  customers: { id: string; name: string | null; email: string | null } | null;
  vehicles: { make: string | null; model: string | null; reg: string | null } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000; // For "days active" copy in email body — always real days

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

function clientError(message: string, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return clientError("POST required", 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Validate body
    const body = await req.json().catch(() => ({}));
    const { rental_id } = body as { rental_id?: string };
    if (!rental_id || typeof rental_id !== "string") {
      return clientError("rental_id required");
    }

    // 2. Fetch the rental + customer
    const { data: rental, error: rentalErr } = await supabase
      .from("rentals")
      .select(`
        id, rental_number, tenant_id, customer_id, payg_start_ts,
        payg_reminder_count, is_pay_as_you_go, status, payg_paused, payg_closed_at,
        customers!rentals_customer_id_fkey ( id, name, email ),
        vehicles ( make, model, reg )
      `)
      .eq("id", rental_id)
      .maybeSingle();

    if (rentalErr) {
      console.error("[PaygManualReminder] Rental fetch error:", rentalErr);
      throw rentalErr;
    }
    if (!rental) {
      return clientError("Rental not found", 404);
    }

    const r = rental as unknown as Rental;

    // 3. Sanity checks (matching cron gates, but more permissive — admin override)
    if (!r.is_pay_as_you_go) {
      return clientError("Not a Pay-As-You-Go rental");
    }
    if (r.payg_closed_at) {
      return clientError("Rental is closed; cannot send reminder");
    }
    if (!r.payg_start_ts) {
      return clientError("Rental has not been activated yet (no payg_start_ts)");
    }
    if (!r.customers?.email) {
      return clientError("Customer has no email on file");
    }

    // 4. Fetch tenant config
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("currency_code, company_name, contact_email, contact_phone")
      .eq("id", r.tenant_id)
      .maybeSingle();

    if (tenantErr) {
      console.error("[PaygManualReminder] Tenant fetch error:", tenantErr);
      throw tenantErr;
    }

    // 5. Find the latest open PAYG invoice on this rental
    const { data: openAccruals, error: accrualErr } = await supabase
      .from("payg_accruals")
      .select("id, accrual_day_index, daily_rate, tax_amount, service_fee_amount")
      .eq("rental_id", r.id)
      .eq("invoice_status", "open")
      .order("accrual_day_index", { ascending: false });

    if (accrualErr) {
      console.error("[PaygManualReminder] Accrual fetch error:", accrualErr);
      throw accrualErr;
    }

    const latestOpen = openAccruals && openAccruals.length > 0 ? openAccruals[0] : null;
    if (!latestOpen) {
      return clientError("No outstanding invoice to remind about");
    }

    const totalOutstanding = (openAccruals ?? []).reduce(
      (sum, a: any) =>
        sum + Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0),
      0,
    );

    if (totalOutstanding <= 0) {
      return clientError("Outstanding balance is already $0");
    }

    // 6. Build the email — pull the tenant's `payg_reminder` template (custom or
    // default fallback) and substitute variables. Same template the auto cron uses,
    // so admin-triggered reminders match what customers normally receive.
    const now = new Date();
    const daysActive = Math.max(
      0,
      Math.floor((now.getTime() - new Date(r.payg_start_ts).getTime()) / DAY_MS),
    );
    const invoiceRef = `pg-${String(latestOpen.accrual_day_index).padStart(3, "0")}`;
    const currencyCode = tenant?.currency_code ?? null;
    const companyName = tenant?.company_name ?? "Drive247";

    const templateData = {
      customer_name: r.customers.name || "Customer",
      customer_email: r.customers.email || "",
      rental_number: r.rental_number || r.id,
      invoice_ref: invoiceRef,
      outstanding_amount: fmtCurrency(totalOutstanding, currencyCode),
      days_active: String(daysActive),
      vehicle_make: r.vehicles?.make || "",
      vehicle_model: r.vehicles?.model || "",
      vehicle_reg: r.vehicles?.reg || "",
      company_name: companyName,
      company_email: tenant?.contact_email || "",
      company_phone: tenant?.contact_phone || "",
    };

    const tpl = await getEmailTemplate(supabase, r.tenant_id, "payg_reminder");
    const subject = replaceTemplateVariables(tpl.subject, templateData);
    const html = replaceTemplateVariables(tpl.content, templateData);

    // 7. Try to send the email
    let emailSent = false;
    let emailError: string | null = null;
    try {
      // Send via Resend (drop-in from _shared/resend-service.ts).
      // Pass tenant_id so the sender becomes the tenant-branded {slug}@drive-247.com.
      const sendResult = await sendEmail(r.customers.email, subject, html, supabase, r.tenant_id);
      if (sendResult.success) {
        emailSent = true;
      } else {
        emailError = sendResult.error ?? "Resend send failed";
      }
    } catch (sesErr: any) {
      emailError = sesErr?.message ?? "Resend send threw an exception";
    }

    // 8. Always log the attempt — audit trail must reflect every operator click
    const reminderNumber = (r.payg_reminder_count || 0) + 1;
    const { error: logErr } = await supabase.from("payg_reminder_log").insert({
      rental_id: r.id,
      tenant_id: r.tenant_id,
      accrual_id: latestOpen.id,
      sent_at: now.toISOString(),
      reminder_number: reminderNumber,
      outstanding_amount: totalOutstanding,
      days_active: daysActive,
      days_overdue: daysActive,
      channel: "email",
      recipient: r.customers.email,
      success: emailSent,
      error_message: emailSent ? null : emailError,
    });

    if (logErr) {
      console.error("[PaygManualReminder] Failed to write audit log:", logErr);
      // Don't throw — caller still wants to know whether the email itself sent
    }

    // 9. If email succeeded, advance the rental's reminder pointer + count.
    //    On failure, intentionally do NOT — the next auto-cron tick should still
    //    fire (failed manual sends shouldn't push the next auto-reminder window back).
    if (emailSent) {
      const { error: rpcErr } = await supabase.rpc("increment_payg_reminder_count", {
        p_rental_id: r.id,
        p_last_sent_at: now.toISOString(),
      });
      if (rpcErr) {
        await supabase
          .from("rentals")
          .update({
            payg_last_reminder_sent_at: now.toISOString(),
            payg_reminder_count: reminderNumber,
          })
          .eq("id", r.id);
      }
    }

    // 10. Return a 200 with structured info — UI uses this to show appropriate toast
    return new Response(
      JSON.stringify({
        success: emailSent,
        email_sent: emailSent,
        logged: !logErr,
        reminder_number: reminderNumber,
        invoice: invoiceRef,
        outstanding: totalOutstanding,
        recipient: r.customers.email,
        error: emailError ?? undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[PaygManualReminder] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message ?? "Unknown server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
