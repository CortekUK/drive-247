import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Pay-As-You-Go payment reminder cron.
 *
 * Runs hourly. For each active PAYG rental with a positive outstanding balance,
 * checks the per-rental (or tenant default) reminder interval and dispatches a
 * reminder email containing a HTML ledger table when the interval has elapsed
 * since the previous reminder (or since the rental start if it's the first one,
 * after the grace period).
 *
 * Idempotency: relies on `payg_last_reminder_sent_at` advancing each successful
 * send. Cron re-runs are safe — same rental cannot be reminded twice in the
 * same window.
 *
 * Email-only for MVP per user decision. Calls `aws-ses-email` directly.
 */

interface Rental {
  id: string;
  rental_number: string | null;
  tenant_id: string;
  customer_id: string;
  monthly_amount: number;
  payg_start_ts: string;
  payg_reminder_interval_days: number | null;
  payg_last_reminder_sent_at: string | null;
  payg_reminder_count: number;
  payg_paused: boolean;
  payg_max_duration_alerted: boolean;
  is_pay_as_you_go: boolean;
  status: string;
  payg_closed_at: string | null;
  customers: { id: string; name: string | null; email: string | null } | null;
}

interface Tenant {
  id: string;
  payg_reminder_interval_days: number | null;
  payg_grace_period_days: number | null;
  payg_max_reminders: number | null;
  currency_code: string | null;
  name: string | null;
}

// R10: inline formatter — Deno can't import portal lib/format-utils.ts
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

// R8: HTML escape user-provided values before injection into email body
function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().split("T")[0];
  } catch {
    return "—";
  }
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

interface LedgerRow {
  id: string;
  entry_date: string;
  category: string;
  amount: number;
  remaining_amount: number;
  due_date: string | null;
}

