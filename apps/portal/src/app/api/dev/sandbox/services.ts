// ============================================================================
// services.ts — SERVER-ONLY manifest for the HYBRID cron sandbox (PROD test tenant)
// ============================================================================
// The Time Machine now runs against the PRODUCTION database, hard-scoped to ONE
// designated test tenant and a fixed allow-list of designated test rentals. It
// fires ISOLATED `sandbox-*` edge functions (never the real cron), each of which
// is fail-closed + tenant-locked. Time is advanced by directly backdating the
// target rental's own driving columns (scoped to id + tenant) — there is NO
// sim-control and NO sim_shift RPC on prod.
//
// This file NEVER runs in the browser: route.ts is 404 outside development and
// holds the prod service key server-side. status()/reset()/preFire()/backdate()
// receive a service-role Supabase client bound to PRODUCTION and must only ever
// touch the designated test rentals below.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient;

// ── The one blessed test tenant (prod `test`) ───────────────────────────────
export const DESIGNATED_TEST_TENANT_ID = "09926302-f0ec-49f9-a05d-0cf1da93cf16";

// ── Designated test rentals (created in the test tenant with these exact ids).
//    route.ts refuses to operate on anything not in this set. ────────────────
export const PAYG_RENTAL = "a0000001-0000-4000-8000-000000000001";
export const INSTALLMENT_RENTAL = "a0000002-0000-4000-8000-000000000001";
export const AUTO_EXTEND_RENTAL = "a0000003-0000-4000-8000-000000000001";
export const DEPOSIT_RENTAL = "a0000004-0000-4000-8000-000000000001";
export const RETURN_REMINDER_RENTAL = "a0000005-0000-4000-8000-000000000001";
export const DAILY_REMINDER_RENTAL = "a0000006-0000-4000-8000-000000000001";

export const DESIGNATED_TEST_RENTAL_IDS: ReadonlySet<string> = new Set([
  PAYG_RENTAL, INSTALLMENT_RENTAL, AUTO_EXTEND_RENTAL, DEPOSIT_RENTAL,
  RETURN_REMINDER_RENTAL, DAILY_REMINDER_RENTAL,
]);

// ── Types ───────────────────────────────────────────────────────────────────
// catchup  = backdate once by N days, then fire in a loop until the backlog drains
// dayloop  = backdate 1 day + fire, repeated N times (order-coupled money chains)
// single   = backdate/preFire once, then fire once
export type Stepping = "catchup" | "dayloop" | "single";

