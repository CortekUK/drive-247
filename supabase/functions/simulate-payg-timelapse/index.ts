import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * PAYG Time-Lapse Simulation (DEV/TEST ONLY)
 *
 * 1 minute = 1 day. Starts a pg_cron job that fires every minute,
 * posting one day of accrual charges per tick. You can watch the
 * ledger grow in real-time on the rental detail page.
 *
 * Actions:
 *   start  — begin simulation (creates a 1-minute cron job)
 *   stop   — stop simulation (removes the cron job)
 *   tick   — internal: called by the cron job each minute (no JWT)
 *   status — check current simulation state
 *
 * Body:
 *   { action: "start", rental_id: string, total_days?: number }
 *   { action: "stop",  rental_id: string }
 *   { action: "tick",  rental_id: string, total_days: number }
 *   { action: "status", rental_id: string }
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
}

interface Tenant {
  id: string;
  tax_enabled: boolean | null;
  tax_percentage: number | null;
  service_fee_enabled: boolean | null;
  service_fee_type: string | null;
  service_fee_value: number | null;
  payg_max_duration_days: number | null;
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

function cronJobName(rentalId: string): string {
  return `payg-timelapse-${rentalId.slice(0, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, rental_id, total_days } = body;

    if (!rental_id || typeof rental_id !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "rental_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const jobName = cronJobName(rental_id);
    const maxDays = Math.min(Math.max(Number(total_days) || 10, 1), 90);

    // ─── START: create a 1-minute cron job ───
    if (action === "start") {
      // Validate the rental first
      const { data: rental, error: rentalErr } = await supabase
        .from("rentals")
        .select("id, is_pay_as_you_go, status, payg_closed_at, payg_accrual_day_count")
        .eq("id", rental_id)
        .single();

      if (rentalErr || !rental) {
        return new Response(
          JSON.stringify({ success: false, error: "Rental not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (!rental.is_pay_as_you_go) {
        return new Response(
          JSON.stringify({ success: false, error: "Not a PAYG rental" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (rental.payg_closed_at) {
        return new Response(
          JSON.stringify({ success: false, error: "Rental is already closed" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Remove existing job if any
      await supabase.rpc("exec_sql", {
        query: `DO $$ BEGIN PERFORM cron.unschedule('${jobName}'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
      }).catch(() => {
        // Fallback: try direct SQL
      });

      // Try to unschedule via raw SQL
      await supabase.from("_temp_noop").select("1").limit(0).catch(() => {});
      const unschedule = await supabase.rpc("exec_sql" as any, {
        query: `SELECT cron.unschedule('${jobName}')`,
      }).catch(() => null);

