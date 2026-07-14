// DEV-ONLY hybrid cron sandbox dispatcher — PRODUCTION test tenant, ONE rental.
//
// The Time Machine panel drives PRODUCTION's isolated `sandbox-*` cron fns (never
// the real cron) scoped to a single designated test rental. Multiple fail-closed
// guardrails stand between a click and a real customer:
//
//   1. 404 unless NODE_ENV==='development' (cannot exist in a deployed build).
//   2. The prod service key comes ONLY from env SANDBOX_PROD_SERVICE_KEY — if it
//      is unset we refuse to run (never a committed key).
//   3. assertDesignated(): every op (backdate / preFire / reset / fire) requires
//      the target rental to live in the one DESIGNATED_TEST_TENANT_ID, and that
//      tenant to be in Stripe TEST mode.
//   4. assertBlastRadius(): before any real fire, a preview call must report that
//      the fn's own due-criteria match ONLY this rental — else abort, no fire.
//   5. Every fire targets a sandbox-* fn that is itself fail-closed + tenant-locked.
//   6. A per-rental in-flight lock rejects racing clicks (409) — the clock shifts
//      are read-modify-write and must never interleave.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICES_BY_KEY,
  SERVICES_ORDERED,
  DESIGNATED_TEST_TENANT_ID,
  type SbService,
} from "./services";

const IS_DEV = process.env.NODE_ENV === "development";
const PROD_URL = "https://hviqoaokxvlancmftwuo.supabase.co";
// Prod service key — env ONLY (gitignored .env; never commit).
const PROD_KEY = process.env.SANDBOX_PROD_SERVICE_KEY || "";

function prod(): SupabaseClient {
  if (!PROD_KEY) {
    throw new Error("SANDBOX_PROD_SERVICE_KEY is not set — refusing to run against production");
  }
  return createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
}

// ── Concurrency: one in-flight mutation per lock key (rental id or "fixtures").
//    Module-level is fine for this dev-only, single-process route. ────────────
const inFlight = new Set<string>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) {
    throw new Error("another sandbox operation is already running for this target — wait for it to finish");
  }
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}

// ── GUARD: the rental must live in the designated TEST tenant, and that tenant
//    must be in Stripe TEST mode. Fail-closed (throws). Any rental in the test
//    tenant is allowed (not just fixtures) so the panel can target the rental
//    you're viewing — the test tenant has NO real customers. ─────────────────
async function assertDesignated(p: SupabaseClient, rentalId: string): Promise<void> {
  const { data: r, error } = await p
    .from("rentals").select("tenant_id").eq("id", rentalId).maybeSingle();
  if (error) throw new Error(`refused: could not resolve rental ${rentalId}: ${error.message}`);
  if (!r) throw new Error(`refused: rental ${rentalId} does not exist`);
  if (r.tenant_id !== DESIGNATED_TEST_TENANT_ID) {
    throw new Error(`refused: rental ${rentalId} is not in the designated test tenant`);
  }
  const { data: t } = await p
    .from("tenants").select("stripe_mode").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  if (!t || t.stripe_mode !== "test") {
    throw new Error("refused: designated test tenant is not in Stripe test mode");
  }
}

/** Does this designated rental exist? (advanceAll/resetAll skip missing fixtures.) */
async function fixtureExists(p: SupabaseClient, rentalId: string): Promise<boolean> {
  const { data } = await p.from("rentals").select("id")
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  return !!data;
}

// Call a sandbox-* fn on prod. verify_jwt=true → authenticate with the service key.
async function callSandbox(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${PROD_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PROD_KEY}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { name: fn, status: res.status, body: json as any };
}

// ── GUARD: preview must show the fn would touch ONLY this rental (or nothing). ─
async function assertBlastRadius(fn: string, scopeRentalId: string): Promise<void> {
  const { status, body } = await callSandbox(fn, { only_rental_id: scopeRentalId, preview: true });
  if (status !== 200 || !body || body.preview !== true) {
    throw new Error(`preview failed for ${fn} (status ${status}): ${JSON.stringify(body)?.slice(0, 180)}`);
  }
  const matched: string[] = Array.isArray(body.matchedRentalIds) ? body.matchedRentalIds : [];
  const stray = matched.filter((id) => id !== scopeRentalId);
  if (stray.length > 0) {
    throw new Error(`ABORT: preview for ${fn} matched OTHER rentals: ${stray.join(", ")}`);
  }
}

