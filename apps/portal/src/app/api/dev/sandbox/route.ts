// DEV-ONLY generic dispatcher for the isolated STAGING cron sandbox.
//
// Lets the Time Machine panel drive staging's `sim-control` + real cron fns from
// the normal (production-pointed) portal WITHOUT any env switching and WITHOUT
// ever touching production. The staging service key lives here, SERVER-SIDE — it
// is never sent to the browser.
//
// This route is now DATA-DRIVEN: every service lives in ./services.ts (a
// server-only SbService[] manifest). The route only knows how to: read status,
// step time per a service's `stepping` policy, fire cron fns (money fns through
// sim-control `action:fire` so GUARD 3 + simDispatchable re-check on every
// dispatch; daily-reminders by direct URL since it is not sim-dispatchable),
// and reset fixtures.
//
// Hard guards:
//   - 404 unless NODE_ENV === 'development' (cannot exist in a deployed build).
//   - Firing money fns goes through sim-control, which fail-closes on any live
//     tenant or side-effect key (GUARD 3). Every fire is scoped to one rental.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  SERVICES_BY_KEY,
  SERVICES_ORDERED,
  type SbService,
  type CronFire,
} from "./services";

const IS_DEV = process.env.NODE_ENV === "development";

const STAGING_URL = "https://ksmreaadhbirzakkxqrq.supabase.co";
// Staging service key — already committed in scripts/db-switch.mjs; staging-only;
// safe to rotate. Kept server-side (never inlined into the client bundle).
const STAGING_SERVICE_KEY =
  process.env.SANDBOX_STAGING_SERVICE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbXJlYWFkaGJpcnpha2t4cXJxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDczMjkxMiwiZXhwIjoyMDk2MzA4OTEyfQ.Fo8OqiaEzCs6ECeRZB8_OgXIi138SRnBR4YyfeSNjfQ";

const staging = createClient(STAGING_URL, STAGING_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── sim-control proxy (money fns fire through here → GUARD 3 re-check) ──────
async function sim(action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${STAGING_URL}/functions/v1/sim-control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${STAGING_SERVICE_KEY}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error || `sim-control ${action} failed (${res.status})`);
  }
  return body;
}

// Direct fire — ONLY used for non-sim-dispatchable fns (daily-reminders). Scoped
// to a single rental via only_rental_id; wrapped in the same {dispatch:[...]}
// envelope sim-control returns so callers treat both transports uniformly.
async function fireDirect(path: string, scopeRentalId: string) {
  const res = await fetch(`${STAGING_URL}/functions/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${STAGING_SERVICE_KEY}` },
    body: JSON.stringify({ only_rental_id: scopeRentalId }),
  });
  const body = await res.json().catch(() => null);
  return { dispatch: [{ name: path, kind: "fn", status: res.status, body, via: "direct" }] };
}

async function fireOne(f: CronFire, scopeRentalId: string) {
  if (f.via === "sim") return sim("fire", { name: f.name, onlyId: scopeRentalId });
  return fireDirect(f.name, scopeRentalId);
}

// Pull the "work done" count from a fire response's first dispatch, using the
// service's progressKey (accrue→processed, installment→charged, etc.).
function progressOf(fireRes: unknown, key: string): number {
  const dispatch = (fireRes as { dispatch?: Array<{ body?: unknown }> })?.dispatch ?? [];
  const body = dispatch[0]?.body as Record<string, unknown> | null | undefined;
  const v = body?.[key];
  return typeof v === "number" ? v : 0;
}

// Backdate a service's driving columns so its fixture becomes due. No-op for
// services positioned by reset()/preFire() (shiftDomain === null).
async function shiftService(svc: SbService, days: number) {
  if (!svc.shiftDomain) return null;
  const id = svc.shiftId ?? (svc.resolveShiftId ? await svc.resolveShiftId(staging) : null);
  // Never fall back to scopeRentalId — for resolver-based domains (installment)
  // that would target a rentals UUID against the wrong table. No id → skip shift.
  if (!id) return null;
  return sim("shift", { domain: svc.shiftDomain, id, days });
}

