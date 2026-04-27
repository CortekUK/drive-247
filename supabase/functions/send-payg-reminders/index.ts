import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Pay-As-You-Go payment reminder cron.
 *
 * Simplified model: one reminder per 24h from rental activation, open-ended,
 * email-only. Respects the tenant-level `payg_auto_reminders_enabled` toggle.
 * Each log row is tagged with the accrual/invoice that was open at send time
 * so the UI can show which invoice nudged the customer.
 */

interface Rental {
  id: string;
  rental_number: string | null;
  tenant_id: string;
  customer_id: string;
  monthly_amount: number;
  payg_start_ts: string;
  payg_last_reminder_sent_at: string | null;
  payg_reminder_count: number;
  payg_paused: boolean;
  is_pay_as_you_go: boolean;
  status: string;
  payg_closed_at: string | null;
  customers: { id: string; name: string | null; email: string | null } | null;
}

interface Tenant {
  id: string;
  payg_auto_reminders_enabled: boolean | null;
  currency_code: string | null;
  name: string | null;
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

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
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
    <head>
      <meta charset="utf-8" />
      <title>Payment Reminder</title>
    </head>
    <body style="margin:0; padding:24px; background:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#374151;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:32px;">
        <h1 style="margin:0 0 8px; color:#111827; font-size:24px; font-weight:600;">Payment Reminder</h1>
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Rental ${safeRef} · Invoice ${safeInvoice}</p>
        <p style="margin:0 0 16px;">Hi ${safeCustomer},</p>
        <p style="margin:0 0 16px;">
          Your Pay-As-You-Go rental with <strong>${safeCompany}</strong> has been active for
          <strong>${args.daysActive} day${args.daysActive === 1 ? "" : "s"}</strong> and has an outstanding balance.
        </p>
        <p style="margin:0 0 16px; padding:16px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb;">
          Current balance: <strong style="font-size:18px; color:#111827;">${totalFmt}</strong>
        </p>
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">
          Please log in to your customer portal to settle the outstanding invoice. If you have already paid, please disregard this message.
        </p>
        <p style="margin:24px 0 0; color:#9ca3af; font-size:12px;">— ${safeCompany}</p>
      </div>
    </body>
    </html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const nowMs = now.getTime();

  try {
    console.log(`[PaygReminderCron] Running at ${now.toISOString()}`);

    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, payg_auto_reminders_enabled, currency_code, name");

    if (tenantErr) throw tenantErr;

    const tenantMap = new Map<string, Tenant>();
    for (const t of (tenants as Tenant[]) ?? []) {
      tenantMap.set(t.id, t);
    }

    const { data: rentals, error: rentalErr } = await supabase
      .from("rentals")
      .select(`
        id,
        rental_number,
        tenant_id,
        customer_id,
        monthly_amount,
        payg_start_ts,
        payg_last_reminder_sent_at,
        payg_reminder_count,
        payg_paused,
        is_pay_as_you_go,
        status,
        payg_closed_at,
        customers!rentals_customer_id_fkey ( id, name, email )
      `)
      .eq("is_pay_as_you_go", true)
      .eq("status", "Active")
      .eq("payg_paused", false)
      .is("payg_closed_at", null)
      .not("payg_start_ts", "is", null);

    if (rentalErr) throw rentalErr;

    if (!rentals || rentals.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, skipped: 0, failed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const r of rentals as Rental[]) {
      try {
        const tenant = tenantMap.get(r.tenant_id);
        if (!tenant) {
          skipped++;
          continue;
        }

        // Respect the tenant toggle
        if (tenant.payg_auto_reminders_enabled === false) {
          skipped++;
          continue;
        }

        // Daily cadence anchored to rental activation (or last send)
        const startTs = new Date(r.payg_start_ts);
        const anchor = r.payg_last_reminder_sent_at
          ? new Date(r.payg_last_reminder_sent_at)
          : startTs;
        if (nowMs < anchor.getTime() + DAY_MS) {
          skipped++;
          continue;
        }

        // Find the latest open PAYG invoice on this rental; skip if none
        const { data: openAccruals } = await supabase
          .from("payg_accruals")
          .select("id, accrual_day_index, daily_rate, tax_amount, service_fee_amount")
          .eq("rental_id", r.id)
          .eq("invoice_status", "open")
          .order("accrual_day_index", { ascending: false });

        const latestOpen = openAccruals && openAccruals.length > 0 ? openAccruals[0] : null;
        if (!latestOpen) {
          skipped++;
          continue;
        }

        const totalOutstanding = (openAccruals ?? []).reduce(
          (sum, a: any) =>
            sum + Number(a.daily_rate || 0) + Number(a.tax_amount || 0) + Number(a.service_fee_amount || 0),
          0,
        );

        if (totalOutstanding <= 0) {
          skipped++;
          continue;
        }

        const customer = r.customers;
        if (!customer || !customer.email) {
          skipped++;
          continue;
        }

        const daysActive = Math.max(0, daysBetween(now, startTs));
        const invoiceRef = `pg-${String(latestOpen.accrual_day_index).padStart(3, "0")}`;

        const html = buildEmailHtml({
          customerName: customer.name || "Customer",
          rentalRef: r.rental_number || r.id,
          invoiceRef,
          daysActive,
          totalOutstanding,
          currencyCode: tenant.currency_code,
          companyName: tenant.name || "Drive247",
        });

        const subject = `Payment Reminder — ${
          fmtCurrency(totalOutstanding, tenant.currency_code)
        } outstanding (${r.rental_number || r.id})`;

        const { data: sendResult, error: sendErr } = await supabase.functions
          .invoke("aws-ses-email", {
            body: { to: customer.email, subject, html },
          });

        const success = !sendErr && (sendResult as any)?.success !== false;
        const reminderNumber = (r.payg_reminder_count || 0) + 1;

        await supabase.from("payg_reminder_log").insert({
          rental_id: r.id,
          tenant_id: r.tenant_id,
          accrual_id: latestOpen.id,
          sent_at: now.toISOString(),
          reminder_number: reminderNumber,
          outstanding_amount: totalOutstanding,
          days_active: daysActive,
          days_overdue: daysActive,
          channel: "email",
          recipient: customer.email,
          success,
          error_message: success ? null : (sendErr?.message ?? "Unknown error"),
        });

        if (!success) {
          console.error(`[PaygReminderCron] SES send failed for rental ${r.id}:`, sendErr?.message);
          failed++;
          continue;
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

        sent++;
        console.log(`[PaygReminderCron] Sent reminder #${reminderNumber} for rental ${r.id} (invoice ${invoiceRef}, outstanding=${totalOutstanding})`);
      } catch (rentalErr: any) {
        console.error(`[PaygReminderCron] Error processing rental ${r.id}:`, rentalErr?.message ?? rentalErr);
        failed++;
      }
    }

    console.log(`[PaygReminderCron] Done. sent=${sent} skipped=${skipped} failed=${failed}`);

    return new Response(
      JSON.stringify({ success: true, sent, skipped, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[PaygReminderCron] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