export interface SbService {
  key: string;
  label: string;
  /** advanceAll fires services in ascending order (cron-clock order). */
  order: number;
  /** The designated test rental this service drives (passed as only_rental_id). */
  scopeRentalId: string;
  /** Isolated sandbox-* fn(s) to fire (in order). NEVER a real cron fn. */
  cronFns: string[];
  stepping: Stepping;
  /** Max iterations for a catch-up drain (default 8). */
  drainFires?: number;
  /** Response field on the PRIMARY fn signalling "work was done" (drain stops at 0). */
  progressKey?: string;
  /** Scoped time-shift: backdate the driving column(s) by `days`. null when the
   *  fixture is positioned by preFire() instead (installment/return/daily). */
  backdate?: (prod: Sb, days: number) => Promise<void>;
  /** Re-anchor the fixture into the exact "due now" bucket (no time-shift). */
  preFire?: (prod: Sb) => Promise<void>;
  /** Read current fixture state (service-role, prod). */
  status: (prod: Sb) => Promise<Record<string, unknown>>;
  /** Restore the fixture to a fresh, eligible-but-unfired baseline. */
  reset: (prod: Sb) => Promise<Record<string, unknown>>;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function sumRemaining(rows: Array<{ remaining_amount?: number | null }> | null): number {
  const total = (rows ?? []).reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
  return Math.round(total * 100) / 100;
}
const todayStr = () => new Date().toISOString().split("T")[0];
const inDaysIso = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

// Backdate a timestamptz column on ONE designated rental by `days` (read-modify-write,
// scoped to id + the test tenant so a bad id can never touch a real rental).
async function shiftTs(prod: Sb, rentalId: string, column: string, days: number, fallbackFromNow = 1): Promise<void> {
  const { data } = await prod.from("rentals").select(`${column}`)
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  const cur = (data as any)?.[column];
  const base = cur ? new Date(cur).getTime() : Date.now() + fallbackFromNow * 24 * 3600 * 1000;
  const shifted = new Date(base - days * 24 * 3600 * 1000).toISOString();
  await prod.from("rentals").update({ [column]: shifted })
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
}

// Backdate a date-only column (e.g. end_date) by `days`.
async function shiftDate(prod: Sb, rentalId: string, column: string, days: number): Promise<void> {
  const { data } = await prod.from("rentals").select(`${column}`)
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  const cur = (data as any)?.[column];
  const base = cur ? new Date(`${cur}T00:00:00Z`).getTime() : Date.now();
  const shifted = new Date(base - days * 24 * 3600 * 1000).toISOString().split("T")[0];
  await prod.from("rentals").update({ [column]: shifted })
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
}

// ── Manifest ────────────────────────────────────────────────────────────────
export const SERVICES: SbService[] = [
  // 1. PAYG accrual (ledger only, no money) ─────────────────────────────────
  {
    key: "payg",
    label: "PAYG accrual",
    order: 10,
    scopeRentalId: PAYG_RENTAL,
    cronFns: ["sandbox-accrue-payg-charges"],
    stepping: "catchup",
    drainFires: 10,
    progressKey: "processed",
    // Window-aware: post `days` accrual CYCLES (one daily-rate charge each) by
    // anchoring payg_next_accrual_at `days` windows into the past — works whether
    // the tenant's accrual window is 24h (prod) or 5-min (this test tenant's QA).
    backdate: async (prod, days) => {
      const { data: t } = await prod.from("tenants")
        .select("payg_accrual_window_seconds").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
      const win = Number((t as any)?.payg_accrual_window_seconds) || 86400;
      // `- 1s` so exactly `days` windows fall due (avoids the boundary off-by-one).
      const target = new Date(Date.now() - (days * win - 1) * 1000).toISOString();
      await prod.from("rentals").update({ payg_next_accrual_at: target })
        .eq("id", PAYG_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
    },
    status: async (s) => {
      const [{ count: accruals }, charges, rental] = await Promise.all([
        s.from("payg_accruals").select("id", { count: "exact", head: true }).eq("rental_id", PAYG_RENTAL),
        s.from("ledger_entries").select("remaining_amount").eq("rental_id", PAYG_RENTAL).eq("type", "Charge"),
        s.from("rentals").select("payg_next_accrual_at, payg_accrual_day_count").eq("id", PAYG_RENTAL).maybeSingle(),
      ]);
      return {
        accruals: accruals ?? 0,
        totalCharged: sumRemaining(charges.data),
        nextAccrualAt: rental.data?.payg_next_accrual_at ?? null,
        dayCount: rental.data?.payg_accrual_day_count ?? 0,
      };
    },
    reset: async (s) => {
      await s.from("payg_accruals").delete().eq("rental_id", PAYG_RENTAL);
      await s.from("ledger_entries").delete().eq("rental_id", PAYG_RENTAL).eq("type", "Charge");
      await s.from("rentals").update({
        is_pay_as_you_go: true, status: "Active", payg_paused: false, payg_closed_at: null,
        payg_accrual_day_count: 0, payg_start_ts: new Date().toISOString(), payg_next_accrual_at: inDaysIso(1),
        payg_last_accrual_at: null, payg_max_duration_alerted: false,
      }).eq("id", PAYG_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return SERVICES[0].status(s);
    },
  },

  // 2. Deposit-hold refresh (test hold recreate; self-reverts) ───────────────
  {
    key: "deposit",
    label: "Deposit-hold refresh",
    order: 20,
    scopeRentalId: DEPOSIT_RENTAL,
    cronFns: ["sandbox-refresh-deposit-holds"],
    stepping: "single",
    progressKey: "refreshed",
    backdate: (prod, days) => shiftTs(prod, DEPOSIT_RENTAL, "deposit_hold_expires_at", days, 7),
    status: async (s) => {
      const { data } = await s.from("rentals")
        .select("deposit_hold_status, deposit_hold_expires_at, deposit_hold_payment_intent_id, deposit_hold_amount")
        .eq("id", DEPOSIT_RENTAL).maybeSingle();
      return {
        holdStatus: data?.deposit_hold_status ?? null,
        expiresAt: data?.deposit_hold_expires_at ?? null,
        paymentIntentId: data?.deposit_hold_payment_intent_id ?? null,
        amount: data?.deposit_hold_amount ?? null,
      };
    },
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", deposit_hold_status: "held",
        deposit_hold_placed_at: new Date().toISOString(), deposit_hold_expires_at: inDaysIso(7),
      }).eq("id", DEPOSIT_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return SERVICES[1].status(s);
    },
  },

  // 3. Installment auto-charge (real TEST PI, settles inline) ────────────────
  //    NOTE: mark-overdue-installments is intentionally NOT fired (global-blast job).
  {
    key: "installment",
    label: "Installment auto-charge",
    order: 30,
    scopeRentalId: INSTALLMENT_RENTAL,
    cronFns: ["sandbox-process-installment-payment"],
    stepping: "catchup",
    drainFires: 8,
    progressKey: "charged",
    // Charges the CUMULATIVE of all open+due installments in one PI → backdate ALL
    // open rows' due_date to today (a single-column time-shift would leave later
    // installments future-dated).
    preFire: async (s) => {
      const { data: plan } = await s.from("installment_plans").select("id")
        .eq("rental_id", INSTALLMENT_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
      if (plan?.id) {
        await s.from("scheduled_installments").update({ due_date: todayStr() })
          .eq("installment_plan_id", plan.id).eq("invoice_status", "open");
        await s.from("installment_plans").update({ last_reminder_sent_at: null }).eq("id", plan.id);
      }
    },
    status: async (s) => {
      const { data: plan } = await s.from("installment_plans")
        .select("id, status, collection_mode, last_reminder_sent_at").eq("rental_id", INSTALLMENT_RENTAL).maybeSingle();
      let installments: Array<Record<string, unknown>> = [];
      if (plan?.id) {
        const { data } = await s.from("scheduled_installments")
          .select("id, installment_number, amount, due_date, invoice_status")
          .eq("installment_plan_id", plan.id).order("installment_number", { ascending: true });
        installments = data ?? [];
      }
      const tally = (st: string) => installments.filter((i) => i.invoice_status === st).length;
      const nextOpen = installments.find((i) => i.invoice_status === "open");
      return {
        planStatus: plan?.status ?? null,
        lastReminderSentAt: plan?.last_reminder_sent_at ?? null,
        installments: installments.length,
        open: tally("open"),
        paid: tally("paid"),
        nextOpenDue: nextOpen?.due_date ?? null,
      };
    },
    reset: async (s) => {
      const { data: plan } = await s.from("installment_plans")
        .update({ status: "active", last_reminder_sent_at: null })
        .eq("rental_id", INSTALLMENT_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID)
        .select("id").maybeSingle();
      if (plan?.id) {
        await s.from("scheduled_installments").update({ invoice_status: "open" }).eq("installment_plan_id", plan.id);
      }
      return SERVICES[2].status(s);
    },
  },

  // 4. Auto-extension (real TEST PI, settles inline; order-coupled) ──────────
  {
    key: "auto_extend",
    label: "Auto-extension",
    order: 40,
    scopeRentalId: AUTO_EXTEND_RENTAL,
    cronFns: ["sandbox-auto-extend-rentals"],
    stepping: "dayloop",
    progressKey: "renewed",
    backdate: async (prod, days) => {
      await shiftTs(prod, AUTO_EXTEND_RENTAL, "auto_extend_next_charge_at", days);
      await shiftDate(prod, AUTO_EXTEND_RENTAL, "end_date", days);
    },
    status: async (s) => {
      const { data } = await s.from("rentals")
        .select("auto_extend_status, auto_extend_charge_count, auto_extend_next_charge_at, end_date, auto_extend_failed_attempts")
        .eq("id", AUTO_EXTEND_RENTAL).maybeSingle();
      return {
        autoExtendStatus: data?.auto_extend_status ?? null,
        chargeCount: data?.auto_extend_charge_count ?? 0,
        nextChargeAt: data?.auto_extend_next_charge_at ?? null,
        endDate: data?.end_date ?? null,
        failedAttempts: data?.auto_extend_failed_attempts ?? 0,
      };
    },
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", auto_extend_enabled: true, auto_extend_paused: false,
        auto_extend_status: "active", auto_extend_charge_count: 0, auto_extend_failed_attempts: 0,
        auto_extend_pending_extension_id: null, auto_extend_next_charge_at: inDaysIso(7),
      }).eq("id", AUTO_EXTEND_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return SERVICES[3].status(s);
    },
  },

