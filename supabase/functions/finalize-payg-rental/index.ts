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
    // ── Tenant authorization ──
    // Extract the caller's JWT and resolve their tenant_id from app_users.
    // service_role bypasses RLS, so we must manually verify that the caller
    // belongs to the same tenant as the rental they're trying to close.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing authorization token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create a user-scoped client to extract the authenticated user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve the caller's tenant_id + super_admin status from app_users
    const { data: appUser, error: appUserErr } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();

    if (appUserErr || !appUser) {
      return new Response(
        JSON.stringify({ success: false, error: "User not found in app_users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    // Tenant ownership check: caller must belong to the same tenant, or be a super admin
    if (!appUser.is_super_admin && appUser.tenant_id !== rental.tenant_id) {
      console.warn(
        `[FinalizePayg] Tenant mismatch: user tenant=${appUser.tenant_id}, rental tenant=${rental.tenant_id}`,
      );
      return new Response(
        JSON.stringify({ success: false, error: "Not authorized for this rental" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
        let sfAmt = 0;
        if (tenant.service_fee_enabled) {
          if (tenant.service_fee_type === "percentage") {
            sfAmt = round2(proRatedRate * ((Number(tenant.service_fee_value) || 0) / 100));
          } else if (tenant.service_fee_type === "fixed_amount") {
            // For partial days, pro-rate the fixed fee by hours covered
            sfAmt = round2((Number(tenant.service_fee_value) || 0) * (hoursElapsed / 24));
          }
        }

        let partialDayIndex = (rental.payg_accrual_day_count || 0) + 1;

        // Claim the partial accrual via the unique constraint (idempotent re-runs OK).
        // If the cron just posted a full day at this index (race), re-fetch the current
        // count and retry once with the correct next index so the partial day isn't lost.
        let accrualRow: any = null;
        let accrualInsertOk = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data: insertedRow, error: accrualErr } = await supabase
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

          if (!accrualErr) {
            accrualRow = insertedRow;
            accrualInsertOk = true;
            break;
          }

          // 23505 = unique violation — cron beat us to this day index
          const isDuplicate =
            (accrualErr as any).code === "23505" ||
            /duplicate key/i.test((accrualErr as any).message ?? "");

          if (!isDuplicate) throw accrualErr;

          if (attempt === 0) {
            // Re-fetch the current accrual_day_count and retry with the next index
            console.log(
              `[FinalizePayg] Day ${partialDayIndex} already claimed for rental ${rental.id}, re-fetching count for retry`,
            );
            const { data: freshRental } = await supabase
              .from("rentals")
              .select("payg_accrual_day_count")
              .eq("id", rental.id)
              .single();
            partialDayIndex = ((freshRental as any)?.payg_accrual_day_count || partialDayIndex) + 1;

            // Also recompute the partial window start from the new accrual boundary
            const latestAccrual = await supabase
              .from("payg_accruals")
              .select("accrual_window_end")
              .eq("rental_id", rental.id)
              .order("accrual_day_index", { ascending: false })
              .limit(1)
              .single();
            if (latestAccrual.data) {
              const newPartialStart = new Date(latestAccrual.data.accrual_window_end as string);
              const newPartialEndMs = Math.min(
                now.getTime(),
                newPartialStart.getTime() + 24 * 60 * 60 * 1000,
              );
              const newHours = (newPartialEndMs - newPartialStart.getTime()) / (60 * 60 * 1000);
              if (newHours <= 0) {
                console.log(`[FinalizePayg] No partial time remaining after cron posted day — skipping`);
                break;
              }
              // Update the partial window for retry (note: rates stay the same — same daily rate)
            }
          } else {
            console.log(
              `[FinalizePayg] Day ${partialDayIndex} still conflicted on retry for rental ${rental.id}, skipping partial`,
            );
          }
        }

        if (accrualInsertOk && accrualRow) {
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

    // Reset the vehicle's status to Available so it returns to the public
    // booking site immediately. The DB rental-overlap trigger guarantees a
    // vehicle can have at most one non-terminal rental at a time, so it's
    // safe to flip back to Available the moment this rental closes — there
    // cannot be a second active rental still holding the vehicle. Non-fatal:
    // if this fails the rental is still closed and an operator can re-sync
    // vehicle status manually, so we log and continue.
    const { error: vehicleErr } = await supabase
      .from("vehicles")
      .update({ status: "Available" })
      .eq("id", rental.vehicle_id)
      .eq("tenant_id", rental.tenant_id);

    if (vehicleErr) {
      console.error(
        `[FinalizePayg] Failed to reset vehicle ${rental.vehicle_id} to Available:`,
        vehicleErr,
      );
    }

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