// Fire every cronFn once; returns the raw fire responses.
async function fireAll(svc: SbService) {
  const out: unknown[] = [];
  for (const f of svc.cronFns) out.push(await fireOne(f, svc.scopeRentalId));
  return out;
}

// Catch-up drain: fire repeatedly until the primary fn stops doing work.
async function drainFire(svc: SbService) {
  const key = svc.progressKey ?? "processed";
  const max = svc.drainFires ?? 8;
  const fired: unknown[] = [];
  let processed = 0;
  for (let i = 0; i < max; i++) {
    let iter = 0;
    for (const f of svc.cronFns) {
      const r = await fireOne(f, svc.scopeRentalId);
      fired.push(r);
      // Progress is measured from the PRIMARY (first) fn only.
      if (f === svc.cronFns[0]) iter += progressOf(r, key);
    }
    processed += iter;
    if (iter === 0) break;
  }
  return { fired, processed };
}

// Advance ONE service by `days`, honouring its stepping policy.
async function advanceService(svc: SbService, days: number) {
  if (svc.stepping === "catchup") {
    await shiftService(svc, days);
    if (svc.preFire) await svc.preFire(staging);
    const { fired, processed } = await drainFire(svc);
    return { fired, processed };
  }
  if (svc.stepping === "dayloop") {
    const fired: unknown[] = [];
    for (let d = 0; d < days; d++) {
      await shiftService(svc, 1);
      for (const r of await fireAll(svc)) fired.push(r);
    }
    return { fired };
  }
  // single: shift → preFire → fire once
  await shiftService(svc, days);
  if (svc.preFire) await svc.preFire(staging);
  return { fired: await fireAll(svc) };
}

// One outer "day" for a service inside advanceAll (always 1-day granular).
async function advanceServiceOneDay(svc: SbService) {
  await shiftService(svc, 1);
  if (svc.preFire) await svc.preFire(staging);
  if (svc.stepping === "catchup") return (await drainFire(svc)).fired;
  return fireAll(svc);
}

async function allStatus() {
  // Return a KEYED map { [serviceKey]: statusObject } — the panel indexes
  // services[key] and renders the status object's fields directly.
  const entries = await Promise.all(
    SERVICES_ORDERED.map(async (svc) => [svc.key, await svc.status(staging)] as const),
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
    if (action === "status") {
      return NextResponse.json({ ok: true, ...(await allStatus()) });
    }

    if (action === "setup") {
      // Mint the Stripe TEST customer + PMs used by money fixtures (staging only).
      const res = await sim("setup");
      return NextResponse.json({ ok: true, setup: res?.stripe ?? res });
    }

    if (action === "advance") {
      const svc = need();
      const n = posDays();
      const result = await advanceService(svc, n);
      return NextResponse.json({
        ok: true, service: svc.key, advancedDays: n, ...result,
        services: { [svc.key]: await svc.status(staging) },
      });
    }

    if (action === "advanceAll") {
      const n = posDays();
      const perService: Record<string, unknown[]> = {};
      for (let d = 0; d < n; d++) {
        for (const svc of SERVICES_ORDERED) {
          (perService[svc.key] ??= []).push(...(await advanceServiceOneDay(svc)));
        }
      }
      return NextResponse.json({ ok: true, advancedDays: n, fired: perService, ...(await allStatus()) });
    }

    if (action === "reset") {
      const svc = need();
      return NextResponse.json({ ok: true, service: svc.key, services: { [svc.key]: await svc.reset(staging) } });
    }

    if (action === "resetAll") {
      const entries = await Promise.all(
        SERVICES_ORDERED.map(async (svc) => [svc.key, await svc.reset(staging)] as const),
      );
      return NextResponse.json({ ok: true, services: Object.fromEntries(entries) });
    }

    return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