  // 5. PAYG pay-link reminder (reuses the PAYG fixture rental) ───────────────
  {
    key: "payg_reminder",
    label: "PAYG pay-link reminder",
    order: 50,
    scopeRentalId: PAYG_RENTAL,
    cronFns: ["sandbox-send-payg-reminders"],
    stepping: "single",
    progressKey: "sent",
    backdate: (prod, days) => shiftTs(prod, PAYG_RENTAL, "payg_last_reminder_sent_at", days),
    status: async (s) => {
      const [{ count: logs }, rental] = await Promise.all([
        s.from("payg_reminder_log").select("id", { count: "exact", head: true }).eq("rental_id", PAYG_RENTAL),
        s.from("rentals").select("payg_last_reminder_sent_at, payg_auto_reminders_enabled").eq("id", PAYG_RENTAL).maybeSingle(),
      ]);
      return {
        reminderLogs: logs ?? 0,
        lastReminderSentAt: rental.data?.payg_last_reminder_sent_at ?? null,
        autoRemindersEnabled: rental.data?.payg_auto_reminders_enabled ?? null,
      };
    },
    reset: async (s) => {
      await s.from("payg_reminder_log").delete().eq("rental_id", PAYG_RENTAL);
      await s.from("rentals").update({
        payg_last_reminder_sent_at: null, payg_auto_reminders_enabled: true,
      }).eq("id", PAYG_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return SERVICES[4].status(s);
    },
  },

  // 6. Return reminder (real email → notify-rental-reminder) ─────────────────
  {
    key: "return_reminder",
    label: "Return reminder",
    order: 60,
    scopeRentalId: RETURN_REMINDER_RENTAL,
    cronFns: ["sandbox-send-return-reminders"],
    stepping: "single",
    progressKey: "processed",
    // send-return-reminders excludes end_date < today, so backdating would push it
    // OUT of the window. Instead re-anchor end_date to today (in-window) + clear stamp.
    preFire: async (s) => {
      await s.from("rentals").update({ return_reminder_sent_at: null, end_date: todayStr() })
        .eq("id", RETURN_REMINDER_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
    },
    status: async (s) => {
      const { data } = await s.from("rentals")
        .select("end_date, return_reminder_sent_at, status").eq("id", RETURN_REMINDER_RENTAL).maybeSingle();
      return {
        endDate: data?.end_date ?? null,
        returnReminderSentAt: data?.return_reminder_sent_at ?? null,
        status: data?.status ?? null,
      };
    },
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", return_reminder_sent_at: null, end_date: todayStr(),
      }).eq("id", RETURN_REMINDER_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return SERVICES[5].status(s);
    },
  },

