/**
 * One engine per rental (migration 20260925120200) on real Postgres, and the
 * memory store's model of it.
 *
 * A rental still on auto-extend, an open PAYG or a live installment plan is
 * charged by that mechanism's own cron. So:
 *   1. pp_create_plan refuses a plan on such a rental — P0001,
 *      `legacy_mechanism_active:<mechanism>: <sentence>`, nothing written;
 *   2. switching one of them ON while a plan is active or paused refuses —
 *      P0001, `payment_plan_active: <sentence>`, nothing written;
 *   3. a CLOSED PAYG and a cancelled / completed installment plan block
 *      nothing, and turning a mechanism OFF is always allowed.
 * The sentences are pinned against errors.ts: the SQL, the 409 and the
 * disabled button say the same words.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootDatabase, seedRental, type Db, type SeededRental } from "../harness/pglite";
import { BASE_DRAFTS, basePlanJson } from "../harness/plan-fixture";
import { PglitePlanStore } from "../harness/pglite-store";
import { MemoryPlanStore } from "@fn/_shared/payment-plans/memory-store.ts";
import { toStoreError } from "@fn/_shared/payment-plans-deno/supabase-store.ts";
import {
  LEGACY_MECHANISM_FALLBACK_REASON,
  LEGACY_MECHANISM_REASON,
  legacyMechanismMessage,
  legacyMechanismOf,
  legacyMechanismRefusal,
  PAYMENT_PLAN_ACTIVE_REASON,
  PlanStoreError,
  type LegacyMechanism,
} from "@fn/_shared/payment-plans/errors.ts";
import type { OccurrenceDraft, PlanRow } from "@fn/_shared/payment-plans/types.ts";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => db.setNow("2026-09-25T12:00:00.000Z"));

// ─── helpers ────────────────────────────────────────────────────────────────

/** Postgres' own answer: SQLSTATE + message, or "ok". */
async function outcome(sql: string, params: unknown[] = []): Promise<{ code: string; message: string } | "ok"> {
  try {
    await db.q(sql, params);
    return "ok";
  } catch (e: any) {
    return { code: e?.code, message: e?.message };
  }
}

const createPlan = (r: SeededRental) =>
  outcome(`SELECT pp_create_plan($1::jsonb, $2::jsonb, NULL)`, [JSON.stringify(basePlanJson(r)), JSON.stringify(BASE_DRAFTS)]);