      // Schedule: every 1 minute, call this function with action=tick
      const tickBody = JSON.stringify({
        action: "tick",
        rental_id,
        total_days: maxDays,
      }).replace(/'/g, "''");

      const scheduleQuery = `
        SELECT cron.schedule(
          '${jobName}',
          '* * * * *',
          $$
          SELECT net.http_post(
            url := current_setting('app.settings.supabase_url') || '/functions/v1/simulate-payg-timelapse',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
            ),
            body := '${tickBody}'::jsonb
          );
          $$
        );
      `;

      const { error: scheduleErr } = await supabase.rpc("exec_sql" as any, {
        query: scheduleQuery,
      });

      if (scheduleErr) {
        console.error("[Timelapse] Schedule error, trying direct:", scheduleErr);
        // Direct approach via SQL execution
        const { error: directErr } = await supabase.from("_direct_sql" as any).select("1").limit(0);
        // If RPC doesn't exist, we'll need to create it
        throw new Error(
          `Could not schedule cron job. The exec_sql RPC may not exist. ` +
          `Run this SQL to create it: CREATE OR REPLACE FUNCTION exec_sql(query text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN EXECUTE query; END $$; GRANT EXECUTE ON FUNCTION exec_sql TO service_role;`
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Time-lapse started: 1 day every minute for ${maxDays} days`,
          job_name: jobName,
          rental_id,
          total_days: maxDays,
          current_day: rental.payg_accrual_day_count || 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── STOP: remove the cron job ───
    if (action === "stop") {
      await supabase.rpc("exec_sql" as any, {
        query: `DO $$ BEGIN PERFORM cron.unschedule('${jobName}'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
      }).catch(() => null);

      return new Response(
        JSON.stringify({ success: true, message: "Time-lapse stopped", job_name: jobName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── STATUS: check current state ───
    if (action === "status") {
      const { data: rental } = await supabase
        .from("rentals")
        .select("payg_accrual_day_count, payg_paused, payg_closed_at, status")
        .eq("id", rental_id)
        .single();

      const { data: outstanding } = await supabase
        .from("ledger_entries")
        .select("remaining_amount")
        .eq("rental_id", rental_id)
        .eq("type", "Charge")
        .gt("remaining_amount", 0);

      const total = (outstanding || []).reduce(
        (s: number, r: any) => s + (Number(r.remaining_amount) || 0), 0,
      );

      return new Response(
        JSON.stringify({
          success: true,
          rental_id,
          day: (rental as any)?.payg_accrual_day_count || 0,
          paused: (rental as any)?.payg_paused,
          closed: !!(rental as any)?.payg_closed_at,
          status: (rental as any)?.status,
          outstanding: round2(total),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── TICK: post exactly 1 day (called by cron every minute) ───
    if (action === "tick") {
      // Fetch rental
      const { data: rentalData, error: rentalErr } = await supabase
        .from("rentals")
        .select("id, tenant_id, customer_id, vehicle_id, monthly_amount, rental_period_type, payg_start_ts, payg_next_accrual_at, payg_accrual_day_count, payg_paused, status, is_pay_as_you_go, payg_closed_at")
        .eq("id", rental_id)
        .single();

      if (rentalErr || !rentalData) {
        console.log(`[Timelapse] Rental ${rental_id} not found, stopping`);
        await supabase.rpc("exec_sql" as any, {
          query: `DO $$ BEGIN PERFORM cron.unschedule('${jobName}'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
        }).catch(() => null);
        return new Response(JSON.stringify({ success: false, error: "Rental gone" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rental = rentalData as Rental;

      // Auto-stop conditions
      const currentDay = rental.payg_accrual_day_count || 0;
      if (
        rental.payg_closed_at ||
        rental.payg_paused ||
        rental.status !== "Active" ||
        currentDay >= maxDays
      ) {
        const reason = rental.payg_closed_at ? "closed"
          : rental.payg_paused ? "paused"
          : rental.status !== "Active" ? `status=${rental.status}`
          : `reached ${maxDays} days`;

        console.log(`[Timelapse] Auto-stopping for rental ${rental_id}: ${reason}`);
        await supabase.rpc("exec_sql" as any, {
          query: `DO $$ BEGIN PERFORM cron.unschedule('${jobName}'); EXCEPTION WHEN OTHERS THEN NULL; END $$;`,
        }).catch(() => null);

        return new Response(
          JSON.stringify({ success: true, stopped: true, reason, day: currentDay }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Fetch tenant config
      const { data: tenantData } = await supabase
        .from("tenants")
        .select("id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, payg_max_duration_days")
        .eq("id", rental.tenant_id)
        .single();

      if (!tenantData) {
        console.error(`[Timelapse] Tenant not found for rental ${rental_id}`);
        return new Response(JSON.stringify({ success: false, error: "Tenant not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tenant = tenantData as Tenant;
      const nextDayIndex = currentDay + 1;
      const now = new Date();
      const nowIso = now.toISOString();

      // Use "now" as the window timestamps so the ledger dates look natural
      const windowStart = new Date(now.getTime() - 60 * 1000); // 1 min ago
      const windowEnd = now;

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

      // Insert accrual
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
          console.log(`[Timelapse] Day ${nextDayIndex} already exists, skipping`);
          return new Response(JSON.stringify({ success: true, skipped: true, day: nextDayIndex }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw accrualErr;
      }

      // Insert ledger entries — use today's date so they sort correctly
      const entryDate = nowIso.split("T")[0];
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

      if (ledgerRows.length > 0) {
        const { data: inserted, error: ledgerErr } = await supabase
          .from("ledger_entries")
          .insert(ledgerRows)
          .select("id");

        if (ledgerErr) {
          await supabase.from("payg_accruals").delete().eq("id", (accrualRow as any).id);
          throw ledgerErr;
        }

        const ledgerIds = ((inserted as any[]) ?? []).map((e) => e.id as string);
        await supabase.from("payg_accruals").update({ ledger_entry_ids: ledgerIds }).eq("id", (accrualRow as any).id);
      }

      // Update rental state
      await supabase
        .from("rentals")
        .update({
          payg_last_accrual_at: nowIso,
          payg_next_accrual_at: new Date(now.getTime() + 60 * 1000).toISOString(), // next tick in 1 min
          payg_accrual_day_count: nextDayIndex,
        })
        .eq("id", rental.id);

      console.log(
        `[Timelapse] Day ${nextDayIndex}/${maxDays} for rental ${rental.id}: rate=${dailyRate}, tax=${taxAmt}, sf=${sfAmt}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          day: nextDayIndex,
          of: maxDays,
          rate: dailyRate,
          tax: taxAmt,
          service_fee: sfAmt,
          total_day: round2(dailyRate + taxAmt + sfAmt),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Invalid action. Use: start, stop, tick, status" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[Timelapse] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
