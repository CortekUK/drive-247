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

// ── The one blessed test tenant (STAGING `test` — isolated, no real customers) ─
export const DESIGNATED_TEST_TENANT_ID = "8b434359-3ad1-491e-9593-b0ef381f5b21";

// ── Designated test rentals (created in the test tenant with these exact ids).
//    route.ts refuses to operate on anything not in this set. ────────────────
// NOTE: rental_number is derived as 'R-' || LEFT(id, 6), so each fixture id must
// differ within its FIRST SIX hex chars or the unique rental_number collides.
export const DEPOSIT_RENTAL = "a4000004-0000-4000-8000-000000000001";
export const RETURN_REMINDER_RENTAL = "a5000005-0000-4000-8000-000000000001";
export const DAILY_REMINDER_RENTAL = "a6000006-0000-4000-8000-000000000001";
// NOTE: route.ts no longer gates on a fixed allow-list — assertDesignated permits
// ANY rental in the designated test tenant (in Stripe test mode). These constants
// are just the seeded fixtures the "Legacy fixture controls" section drives.

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
   *  fixture is positioned by preFire() instead (return/daily). */
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
// Self-reference by key, not array index: a service can be removed from the
// manifest without silently repointing every later reset() at its neighbour.
const svc = (key: string): SbService => SERVICES.find((x) => x.key === key)!;

export const SERVICES: SbService[] = [
  // 1. Deposit-hold refresh (test hold recreate; self-reverts) ───────────────
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
      // The refresh fn needs a REAL requires_capture PI; if a failed run burned it
      // (status flipped to expired + PI cancelled), surface that instead of
      // silently re-arming a fixture that can only fail again.
      const { data } = await s.from("rentals").select("deposit_hold_payment_intent_id")
        .eq("id", DEPOSIT_RENTAL).maybeSingle();
      if (!(data as { deposit_hold_payment_intent_id?: string | null } | null)?.deposit_hold_payment_intent_id) {
        throw new Error("deposit fixture has no hold PaymentIntent — run sandbox-fixture-setup and re-seed it");
      }
      await s.from("rentals").update({
        status: "Active", deposit_hold_status: "held",
        deposit_hold_placed_at: new Date().toISOString(), deposit_hold_expires_at: inDaysIso(7),
      }).eq("id", DEPOSIT_RENTAL).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      return svc("deposit").status(s);
    },
  },

  // 2. Return reminder (real email → notify-rental-reminder) ─────────────────
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
      return svc("return_reminder").status(s);
    },
  },

  // 3. Daily ledger reminder (in-app reminder_events only) ───────────────────
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
      return svc("daily_reminder").status(s);
    },
  },
];

export const SERVICES_BY_KEY: Record<string, SbService> = Object.fromEntries(
  SERVICES.map((s) => [s.key, s]),
);

/** Services in cron-clock (advanceAll) order. */
export const SERVICES_ORDERED: SbService[] = [...SERVICES].sort((a, b) => a.order - b.order);
