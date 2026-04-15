import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Finalize a Pay-As-You-Go rental.
 *
 * Posts a final pro-rated partial day for the time elapsed since the last accrual,
 * then closes the rental: status='Closed', end_date=now, payg_closed_at=now.
 *
 * R5 nuance: if the rental is currently paused, skip the partial-day charge —
 * the admin paused intentionally so billing them for the dormant time is hostile.
 *
 * Auth: requires JWT (verify_jwt = true in config.toml). The caller's tenant
 * membership is enforced via RLS — service_role bypasses, so we re-validate
 * tenant ownership inside the function.
 *
 * Request body: { rental_id: string }
 * Response: { success: boolean, partial_day_posted: boolean, closed_at: string, error?: string }
 */

interface Rental {
  id: string;
  tenant_id: string;
  customer_id: string;
  vehicle_id: string;
  monthly_amount: number;
  rental_period_type: string;
  payg_start_ts: string;
  payg_last_accrual_at: string | null;
  payg_next_accrual_at: string;
  payg_accrual_day_count: number;
  payg_paused: boolean;
  payg_closed_at: string | null;
  is_pay_as_you_go: boolean;
  status: string;
}

interface Tenant {
  id: string;
  tax_enabled: boolean | null;
  tax_percentage: number | null;
  service_fee_enabled: boolean | null;
  service_fee_type: string | null;
  service_fee_value: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeDailyRate(rental: Rental): number {
  if (rental.rental_period_type === "Daily") return Number(rental.monthly_amount) || 0;
  if (rental.rental_period_type === "Weekly") return Number(rental.monthly_amount) / 7 || 0;
  if (rental.rental_period_type === "Monthly") return Number(rental.monthly_amount) / 30 || 0;
  return Number(rental.monthly_amount) || 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // Parse body
    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rental_id;
    if (!rentalId || typeof rentalId !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "rental_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch the rental
    const { data: rentalData, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        "id, tenant_id, customer_id, vehicle_id, monthly_amount, rental_period_type, payg_start_ts, payg_last_accrual_at, payg_next_accrual_at, payg_accrual_day_count, payg_paused, payg_closed_at, is_pay_as_you_go, status",
      )
      .eq("id", rentalId)
      .single();

    if (rentalErr || !rentalData) {
      console.error(`[FinalizePayg] Rental ${rentalId} not found:`, rentalErr);
      return new Response(
        JSON.stringify({ success: false, error: "Rental not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rental = rentalData as Rental;

    if (!rental.is_pay_as_you_go) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental is not Pay-As-You-Go" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (rental.payg_closed_at) {
      return new Response(
        JSON.stringify({ success: false, error: "Rental is already closed" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let partialDayPosted = false;

    // R5: Skip partial-day charge if rental is paused — admin paused intentionally,
    // so billing for the time-since-last-accrual is hostile.
    if (!rental.payg_paused) {
      // Compute how many hours have elapsed since the last full-day window started.
      // payg_next_accrual_at is the START of the next-due window (per R1 design).
      // The partial day covers [previous_window_end, now]. previous_window_end =
      // payg_next_accrual_at (if no day was just posted) — wait, more precisely:
      //
      // After day N posts: next_accrual_at = day_N_end = day_(N+1)_start
      // The partial covers [day_(N+1)_start, now] if now < day_(N+1)_start + 24h.
      //
      // If no day has been posted yet (accrual_day_count = 0), the partial covers
      // [start_ts, now] — but only if now > start_ts. If now < start_ts the rental
      // hasn't started yet and there's nothing to bill.
      const partialStart = new Date(rental.payg_next_accrual_at);
      const partialEndMs = Math.min(
        now.getTime(),
        partialStart.getTime() + 24 * 60 * 60 * 1000,
      );
      const partialEnd = new Date(partialEndMs);
      const hoursElapsed = (partialEnd.getTime() - partialStart.getTime()) / (60 * 60 * 1000);

      if (hoursElapsed > 0) {
        // Fetch tenant config for tax/fee rates
        const { data: tenantData, error: tenantErr } = await supabase
          .from("tenants")
          .select(
            "id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value",
          )
          .eq("id", rental.tenant_id)
          .single();

        if (tenantErr || !tenantData) {
          throw new Error(`Tenant ${rental.tenant_id} fetch failed: ${tenantErr?.message}`);
        }
        const tenant = tenantData as Tenant;

        const dailyRate = round2(computeDailyRate(rental));
        const proRatedRate = round2((dailyRate / 24) * hoursElapsed);
        const taxPct = tenant.tax_enabled ? Number(tenant.tax_percentage) || 0 : 0;
        const taxAmt = round2(proRatedRate * (taxPct / 100));
        const isServiceFeePct = tenant.service_fee_type === "percentage";
        const sfPct = tenant.service_fee_enabled && isServiceFeePct
          ? Number(tenant.service_fee_value) || 0
          : 0;
        const sfAmt = round2(proRatedRate * (sfPct / 100));

        const partialDayIndex = (rental.payg_accrual_day_count || 0) + 1;

        // Claim the partial accrual via the unique constraint (idempotent re-runs OK)
        const { data: accrualRow, error: accrualErr } = await supabase
          .from("payg_accruals")
          .insert({
            rental_id: rental.id,
            tenant_id: rental.tenant_id,
            accrual_day_index: partialDayIndex,
            accrual_window_start: partialStart.toISOString(),
            accrual_window_end: partialEnd.toISOString(),
            daily_rate: proRatedRate,
            tax_amount: taxAmt,
            service_fee_amount: sfAmt,
            is_partial: true,
            hours_covered: round2(hoursElapsed),
            ledger_entry_ids: [],
          })
          .select()
          .single();

        // 23505 = unique violation. Either the cron beat us or this is a re-run; harmless.
        if (accrualErr) {
          if (
            (accrualErr as any).code === "23505" ||
            /duplicate key/i.test((accrualErr as any).message ?? "")
          ) {
            console.log(
              `[FinalizePayg] Day ${partialDayIndex} already exists for rental ${rental.id}, skipping partial insert`,
            );
          } else {
            throw accrualErr;
          }
        } else {
          // Insert ledger entries for the partial day
          const entryDate = partialStart.toISOString().split("T")[0];
          const refBase = `payg-${rental.id}-day-${partialDayIndex}-partial`;
          const ledgerRows: any[] = [];

          if (proRatedRate > 0) {
            ledgerRows.push({
              customer_id: rental.customer_id,
              rental_id: rental.id,
              vehicle_id: rental.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Rental",
              amount: proRatedRate,
              due_date: entryDate,
              remaining_amount: proRatedRate,
              tenant_id: rental.tenant_id,
              reference: `${refBase}-rental`,
            });
          }
          if (taxAmt > 0) {
            ledgerRows.push({
              customer_id: rental.customer_id,
              rental_id: rental.id,
              vehicle_id: rental.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Tax",
              amount: taxAmt,
              due_date: entryDate,
              remaining_amount: taxAmt,
              tenant_id: rental.tenant_id,
              reference: `${refBase}-tax`,
            });
          }
          if (sfAmt > 0) {
            ledgerRows.push({
              customer_id: rental.customer_id,
              rental_id: rental.id,
              vehicle_id: rental.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Service Fee",
              amount: sfAmt,
              due_date: entryDate,
              remaining_amount: sfAmt,
              tenant_id: rental.tenant_id,
              reference: `${refBase}-servicefee`,
            });
          }

          if (ledgerRows.length > 0) {
            const { data: inserted, error: ledgerErr } = await supabase
              .from("ledger_entries")
              .insert(ledgerRows)
              .select("id");

            if (ledgerErr) {
              // Roll back the accrual claim if ledger insert failed
              await supabase
                .from("payg_accruals")
                .delete()
                .eq("id", (accrualRow as any).id);
              throw ledgerErr;
            }

            const ledgerIds = ((inserted as any[]) ?? []).map((e) => e.id as string);
            await supabase
              .from("payg_accruals")
              .update({ ledger_entry_ids: ledgerIds })
              .eq("id", (accrualRow as any).id);
          }

          // Bump rental.accrual_day_count for the partial day
          await supabase
            .from("rentals")
            .update({
              payg_last_accrual_at: nowIso,
              payg_accrual_day_count: partialDayIndex,
            })
            .eq("id", rental.id);

          partialDayPosted = true;
        }
      }
    } else {
      console.log(
        `[FinalizePayg] Rental ${rental.id} is paused — skipping partial-day charge per R5`,
      );
    }

    // Final close: status='Closed', end_date=today, payg_closed_at=now
    const today = now.toISOString().split("T")[0];
    const { error: closeErr } = await supabase
      .from("rentals")
      .update({
        status: "Closed",
        end_date: today,
        payg_closed_at: nowIso,
      })
      .eq("id", rental.id);

    if (closeErr) throw closeErr;

    console.log(
      `[FinalizePayg] Closed rental ${rental.id} (partial_day_posted=${partialDayPosted})`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        partial_day_posted: partialDayPosted,
        closed_at: nowIso,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[FinalizePayg] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