const createPlanId = async (r: SeededRental) =>
  (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb, NULL) id`, [JSON.stringify(basePlanJson(r)), JSON.stringify(BASE_DRAFTS)]))!.id;
const planCount = async (rentalId: string) =>
  (await db.one<{ n: number }>(`SELECT count(*)::int n FROM payment_plans WHERE rental_id = $1`, [rentalId]))!.n;
const flags = (rentalId: string) =>
  db.one<{ auto_extend_enabled: boolean; is_pay_as_you_go: boolean; payg_closed_at: string | null }>(
    `SELECT auto_extend_enabled, is_pay_as_you_go, payg_closed_at FROM rentals WHERE id = $1`,
    [rentalId],
  );
const addInstallment = (r: SeededRental, status: string) =>
  outcome(`INSERT INTO installment_plans (rental_id, tenant_id, customer_id, status) VALUES ($1, $2, $3, $4)`, [r.rentalId, r.tenantId, r.customerId, status]);

/** Put a freshly seeded rental on a mechanism, the way the old code paths do it (no plan exists yet). */
async function onMechanism(r: SeededRental, m: LegacyMechanism | "payg_closed" | `installment_${string}`): Promise<void> {
  if (m === "auto_extend") await db.q(`UPDATE rentals SET auto_extend_enabled = true WHERE id = $1`, [r.rentalId]);
  else if (m === "payg") await db.q(`UPDATE rentals SET is_pay_as_you_go = true, payg_closed_at = NULL WHERE id = $1`, [r.rentalId]);
  else if (m === "payg_closed") await db.q(`UPDATE rentals SET is_pay_as_you_go = true, payg_closed_at = '2026-09-20T10:00:00Z' WHERE id = $1`, [r.rentalId]);
  else if (m === "installment") expect(await addInstallment(r, "active")).toBe("ok");
  else expect(await addInstallment(r, m.slice("installment_".length))).toBe("ok");
}

const refusedFor = (m: LegacyMechanism) => ({ code: "P0001", message: `legacy_mechanism_active:${m}: ${LEGACY_MECHANISM_REASON[m]}` });
const planInTheWay = (m: LegacyMechanism) => ({ code: "P0001", message: `payment_plan_active: ${PAYMENT_PLAN_ACTIVE_REASON[m]}` });

// ─── 1. a plan on a rental that is on an old mechanism ─────────────────────

describe("pp_create_plan refuses a rental still on an old mechanism", () => {
  it("control: a rental on no old mechanism gets its plan", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    expect(await createPlan(r)).toBe("ok");
    expect(await planCount(r.rentalId)).toBe(1);
  });

  it.each<[string, LegacyMechanism, LegacyMechanism | `installment_${string}`]>([
    ["auto_extend_enabled = true", "auto_extend", "auto_extend"],
    ["is_pay_as_you_go = true, payg_closed_at NULL (open PAYG)", "payg", "payg"],
    ["an installment plan that is pending", "installment", "installment_pending"],
    ["an installment plan that is active", "installment", "installment_active"],
    ["an installment plan that is overdue", "installment", "installment_overdue"],
  ])("%s → P0001 legacy_mechanism_active:%s, and nothing is written", async (_label, expected, m) => {
    const r = await seedRental(db, { owedCents: 60000 });
    await onMechanism(r, m);
    expect(await createPlan(r)).toEqual(refusedFor(expected));
    expect(await planCount(r.rentalId)).toBe(0);
    const orphans = await db.one<{ n: number }>(`SELECT count(*)::int n FROM payment_plan_occurrences WHERE rental_id = $1`, [r.rentalId]);
    expect(orphans!.n).toBe(0);
  });

  it.each<[string, "payg_closed" | `installment_${string}`]>([
    ["a CLOSED PAYG (payg_closed_at set)", "payg_closed"],
    ["a CANCELLED installment plan", "installment_cancelled"],
    ["a COMPLETED installment plan", "installment_completed"],
  ])("%s does not block", async (_label, m) => {
    const r = await seedRental(db, { owedCents: 60000 });
    await onMechanism(r, m);
    expect(await createPlan(r)).toBe("ok");
    expect(await planCount(r.rentalId)).toBe(1);
  });

  it("auto-extend is named first when a rental is on two (the same order the portal checks)", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    await onMechanism(r, "payg");
    await onMechanism(r, "auto_extend");
    expect(await createPlan(r)).toEqual(refusedFor("auto_extend"));
  });

  it("once the old mechanism is switched off, the plan can be created", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    await onMechanism(r, "auto_extend");
    expect(await createPlan(r)).toEqual(refusedFor("auto_extend"));
    await db.q(`UPDATE rentals SET auto_extend_enabled = false WHERE id = $1`, [r.rentalId]);
    expect(await createPlan(r)).toBe("ok");
  });

  it("the PGlite store (the Supabase store's twin) turns it into PlanStoreError 'legacy_mechanism_active'", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    await onMechanism(r, "payg");
    const store = new PglitePlanStore(db);
    store.setNow("2026-09-25T12:00:00.000Z");
    const err = await store.createPlan({ plan: basePlanJson(r) as unknown as Omit<PlanRow, "id" | "version" | "status">, occurrences: BASE_DRAFTS as OccurrenceDraft[] }).catch((e) => e);
    expect(err).toBeInstanceOf(PlanStoreError);
    expect(err.code).toBe("legacy_mechanism_active");
    expect(legacyMechanismOf(err.message)).toBe("payg");
  });
});

// ─── 2. an old mechanism switched on while a plan is live ──────────────────

describe("switching an old mechanism ON while a payment plan is live is refused", () => {
  let r: SeededRental;
  let planId: string;
  beforeEach(async () => {
    r = await seedRental(db, { owedCents: 60000 });
    planId = await createPlanId(r);
  });

  it("auto_extend_enabled → true: P0001 payment_plan_active, the row unchanged", async () => {
    expect(await outcome(`UPDATE rentals SET auto_extend_enabled = true WHERE id = $1`, [r.rentalId])).toEqual(planInTheWay("auto_extend"));
    expect((await flags(r.rentalId))!.auto_extend_enabled).toBe(false);
  });

  it("is_pay_as_you_go → true: refused", async () => {
    expect(await outcome(`UPDATE rentals SET is_pay_as_you_go = true WHERE id = $1`, [r.rentalId])).toEqual(planInTheWay("payg"));
    expect((await flags(r.rentalId))!.is_pay_as_you_go).toBe(false);
  });

  it("re-opening a closed PAYG (payg_closed_at → NULL) is switching it on: refused", async () => {
    // Close-first order is the only one the trigger lets through with a plan live.
    await db.q(`UPDATE rentals SET payg_closed_at = '2026-09-20T10:00:00Z' WHERE id = $1`, [r.rentalId]);
    expect(await outcome(`UPDATE rentals SET is_pay_as_you_go = true WHERE id = $1`, [r.rentalId])).toBe("ok");
    expect(await outcome(`UPDATE rentals SET payg_closed_at = NULL WHERE id = $1`, [r.rentalId])).toEqual(planInTheWay("payg"));
    expect((await flags(r.rentalId))!.payg_closed_at).not.toBeNull();
  });

  it("a PAUSED plan is live too", async () => {
    await db.q(`SELECT pp_pause_plan($1, NULL, 'away')`, [planId]);
    expect(await outcome(`UPDATE rentals SET auto_extend_enabled = true WHERE id = $1`, [r.rentalId])).toEqual(planInTheWay("auto_extend"));
    expect(await outcome(`UPDATE rentals SET is_pay_as_you_go = true WHERE id = $1`, [r.rentalId])).toEqual(planInTheWay("payg"));
  });

  it.each(["pending", "active", "overdue"])("INSERT of a %s installment plan: refused, nothing written", async (status) => {
    expect(await addInstallment(r, status)).toEqual(planInTheWay("installment"));
    const n = await db.one<{ n: number }>(`SELECT count(*)::int n FROM installment_plans WHERE rental_id = $1`, [r.rentalId]);
    expect(n!.n).toBe(0);
  });

  it("re-activating a cancelled installment plan: refused; moving it between closed states is not", async () => {
    // A cancelled row can be inserted with a plan live (it collects nothing)…
    expect(await addInstallment(r, "cancelled")).toBe("ok");
    expect(await outcome(`UPDATE installment_plans SET status = 'active' WHERE rental_id = $1`, [r.rentalId])).toEqual(planInTheWay("installment"));
    expect(await outcome(`UPDATE installment_plans SET status = 'completed' WHERE rental_id = $1`, [r.rentalId])).toBe("ok");
  });

  it("turning a mechanism OFF, and every unrelated rental update, is untouched", async () => {
    expect(await outcome(`UPDATE rentals SET auto_extend_enabled = false, is_pay_as_you_go = false WHERE id = $1`, [r.rentalId])).toBe("ok");
    expect(await outcome(`UPDATE rentals SET end_date = '2026-11-30', status = 'Active' WHERE id = $1`, [r.rentalId])).toBe("ok");
  });

  it("once the plan is cancelled (or completed) the old mechanism can be switched on", async () => {
    await db.q(`SELECT pp_cancel_plan($1, NULL, 'moving to auto-extend')`, [planId]);
    expect(await outcome(`UPDATE rentals SET auto_extend_enabled = true WHERE id = $1`, [r.rentalId])).toBe("ok");
    const r2 = await seedRental(db, { owedCents: 60000 });
    const p2 = await createPlanId(r2);
    await db.q(`UPDATE payment_plans SET status = 'completed', completed_at = now() WHERE id = $1`, [p2]);
    expect(await addInstallment(r2, "active")).toBe("ok");
  });

  it("holds for a portal user too — even one whose RLS cannot see the plan (the checks are SECURITY DEFINER)", async () => {
    // No app_users row: RLS shows this caller no plans at all, yet the refusal
    // still sees the live one. And the revoked EXECUTE on the trigger function
    // does not stop the trigger firing for them.
    const res = await db
      .asRole("authenticated", "44444444-4444-4444-8444-444444444444", async (tx) => {
        const visible = await tx.q(`SELECT 1 FROM payment_plans WHERE rental_id = $1`, [r.rentalId]);
        expect(visible).toEqual([]);
        await tx.q(`UPDATE rentals SET auto_extend_enabled = true WHERE id = $1`, [r.rentalId]);
        return "ok";
      })
      .catch((e: any) => ({ code: e?.code, message: e?.message }));
    expect(res).toEqual(planInTheWay("auto_extend"));
  });
});

// ─── the triggers cost nothing on an ordinary rentals update ───────────────

describe("the rentals trigger fires only when a mechanism turns on", () => {
  it("is BEFORE UPDATE OF exactly the three flag columns, with a WHEN guard (no INSERT, no other column)", async () => {
    const t = await db.one<{ def: string; cols: string[]; has_when: boolean }>(
      `SELECT pg_get_triggerdef(t.oid) def,
              ARRAY(SELECT a.attname::text FROM unnest(t.tgattr::int2[]) k JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k ORDER BY 1) cols,
              t.tgqual IS NOT NULL has_when
         FROM pg_trigger t WHERE t.tgname = 'pp_rental_one_engine'`,
    );
    expect(t!.cols).toEqual(["auto_extend_enabled", "is_pay_as_you_go", "payg_closed_at"]);
    expect(t!.has_when).toBe(true);
    expect(t!.def).toMatch(/^CREATE TRIGGER pp_rental_one_engine BEFORE UPDATE OF /);
  });
});

// ─── the words ─────────────────────────────────────────────────────────────

describe("one sentence per mechanism, everywhere", () => {
  it("legacyMechanismOf finds the marker behind a store's own prefix, and ignores anything else", () => {
    expect(legacyMechanismOf(`pp_create_plan: ${legacyMechanismMessage("installment")}`)).toBe("installment");
    expect(legacyMechanismOf("legacy_mechanism_active:payg: whatever")).toBe("payg");
    expect(legacyMechanismOf("legacy_mechanism_active:turo: new one")).toBeNull();
    expect(legacyMechanismOf("pp_claim: plan is paused")).toBeNull();
    expect(legacyMechanismOf(null)).toBeNull();
  });

  it("payment-plan-manage's 409 body names the mechanism in the operator's words", () => {
    for (const m of ["auto_extend", "payg", "installment"] as const) {
      expect(legacyMechanismRefusal(`pp_create_plan: ${legacyMechanismMessage(m)}`)).toEqual({ error: LEGACY_MECHANISM_REASON[m], code: "legacy_mechanism_active", mechanism: m });
    }
    expect(legacyMechanismRefusal("legacy_mechanism_active:turo: x")).toEqual({ error: LEGACY_MECHANISM_FALLBACK_REASON, code: "legacy_mechanism_active", mechanism: null });
    expect(LEGACY_MECHANISM_REASON.auto_extend).toMatch(/renews automatically.*auto-extend off/);
  });

  it("the Supabase store maps P0001 + the marker to 'legacy_mechanism_active', any other P0001 to 'refused'", () => {
    const legacy = toStoreError("pp_create_plan", { code: "P0001", message: legacyMechanismMessage("auto_extend") });
    expect([legacy.code, legacyMechanismOf(legacy.message)]).toEqual(["legacy_mechanism_active", "auto_extend"]);
    expect(toStoreError("pp_x", { code: "P0001", message: "something else" }).code).toBe("refused");
  });
});

// ─── the memory store says the same thing ─────────────────────────────────

describe("MemoryPlanStore models the same rule (parity with the SQL above)", () => {
  const plan = (rentalId: string): Omit<PlanRow, "id" | "version" | "status"> => ({
    ...(basePlanJson({ tenantId: "t1", rentalId, customerId: "c1" }) as unknown as Omit<PlanRow, "id" | "version" | "status">),
  });
  const drafts = BASE_DRAFTS as OccurrenceDraft[];
  const store = () =>
    new MemoryPlanStore({
      now: "2026-09-25T12:00:00.000Z",
      rentals: [
        { id: "plain", tenantId: "t1", customerId: "c1", owedCents: 60000 },
        { id: "auto", tenantId: "t1", customerId: "c1", owedCents: 60000, legacy: "auto_extend" },
        { id: "payg", tenantId: "t1", customerId: "c1", owedCents: 60000, legacy: "payg" },
        { id: "inst", tenantId: "t1", customerId: "c1", owedCents: 60000, legacy: "installment" },
      ],
    });

  it.each<[string, LegacyMechanism]>([
    ["auto", "auto_extend"],
    ["payg", "payg"],
    ["inst", "installment"],
  ])("createPlan on rental '%s' → PlanStoreError legacy_mechanism_active, with the SQL's exact message", async (rentalId, m) => {
    const s = store();
    const err = await s.createPlan({ plan: plan(rentalId), occurrences: drafts }).catch((e) => e);
    expect(err).toBeInstanceOf(PlanStoreError);
    expect([err.code, err.message]).toEqual(["legacy_mechanism_active", refusedFor(m).message]);
    expect(s.snapshot().plans).toEqual([]);
    expect(s.snapshot().occurrences).toEqual([]);
  });

  it("no mechanism → the plan is created; turning a mechanism on is then refused with the SQL's words, off is fine", async () => {
    const s = store();
    const planId = await s.createPlan({ plan: plan("plain"), occurrences: drafts });
    for (const m of ["auto_extend", "payg", "installment"] as const) {
      const err = (() => {
        try {
          s.setRentalLegacy("plain", m);
          return null;
        } catch (e) {
          return e as PlanStoreError;
        }
      })();
      expect([err?.code, err?.message]).toEqual(["refused", planInTheWay(m).message]);
    }
    await s.pausePlan(planId, null, "away");
    expect(() => s.setRentalLegacy("plain", "auto_extend")).toThrow(/payment_plan_active/);
    expect(() => s.setRentalLegacy("plain", null)).not.toThrow();
    await s.cancelPlan(planId, null, "done");
    expect(() => s.setRentalLegacy("plain", "auto_extend")).not.toThrow();
  });

  it("switching the mechanism off lets the plan through", async () => {
    const s = store();
    s.setRentalLegacy("auto", null);
    await expect(s.createPlan({ plan: plan("auto"), occurrences: drafts })).resolves.toMatch(/^plan-/);
  });
});