  // 7. Daily ledger reminder (in-app reminder_events only) ───────────────────
  {
    key: "daily_reminder",
    label: "Daily ledger reminder",
    order: 70,
    scopeRentalId: DAILY_REMINDER_RENTAL,
    cronFns: ["sandbox-daily-reminders"],
    stepping: "single",
    progressKey: "processedCharges",
    // daily-reminders has a date off-by-one; position the charge's due_date at the
    // exact "today" bucket via preFire instead of a time-shift.
    preFire: async (s) => {
      await s.from("ledger_entries").update({ due_date: todayStr() })
        .eq("rental_id", DAILY_REMINDER_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).eq("type", "Charge");
    },
    status: async (s) => {
      const [{ count: events }, charges] = await Promise.all([
        s.from("reminder_events").select("id", { count: "exact", head: true }).eq("rental_id", DAILY_REMINDER_RENTAL),
        s.from("ledger_entries").select("id, due_date, remaining_amount").eq("rental_id", DAILY_REMINDER_RENTAL).eq("type", "Charge"),
      ]);
      const rows = charges.data ?? [];
      return {
        reminderEvents: events ?? 0,
        charges: rows.length,
        nextDue: rows.map((r) => r.due_date).filter(Boolean).sort()[0] ?? null,
      };
    },
    reset: async (s) => {
      await s.from("reminder_events").delete().eq("rental_id", DAILY_REMINDER_RENTAL);
      await s.from("ledger_entries").update({ due_date: todayStr() })
        .eq("rental_id", DAILY_REMINDER_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).eq("type", "Charge");
      return SERVICES[6].status(s);
    },
  },
];

export const SERVICES_BY_KEY: Record<string, SbService> = Object.fromEntries(
  SERVICES.map((s) => [s.key, s]),
);

/** Services in cron-clock (advanceAll) order. */
export const SERVICES_ORDERED: SbService[] = [...SERVICES].sort((a, b) => a.order - b.order);
