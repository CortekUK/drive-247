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
//      the target rental to be in DESIGNATED_TEST_RENTAL_IDS, owned by the one
//      DESIGNATED_TEST_TENANT_ID, whose tenant is in Stripe TEST mode.
//   4. assertBlastRadius(): before any real fire, a preview call must report that
//      the fn's own due-criteria match ONLY this rental — else abort, no fire.
//   5. Every fire targets a sandbox-* fn that is itself fail-closed + tenant-locked.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICES_BY_KEY,
  SERVICES_ORDERED,
  DESIGNATED_TEST_TENANT_ID,
  DESIGNATED_TEST_RENTAL_IDS,
  type SbService,
} from "./services";

const IS_DEV = process.env.NODE_ENV === "development";
const PROD_URL = "https://hviqoaokxvlancmftwuo.supabase.co";
// Prod service key — env ONLY (put it in a gitignored .env.local; never commit).
const PROD_KEY = process.env.SANDBOX_PROD_SERVICE_KEY || "";

function prod(): SupabaseClient {
  if (!PROD_KEY) {
    throw new Error("SANDBOX_PROD_SERVICE_KEY is not set — refusing to run against production");
  }
  return createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });
}

// ── GUARD: the rental must live in the designated TEST tenant, and that tenant
//    must be in Stripe TEST mode. Fail-closed (throws).
//    Any rental in the test tenant is allowed (not just the fixtures) so the
//    panel can target the rental you're viewing — the test tenant has NO real
//    customers, and the blast-radius preview + fail-closed sandbox fns still keep
//    every fire to that one rental. ─────────────────────────────────────────
async function assertDesignated(p: SupabaseClient, rentalId: string): Promise<void> {
  const { data: r, error } = await p
    .from("rentals").select("tenant_id").eq("id", rentalId).maybeSingle();
  if (error) throw new Error(`refused: could not resolve rental ${rentalId}: ${error.message}`);
  if (!r) throw new Error(`refused: designated rental ${rentalId} does not exist`);
  if (r.tenant_id !== DESIGNATED_TEST_TENANT_ID) {
    throw new Error(`refused: rental ${rentalId} is not in the designated test tenant`);
  }
  const { data: t } = await p
    .from("tenants").select("stripe_mode").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  if (!t || t.stripe_mode !== "test") {
    throw new Error("refused: designated test tenant is not in Stripe test mode");
  }
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
async function fireOne(p: SupabaseClient, fn: string, scopeRentalId: string) {
  await assertDesignated(p, scopeRentalId);
  await assertBlastRadius(fn, scopeRentalId);
  return callSandbox(fn, { only_rental_id: scopeRentalId });
}

function progressOf(fireRes: { body?: any }, key: string): number {
  const v = fireRes?.body?.[key];
  return typeof v === "number" ? v : 0;
}

// ── FAST-FORWARD the rental being viewed ──────────────────────────────────────
// The Dev Panel is a pure TIME control: it shifts this rental's clock back N days
// (so "N days have passed" from the rental's point of view), then runs THIS
// rental's own cron jobs — accrual, reminders, auto-extend, deposit — exactly as
// production would. Results land in the rental's ledger, so the FRONTEND (KPI
// cards, Payment Breakdown, timeline) shows them; the panel shows no amounts.
//
// Afterwards we hand the clock back to the real cron at its natural next point,
// so the real cron does NOT immediately re-fire this rental (that churn is what
// made the numbers move on their own).
const DAY_MS = 24 * 3600 * 1000;
const backDays = (ts: string | null, days: number) =>
  ts ? new Date(new Date(ts).getTime() - days * DAY_MS).toISOString() : null;

async function paygWindowSeconds(p: SupabaseClient): Promise<number> {
  const { data } = await p.from("tenants")
    .select("payg_accrual_window_seconds").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  return Number((data as any)?.payg_accrual_window_seconds) || 86400;
}

/** Move every time anchor on ONE designated rental back by `days`. Scoped to id + tenant. */
async function shiftRentalClock(p: SupabaseClient, rentalId: string, days: number) {
  const { data } = await p.from("rentals")
    .select("payg_start_ts, payg_last_reminder_sent_at, payg_next_accrual_at, auto_extend_next_charge_at, deposit_hold_expires_at")
    .eq("id", rentalId).maybeSingle();
  if (!data) return;
  const r = data as any;
  const u: Record<string, unknown> = {};
  if (r.payg_start_ts) u.payg_start_ts = backDays(r.payg_start_ts, days);
  if (r.payg_last_reminder_sent_at) u.payg_last_reminder_sent_at = backDays(r.payg_last_reminder_sent_at, days);
  if (r.payg_next_accrual_at) u.payg_next_accrual_at = backDays(r.payg_next_accrual_at, days);
  if (r.auto_extend_next_charge_at) u.auto_extend_next_charge_at = backDays(r.auto_extend_next_charge_at, days);
  if (r.deposit_hold_expires_at) u.deposit_hold_expires_at = backDays(r.deposit_hold_expires_at, days);
  if (Object.keys(u).length) {
    await p.from("rentals").update(u).eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
  }
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

// ── "This rental" (PAYG) — advance/inspect the rental the user is VIEWING, ─────
//    not a fixed fixture. Same guards (assertDesignated → test tenant + mode;
//    fireOne → blast-radius). PAYG is ledger-only so it works on any PAYG rental.
async function backdatePaygWindows(p: SupabaseClient, rentalId: string, days: number) {
  const { data: t } = await p.from("tenants")
    .select("payg_accrual_window_seconds").eq("id", DESIGNATED_TEST_TENANT_ID).maybeSingle();
  const win = Number((t as any)?.payg_accrual_window_seconds) || 86400;
  const target = new Date(Date.now() - (days * win - 1) * 1000).toISOString();
  await p.from("rentals").update({ payg_next_accrual_at: target })
    .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
}

async function paygStatusFor(p: SupabaseClient, rentalId: string) {
  const [accr, charges, rental] = await Promise.all([
    p.from("payg_accruals").select("id", { count: "exact", head: true }).eq("rental_id", rentalId),
    p.from("ledger_entries").select("remaining_amount").eq("rental_id", rentalId).eq("type", "Charge"),
    p.from("rentals").select("payg_next_accrual_at, payg_accrual_day_count, is_pay_as_you_go, status")
      .eq("id", rentalId).maybeSingle(),
  ]);
  const total = (charges.data ?? []).reduce((s: number, r: any) => s + Number(r.remaining_amount || 0), 0);
  return {
    isPayg: rental.data?.is_pay_as_you_go ?? false,
    status: rental.data?.status ?? null,
    accruals: accr.count ?? 0,
    totalCharged: Math.round(total * 100) / 100,
    dayCount: rental.data?.payg_accrual_day_count ?? 0,
    nextAccrualAt: rental.data?.payg_next_accrual_at ?? null,
  };
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
      const result = await advanceService(p, svc, n);
      return NextResponse.json({
        ok: true, service: svc.key, advancedDays: n, ...result,
        services: { [svc.key]: await svc.status(p) },
      });
    }

    if (action === "advanceAll") {
      const n = posDays();
      const perService: Record<string, unknown[]> = {};
      for (let d = 0; d < n; d++) {
        for (const svc of SERVICES_ORDERED) {
          (perService[svc.key] ??= []).push(...(await advanceServiceOneDay(p, svc)));
        }
      }
      return NextResponse.json({ ok: true, advancedDays: n, fired: perService, ...(await allStatus(p)) });
    }

    if (action === "reset") {
      const svc = need();
      await assertDesignated(p, svc.scopeRentalId); // reset mutates prod rows — gate it
      return NextResponse.json({ ok: true, service: svc.key, services: { [svc.key]: await svc.reset(p) } });
    }

    if (action === "resetAll") {
      const entries = await Promise.all(
        SERVICES_ORDERED.map(async (svc) => {
          await assertDesignated(p, svc.scopeRentalId);
          return [svc.key, await svc.reset(p)] as const;
        }),
      );
      return NextResponse.json({ ok: true, services: Object.fromEntries(entries) });
    }

    // ── "This rental" — inspect/advance the PAYG rental the user is viewing ──
    if (action === "rentalPaygStatus") {
      await assertDesignated(p, rentalId);
      return NextResponse.json({ ok: true, rentalId, status: await paygStatusFor(p, rentalId) });
    }

    if (action === "advanceRentalPayg") {
      const n = posDays();
      await assertDesignated(p, rentalId);
      const st0 = await paygStatusFor(p, rentalId);
      if (!st0.isPayg) throw new Error("this rental is not a Pay-As-You-Go rental");
      // PAYG only accrues ACTIVE rentals. A freshly-created test rental is often
      // "Pending" — activate it (and clear pause/close) so the accrual can run.
      let activated = false;
      if (st0.status !== "Active") {
        await p.from("rentals").update({ status: "Active", payg_paused: false, payg_closed_at: null })
          .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
        activated = true;
      }
      await backdatePaygWindows(p, rentalId, n);
      // Drain-fire the isolated PAYG worker — each pass is blast-radius-checked.
      const fn = "sandbox-accrue-payg-charges";
      let processed = 0;
      for (let i = 0; i < 10; i++) {
        const r = await fireOne(p, fn, rentalId);
        const did = progressOf(r, "processed");
        processed += did;
        if (did === 0) break;
      }
      return NextResponse.json({ ok: true, rentalId, advancedDays: n, processed, activated, status: await paygStatusFor(p, rentalId) });
    }

    // Send a PAYG reminder for the rental being viewed (needs an outstanding balance).
    if (action === "sendRentalPaygReminder") {
      await assertDesignated(p, rentalId);
      const st0 = await paygStatusFor(p, rentalId);
      if (!st0.isPayg) throw new Error("this rental is not a Pay-As-You-Go rental");
      if ((st0.totalCharged ?? 0) <= 0) {
        return NextResponse.json({ ok: true, rentalId, sent: 0, note: "no outstanding balance — advance the rental first so there's something to remind about", status: st0 });
      }
      // The first reminder only fires once now >= (payg_start_ts + interval days).
      // Backdate the start + clear the last-sent stamp + ensure reminders on so the
      // reminder is due right now.
      await p.from("rentals").update({
        payg_start_ts: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        payg_last_reminder_sent_at: null,
        payg_auto_reminders_enabled: true,
      }).eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      const r = await fireOne(p, "sandbox-send-payg-reminders", rentalId);
      const sent = progressOf(r, "sent");
      const { count } = await p.from("payg_reminder_log").select("id", { count: "exact", head: true }).eq("rental_id", rentalId);
      return NextResponse.json({ ok: true, rentalId, sent, reminderLogs: count ?? 0, status: await paygStatusFor(p, rentalId) });
    }

    // ── FAST-FORWARD the rental being viewed: the Dev Panel becomes ITS cron ──
    if (action === "fastForwardRental") {
      const n = posDays();
      await assertDesignated(p, rentalId);
      const { data: r0 } = await p.from("rentals")
        .select("status, is_pay_as_you_go, auto_extend_enabled, deposit_hold_status")
        .eq("id", rentalId).maybeSingle();
      if (!r0) throw new Error("rental not found");
      const rr = r0 as any;

      // Cron jobs only process ACTIVE rentals — activate a Pending test rental.
      const activated = rr.status !== "Active";
      if (activated) {
        await p.from("rentals").update({ status: "Active", payg_paused: false, payg_closed_at: null })
          .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      }

      // "N days have passed" for this rental.
      await shiftRentalClock(p, rentalId, n);

      // Run THIS rental's own cron jobs, in cron-clock order.
      const fired: Record<string, number> = {};
      if (rr.is_pay_as_you_go) {
        fired.charges = await drainRental(p, "sandbox-accrue-payg-charges", rentalId, "processed");
        fired.reminders = progressOf(await fireOne(p, "sandbox-send-payg-reminders", rentalId), "sent");
      }
      if (rr.auto_extend_enabled) {
        fired.autoExtensions = progressOf(await fireOne(p, "sandbox-auto-extend-rentals", rentalId), "renewed");
      }
      if (rr.deposit_hold_status === "held") {
        fired.depositRefreshes = progressOf(await fireOne(p, "sandbox-refresh-deposit-holds", rentalId), "refreshed");
      }
      fired.dailyReminders = progressOf(await fireOne(p, "sandbox-daily-reminders", rentalId), "processedCharges");

      // Hand the clock back to the REAL cron at its natural next point, so it does
      // NOT immediately re-fire this rental (that churn moved the numbers on their own).
      if (rr.is_pay_as_you_go) {
        const win = await paygWindowSeconds(p);
        await p.from("rentals")
          .update({ payg_next_accrual_at: new Date(Date.now() + win * 1000).toISOString() })
          .eq("id", rentalId).eq("tenant_id", DESIGNATED_TEST_TENANT_ID);
      }

      return NextResponse.json({ ok: true, rentalId, advancedDays: n, activated, fired });
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
