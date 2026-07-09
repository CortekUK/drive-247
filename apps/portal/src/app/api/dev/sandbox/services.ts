// ============================================================================
// services.ts — SERVER-ONLY multi-service manifest for the STAGING cron sandbox
// ============================================================================
// Data-driven catalog the /api/dev/sandbox dispatcher (route.ts) iterates over.
// Each entry describes ONE cron-driven rental service: how to make its staging
// fixture eligible (shiftDomain/shiftId), which real cron fn(s) to fire and by
// what transport, how to step time (catch-up / day-loop / single), and how to
// read/reset its fixture state directly on staging.
//
// This file NEVER runs in the browser: route.ts is 404 outside development and
// holds the staging service key. status()/reset()/preFire()/resolveShiftId()
// receive a service-role Supabase client bound to the staging project.
//
// IMPORTANT ID note: for `installment`, shiftId (a scheduled_installments.id) is
// NOT the same as scopeRentalId (the rentals.id). scopeRentalId is always what
// gets passed to a cron fn as only_rental_id; shiftId (or resolveShiftId) is what
// the sim-control `shift` RPC backdates.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

// deno/next both fine with an untyped client for these ad-hoc reads.
type Sb = SupabaseClient;

// ── Pre-assigned staging fixture rentals (must match the STAGING RECIPE) ─────
export const PAYG_RENTAL = "b657f93b-a4d4-419d-84d5-fa9281e72ba4";
export const INSTALLMENT_RENTAL = "22222222-0000-0000-0000-000000000001";
export const AUTO_EXTEND_RENTAL = "44444444-0000-0000-0000-000000000001";
export const DEPOSIT_RENTAL = "55555555-0000-0000-0000-000000000001";
export const RETURN_REMINDER_RENTAL = "66666666-0000-0000-0000-000000000001";
export const DAILY_REMINDER_RENTAL = "77777777-0000-0000-0000-000000000001";

// ── Types ────────────────────────────────────────────────────────────────
export type FireTransport = "sim" | "direct";
// catchup  = shift once by N days, then fire in a loop until the backlog drains
// dayloop  = shift 1 day + fire, repeated N times (order-coupled money chains)
// single   = shift once by N days (+optional preFire), then fire once
export type Stepping = "catchup" | "dayloop" | "single";

export interface CronFire {
  /** sim → dispatch name in sim-control CRON_MANIFEST (GUARD 3 re-check).
   *  direct → the edge-function path fetched directly (used only for
   *  daily-reminders, which is intentionally NOT sim-dispatchable). */
  name: string;
  via: FireTransport;
}

export interface SbService {
  key: string;
  label: string;
  /** advanceAll fires services in ascending order (cron-clock order). */
  order: number;
  /** Passed to every cron fn as only_rental_id. */
  scopeRentalId: string;
  /** sim-control shift domain key, or null when the fixture is positioned by
   *  reset()/preFire() instead of a time-shift (daily_reminder). */
  shiftDomain: string | null;
  /** Concrete id the shift RPC targets. null → resolveShiftId() is used, or
   *  (when both absent) the shift falls back to scopeRentalId. */
  shiftId: string | null;
  /** Optional dynamic shift-id resolver (installment: earliest open row). */
  resolveShiftId?: (staging: Sb) => Promise<string | null>;
  cronFns: CronFire[];
  stepping: Stepping;
  /** Max iterations for a catch-up drain (default 8). */
  drainFires?: number;
  /** Body field on a fired fn's response that signals "work was done" — the
   *  drain loop stops when the FIRST cronFn reports 0 here. Default "processed". */
  progressKey?: string;
  /** single-stepping pre-fire hook (seed a fixture into the exact bucket). */
  preFire?: (staging: Sb) => Promise<void>;
  /** Read current fixture state from staging (service-role). */
  status: (staging: Sb) => Promise<Record<string, unknown>>;
  /** Restore the fixture to a fresh, eligible-but-unfired baseline on staging. */
  reset: (staging: Sb) => Promise<Record<string, unknown>>;
}

// ── helpers ─────────────────────────────────────────────────────────────
function sumRemaining(rows: Array<{ remaining_amount?: number | null }> | null): number {
  const total = (rows ?? []).reduce((s, r) => s + Number(r.remaining_amount || 0), 0);
  return Math.round(total * 100) / 100;
}
const todayStr = () => new Date().toISOString().split("T")[0];
const inDaysIso = (n: number) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