// Fire ONE sandbox fn, fully guarded: designated → blast-radius → real fire.
// A non-200 / success:false real fire THROWS (never silently reads as success).
async function fireOne(p: SupabaseClient, fn: string, scopeRentalId: string) {
  await assertDesignated(p, scopeRentalId);
  await assertBlastRadius(fn, scopeRentalId);
  const res = await callSandbox(fn, { only_rental_id: scopeRentalId });
  if (res.status !== 200 || res.body?.success === false) {
    const msg = res.body?.error || (Array.isArray(res.body?.errors) ? res.body.errors.join("; ") : `HTTP ${res.status}`);
    throw new Error(`${fn} failed: ${msg}`);
  }
  return res;
}

function progressOf(fireRes: { body?: any }, key: string): number {
  const v = fireRes?.body?.[key];
  return typeof v === "number" ? v : 0;
}

const DAY_MS = 24 * 3600 * 1000;
const backDays = (ts: string, days: number) =>
  new Date(new Date(ts).getTime() - days * DAY_MS).toISOString();

async function paygWindowSeconds(p: SupabaseClient): Promise<number> {
  const { data } = await p.from("tenants")
    .select("payg_accrual_window_seconds").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  return Number((data as any)?.payg_accrual_window_seconds) || 86400;
}

/** Fire a cron fn repeatedly until it stops doing work (catch-up drain). */
async function drainRental(p: SupabaseClient, fn: string, rentalId: string, key: string, max = 12) {
  let total = 0;
  for (let i = 0; i < max; i++) {
    const did = progressOf(await fireOne(p, fn, rentalId), key);
    total += did;
    if (did === 0) break;
  }
  return total;
}

// Catch-up drain: fire repeatedly until the PRIMARY fn stops doing work.
async function drainFire(p: SupabaseClient, svc: SbService) {
  const key = svc.progressKey ?? "processed";
  const max = svc.drainFires ?? 8;
  const fired: unknown[] = [];
  let processed = 0;
  for (let i = 0; i < max; i++) {
    let iter = 0;
    for (const fn of svc.cronFns) {
      const r = await fireOne(p, fn, svc.scopeRentalId);
      fired.push(r);
      if (fn === svc.cronFns[0]) iter += progressOf(r, key);
    }
    processed += iter;
    if (iter === 0) break;
  }
  return { fired, processed };
}

// Advance ONE service by `days`, honouring its stepping policy. Every path is
// gated: assertDesignated before any prod mutation (backdate/preFire) or fire.
async function advanceService(p: SupabaseClient, svc: SbService, days: number) {
  await assertDesignated(p, svc.scopeRentalId);

  if (svc.stepping === "catchup") {
    if (svc.backdate) await svc.backdate(p, days);
    if (svc.preFire) await svc.preFire(p);
    return drainFire(p, svc);
  }
  if (svc.stepping === "dayloop") {
    const fired: unknown[] = [];
    for (let d = 0; d < days; d++) {
      if (svc.backdate) await svc.backdate(p, 1);
      if (svc.preFire) await svc.preFire(p);
      for (const fn of svc.cronFns) fired.push(await fireOne(p, fn, svc.scopeRentalId));
    }
    return { fired };
  }
  // single
  if (svc.backdate) await svc.backdate(p, days);
  if (svc.preFire) await svc.preFire(p);
  const fired: unknown[] = [];
  for (const fn of svc.cronFns) fired.push(await fireOne(p, fn, svc.scopeRentalId));
  return { fired };
}

// One outer "day" for a service inside advanceAll (1-day granular).
async function advanceServiceOneDay(p: SupabaseClient, svc: SbService) {
  await assertDesignated(p, svc.scopeRentalId);
  if (svc.backdate) await svc.backdate(p, 1);
  if (svc.preFire) await svc.preFire(p);
  if (svc.stepping === "catchup") return (await drainFire(p, svc)).fired;
  const fired: unknown[] = [];
  for (const fn of svc.cronFns) fired.push(await fireOne(p, fn, svc.scopeRentalId));
  return fired;
}

async function allStatus(p: SupabaseClient) {
  const entries = await Promise.all(
    SERVICES_ORDERED.map(async (svc) => [svc.key, await svc.status(p)] as const),
  );
  return { services: Object.fromEntries(entries) };
}

// ═════════════════════════════ FAST-FORWARD ═════════════════════════════════
// The Dev Panel is a pure TIME control: pressing +Nd makes it THIS rental's cron
// for N days. It shifts the rental's own time anchors back N days, runs the
// rental's applicable cron jobs (accrual, installments, reminders, auto-extend,
// deposit, daily), then hands every anchor the crons did NOT consume back to its
// pre-shift value — so the REAL cron never sees a backdated anchor and never
// churns the rental on its own. Results land in the rental's ledger; the
// frontend (KPI cards / Payment Breakdown / timeline) shows them via Realtime.