function buildLedgerHtml(
  rows: LedgerRow[],
  currencyCode: string | null,
): { tableHtml: string; totalOutstanding: number } {
  const unpaid = rows.filter((r) => Number(r.remaining_amount) > 0);

  if (unpaid.length === 0) {
    return { tableHtml: "", totalOutstanding: 0 };
  }

  // Group by entry_date so the email shows day-by-day
  const byDate = new Map<string, LedgerRow[]>();
  for (const row of unpaid) {
    const key = row.entry_date || "unknown";
    const list = byDate.get(key) ?? [];
    list.push(row);
    byDate.set(key, list);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  let totalOutstanding = 0;

  let bodyRows = "";
  for (const date of sortedDates) {
    const dayRows = byDate.get(date)!;
    let dayTotal = 0;
    let dayCells = "";
    for (const row of dayRows) {
      const amt = Number(row.remaining_amount);
      dayTotal += amt;
      totalOutstanding += amt;
      dayCells += `
        <tr>
          <td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; color:#374151; font-size:14px;">${escapeHtml(row.category)}</td>
          <td style="padding:8px 12px; border-bottom:1px solid #e5e7eb; color:#374151; font-size:14px; text-align:right;">${escapeHtml(fmtCurrency(amt, currencyCode))}</td>
        </tr>`;
    }
    bodyRows += `
      <tr>
        <td colspan="2" style="padding:10px 12px; background:#f9fafb; border-bottom:1px solid #e5e7eb; font-weight:600; color:#111827; font-size:13px;">${escapeHtml(date)} &mdash; ${escapeHtml(fmtCurrency(dayTotal, currencyCode))}</td>
      </tr>${dayCells}`;
  }

  const tableHtml = `
    <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; margin:16px 0;">
      <thead>
        <tr style="background:#eef2ff;">
          <th style="padding:10px 12px; text-align:left; font-size:12px; text-transform:uppercase; color:#4338ca; letter-spacing:0.05em;">Charge</th>
          <th style="padding:10px 12px; text-align:right; font-size:12px; text-transform:uppercase; color:#4338ca; letter-spacing:0.05em;">Outstanding</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr>
          <td style="padding:12px; background:#1f2937; color:#ffffff; font-weight:700; font-size:14px;">Total Outstanding</td>
          <td style="padding:12px; background:#1f2937; color:#ffffff; font-weight:700; font-size:14px; text-align:right;">${escapeHtml(fmtCurrency(totalOutstanding, currencyCode))}</td>
        </tr>
      </tbody>
    </table>`;

  return { tableHtml, totalOutstanding };
}

function buildEmailHtml(args: {
  customerName: string;
  rentalRef: string;
  daysActive: number;
  daysOverdue: number;
  ledgerHtml: string;
  totalOutstanding: number;
  currencyCode: string | null;
  companyName: string;
}): string {
  const safeCustomer = escapeHtml(args.customerName);
  const safeRef = escapeHtml(args.rentalRef);
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
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Rental ${safeRef}</p>
        <p style="margin:0 0 16px;">Hi ${safeCustomer},</p>
        <p style="margin:0 0 16px;">
          Your Pay-As-You-Go rental with <strong>${safeCompany}</strong> has been active for
          <strong>${args.daysActive} day${args.daysActive === 1 ? "" : "s"}</strong>${
    args.daysOverdue > 0
      ? `, and you currently have <strong>${args.daysOverdue} day${args.daysOverdue === 1 ? "" : "s"} of unpaid charges</strong>`
      : ""
  }.
        </p>
        <p style="margin:0 0 8px;">Your current outstanding balance is <strong>${totalFmt}</strong>.</p>
        ${args.ledgerHtml}
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">
          Please contact ${safeCompany} to arrange payment as soon as possible. If you have already paid, please disregard this message.
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

    // 1. Fetch tenants and their reminder defaults
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select(
        "id, payg_reminder_interval_days, payg_grace_period_days, payg_max_reminders, currency_code, name",
      );

    if (tenantErr) {
      console.error("[PaygReminderCron] Error fetching tenants:", tenantErr);
      throw tenantErr;
    }

    const tenantMap = new Map<string, Tenant>();
    for (const t of (tenants as Tenant[]) ?? []) {
      tenantMap.set(t.id, t);
    }

    // 2. Find candidate rentals: PAYG, active, not paused, not closed,
    //    and not yet capped on reminders. Filter further per-tenant in JS.
    const { data: rentals, error: rentalErr } = await supabase
      .from("rentals")
      .select(`
        id,
        rental_number,
        tenant_id,
        customer_id,
        monthly_amount,
        payg_start_ts,
        payg_reminder_interval_days,
        payg_last_reminder_sent_at,
        payg_reminder_count,
        payg_paused,
        payg_max_duration_alerted,
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

    if (rentalErr) {
      console.error("[PaygReminderCron] Error fetching rentals:", rentalErr);
      throw rentalErr;
    }

    if (!rentals || rentals.length === 0) {
      console.log("[PaygReminderCron] No active PAYG rentals to evaluate");
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
          console.warn(`[PaygReminderCron] Missing tenant ${r.tenant_id}`);
          skipped++;
          continue;
        }

        // Resolve effective reminder interval (per-rental override > tenant default)
        const intervalDays = r.payg_reminder_interval_days
          ?? tenant.payg_reminder_interval_days
          ?? 4;
        const graceDays = tenant.payg_grace_period_days ?? 2;
        const maxReminders = tenant.payg_max_reminders ?? 10;

        // Safety cap on reminder count
        if ((r.payg_reminder_count || 0) >= maxReminders) {
          skipped++;
          continue;
        }

        // Grace period check (first reminder only)
        const startTs = new Date(r.payg_start_ts);
        if (!r.payg_last_reminder_sent_at) {
          const graceEnd = new Date(
            startTs.getTime() + graceDays * 24 * 60 * 60 * 1000,
          );
          if (nowMs < graceEnd.getTime()) {
            skipped++;
            continue;
          }
        } else {
          // Subsequent reminder: enforce interval since last send
          const lastSent = new Date(r.payg_last_reminder_sent_at);
          const nextDue = new Date(
            lastSent.getTime() + intervalDays * 24 * 60 * 60 * 1000,
          );
          if (nowMs < nextDue.getTime()) {
            skipped++;
            continue;
          }
        }

        // Fetch unpaid ledger entries for this rental (tenant_id for defense-in-depth
        // since service_role bypasses RLS)
        const { data: ledgerData, error: ledgerErr } = await supabase
          .from("ledger_entries")
          .select("id, entry_date, category, amount, remaining_amount, due_date")
          .eq("rental_id", r.id)
          .eq("tenant_id", r.tenant_id)
          .eq("type", "Charge")
          .gt("remaining_amount", 0)
          .order("entry_date", { ascending: true });

        if (ledgerErr) {
          console.error(
            `[PaygReminderCron] Ledger fetch failed for rental ${r.id}:`,
            ledgerErr,
          );
          failed++;
          continue;
        }

        const ledgerRows = (ledgerData as LedgerRow[]) ?? [];
        const { tableHtml, totalOutstanding } = buildLedgerHtml(
          ledgerRows,
          tenant.currency_code,
        );

        // Skip if nothing outstanding (customer paid since the cron query filter)
        if (totalOutstanding <= 0) {
          skipped++;
          continue;
        }

        const customer = r.customers;
        if (!customer || !customer.email) {
          console.warn(
            `[PaygReminderCron] Rental ${r.id} has no customer email; skipping`,
          );
          skipped++;
          continue;
        }

        const daysActive = Math.max(0, daysBetween(now, startTs));
        // Compute daysOverdue from the earliest unpaid ledger entry date
        const earliestUnpaidDate = ledgerRows.length > 0
          ? ledgerRows.reduce((earliest, row) => {
              const d = row.entry_date || "";
              return d < earliest ? d : earliest;
            }, ledgerRows[0].entry_date || "")
          : null;
        const daysOverdue = earliestUnpaidDate
          ? Math.max(0, daysBetween(now, new Date(earliestUnpaidDate)))
          : 0;

        const html = buildEmailHtml({
          customerName: customer.name || "Customer",
          rentalRef: r.rental_number || r.id,
          daysActive,
          daysOverdue,
          ledgerHtml: tableHtml,
          totalOutstanding,
          currencyCode: tenant.currency_code,
          companyName: tenant.name || "Drive247",
        });

        // 3. Dispatch via aws-ses-email
        const subject = `Payment Reminder — ${
          fmtCurrency(totalOutstanding, tenant.currency_code)
        } outstanding (${r.rental_number || r.id})`;

        const { data: sendResult, error: sendErr } = await supabase.functions
          .invoke("aws-ses-email", {
            body: {
              to: customer.email,
              subject,
              html,
            },
          });

        const success = !sendErr && (sendResult as any)?.success !== false;

        // 4. Audit log row (always written, success or failure)
        const reminderNumber = (r.payg_reminder_count || 0) + 1;
        await supabase.from("payg_reminder_log").insert({
          rental_id: r.id,
          tenant_id: r.tenant_id,
          sent_at: now.toISOString(),
          reminder_number: reminderNumber,
          outstanding_amount: totalOutstanding,
          days_active: daysActive,
          days_overdue: daysOverdue,
          channel: "email",
          recipient: customer.email,
          success,
          error_message: success ? null : (sendErr?.message ?? "Unknown error"),
        });

        if (!success) {
          console.error(
            `[PaygReminderCron] SES send failed for rental ${r.id}:`,
            sendErr?.message,
          );
          failed++;
          continue;
        }

        // 5. Stamp the rental with the new last_reminder_sent_at + atomically bump count
        //    Uses RPC-style raw SQL increment to avoid read-then-write race condition
        //    when multiple cron workers process the same rental concurrently.
        await supabase.rpc("increment_payg_reminder_count", {
          p_rental_id: r.id,
          p_last_sent_at: now.toISOString(),
        }).then(async ({ error: rpcErr }) => {
          // Fallback to direct update if RPC doesn't exist (pre-migration)
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
        console.log(
          `[PaygReminderCron] Sent reminder #${reminderNumber} for rental ${r.id} to ${customer.email} (outstanding=${totalOutstanding})`,
        );
      } catch (rentalErr: any) {
        console.error(
          `[PaygReminderCron] Error processing rental ${r.id}:`,
          rentalErr?.message ?? rentalErr,
        );
        failed++;
      }
    }

    console.log(
      `[PaygReminderCron] Done. sent=${sent} skipped=${skipped} failed=${failed}`,
    );

    return new Response(
      JSON.stringify({ success: true, sent, skipped, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[PaygReminderCron] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
