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

// ── GUARD: the rental must be a designated test rental, in the designated test
//    tenant, and that tenant must be in Stripe TEST mode. Fail-closed (throws). ─
async function assertDesignated(p: SupabaseClient, rentalId: string): Promise<void> {
  if (!DESIGNATED_TEST_RENTAL_IDS.has(rentalId)) {
    throw new Error(`refused: ${rentalId} is not a designated test rental`);
  }
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
  try {
    const body = await req.json();
    action = String(body?.action ?? "");
    serviceKey = String(body?.service ?? "");
    days = Number(body?.days ?? 0);
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

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