interface FfSnapshot {
  rentals: Record<string, string | null>;
  openInstallments: Array<{ id: string; due_date: string }>;
  planId: string | null;
  planCooldown: string | null;
}

async function fastForwardRental(p: SupabaseClient, rentalId: string, days: number) {
  await assertDesignated(p, rentalId);

  const { data: r0 } = await p.from("rentals")
    .select("status, is_pay_as_you_go, auto_extend_enabled, deposit_hold_status, payg_closed_at, payg_start_ts, payg_last_reminder_sent_at, payg_next_accrual_at, auto_extend_next_charge_at, deposit_hold_expires_at, end_date")
    .eq("id", rentalId).maybeSingle();
  if (!r0) throw new Error("rental not found");
  const rr = r0 as any;

  // Only a PENDING rental is auto-activated (cron jobs process Active only).
  // Closed / Completed / Cancelled rentals are refused — resurrecting them would
  // hand them back to the REAL crons forever.
  let activated = false;
  if (rr.status !== "Active") {
    if (rr.status === "Pending" && !rr.payg_closed_at) {
      await p.from("rentals").update({ status: "Active", payg_paused: false })
        .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      activated = true;
    } else {
      throw new Error(`this rental is ${rr.status} — only Active or Pending rentals can be fast-forwarded`);
    }
  }

  const win = await paygWindowSeconds(p);

  // ── snapshot every anchor we are about to shift ───────────────────────────
  const snap: FfSnapshot = {
    rentals: {
      payg_start_ts: rr.payg_start_ts,
      payg_last_reminder_sent_at: rr.payg_last_reminder_sent_at,
      payg_next_accrual_at: rr.payg_next_accrual_at,
      auto_extend_next_charge_at: rr.auto_extend_next_charge_at,
      deposit_hold_expires_at: rr.deposit_hold_expires_at,
      end_date: rr.end_date,
    },
    openInstallments: [],
    planId: null,
    planCooldown: null,
  };

  // ── shift the clock: N days pass for THIS rental ──────────────────────────
  const u: Record<string, unknown> = {};
  if (rr.payg_start_ts) u.payg_start_ts = backDays(rr.payg_start_ts, days);
  if (rr.payg_last_reminder_sent_at) u.payg_last_reminder_sent_at = backDays(rr.payg_last_reminder_sent_at, days);
  // PAYG accrual is WINDOW-based, not calendar-based (the test tenant may run a
  // short QA window). "N days pass" = N windows become due. (days-1)*win margin
  // avoids the boundary race that made +7d post 8 accruals.
  if (rr.is_pay_as_you_go) {
    u.payg_next_accrual_at = new Date(Date.now() - Math.max(0, days - 1) * win * 1000 - 1000).toISOString();
  }
  if (rr.auto_extend_next_charge_at) u.auto_extend_next_charge_at = backDays(rr.auto_extend_next_charge_at, days);
  if (rr.deposit_hold_expires_at) u.deposit_hold_expires_at = backDays(rr.deposit_hold_expires_at, days);
  if (rr.end_date) {
    const base = new Date(`${rr.end_date}T00:00:00Z`).getTime();
    u.end_date = new Date(base - days * DAY_MS).toISOString().split("T")[0];
  }
  if (Object.keys(u).length) {
    await p.from("rentals").update(u).eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
  }

  // Installments live in scheduled_installments.due_date — shift the open ones.
  const { data: plan } = await p.from("installment_plans")
    .select("id, last_reminder_sent_at").eq("rental_id", rentalId)
    .eq("tenant_id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  if (plan?.id) {
    snap.planId = plan.id;
    snap.planCooldown = (plan as any).last_reminder_sent_at ?? null;
    const { data: open } = await p.from("scheduled_installments")
      .select("id, due_date").eq("installment_plan_id", plan.id).eq("invoice_status", "open");
    snap.openInstallments = (open ?? []) as any[];
    for (const si of snap.openInstallments) {
      const base = new Date(`${si.due_date}T00:00:00Z`).getTime();
      await p.from("scheduled_installments")
        .update({ due_date: new Date(base - days * DAY_MS).toISOString().split("T")[0] })
        .eq("id", si.id);
    }
    // The 24h charge cooldown must not swallow the simulated days.
    await p.from("installment_plans").update({ last_reminder_sent_at: null }).eq("id", plan.id);
  }

  // ── run THIS rental's cron jobs, in cron-clock order ──────────────────────
  const fired: Record<string, number> = {};
  const errors: string[] = [];
  const step = async (label: string, fn: () => Promise<number>) => {
    try { fired[label] = await fn(); }
    catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  };

  try {
    if (rr.is_pay_as_you_go) {
      await step("charges", () => drainRental(p, "sandbox-accrue-payg-charges", rentalId, "processed"));
      await step("reminders", async () => progressOf(await fireOne(p, "sandbox-send-payg-reminders", rentalId), "sent"));
    }
    if (snap.planId) {
      await step("installments", () => drainRental(p, "sandbox-process-installment-payment", rentalId, "charged", 8));
    }
    if (rr.auto_extend_enabled) {
      await step("autoExtensions", () => drainRental(p, "sandbox-auto-extend-rentals", rentalId, "renewed", 8));
    }
    if (rr.deposit_hold_status === "held" && !rr.auto_extend_enabled) {
      // (with auto-extend enabled the refresh fn RELEASES the hold instead — skip)
      await step("depositRefreshes", async () => progressOf(await fireOne(p, "sandbox-refresh-deposit-holds", rentalId), "refreshed"));
    }
    await step("returnReminders", async () => progressOf(await fireOne(p, "sandbox-send-return-reminders", rentalId), "processed"));
    await step("dailyReminders", async () => progressOf(await fireOne(p, "sandbox-daily-reminders", rentalId), "processedCharges"));
  } finally {
    // ── hand the clock back so the REAL cron never sees backdated anchors, and
    //    restore business date fields we only shifted for the simulation. ─────
    const { data: after } = await p.from("rentals")
      .select("auto_extend_next_charge_at, deposit_hold_expires_at, payg_last_reminder_sent_at, end_date")
      .eq("id", rentalId).maybeSingle();
    const a = (after ?? {}) as any;
    const nowMs = Date.now();
    const inst = (ts: unknown) => (ts ? new Date(ts as string).getTime() : NaN);
    const restore: Record<string, unknown> = {};

    // PAYG accrual pointer: park one full window in the future.
    if (rr.is_pay_as_you_go) restore.payg_next_accrual_at = new Date(nowMs + win * 1000).toISOString();

    // payg_start_ts is a business field (billing start) — always restore it.
    if (snap.rentals.payg_start_ts) restore.payg_start_ts = snap.rentals.payg_start_ts;

    // payg_last_reminder_sent_at: keep it only if a reminder RE-STAMPED it (value
    // moved off our shifted one); otherwise restore the real value.
    if (u.payg_last_reminder_sent_at && inst(a.payg_last_reminder_sent_at) === inst(u.payg_last_reminder_sent_at)) {
      restore.payg_last_reminder_sent_at = snap.rentals.payg_last_reminder_sent_at;
    }

    // auto-extend / deposit anchors: if the cron did NOT advance them past now
    // (compare as INSTANTS, not strings — DB returns +00:00, we wrote Z), restore
    // the real future value so the real cron won't immediately re-fire.
    if (u.auto_extend_next_charge_at && inst(a.auto_extend_next_charge_at) <= nowMs) {
      restore.auto_extend_next_charge_at = snap.rentals.auto_extend_next_charge_at;
    }
    if (u.deposit_hold_expires_at && inst(a.deposit_hold_expires_at) <= nowMs) {
      restore.deposit_hold_expires_at = snap.rentals.deposit_hold_expires_at;
    }

    // end_date: undo the artificial `days` shift while PRESERVING any legitimate
    // roll a cron did (auto-extend renewal). +days cancels the -days shift exactly.
    if (u.end_date && a.end_date) {
      const base = new Date(`${a.end_date}T00:00:00Z`).getTime();
      restore.end_date = new Date(base + days * DAY_MS).toISOString().split("T")[0];
    }

    if (Object.keys(restore).length) {
      await p.from("rentals").update(restore).eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
    }

    // Installments STILL open (charge failed / skipped) get their real due dates
    // + cooldown back so the REAL installment cron won't charge them off-schedule.
    if (snap.planId && snap.openInstallments.length) {
      const { data: still } = await p.from("scheduled_installments")
        .select("id").eq("installment_plan_id", snap.planId).eq("invoice_status", "open");
      const stillOpen = new Set(((still ?? []) as any[]).map((s) => s.id));
      let anyStillOpen = false;
      for (const si of snap.openInstallments) {
        if (stillOpen.has(si.id)) {
          anyStillOpen = true;
          await p.from("scheduled_installments").update({ due_date: si.due_date }).eq("id", si.id);
        }
      }
      if (anyStillOpen && snap.planCooldown) {
        await p.from("installment_plans").update({ last_reminder_sent_at: snap.planCooldown }).eq("id", snap.planId);
      }
    }
  }

  // Post-state so the panel can show what changed + a prepaid hint (a rental with
  // a big prepaid balance settles new charges immediately → Balance Due stays $0).
  const { data: post } = await p.from("rentals")
    .select("payg_accrual_day_count, end_date").eq("id", rentalId).maybeSingle();
  const { data: chg } = await p.from("ledger_entries")
    .select("amount, remaining_amount").eq("rental_id", rentalId).eq("type", "Charge");
  const gross = (chg ?? []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
  const outstanding = (chg ?? []).reduce((s: number, c: any) => s + Number(c.remaining_amount || 0), 0);
  const summary = {
    dayCount: (post as any)?.payg_accrual_day_count ?? null,
    endDate: (post as any)?.end_date ?? null,
    chargeRows: (chg ?? []).length,
    grossCharged: Math.round(gross * 100) / 100,
    outstanding: Math.round(outstanding * 100) / 100,
    settledByPrepay: gross > 0 && outstanding < gross - 0.01,
  };

  return { fired, errors, activated, summary };
}

export async function POST(req: Request) {
  if (!IS_DEV) return NextResponse.json({ ok: false, error: "not available" }, { status: 404 });

  let action = "";
  let serviceKey = "";
  let days = 0;
  let rentalId = "";
  try {
    const body = await req.json();
    action = String(body?.action ?? "");
    serviceKey = String(body?.service ?? "");
    days = Number(body?.days ?? 0);
    rentalId = String(body?.rentalId ?? "");
  } catch { /* empty */ }

  const need = (): SbService => {
    const svc = SERVICES_BY_KEY[serviceKey];
    if (!svc) throw new Error(`unknown service: ${serviceKey || "(none)"}`);
    return svc;
  };
  const posDays = () => {
    if (!Number.isFinite(days) || days <= 0) throw new Error("requires a positive `days`");
    return Math.floor(days);
  };

  try {
    const p = prod();

    if (action === "status") {
      return NextResponse.json({ ok: true, ...(await allStatus(p)) });
    }

    if (action === "advance") {
      const svc = need();
      const n = posDays();
      const result = await withLock(svc.scopeRentalId, () => advanceService(p, svc, n));
      return NextResponse.json({
        ok: true, service: svc.key, advancedDays: n, ...result,
        services: { [svc.key]: await svc.status(p) },
      });
    }

    if (action === "advanceAll") {
      const n = posDays();
      return NextResponse.json(await withLock("fixtures", async () => {
        // Skip fixtures that don't exist instead of 500ing mid-loop.
        const present: SbService[] = [];
        const skipped: string[] = [];
        for (const svc of SERVICES_ORDERED) {
          (await fixtureExists(p, svc.scopeRentalId)) ? present.push(svc) : skipped.push(svc.key);
        }
        const perService: Record<string, unknown[]> = {};
        for (let d = 0; d < n; d++) {
          for (const svc of present) {
            (perService[svc.key] ??= []).push(...(await advanceServiceOneDay(p, svc)));
          }
        }
        return { ok: true, advancedDays: n, fired: perService, skipped, ...(await allStatus(p)) };
      }));
    }

    if (action === "reset") {
      const svc = need();
      return NextResponse.json(await withLock(svc.scopeRentalId, async () => {
        await assertDesignated(p, svc.scopeRentalId); // reset mutates prod rows — gate it
        return { ok: true, service: svc.key, services: { [svc.key]: await svc.reset(p) } };
      }));
    }

    if (action === "resetAll") {
      return NextResponse.json(await withLock("fixtures", async () => {
        // Sequential + per-service isolation: one broken fixture must not abort
        // (or hide) the others' resets.
        const services: Record<string, unknown> = {};
        const skipped: string[] = [];
        const errors: string[] = [];
        for (const svc of SERVICES_ORDERED) {
          if (!(await fixtureExists(p, svc.scopeRentalId))) { skipped.push(svc.key); continue; }
          try {
            await assertDesignated(p, svc.scopeRentalId);
            services[svc.key] = await svc.reset(p);
          } catch (e) {
            errors.push(`${svc.key}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return { ok: true, services, skipped, errors };
      }));
    }

    // ── FAST-FORWARD the rental being viewed: the Dev Panel becomes ITS cron ──
    if (action === "fastForwardRental") {
      const n = posDays();
      const result = await withLock(rentalId, () => fastForwardRental(p, rentalId, n));
      return NextResponse.json({ ok: true, rentalId, advancedDays: n, ...result });
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.startsWith("another sandbox operation") ? 409 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
