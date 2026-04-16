import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * PAYG Simulation Tool (DEV/TEST ONLY)
 *
 * Simulates the passage of time for a PAYG rental by:
 *   1. Backdating payg_start_ts and payg_next_accrual_at by N days
 *   2. Triggering the accrual catch-up loop inline (same logic as accrue-payg-charges)
 *   3. Optionally triggering a reminder check
 *
 * This lets you test the full PAYG lifecycle without waiting real days.
 *
 * Usage:
 *   POST /functions/v1/simulate-payg-days
 *   Body: {
 *     rental_id: string,          // The PAYG rental to simulate
 *     days: number,               // How many days to simulate (1-90)
 *     trigger_reminder?: boolean  // Also trigger reminder check (default: false)
 *   }
 *
 * Auth: requires JWT (verify_jwt = true)
 */

interface Rental {
  id: string;
  tenant_id: string;
  customer_id: string;
  vehicle_id: string;
  monthly_amount: number;
  rental_period_type: string;
  payg_start_ts: string;
  payg_next_accrual_at: string;
  payg_accrual_day_count: number;
  payg_paused: boolean;
  status: string;
  is_pay_as_you_go: boolean;
  payg_closed_at: string | null;
  payg_max_duration_alerted: boolean;
}

interface Tenant {
  id: string;
  tax_enabled: boolean | null;
  tax_percentage: number | null;
  service_fee_enabled: boolean | null;
  service_fee_type: string | null;
  service_fee_value: number | null;
  payg_max_duration_days: number | null;
  payg_reminder_interval_days: number | null;
  payg_grace_period_days: number | null;
  payg_max_reminders: number | null;
  currency_code: string | null;
  company_name: string | null;
}

