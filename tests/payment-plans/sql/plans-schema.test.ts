/**
 * Migration 20260925120100_payment_plans.sql — constraints, unique indexes and
 * the occurrence state machine, on real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDatabase, seedRental, type Db, type SeededRental } from "../harness/pglite";
import { BASE_DRAFTS, basePlanJson } from "../harness/plan-fixture";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 60_000);
afterAll(async () => db?.close());

/** Assert a statement fails with this SQLSTATE and (when given) this constraint. */
async function expectPgError(p: Promise<unknown>, code: string, constraint?: string | RegExp) {
  try {
    await p;
  } catch (e: any) {
    expect(e.code, `${e.message}`).toBe(code);
    if (constraint instanceof RegExp) expect(e.constraint ?? e.message).toMatch(constraint);
    else if (constraint) expect(e.constraint ?? e.message).toBe(constraint);
    return e;
  }
  throw new Error(`expected SQLSTATE ${code}${constraint ? ` (${constraint})` : ""}, but the statement succeeded`);
}

async function createBasePlan(r: SeededRental, over: Record<string, unknown> = {}): Promise<string> {
  const row = await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb, $2::jsonb, NULL) id`, [
    JSON.stringify(basePlanJson(r, over)),
    JSON.stringify(BASE_DRAFTS),
  ]);
  return row!.id;
}

/** A raw INSERT of a valid plan row, with `set` overriding columns (for CHECK tests). */
async function rawPlanInsert(r: SeededRental, set: Record<string, string>) {
  const cols: Record<string, string> = {
    tenant_id: `'${r.tenantId}'`,
    rental_id: `'${r.rentalId}'`,
    customer_id: `'${r.customerId}'`,
    status: `'cancelled'`, // not live, so the one-live-plan index never interferes
    cancelled_at: `now()`,
    freq: `'weekly'`,
    by_weekday: `'{5}'`,
    anchor_date: `'2026-10-02'`,
    end_kind: `'count'`,
    occurrence_count: `3`,
    timezone: `'America/New_York'`,
    amount_mode: `'split_total'`,
    total_amount: `600`,
    collection_method: `'auto_charge'`,
    ...set,
  };
  const names = Object.keys(cols);
  return db.q(`INSERT INTO payment_plans (${names.join(",")}) VALUES (${names.map((n) => cols[n]).join(",")})`);
}

describe("payment_plans — CHECKs", () => {
  let r: SeededRental;
  beforeAll(async () => {
    r = await seedRental(db, { owedCents: 60000 });
  });

  it("a valid raw row is accepted (the baseline every case below breaks one thing of)", async () => {
    await expect(rawPlanInsert(r, {})).resolves.toBeDefined();
  });

  const cases: [string, Record<string, string>, string][] = [
    ["status outside the set", { status: `'live'` }, "payment_plans_status_check"],
    ["freq outside the set", { freq: `'hourly'` }, "payment_plans_freq_check"],
    ["interval 0", { interval_count: `0` }, "payment_plans_interval_count_check"],
    ["interval 53", { interval_count: `53` }, "payment_plans_interval_count_check"],
    ["weekly without weekdays", { by_weekday: `NULL` }, "payment_plans_weekly_needs_weekday"],
    ["weekly with an empty weekday list", { by_weekday: `'{}'` }, "payment_plans_weekly_needs_weekday"],
    ["weekday 8", { by_weekday: `'{5,8}'` }, "payment_plans_weekday_range"],
    ["weekday 0", { by_weekday: `'{0}'` }, "payment_plans_weekday_range"],
    ["monthly without a day", { freq: `'monthly'`, by_weekday: `NULL` }, "payment_plans_monthly_needs_day"],
    ["month day 0", { freq: `'monthly'`, by_weekday: `NULL`, by_month_day: `0` }, "payment_plans_month_day_range"],
    ["month day -2", { freq: `'monthly'`, by_weekday: `NULL`, by_month_day: `-2` }, "payment_plans_month_day_range"],
    ["month day 32", { freq: `'monthly'`, by_weekday: `NULL`, by_month_day: `32` }, "payment_plans_month_day_range"],
    ["dates without dates", { freq: `'dates'`, by_weekday: `NULL` }, "payment_plans_dates_needs_dates"],
    ["dates with an empty list", { freq: `'dates'`, by_weekday: `NULL`, explicit_dates: `'{}'` }, "payment_plans_dates_needs_dates"],
    ["end count without a count", { occurrence_count: `NULL` }, "payment_plans_count_needs_count"],
    ["count 0", { occurrence_count: `0` }, "payment_plans_occurrence_count_check"],
    ["count 521", { occurrence_count: `521` }, "payment_plans_occurrence_count_check"],
    ["end until without a date", { end_kind: `'until'` }, "payment_plans_end_needs_date"],
    ["end rental_end without a date", { end_kind: `'rental_end'` }, "payment_plans_end_needs_date"],
    ["end kind outside the set", { end_kind: `'forever'` }, "payment_plans_end_kind_check"],
    ["charge time 03:59", { charge_local_time: `'03:59'` }, "payment_plans_charge_local_time_check"],
    ["split without a total", { total_amount: `NULL` }, "payment_plans_split_needs_total"],
    ["fixed without an amount", { amount_mode: `'fixed'`, total_amount: `NULL` }, "payment_plans_fixed_needs_amount"],
    ["per_period without a rate", { amount_mode: `'per_period'`, total_amount: `NULL` }, "payment_plans_per_period_needs_rate"],
    ["total 0", { total_amount: `0` }, "payment_plans_total_amount_check"],
    ["fixed amount negative", { amount_mode: `'fixed'`, fixed_amount: `-1` }, "payment_plans_fixed_amount_check"],
    ["amount mode outside the set", { amount_mode: `'whatever'` }, "payment_plans_amount_mode_check"],
    ["collection method outside the set", { collection_method: `'crypto'` }, "payment_plans_collection_method_check"],
    ["max attempts 0", { max_attempts: `0` }, "payment_plans_max_attempts_check"],
    ["max attempts 11", { max_attempts: `11` }, "payment_plans_max_attempts_check"],
    ["retry after 0 days", { retry_after_days: `0` }, "payment_plans_retry_after_days_check"],
    ["retry after 15 days", { retry_after_days: `15` }, "payment_plans_retry_after_days_check"],
    ["reminder offset 31", { reminder_offsets: `'{-2,31}'` }, "payment_plans_reminder_offsets_range"],
    ["provider outside the set", { payment_provider: `'paypal'` }, "payment_plans_payment_provider_check"],
    ["currency upper-case", { currency: `'USD'` }, "payment_plans_currency_check"],
    ["created_via outside the set", { created_via: `'api'` }, "payment_plans_created_via_check"],
    ["legacy_source outside the set", { legacy_source: `'stripe_schedule'` }, "payment_plans_legacy_source_check"],
    ["cancelled without cancelled_at", { cancelled_at: `NULL` }, "payment_plans_status_stamps"],
    ["paused without paused_at", { status: `'paused'`, cancelled_at: `NULL` }, "payment_plans_status_stamps"],
    ["version 0", { version: `0` }, "payment_plans_version_check"],
  ];
  it.each(cases)("refuses: %s", async (_label, set, constraint) => {
    await expectPgError(rawPlanInsert(r, set), "23514", constraint);
  });
});

describe("payment_plans — one live plan per rental", () => {
  it("a second active plan on a rental is a unique violation; after cancelling the first, a new one is allowed", async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    const first = await createBasePlan(r);
    await expectPgError(createBasePlan(r), "23505", "ux_payment_plans_one_live_per_rental");
    // paused counts as live too
    await db.q(`SELECT pp_pause_plan($1, NULL, 'x')`, [first]);
    await expectPgError(createBasePlan(r), "23505", "ux_payment_plans_one_live_per_rental");
    await db.q(`SELECT pp_cancel_plan($1, NULL, 'x')`, [first]);
    await expect(createBasePlan(r)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("payment_plan_occurrences — CHECKs and uniques", () => {
  let r: SeededRental;
  let planId: string;
  let occ: { id: string; plan_id: string; seq: number }[];
  beforeAll(async () => {
    r = await seedRental(db, { owedCents: 60000 });
    planId = await createBasePlan(r);
    occ = await db.q(`SELECT id, plan_id, seq FROM payment_plan_occurrences WHERE plan_id=$1 ORDER BY seq`, [planId]);
  });

  const insertOcc = (set: Record<string, string>) => {
    const cols: Record<string, string> = {
      tenant_id: `'${r.tenantId}'`,
      plan_id: `'${planId}'`,
      rental_id: `'${r.rentalId}'`,
      seq: `99`,
      due_date: `'2026-10-30'`,
      due_at: `'2026-10-30T14:00:00Z'`,
      amount: `10`,
      collection_method: `'auto_charge'`,
      ...set,
    };
    const names = Object.keys(cols);
    return db.q(`INSERT INTO payment_plan_occurrences (${names.join(",")}) VALUES (${names.map((n) => cols[n]).join(",")})`);
  };

  it("UNIQUE (plan_id, seq)", async () => {
    await expectPgError(insertOcc({ seq: `1` }), "23505", "payment_plan_occurrences_plan_seq_key");
  });
  it("amount must be > 0", async () => {
    await expectPgError(insertOcc({ amount: `0` }), "23514", "payment_plan_occurrences_amount_check");
  });
  it("amount_paid must be ≥ 0", async () => {
    await expectPgError(insertOcc({ amount_paid: `-0.01` }), "23514", "payment_plan_occurrences_amount_paid_check");
  });
  it("period_end must be after period_start", async () => {
    await expectPgError(insertOcc({ period_start: `'2026-10-30'`, period_end: `'2026-10-30'` }), "23514", "payment_plan_occurrences_period_order");
  });
  it("status outside the set (the CHECK itself — the insert trigger would refuse first, so it is switched off here)", async () => {
    await db.exec(`SET session_replication_role = replica`);
    try {
      await expectPgError(insertOcc({ status: `'lost'` }), "23514", "payment_plan_occurrences_status_check");
    } finally {
      await db.exec(`SET session_replication_role = origin`);
    }
  });
  it("a new occurrence must start 'scheduled' (trigger)", async () => {
    await expectPgError(insertOcc({ status: `'paid'` }), "23514");
  });
  it("next_attempt_at on a non-failed row is cleared by the guard (and the CHECK backs it)", async () => {
    await db.q(`UPDATE payment_plan_occurrences SET next_attempt_at = '2026-10-04T14:00Z' WHERE id=$1`, [occ[2].id]);
    const row = await db.one(`SELECT status, next_attempt_at FROM payment_plan_occurrences WHERE id=$1`, [occ[2].id]);
    expect(row).toEqual({ status: "scheduled", next_attempt_at: null });
  });
  it("UNIQUE link_token_hash", async () => {
    await db.q(`SELECT pp_set_link_token($1, 'hash-a')`, [occ[0].id]);
    await expectPgError(db.q(`SELECT pp_set_link_token($1, 'hash-a')`, [occ[1].id]), "23505", "payment_plan_occurrences_link_token_hash_key");
  });
  it("plan_id / seq / tenant_id / rental_id are immutable", async () => {
    await expectPgError(db.q(`UPDATE payment_plan_occurrences SET seq = 42 WHERE id=$1`, [occ[2].id]), "23514");
  });
});

describe("payment_plan_attempts — the double-charge guards", () => {
  let r: SeededRental;
  let occId: string;
  beforeAll(async () => {
    r = await seedRental(db, { owedCents: 60000 });
    const planId = await createBasePlan(r);
    occId = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id=$1 AND seq=1`, [planId]))!.id;
  });
  const insertAttempt = (n: number, status: string, account = "acct_x", key?: string) =>
    db.q(
      `INSERT INTO payment_plan_attempts (tenant_id, occurrence_id, attempt_no, method, idempotency_key, status, provider, provider_account, amount)
       VALUES ($1, $2, $3, 'auto_charge', $4, $5, 'stripe', $6, 200)`,
      [r.tenantId, occId, n, key ?? `pp:${account}:${occId}:${n}`, status, account],
    );

  it("two in-flight attempts on one occurrence → unique violation (not a code path)", async () => {
    await insertAttempt(1, "in_flight");
    await expectPgError(insertAttempt(2, "claimed"), "23505", "ux_payment_plan_attempts_one_in_flight");
    await expectPgError(insertAttempt(3, "in_flight"), "23505", "ux_payment_plan_attempts_one_in_flight");
    // A finished attempt does not hold the occurrence.
    await expect(insertAttempt(4, "failed")).resolves.toBeDefined();
  });

  it("a duplicate idempotency key → unique violation", async () => {
    // Same key means same (account, occurrence, attempt_no): whichever unique index Postgres checks first reports it.
    await expectPgError(insertAttempt(4, "failed"), "23505", /payment_plan_attempts_(idempotency_key_key|occurrence_attempt_no_key)/);
  });

  it("a key that does not follow pp:{account|platform}:{occurrence}:{attempt_no} is refused", async () => {
    await expectPgError(insertAttempt(5, "failed", "acct_x", `pp:acct_other:${occId}:5`), "23514", "payment_plan_attempts_key_format");
    await expectPgError(insertAttempt(6, "failed", "acct_x", `stripe-${occId}`), "23514", "payment_plan_attempts_key_format");
  });

  it("amount must be > 0; attempt_no ≥ 1", async () => {
    await expectPgError(
      db.q(
        `INSERT INTO payment_plan_attempts (tenant_id, occurrence_id, attempt_no, method, idempotency_key, status, provider, amount)
         VALUES ($1,$2,7,'manual',$3,'failed','manual',0)`,
        [r.tenantId, occId, `pp:platform:${occId}:7`],
      ),
      "23514",
      "payment_plan_attempts_amount_check",
    );
  });

  it("a succeeded attempt is terminal; identity columns are immutable", async () => {
    await insertAttempt(8, "succeeded");
    const id = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_attempts WHERE occurrence_id=$1 AND attempt_no=8`, [occId]))!.id;
    await expectPgError(db.q(`UPDATE payment_plan_attempts SET status='failed' WHERE id=$1`, [id]), "23514");
    await expectPgError(db.q(`UPDATE payment_plan_attempts SET idempotency_key='x' WHERE id=$1`, [id]), "23514");
  });
});

describe("occurrence state machine (§6) — all 121 (from, to) pairs", () => {
  // Written out from the design doc §6, independently of the SQL.
  const S6: Record<string, string[]> = {
    scheduled: ["due", "paid", "partially_paid", "skipped", "superseded", "cancelled"],
    due: ["processing", "paid", "partially_paid", "requires_action", "failed", "skipped", "superseded", "cancelled"],
    processing: ["paid", "partially_paid", "failed", "requires_action", "due"],
    requires_action: ["processing", "paid", "partially_paid", "failed", "due", "skipped", "superseded", "cancelled"],
    partially_paid: ["processing", "paid", "failed", "requires_action", "due", "skipped", "superseded", "cancelled"],
    failed: ["processing", "due", "paid", "partially_paid", "requires_action", "skipped", "superseded", "cancelled"],
    paid: ["partially_paid", "due"],
    skipped: ["due"],
    superseded: [],
    cancelled: [],
    waived: [],
  };
  const ALL = Object.keys(S6);
  let occId: string;

  beforeAll(async () => {
    const r = await seedRental(db, { owedCents: 60000 });
    const planId = await createBasePlan(r);
    occId = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id=$1 AND seq=3`, [planId]))!.id;
  });

  /** Force `from` with triggers off (superuser only), then attempt `to` with the guard live. */
  async function tryTransition(from: string, to: string): Promise<"ok" | "raised"> {
    await db.exec(`SET session_replication_role = replica`);
    await db.q(`UPDATE payment_plan_occurrences SET status=$2, next_attempt_at=NULL WHERE id=$1`, [occId, from]);
    await db.exec(`SET session_replication_role = origin`);
    try {
      await db.q(`UPDATE payment_plan_occurrences SET status=$2 WHERE id=$1`, [occId, to]);
      return "ok";
    } catch (e: any) {
      if (!/illegal transition/.test(e.message)) throw e;
      return "raised";
    }
  }

  it("allows exactly the §6 transitions (and same-status no-ops), refuses every other", async () => {
    const got: Record<string, string> = {};
    const want: Record<string, string> = {};
    for (const from of ALL) {
      for (const to of ALL) {
        const key = `${from} -> ${to}`;
        want[key] = from === to || S6[from].includes(to) ? "ok" : "raised";
        got[key] = await tryTransition(from, to);
      }
    }
    expect(Object.keys(got)).toHaveLength(121);
    expect(got).toEqual(want);
    // Sanity: the matrix is not trivially all-ok or all-raised.
    const counts = Object.values(want).reduce((a, v) => ({ ...a, [v]: (a[v] ?? 0) + 1 }), {} as Record<string, number>);
    expect(counts).toEqual({ ok: 11 + 46, raised: 121 - 57 });
  });

  it("design gap made visible: nothing can ever reach 'waived' (no §6 edge leads to it)", () => {
    expect(ALL.filter((s) => S6[s].includes("waived"))).toEqual([]);
  });
});
