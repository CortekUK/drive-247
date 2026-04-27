import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Pay-As-You-Go accrual cron.
 *
 * Runs every 15 minutes. For each active PAYG rental whose `payg_next_accrual_at`
 * has arrived, this function posts a new day's charges (rental + tax + % service fee)
 * and advances the accrual pointer by 24 hours.
 *
 * Idempotency is enforced by a UNIQUE constraint on `payg_accruals (rental_id, accrual_day_index)`.
 * Safe to re-run without creating duplicate ledger entries.
 *
 * Max-duration safety cap: if a rental exceeds `tenants.payg_max_duration_days`,
 * accrual stops and `rentals.payg_max_duration_alerted` flips to true so the
 * admin reminder path can raise a critical alert.
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
}

function computeDailyRate(rental: Rental): number {
  // PAYG rentals are stored with `rental_period_type = 'Daily'` and `monthly_amount`
  // holding the daily rate (the form pushes the daily-tab value here for PAYG).
  // For robustness against future cases where a tenant configured weekly/monthly
  // pricing into a PAYG rental, fall back to dividing the period amount evenly.
  if (rental.rental_period_type === "Daily") {
    return Number(rental.monthly_amount) || 0;
  }
  if (rental.rental_period_type === "Weekly") {
    return Number(rental.monthly_amount) / 7 || 0;
  }
  if (rental.rental_period_type === "Monthly") {
    return Number(rental.monthly_amount) / 30 || 0;
  }
  return Number(rental.monthly_amount) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    console.log(`[PaygAccrualCron] Running at ${nowIso}`);

    // 1. Fetch all tenants that might host PAYG rentals + their pricing config
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select(
        "id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, payg_max_duration_days",
      );

    if (tenantErr) {
      console.error("[PaygAccrualCron] Error fetching tenants:", tenantErr);
      throw tenantErr;
    }

    const tenantMap = new Map<string, Tenant>();
    for (const t of (tenants as Tenant[]) ?? []) {
      tenantMap.set(t.id, t);
    }

    // 2. Find active PAYG rentals whose next accrual window has arrived
    const { data: rentals, error: rentalErr } = await supabase
      .from("rentals")
      .select(
        "id, tenant_id, customer_id, vehicle_id, monthly_amount, rental_period_type, payg_start_ts, payg_next_accrual_at, payg_accrual_day_count, payg_paused, status, is_pay_as_you_go, payg_closed_at, payg_max_duration_alerted",
      )
      .eq("is_pay_as_you_go", true)
      .eq("status", "Active")
      .eq("payg_paused", false)
      .is("payg_closed_at", null)
      .not("payg_next_accrual_at", "is", null)
      .lte("payg_next_accrual_at", nowIso);

    if (rentalErr) {
      console.error("[PaygAccrualCron] Error fetching rentals:", rentalErr);
      throw rentalErr;
    }

    if (!rentals || rentals.length === 0) {
      console.log("[PaygAccrualCron] No rentals ready for accrual");
      return new Response(
        JSON.stringify({ success: true, processed: 0, failed: 0, capped: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0; // total day-accruals posted across all rentals
    let failed = 0;
    let capped = 0;

    // Per-rental catch-up cap (R2) — prevents a single backdated rental from monopolizing
    // the run. Most rentals will accrue 1 day per run; backdated rentals catch up over time.
    const MAX_DAYS_PER_RENTAL_PER_RUN = 30;

    for (const r of rentals as Rental[]) {
      try {
        const tenant = tenantMap.get(r.tenant_id);
        if (!tenant) {
          console.warn(
            `[PaygAccrualCron] Missing tenant ${r.tenant_id} for rental ${r.id}`,
          );
          continue;
        }

        const maxDuration = tenant.payg_max_duration_days ?? 90;

        // Mutable state — advances each iteration of the catch-up loop
        let currentNextAccrual = new Date(r.payg_next_accrual_at);
        let currentDayCount = r.payg_accrual_day_count || 0;
        let daysPostedThisRental = 0;

        // R2 catch-up loop: keep posting days while there are due windows in the past,
        // capped per rental + per max-duration safety cap.
        while (
          currentNextAccrual.getTime() <= now.getTime() &&
          daysPostedThisRental < MAX_DAYS_PER_RENTAL_PER_RUN
        ) {
          const nextDayIndex = currentDayCount + 1;

          // Max-duration safety cap (re-checked each iteration so a runaway backdated
          // rental cannot exceed the cap in a single run).
          if (nextDayIndex > maxDuration) {
            if (!r.payg_max_duration_alerted) {
              await supabase
                .from("rentals")
                .update({ payg_max_duration_alerted: true })
                .eq("id", r.id);
              // Update local copy so subsequent iterations don't re-fire the alert
              r.payg_max_duration_alerted = true;

              // Phase 8: Write a critical reminder so the admin portal shows an alert
              await supabase.from("reminders").insert({
                rule_code: "payg_max_duration",
                object_type: "rental",
                object_id: r.id,
                title: "PAYG rental exceeded max duration",
                message: `Pay-As-You-Go rental has been active for ${maxDuration} days. Daily accrual has been paused automatically. Please close this rental from the rental detail page.`,
                due_on: nowIso.split("T")[0],
                remind_on: nowIso.split("T")[0],
                severity: "critical",
                status: "pending",
                context: { rental_id: r.id, accrual_day_count: currentDayCount, max_duration_days: maxDuration },
                tenant_id: r.tenant_id,
              }).then(({ error }) => {
                if (error) console.error(`[PaygAccrualCron] Failed to create max-duration reminder for ${r.id}:`, error);
              });
            }
            capped++;
            console.log(
              `[PaygAccrualCron] Rental ${r.id} hit max duration ${maxDuration} at day ${nextDayIndex}, stopping`,
            );
            break;
          }

          // R1 design: currentNextAccrual is the START of the window we're posting now.
          // window_start = currentNextAccrual, window_end = currentNextAccrual + 24h.
          const windowStartDt = new Date(currentNextAccrual);
          // TEST MODE: 5-min accrual window (revert to `24 * 60 * 60 * 1000` for production).
          const windowEndDt = new Date(
            currentNextAccrual.getTime() + 5 * 60 * 1000,
          );

          // Compute rates for this specific day.
          // KNOWN LIMITATION (R4 in plan): weekend/holiday surcharges NOT yet applied —
          // requires Deno port of getDayRate(). The flat daily rate is used for now.
          const dailyRate = round2(computeDailyRate(r));
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

          // Claim this accrual day via unique constraint
          const { data: accrualRow, error: accrualErr } = await supabase
            .from("payg_accruals")
            .insert({
              rental_id: r.id,
              tenant_id: r.tenant_id,
              accrual_day_index: nextDayIndex,
              accrual_window_start: windowStartDt.toISOString(),
              accrual_window_end: windowEndDt.toISOString(),
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
            // Conflict on unique (rental_id, accrual_day_index) — another worker already
            // claimed this day. Skip the insert but still advance our local pointer so
            // the next loop iteration processes day N+1.
            if (
              (accrualErr as any).code === "23505" ||
              /duplicate key/i.test((accrualErr as any).message ?? "")
            ) {
              console.log(
                `[PaygAccrualCron] Day ${nextDayIndex} already claimed for rental ${r.id}, advancing pointer`,
              );
              currentDayCount = nextDayIndex;
              currentNextAccrual = windowEndDt;
              continue;
            }
            throw accrualErr;
          }

          // Insert ledger entries (Rental / Tax / Service Fee) for this day.
          // Uses the date portion of the window start as entry_date so FIFO ordering
          // treats earlier days as senior. R9: rental-scoped references for global uniqueness.
          const entryDate = windowStartDt.toISOString().split("T")[0];
          const refBase = `payg-${r.id}-day-${nextDayIndex}`;
          const ledgerRows: any[] = [];

          if (dailyRate > 0) {
            ledgerRows.push({
              customer_id: r.customer_id,
              rental_id: r.id,
              vehicle_id: r.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Rental",
              amount: dailyRate,
              due_date: entryDate,
              remaining_amount: dailyRate,
              tenant_id: r.tenant_id,
              reference: `${refBase}-rental`,
            });
          }
          if (taxAmt > 0) {
            ledgerRows.push({
              customer_id: r.customer_id,
              rental_id: r.id,
              vehicle_id: r.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Tax",
              amount: taxAmt,
              due_date: entryDate,
              remaining_amount: taxAmt,
              tenant_id: r.tenant_id,
              reference: `${refBase}-tax`,
            });
          }
          if (sfAmt > 0) {
            ledgerRows.push({
              customer_id: r.customer_id,
              rental_id: r.id,
              vehicle_id: r.vehicle_id,
              entry_date: entryDate,
              type: "Charge",
              category: "Service Fee",
              amount: sfAmt,
              due_date: entryDate,
              remaining_amount: sfAmt,
              tenant_id: r.tenant_id,
              reference: `${refBase}-servicefee`,
            });
          }

          let ledgerIds: string[] = [];
          if (ledgerRows.length > 0) {
            const { data: inserted, error: ledgerErr } = await supabase
              .from("ledger_entries")
              .insert(ledgerRows)
              .select("id");

            if (ledgerErr) {
              // Failed to insert ledger entries — roll back the accrual claim
              await supabase
                .from("payg_accruals")
                .delete()
                .eq("id", (accrualRow as any).id);
              throw ledgerErr;
            }

            ledgerIds = ((inserted as any[]) ?? []).map((e) => e.id as string);

            // Back-fill ledger_entry_ids on the accrual row for audit
            await supabase
              .from("payg_accruals")
              .update({ ledger_entry_ids: ledgerIds })
              .eq("id", (accrualRow as any).id);
          }

          // Update the rental's accrual pointer (write after each successful day so a
          // crash mid-loop doesn't lose progress).
          const { error: updateErr } = await supabase
            .from("rentals")
            .update({
              payg_last_accrual_at: nowIso,
              payg_next_accrual_at: windowEndDt.toISOString(),
              payg_accrual_day_count: nextDayIndex,
            })
            .eq("id", r.id);

          if (updateErr) throw updateErr;

          // Advance local state for the next iteration of the catch-up loop
          currentDayCount = nextDayIndex;
          currentNextAccrual = windowEndDt;
          daysPostedThisRental++;
          processed++;

          console.log(
            `[PaygAccrualCron] Posted day ${nextDayIndex} for rental ${r.id}: rental=${dailyRate}, tax=${taxAmt}, sf=${sfAmt}`,
          );
        }

        if (daysPostedThisRental >= MAX_DAYS_PER_RENTAL_PER_RUN) {
          console.log(
            `[PaygAccrualCron] Hit per-rental catch-up cap (${MAX_DAYS_PER_RENTAL_PER_RUN}) for rental ${r.id}; remaining days will accrue on next runs`,
          );
        }
      } catch (rentalErr: any) {
        console.error(
          `[PaygAccrualCron] Error processing rental ${r.id}:`,
          rentalErr?.message ?? rentalErr,
        );
        failed++;
      }
    }

    console.log(
      `[PaygAccrualCron] Done. processed=${processed} failed=${failed} capped=${capped}`,
    );

    return new Response(
      JSON.stringify({ success: true, processed, failed, capped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[PaygAccrualCron] Fatal error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