function computeDailyRate(rental: Rental): number {
  if (rental.rental_period_type === "Daily") return Number(rental.monthly_amount) || 0;
  if (rental.rental_period_type === "Weekly") return Number(rental.monthly_amount) / 7 || 0;
  if (rental.rental_period_type === "Monthly") return Number(rental.monthly_amount) / 30 || 0;
  return Number(rental.monthly_amount) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { rental_id, days, trigger_reminder } = body;

    if (!rental_id || typeof rental_id !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "rental_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const simulateDays = Math.min(Math.max(Number(days) || 1, 1), 90);

    // 1. Fetch the rental
    const { data: rentalData, error: rentalErr } = await supabase
      .from("rentals")
      .select("id, tenant_id, customer_id, vehicle_id, monthly_amount, rental_period_type, payg_start_ts, payg_next_accrual_at, payg_accrual_day_count, payg_paused, status, is_pay_as_you_go, payg_closed_at, payg_max_duration_alerted")
      .eq("id", rental_id)
      .single();

    if (rentalErr || !rentalData) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rental = rentalData as Rental;

    if (!rental.is_pay_as_you_go) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental is not PAYG" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (rental.payg_closed_at) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental is already closed" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Fetch tenant config
    const { data: tenantData, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, payg_max_duration_days, payg_reminder_interval_days, payg_grace_period_days, payg_max_reminders, currency_code, company_name")
      .eq("id", rental.tenant_id)
      .single();

    if (tenantErr || !tenantData) {
      return new Response(
        JSON.stringify({ success: false, error: "Tenant not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tenant = tenantData as Tenant;

    // 3. Backdate the rental — shift payg_start_ts and payg_next_accrual_at back by N days
    const msPerDay = 24 * 60 * 60 * 1000;
    const shiftMs = simulateDays * msPerDay;

    const originalStartTs = new Date(rental.payg_start_ts);
    const originalNextAccrual = new Date(rental.payg_next_accrual_at);

    const newStartTs = new Date(originalStartTs.getTime() - shiftMs);
    const newNextAccrual = new Date(originalNextAccrual.getTime() - shiftMs);

    const { error: backdateErr } = await supabase
      .from("rentals")
      .update({
        payg_start_ts: newStartTs.toISOString(),
        payg_next_accrual_at: newNextAccrual.toISOString(),
      })
      .eq("id", rental.id);

    if (backdateErr) throw backdateErr;

    console.log(
      `[SimulatePayg] Backdated rental ${rental.id} by ${simulateDays} days: start=${newStartTs.toISOString()}, next_accrual=${newNextAccrual.toISOString()}`,
    );

    // 4. Run accrual catch-up inline (same logic as accrue-payg-charges)
    const now = new Date();
    const nowIso = now.toISOString();
    const maxDuration = tenant.payg_max_duration_days ?? 90;

    let currentNextAccrual = newNextAccrual;
    let currentDayCount = rental.payg_accrual_day_count || 0;
    let daysPosted = 0;
    let capped = false;
    const accrualLog: { day: number; rate: number; tax: number; sf: number }[] = [];

    while (currentNextAccrual.getTime() <= now.getTime() && daysPosted < simulateDays) {
      const nextDayIndex = currentDayCount + 1;

      if (nextDayIndex > maxDuration) {
        capped = true;
        console.log(`[SimulatePayg] Hit max duration ${maxDuration} at day ${nextDayIndex}`);
        break;
      }

      const windowStart = new Date(currentNextAccrual);
      const windowEnd = new Date(currentNextAccrual.getTime() + msPerDay);

      const dailyRate = round2(computeDailyRate(rental));
      const taxPct = tenant.tax_enabled ? (Number(tenant.tax_percentage) || 0) : 0;
      const taxAmt = round2(dailyRate * (taxPct / 100));
      let sfAmt = 0;
      if (tenant.service_fee_enabled) {
        if (tenant.service_fee_type === "percentage") {
          sfAmt = round2(dailyRate * ((Number(tenant.service_fee_value) || 0) / 100));
        } else if (tenant.service_fee_type === "fixed_amount") {
          sfAmt = round2(Number(tenant.service_fee_value) || 0);
        }
      }

      // Insert accrual row (idempotent via unique constraint)
      const { data: accrualRow, error: accrualErr } = await supabase
        .from("payg_accruals")
        .insert({
          rental_id: rental.id,
          tenant_id: rental.tenant_id,
          accrual_day_index: nextDayIndex,
          accrual_window_start: windowStart.toISOString(),
          accrual_window_end: windowEnd.toISOString(),
          daily_rate: dailyRate,
          tax_amount: taxAmt,
          service_fee_amount: sfAmt,
          is_partial: false,
          hours_covered: 24,
          ledger_entry_ids: [],
        })
        .select()
        .single();

      if (accrualErr) {
        if ((accrualErr as any).code === "23505") {
          // Already exists — skip but advance
          currentDayCount = nextDayIndex;
          currentNextAccrual = windowEnd;
          continue;
        }
        throw accrualErr;
      }

      // Insert ledger entries
      const entryDate = windowStart.toISOString().split("T")[0];
      const refBase = `payg-${rental.id}-day-${nextDayIndex}`;
      const ledgerRows: any[] = [];

      if (dailyRate > 0) {
        ledgerRows.push({
          customer_id: rental.customer_id, rental_id: rental.id,
          vehicle_id: rental.vehicle_id, entry_date: entryDate,
          type: "Charge", category: "Rental", amount: dailyRate,
          due_date: entryDate, remaining_amount: dailyRate,
          tenant_id: rental.tenant_id, reference: `${refBase}-rental`,
        });
      }
      if (taxAmt > 0) {
        ledgerRows.push({
          customer_id: rental.customer_id, rental_id: rental.id,
          vehicle_id: rental.vehicle_id, entry_date: entryDate,
          type: "Charge", category: "Tax", amount: taxAmt,
          due_date: entryDate, remaining_amount: taxAmt,
          tenant_id: rental.tenant_id, reference: `${refBase}-tax`,
        });
      }
      if (sfAmt > 0) {
        ledgerRows.push({
          customer_id: rental.customer_id, rental_id: rental.id,
          vehicle_id: rental.vehicle_id, entry_date: entryDate,
          type: "Charge", category: "Service Fee", amount: sfAmt,
          due_date: entryDate, remaining_amount: sfAmt,
          tenant_id: rental.tenant_id, reference: `${refBase}-servicefee`,
        });
      }

      let ledgerIds: string[] = [];
      if (ledgerRows.length > 0) {
        const { data: inserted, error: ledgerErr } = await supabase
          .from("ledger_entries")
          .insert(ledgerRows)
          .select("id");

        if (ledgerErr) {
          await supabase.from("payg_accruals").delete().eq("id", (accrualRow as any).id);
          throw ledgerErr;
        }
        ledgerIds = ((inserted as any[]) ?? []).map((e) => e.id as string);
        await supabase.from("payg_accruals").update({ ledger_entry_ids: ledgerIds }).eq("id", (accrualRow as any).id);
      }

      // Update rental pointer
      await supabase
        .from("rentals")
        .update({
          payg_last_accrual_at: nowIso,
          payg_next_accrual_at: windowEnd.toISOString(),
          payg_accrual_day_count: nextDayIndex,
        })
        .eq("id", rental.id);

      accrualLog.push({ day: nextDayIndex, rate: dailyRate, tax: taxAmt, sf: sfAmt });
      currentDayCount = nextDayIndex;
      currentNextAccrual = windowEnd;
      daysPosted++;
    }

    // 5. Optionally trigger reminder check
    let reminderResult: any = null;
    if (trigger_reminder) {
      try {
        const { data, error } = await supabase.functions.invoke("send-payg-reminders", {
          body: {},
        });
        reminderResult = error ? { error: error.message } : data;
      } catch (e: any) {
        reminderResult = { error: e.message };
      }
    }

    // 6. Fetch final state for the response
    const { data: finalRental } = await supabase
      .from("rentals")
      .select("payg_start_ts, payg_next_accrual_at, payg_accrual_day_count, payg_reminder_count, payg_last_reminder_sent_at")
      .eq("id", rental.id)
      .single();

    const { data: totalOutstanding } = await supabase
      .from("ledger_entries")
      .select("remaining_amount")
      .eq("rental_id", rental.id)
      .eq("type", "Charge")
      .gt("remaining_amount", 0);

    const outstanding = (totalOutstanding || []).reduce(
      (sum: number, r: any) => sum + (Number(r.remaining_amount) || 0), 0,
    );

    return new Response(
      JSON.stringify({
        success: true,
        simulation: {
          rental_id: rental.id,
          days_requested: simulateDays,
          days_accrued: daysPosted,
          max_duration_capped: capped,
          accrual_log: accrualLog,
        },
        rental_state: {
          payg_start_ts: (finalRental as any)?.payg_start_ts,
          payg_next_accrual_at: (finalRental as any)?.payg_next_accrual_at,
          payg_accrual_day_count: (finalRental as any)?.payg_accrual_day_count,
          payg_reminder_count: (finalRental as any)?.payg_reminder_count,
          total_outstanding: round2(outstanding),
        },
        reminder_result: reminderResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[SimulatePayg] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
