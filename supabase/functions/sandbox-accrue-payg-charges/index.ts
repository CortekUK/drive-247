import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * SANDBOX copy of `accrue-payg-charges` — Dev Panel "Time Machine" ONLY.
 *
 * This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
 * has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
 * and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
 * owned by that one designated test tenant. A `preview: true` request performs
 * ZERO writes and just reports which rentals its due-criteria would match (used
 * by route.ts for the blast-radius pre-check).
 *
 * The real `accrue-payg-charges` cron is never modified and keeps serving every
 * customer on its schedule. A bug here therefore cannot reach a real customer:
 * this function only ever touches the single rental id it is handed, in the
 * designated test tenant.
 *
 * Accrual logic below is copied verbatim from accrue-payg-charges so the
 * sandbox exercises the same behaviour; the ONLY differences are the
 * fail-closed guard, the preview branch, the tenant-lock, and the tenant-config
 * read being scoped to the target's tenant.
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
  payg_accrual_window_seconds: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function computeDailyRate(rental: Rental): number {
  if (rental.rental_period_type === "Daily") return Number(rental.monthly_amount) || 0;
  if (rental.rental_period_type === "Weekly") return Number(rental.monthly_amount) / 7 || 0;
  if (rental.rental_period_type === "Monthly") return Number(rental.monthly_amount) / 30 || 0;
  return Number(rental.monthly_amount) || 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RENTAL_FIELDS =
  "id, tenant_id, customer_id, vehicle_id, monthly_amount, rental_period_type, payg_start_ts, payg_next_accrual_at, payg_accrual_day_count, payg_paused, status, is_pay_as_you_go, payg_closed_at, payg_max_duration_alerted";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const SANDBOX_TENANT = Deno.env.get("SANDBOX_TEST_TENANT_ID") || null;
  // FAIL-CLOSED: without the designated-tenant env this sandbox must not run at all.
  if (!SANDBOX_TENANT) {
    return json({ success: false, error: "sandbox: SANDBOX_TEST_TENANT_ID is not configured" }, 412);
  }

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === "string" ? body.only_rental_id.trim() : "";
  const preview = body?.preview === true;
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: "sandbox: a valid only_rental_id (UUID) is required" }, 400);
  }

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from("rentals").select("id, tenant_id").eq("id", onlyRentalId).maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) return json({ success: false, error: "sandbox: rental not found" }, 404);
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: "sandbox: rental is not in the designated test tenant" }, 403);
    }

    // ── Due-criteria query — IDENTICAL to the real cron, ALWAYS hard-scoped to
    //    the one rental id (there is no code path that omits this filter). ────
    const { data: rentals, error: rentalErr } = await supabase
      .from("rentals")
      .select(RENTAL_FIELDS)
      .eq("is_pay_as_you_go", true)
      .eq("status", "Active")
      .eq("payg_paused", false)
      .is("payg_closed_at", null)
      .not("payg_next_accrual_at", "is", null)
      .lte("payg_next_accrual_at", nowIso)
      .eq("id", onlyRentalId);
    if (rentalErr) throw rentalErr;

    const matchedRentalIds = ((rentals as Rental[]) ?? []).map((r) => r.id);

    // ── PREVIEW (blast-radius) — zero writes, just report what would match. ──
    if (preview) return json({ success: true, preview: true, matchedRentalIds });

    if (!rentals || rentals.length === 0) {
      return json({ success: true, processed: 0, failed: 0, capped: 0, matchedRentalIds: [] });
    }
    // Defensive: scoped by unique id, so this must be exactly the target.
    if (rentals.length !== 1 || (rentals[0] as Rental).id !== onlyRentalId) {
      return json({ success: false, error: "sandbox: blast-radius assertion failed" }, 500);
    }

    // ── Tenant config — scoped read (audit fix): only the target's tenant. ───
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, tax_enabled, tax_percentage, service_fee_enabled, service_fee_type, service_fee_value, payg_max_duration_days, payg_accrual_window_seconds")
      .eq("id", (rentals[0] as Rental).tenant_id);
    if (tenantErr) throw tenantErr;
    const tenantMap = new Map<string, Tenant>();
    for (const t of (tenants as Tenant[]) ?? []) tenantMap.set(t.id, t);

    let processed = 0;
    let failed = 0;
    let capped = 0;

    function maxDaysFor(tenant: Tenant): number {
      const windowS = tenant.payg_accrual_window_seconds ?? 86400;
      const ratio = Math.max(1, Math.floor(86400 / windowS));
      const cap = windowS >= 86400 ? 7 : ratio;
      return Math.min(cap, 300);
    }

    for (const r of rentals as Rental[]) {
      try {
        const tenant = tenantMap.get(r.tenant_id);
        if (!tenant) {
          console.warn(`[SandboxPaygAccrual] Missing tenant ${r.tenant_id} for rental ${r.id}`);
          continue;
        }

        const maxDuration = tenant.payg_max_duration_days ?? 90;
        const windowSeconds = tenant.payg_accrual_window_seconds ?? 86400;
        const accrualWindowMs = windowSeconds * 1000;
        const maxDaysThisRun = maxDaysFor(tenant);

        let currentNextAccrual = new Date(r.payg_next_accrual_at);
        let currentDayCount = r.payg_accrual_day_count || 0;
        let daysPostedThisRental = 0;

        while (
          currentNextAccrual.getTime() <= now.getTime() &&
          daysPostedThisRental < maxDaysThisRun
        ) {
          const nextDayIndex = currentDayCount + 1;

          if (nextDayIndex > maxDuration) {
            if (!r.payg_max_duration_alerted) {
              await supabase.from("rentals").update({ payg_max_duration_alerted: true }).eq("id", r.id);
              r.payg_max_duration_alerted = true;
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
                if (error) console.error(`[SandboxPaygAccrual] Failed to create max-duration reminder for ${r.id}:`, error);
              });
            }
            capped++;
            break;
          }

          const windowStartDt = new Date(currentNextAccrual);
          const windowEndDt = new Date(currentNextAccrual.getTime() + accrualWindowMs);

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
            if (
              (accrualErr as any).code === "23505" ||
              /duplicate key/i.test((accrualErr as any).message ?? "")
            ) {
              currentDayCount = nextDayIndex;
              currentNextAccrual = windowEndDt;
              continue;
            }
            throw accrualErr;
          }

          const entryDate = windowStartDt.toISOString().split("T")[0];
          const refBase = `payg-${r.id}-day-${nextDayIndex}`;
          const ledgerRows: any[] = [];

          if (dailyRate > 0) {
            ledgerRows.push({
              customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
              entry_date: entryDate, type: "Charge", category: "Rental", amount: dailyRate,
              due_date: entryDate, remaining_amount: dailyRate, tenant_id: r.tenant_id,
              reference: `${refBase}-rental`,
            });
          }
          if (taxAmt > 0) {
            ledgerRows.push({
              customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
              entry_date: entryDate, type: "Charge", category: "Tax", amount: taxAmt,
              due_date: entryDate, remaining_amount: taxAmt, tenant_id: r.tenant_id,
              reference: `${refBase}-tax`,
            });
          }
          if (sfAmt > 0) {
            ledgerRows.push({
              customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
              entry_date: entryDate, type: "Charge", category: "Service Fee", amount: sfAmt,
              due_date: entryDate, remaining_amount: sfAmt, tenant_id: r.tenant_id,
              reference: `${refBase}-servicefee`,
            });
          }

          let ledgerIds: string[] = [];
          if (ledgerRows.length > 0) {
            const { data: inserted, error: ledgerErr } = await supabase
              .from("ledger_entries").insert(ledgerRows).select("id");
            if (ledgerErr) {
              await supabase.from("payg_accruals").delete().eq("id", (accrualRow as any).id);
              throw ledgerErr;
            }
            ledgerIds = ((inserted as any[]) ?? []).map((e) => e.id as string);
            await supabase.from("payg_accruals").update({ ledger_entry_ids: ledgerIds }).eq("id", (accrualRow as any).id);
          }

          const { error: updateErr } = await supabase
            .from("rentals")
            .update({
              payg_last_accrual_at: nowIso,
              payg_next_accrual_at: windowEndDt.toISOString(),
              payg_accrual_day_count: nextDayIndex,
            })
            .eq("id", r.id);
          if (updateErr) throw updateErr;

          currentDayCount = nextDayIndex;
          currentNextAccrual = windowEndDt;
          daysPostedThisRental++;
          processed++;
        }
      } catch (rErr: any) {
        console.error(`[SandboxPaygAccrual] Error processing rental ${r.id}:`, rErr?.message ?? rErr);
        failed++;
      }
    }

    return json({ success: true, processed, failed, capped, matchedRentalIds });
  } catch (error: any) {
    console.error("[SandboxPaygAccrual] Fatal error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