// ── Manifest ────────────────────────────────────────────────────────────
export const SERVICES: SbService[] = [
  // 1. PAYG accrual (ledger only, no money) ────────────────────────────────
  {
    key: "payg",
    label: "PAYG accrual",
    order: 10,
    scopeRentalId: PAYG_RENTAL,
    shiftDomain: "payg",
    shiftId: PAYG_RENTAL,
    cronFns: [{ name: "accrue-payg-charges", via: "sim" }],
    stepping: "catchup",
    drainFires: 8,
    progressKey: "processed",
    status: async (s) => {
      const [{ count: accruals }, charges, rental] = await Promise.all([
        s.from("payg_accruals").select("id", { count: "exact", head: true }).eq("rental_id", PAYG_RENTAL),
        s.from("ledger_entries").select("remaining_amount").eq("rental_id", PAYG_RENTAL).eq("type", "Charge"),
        s.from("rentals").select("payg_next_accrual_at, payg_accrual_day_count, monthly_amount, rental_period_type")
          .eq("id", PAYG_RENTAL).maybeSingle(),
      ]);
      return {
        accruals: accruals ?? 0,
        totalCharged: sumRemaining(charges.data),
        nextAccrualAt: rental.data?.payg_next_accrual_at ?? null,
        dayCount: rental.data?.payg_accrual_day_count ?? 0,
        rate: rental.data ? `${rental.data.monthly_amount}/${rental.data.rental_period_type}` : null,
      };
    },
    reset: async (s) => {
      await s.from("payg_accruals").delete().eq("rental_id", PAYG_RENTAL);
      await s.from("ledger_entries").delete().eq("rental_id", PAYG_RENTAL).eq("type", "Charge");
      await s.from("rentals").update({
        is_pay_as_you_go: true, status: "Active", payg_paused: false, payg_closed_at: null,
        payg_accrual_day_count: 0, payg_start_ts: new Date().toISOString(), payg_next_accrual_at: inDaysIso(1),
        payg_last_accrual_at: null, payg_max_duration_alerted: false,
      }).eq("id", PAYG_RENTAL);
      return SERVICES[0].status(s);
    },
  },

  // 2. Deposit-hold refresh (test hold recreate; self-reverts) ──────────────
  {
    key: "deposit",
    label: "Deposit-hold refresh",
    order: 20,
    scopeRentalId: DEPOSIT_RENTAL,
    shiftDomain: "deposit",
    shiftId: DEPOSIT_RENTAL,
    cronFns: [{ name: "refresh-deposit-holds", via: "sim" }],
    stepping: "single",
    progressKey: "refreshed",
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
    // NOTE: a real requires_capture test PaymentIntent must already exist on the
    // fixture (seeded by fixture SQL / place-deposit-hold). reset() only re-anchors
    // the DB row to a fresh "held" baseline; it does not mint a Stripe hold.
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", deposit_hold_status: "held",
        deposit_hold_placed_at: new Date().toISOString(), deposit_hold_expires_at: inDaysIso(7),
      }).eq("id", DEPOSIT_RENTAL);
      return SERVICES[1].status(s);
    },
  },

  // 3. Installment auto-charge (real test PI, settles inline) ───────────────
  {
    key: "installment",
    label: "Installment auto-charge",
    order: 30,
    scopeRentalId: INSTALLMENT_RENTAL,
    // No sim_shift: process-installment-payment charges the CUMULATIVE of all
    // open+due installments in one PI, so we backdate ALL open rows' due_date in
    // preFire (a single-row sim_shift would leave later installments future-dated).
    shiftDomain: null,
    shiftId: null,
    preFire: async (s) => {
      const { data: plan } = await s.from("installment_plans").select("id").eq("rental_id", INSTALLMENT_RENTAL).maybeSingle();
      if (plan?.id) {
        await s.from("scheduled_installments").update({ due_date: todayStr() })
          .eq("installment_plan_id", plan.id).eq("invoice_status", "open");
        await s.from("installment_plans").update({ last_reminder_sent_at: null }).eq("id", plan.id);
      }
    },
    cronFns: [
      { name: "process-installment-payment", via: "sim" },
      { name: "mark-overdue-installments", via: "sim" },
    ],
    stepping: "catchup",
    drainFires: 8,
    progressKey: "charged", // process-installment-payment reports { charged }
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
    // NOTE: money fixture — the plan, scheduled_installments and the attached
    // Stripe TEST PM are seeded by fixture SQL + sim-control `setup`. reset() only
    // re-opens the installments and clears the reminder stamp so the flow can rerun.
    reset: async (s) => {
      const { data: plan } = await s.from("installment_plans")
        .update({ status: "active", last_reminder_sent_at: null }).eq("rental_id", INSTALLMENT_RENTAL)
        .select("id").maybeSingle();
      if (plan?.id) {
        await s.from("scheduled_installments").update({ invoice_status: "open" }).eq("installment_plan_id", plan.id);
      }
      return SERVICES[2].status(s);
    },
  },

  // 4. Auto-extension (real test PI, settles inline; order-coupled) ─────────
  {
    key: "auto_extend",
    label: "Auto-extension",
    order: 40,
    scopeRentalId: AUTO_EXTEND_RENTAL,
    shiftDomain: "auto_extend",
    shiftId: AUTO_EXTEND_RENTAL,
    cronFns: [{ name: "auto-extend-rentals", via: "sim" }],
    stepping: "dayloop",
    progressKey: "renewed",
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
    // NOTE: money fixture (Stripe TEST PM seeded externally). reset() re-arms the
    // extension loop to a clean baseline; it does not undo already-charged periods'
    // ledger rows (rerun after a full fixture reseed for a pristine state).
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", auto_extend_enabled: true, auto_extend_paused: false,
        auto_extend_status: "active", auto_extend_charge_count: 0, auto_extend_failed_attempts: 0,
        auto_extend_pending_extension_id: null, auto_extend_next_charge_at: inDaysIso(7),
      }).eq("id", AUTO_EXTEND_RENTAL);
      return SERVICES[3].status(s);
    },
  },

  // 5. PAYG pay-link reminder (reuses the PAYG fixture rental) ──────────────
  {
    key: "payg_reminder",
    label: "PAYG pay-link reminder",
    order: 50,
    scopeRentalId: PAYG_RENTAL,
    // reuses the payg shift domain; requires payg_last_reminder_sent_at added to
    // that domain's driveCols (see orchestrator note).
    shiftDomain: "payg",
    shiftId: PAYG_RENTAL,
    cronFns: [{ name: "send-payg-reminders", via: "sim" }],
    stepping: "single",
    progressKey: "sent",
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
      }).eq("id", PAYG_RENTAL);
      return SERVICES[4].status(s);
    },
  },

  // 6. Return reminder (email → SES no-op on staging) ──────────────────────
  {
    key: "return_reminder",
    label: "Return reminder",
    order: 60,
    scopeRentalId: RETURN_REMINDER_RENTAL,
    // No time-shift: send-return-reminders excludes end_date < today, so backdating
    // would push the fixture OUT of the window. Instead preFire re-anchors end_date
    // to today (in-window) and clears the dedupe stamp so an advance re-fires.
    shiftDomain: null,
    shiftId: null,
    preFire: async (s) => {
      await s.from("rentals").update({ return_reminder_sent_at: null, end_date: todayStr() })
        .eq("id", RETURN_REMINDER_RENTAL);
    },
    cronFns: [{ name: "send-return-reminders", via: "sim" }],
    stepping: "single",
    progressKey: "processed",
    status: async (s) => {
      const { data } = await s.from("rentals")
        .select("end_date, return_reminder_sent_at, status").eq("id", RETURN_REMINDER_RENTAL).maybeSingle();
      return {
        endDate: data?.end_date ?? null,
        returnReminderSentAt: data?.return_reminder_sent_at ?? null,
        status: data?.status ?? null,
      };
    },
    // Seed end_date INTO the reminder window (tomorrow) so the fixture is eligible
    // even without a shift; clears the dedupe stamp.
    reset: async (s) => {
      await s.from("rentals").update({
        status: "Active", return_reminder_sent_at: null, end_date: todayStr(),
      }).eq("id", RETURN_REMINDER_RENTAL);
      return SERVICES[5].status(s);
    },
  },

  // 7. Daily ledger reminder (in-app reminder_events only; direct fire) ─────
  {
    key: "daily_reminder",
    label: "Daily ledger reminder",
    order: 70,
    scopeRentalId: DAILY_REMINDER_RENTAL,
    // No time-shift: daily-reminders has a date off-by-one, so we position the
    // charge's due_date at the exact "today" bucket via preFire instead.
    shiftDomain: null,
    shiftId: null,
    // fired by DIRECT URL — daily-reminders is intentionally NOT sim-dispatchable
    // (its live cron misroutes to a foreign project), so sim-control would reject it.
    cronFns: [{ name: "daily-reminders", via: "direct" }],
    stepping: "single",
    progressKey: "processedCharges",
    preFire: async (s) => {
      // Land the fixture's Charge ledger row on today's exact bucket.
      await s.from("ledger_entries").update({ due_date: todayStr() })
        .eq("rental_id", DAILY_REMINDER_RENTAL).eq("type", "Charge");
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
    // NOTE: the Charge ledger row itself is seeded by fixture SQL (needs customer_id
    // etc.). reset() clears emitted reminder_events and re-buckets due_date to today.
    reset: async (s) => {
      await s.from("reminder_events").delete().eq("rental_id", DAILY_REMINDER_RENTAL);
      await s.from("ledger_entries").update({ due_date: todayStr() })
        .eq("rental_id", DAILY_REMINDER_RENTAL).eq("type", "Charge");
      return SERVICES[6].status(s);
    },
  },
];

export const SERVICES_BY_KEY: Record<string, SbService> = Object.fromEntries(
  SERVICES.map((s) => [s.key, s]),
);

/** Services in cron-clock (advanceAll) order. */
export const SERVICES_ORDERED: SbService[] = [...SERVICES].sort((a, b) => a.order - b.order);
