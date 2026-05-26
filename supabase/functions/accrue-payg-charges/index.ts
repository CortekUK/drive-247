import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Pay-As-You-Go accrual cron.
 *
 * Scheduled every 5 minutes (cron jobid 32 — schedule "<slash>5 * * * *"). For each active
 * PAYG rental whose `payg_next_accrual_at` has arrived, this function posts a
 * new accrual + ledger charges (rental + tax + % service fee) and advances the
 * accrual pointer by the rental's tenant accrual window.
 *
 * Each tenant configures its accrual window via
 * `tenants.payg_accrual_window_seconds` (default 86400 = 24h). Production
 * tenants stay at 24h so they only get one accrual per day even though the
 * cron fires every 5 minutes (the `payg_next_accrual_at <= now()` filter
 * makes the in-between ticks cheap no-ops). The `test` tenant runs at 300s
 * (5 min) so QA can watch PAYG cycles in real time.
 *
 * HISTORICAL BUG: this file shipped with a hardcoded 5-minute window
 * (`5 * 60 * 1000`) applied to ALL tenants — combined with the 30-day per-
 * rental catch-up cap, every active PAYG rental was getting ~30 days of
 * charges posted in a single 2-second burst every night. Symptom: customers
 * received reminders for $1,000+ outstanding 2 days after signing up. Fixed
 * by making the window per-tenant and moving the test-mode behavior behind
 * an explicit tenant config flag. See data-repair migration
 * `repair_jeffery_martin_payg_overaccrual_2026_05_15` for the customer
 * cleanup that accompanied this fix.
 *
 * Idempotency is enforced by a UNIQUE constraint on
 * `payg_accruals (rental_id, accrual_day_index)`. Safe to re-run.
 *
 * Max-duration safety cap: if a rental exceeds
 * `tenants.payg_max_duration_days`, accrual stops and
 * `rentals.payg_max_duration_alerted` flips to true so the admin reminder
 * path can raise a critical alert.
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
  // Width of one PAYG accrual "day" in seconds. Production tenants are 86400
  // (24h); the `test` tenant is 300 (5 min) for rapid QA cycles. The cron
  // schedule (every-5-min) is the floor — a tenant set to 60s would still
  // only get one accrual per cron tick.
  payg_accrual_window_seconds: number;
}

function computeDailyRate(rental: Rental): number {
  // PAYG rentals store the per-period billing amount in `monthly_amount` and the
  // unit (Weekly/Monthly) in `rental_period_type`. Daily is preserved here as a
  // pre-2026-05 legacy path; new PAYG rentals only use Weekly or Monthly.
  // This formula MUST stay in lockstep with `computePaygDailyRate()` in
  // apps/portal/src/lib/payg-rate.ts (the UI fallback before the first accrual).
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
        "id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, payg_max_duration_days, payg_accrual_window_seconds",
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

    // Per-rental catch-up cap (R2) — prevents a single backdated rental from
    // monopolizing the run. The cap is tenant-aware: it scales with the tenant's
    // accrual window so a 24h-window rental can catch up ~7 days of outage, while
    // a 5-min-window test rental can catch up ~6 hours of test-time before
    // tapping out and resuming on the next cron tick. Hardcoded 7 was the right
    // value when everyone was 24h; with mixed windows we derive it from the
    // tenant config.
    //
    //   24h tenants: floor(86400 / 86400) * 7 = 7 days catch-up (unchanged)
    //   5-min test : floor(86400 / 300)   * 1 = 288 windows catch-up (one full
    //                 simulated day in a single tick — handy when admin pauses
    //                 then resumes a test rental)
    // For safety, we always cap absolute count at 300 to bound cron run time.
    function maxDaysFor(tenant: Tenant): number {
      const windowS = tenant.payg_accrual_window_seconds ?? 86400;
      // 24h tenants get a 7-day outage budget; faster windows get 1×day worth.
      const ratio = Math.max(1, Math.floor(86400 / windowS));
      const cap = windowS >= 86400 ? 7 : ratio;
      return Math.min(cap, 300);
    }

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
        // Per-tenant accrual window. Production tenants = 86400s (24h);
        // `test` tenant = 300s (5 min) for rapid QA. Falls back to 24h if the
        // column ever returns null (shouldn't, the column is NOT NULL with a
        // default — but defensive coding for old cached schemas).
        const windowSeconds = tenant.payg_accrual_window_seconds ?? 86400;
        const accrualWindowMs = windowSeconds * 1000;
        const maxDaysThisRun = maxDaysFor(tenant);

        // Mutable state — advances each iteration of the catch-up loop
        let currentNextAccrual = new Date(r.payg_next_accrual_at);
        let currentDayCount = r.payg_accrual_day_count || 0;
        let daysPostedThisRental = 0;

        // R2 catch-up loop: keep posting days while there are due windows in the past,
        // capped per rental + per max-duration safety cap.
        while (
          currentNextAccrual.getTime() <= now.getTime() &&
          daysPostedThisRental < maxDaysThisRun
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
          // Window length is per-tenant (computed above as `accrualWindowMs`).
          // Production tenants run on 24h (86_400_000ms). The `test` tenant runs on
          // 5 min (300_000ms) so QA can watch rapid PAYG cycles. To change this,
          // update `tenants.payg_accrual_window_seconds` — never hardcode here.
          const windowStartDt = new Date(currentNextAccrual);
          const windowEndDt = new Date(
            currentNextAccrual.getTime() + accrualWindowMs,
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

          // Claim this accrual day via unique constraint.
          // `hours_covered` reports the real width of the window so audits
          // don't lie. For production this is 24; for the 5-min test tenant
          // this is 0.083h. Stored as a numeric so fractional values fit.
          const hoursCovered = round2(windowSeconds / 3600);
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
              hours_covered: hoursCovered,
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

            // Finance Sync — enqueue a rental_charge event per inserted ledger row.
            // Combined dailyRate + taxAmt + sfAmt rows all flow into one financial_event
            // per logical accrual day (we pick the 'Rental' row's id as the source
            // anchor so dedupe at retry time stays clean). Non-fatal on failure.
            const tenant = tenantMap.get(r.tenant_id);
            const currency = (tenant?.currency_code as string | undefined) ?? "USD";
            const rentalChargeRow = ((inserted as any[]) ?? []).find((row) => row?.id);
            if (rentalChargeRow && r.tenant_id) {
              try {
                const totalAmount = Number(dailyRate) + Number(taxAmt ?? 0) + Number(sfAmt ?? 0);
                await supabase.rpc("enqueue_financial_event", {
                  p_tenant_id: r.tenant_id,
                  p_event_type: "rental_charge",
                  p_amount_cents: Math.round(totalAmount * 100),
                  p_tax_cents: Math.round(Number(taxAmt ?? 0) * 100),
                  p_currency: currency,
                  p_rental_id: r.id,
                  p_customer_id: r.customer_id ?? null,
                  p_vehicle_id: r.vehicle_id ?? null,
                  p_source_table: "ledger_entries",
                  p_source_id: rentalChargeRow.id,
                  p_description: `PAYG daily charge ${entryDate}`,
                  p_metadata: { ref_base: refBase, ledger_ids: ledgerIds, accrual_day: entryDate },
                });
              } catch (err) {
                console.error("[finance-sync] enqueue rental_charge (PAYG) failed (non-fatal):", err);
              }
            }
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

        if (daysPostedThisRental >= maxDaysThisRun) {
          console.log(
            `[PaygAccrualCron] Hit per-rental catch-up cap (${maxDaysThisRun}) for rental ${r.id}; remaining days will accrue on next runs`,
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
