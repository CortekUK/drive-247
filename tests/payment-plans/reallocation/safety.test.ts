/**
 * The guarantees payment_reallocate / charge_recompute_remaining make about
 * HOW they write (migration 20260926120100), each shown on real Postgres:
 *   * atomic — a failure at any write leaves every table exactly as it was;
 *   * no silent no-op — a write that touches zero rows aborts the call;
 *   * locked — the payment and every charge the call touches are locked
 *     FOR UPDATE before the first write;
 *   * reachable by service_role only; the audit is append-only.
 *
 * Failures are injected with test-only triggers in a private clone, the way a
 * production trigger or policy could swallow or reject a write.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloneDatabase } from "../harness/pglite";
import {
  applications,
  everything,
  insertCompletedPayment,
  outcome,
  reallocate,
  recompute,
  refusal,
  seedRental,
  seedStaff,
  type Db,
} from "./helpers";

const opened: Db[] = [];
afterAll(async () => {
  while (opened.length) await opened.pop()!.close();
});
async function fresh(): Promise<Db> {
  const db = await cloneDatabase();
  opened.push(db);
  return db;
}

/** Tax 300 + Fine 150; a 300 payment on Tax (FIFO); the move under test is Tax 200 / Fine 100. */
async function scene(db: Db) {
  const r = await seedRental(db, {
    charges: [
      { category: "Tax", amountCents: 30000, dueDate: "2026-10-02" },
      { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
    ],
  });
  const [tax, fine] = r.chargeIds;
  const pid = await insertCompletedPayment(db, r, 30000);
  const actor = await seedStaff(db, r.tenantId);
  const move = () => reallocate(db, pid, [[tax, 20000], [fine, 10000]], actor);
  return { r, tax, fine, pid, actor, move };
}

describe("payment reallocation — atomic", () => {
  // Each failure point comes after earlier writes of the same call have run.
  const failAt: [string, string][] = [
    ["the audit insert (the last write)", `CREATE TRIGGER t_fail BEFORE INSERT ON payment_allocation_changes FOR EACH ROW EXECUTE FUNCTION t_fail()`],
    ["the payment update", `CREATE TRIGGER t_fail BEFORE UPDATE OF remaining_amount ON payments FOR EACH ROW EXECUTE FUNCTION t_fail()`],
    ["the Fines revenue insert", `CREATE TRIGGER t_fail BEFORE INSERT ON pnl_entries FOR EACH ROW WHEN (NEW.category = 'Fines') EXECUTE FUNCTION t_fail()`],
    ["the Fine allocation insert", `CREATE TRIGGER t_fail BEFORE INSERT ON payment_applications FOR EACH ROW EXECUTE FUNCTION t_fail()`],
  ];
  for (const [where, trigger] of failAt) {
    it(`leaves every table exactly as it was when ${where} fails`, async () => {
      const db = await fresh();
      const s = await scene(db);
      await db.exec(`CREATE FUNCTION t_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; ${trigger};`);
      const before = await everything(db);
      const o = await outcome(s.move);
      expect(o).toMatchObject({ message: "injected failure" });
      expect(await everything(db)).toEqual(before);
    });
  }
});

describe("payment reallocation — a write that touches no row aborts the call", () => {
  // A BEFORE trigger returning NULL makes Postgres skip the row: the statement
  // "succeeds" with 0 rows — exactly the silent no-op the row-count asserts exist for.
  const swallow: [string, string][] = [
    ["the Tax charge's remaining_amount", `CREATE TRIGGER t_swallow BEFORE UPDATE ON ledger_entries FOR EACH ROW WHEN (OLD.category = 'Tax') EXECUTE FUNCTION t_swallow()`],
    ["the Tax allocation update", `CREATE TRIGGER t_swallow BEFORE UPDATE ON payment_applications FOR EACH ROW EXECUTE FUNCTION t_swallow()`],
    ["the Tax revenue update", `CREATE TRIGGER t_swallow BEFORE UPDATE ON pnl_entries FOR EACH ROW EXECUTE FUNCTION t_swallow()`],
    ["the payment's own update", `CREATE TRIGGER t_swallow BEFORE UPDATE OF remaining_amount ON payments FOR EACH ROW EXECUTE FUNCTION t_swallow()`],
  ];
  for (const [what, trigger] of swallow) {
    it(`refuses with write_failed, and changes nothing, when ${what} touches zero rows`, async () => {
      const db = await fresh();
      const s = await scene(db);
      await db.exec(`CREATE FUNCTION t_swallow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; ${trigger};`);
      const before = await everything(db);
      expect(await refusal(s.move)).toBe("P0001 write_failed");
      expect(await everything(db)).toEqual(before);
    });
  }

  it("refuses with write_failed when the recompute's charge update touches zero rows", async () => {
    const db = await fresh();
    const s = await scene(db);
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [s.fine]); // drift: 150 settled, 0 applied
    await db.exec(`CREATE FUNCTION t_swallow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
                   CREATE TRIGGER t_swallow BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION t_swallow();`);
    const before = await everything(db);
    expect(await refusal(() => recompute(db, s.fine, s.actor))).toBe("P0001 write_failed");
    expect(await everything(db)).toEqual(before);
  });
});

describe("payment reallocation — locks", () => {
  it("holds FOR UPDATE on the payment and on every charge it touches before its first write", async () => {
    const db = await fresh();
    const s = await scene(db);
    // A third charge the payment is not on and the move does not touch: must NOT be locked.
    const bystander = (await db.one<{ id: string }>(
      `INSERT INTO ledger_entries (customer_id, rental_id, vehicle_id, tenant_id, entry_date, due_date, type, category, amount, remaining_amount, reference)
       VALUES ($1, $2, $3, $4, '2026-10-06', '2026-10-06', 'Charge', 'Other', 10, 10, 'bystander') RETURNING id`,
      [s.r.customerId, s.r.rentalId, s.r.vehicleId, s.r.tenantId],
    ))!.id;
    // A row's xmax equals this transaction's id while this transaction holds a
    // row lock on it (and nothing has rewritten it yet). Recorded at the FIRST
    // ledger write of the call.
    await db.exec(`
      CREATE TABLE lock_probe (what text, id uuid, locked boolean);
      CREATE FUNCTION t_probe() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE me text := (pg_current_xact_id()::text::bigint % 4294967296)::text;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM lock_probe) THEN
          INSERT INTO lock_probe SELECT 'payment', id, xmax::text = me FROM payments WHERE id = '${s.pid}';
          INSERT INTO lock_probe SELECT 'charge', id, xmax::text = me FROM ledger_entries
            WHERE id IN ('${s.tax}', '${s.fine}', '${bystander}');
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER t_probe BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION t_probe();`);
    await s.move();
    const rows = await db.q<{ what: string; id: string; locked: boolean }>(`SELECT * FROM lock_probe`);
    const locked = Object.fromEntries(rows.map((r) => [r.id, r.locked]));
    expect(locked).toEqual({ [s.pid]: true, [s.tax]: true, [s.fine]: true, [bystander]: false });
  });
});

describe("payment reallocation — who can call it", () => {
  let db: Db;
  let s: Awaited<ReturnType<typeof scene>>;
  let staffAuth: string;
  beforeAll(async () => {
    db = await fresh();
    s = await scene(db);
    staffAuth = (await db.one<any>(`SELECT auth_user_id FROM app_users WHERE id = $1`, [s.actor]))!.auth_user_id;
  }, 60_000);

  const FUNCTIONS = [
    "payment_reallocate(uuid,jsonb,text,text,uuid)",
    "charge_recompute_remaining(uuid,text,uuid,text)",
    "bill_reconcile_options(uuid,uuid)",
  ];

  it("grants EXECUTE on the three entry points to service_role only — not anon, authenticated or PUBLIC", async () => {
    const rows = await db.q<{ fn: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(
      `SELECT f fn,
              has_function_privilege('anon', f, 'EXECUTE') anon,
              has_function_privilege('authenticated', f, 'EXECUTE') auth,
              has_function_privilege('service_role', f, 'EXECUTE') svc,
              EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = f::regprocedure AND a.grantee = 0) pub
         FROM unnest($1::text[]) f`,
      [FUNCTIONS],
    );
    expect(rows).toEqual(FUNCTIONS.map((fn) => ({ fn, anon: false, auth: false, svc: true, pub: false })));
  });

  it("keeps every function of the migration off the API roles, SECURITY DEFINER where it reads or writes tables, search_path pinned", async () => {
    const rows = await db.q<{ proname: string; secdef: boolean; pinned: boolean; anon: boolean; auth: boolean }>(
      `SELECT p.proname, p.prosecdef secdef,
              COALESCE(array_to_string(p.proconfig, ',') LIKE '%search_path=public%', false) pinned,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'pal\\_\\_%' OR p.proname IN ('payment_reallocate', 'charge_recompute_remaining',
               'bill_reconcile_options', 'payment_allocation_changes_append_only'))
        ORDER BY p.proname`,
    );
    const pure = new Set(["pal__money", "pal__pnl_category", "pal__require_reason", "payment_allocation_changes_append_only"]);
    expect(rows.length).toBe(12);
    for (const r of rows) {
      expect({ fn: r.proname, pinned: r.pinned, anon: r.anon, auth: r.auth }).toEqual({ fn: r.proname, pinned: true, anon: false, auth: false });
      if (!pure.has(r.proname)) expect({ fn: r.proname, secdef: r.secdef }).toEqual({ fn: r.proname, secdef: true });
    }
  });

  it("refuses a signed-in member of staff calling payment_reallocate directly ('permission denied')", async () => {
    const o = await outcome(() =>
      db.asRole("authenticated", staffAuth, (tx) =>
        tx.q(`SELECT payment_reallocate($1, $2::jsonb, 'x', NULL, $3)`, [s.pid, JSON.stringify([{ charge_entry_id: s.tax, amount_cents: 30000 }]), s.actor]),
      ),
    );
    expect(o).toMatchObject({ code: "42501" });
  });

  it("lets service_role call it", async () => {
    const o = await outcome(() =>
      db.asRole("service_role", null, (tx) =>
        tx.q(`SELECT payment_reallocate($1, $2::jsonb, 'x', NULL, $3)`, [
          s.pid,
          JSON.stringify([{ charge_entry_id: s.tax, amount_cents: 20000 }, { charge_entry_id: s.fine, amount_cents: 10000 }]),
          s.actor,
        ]),
      ),
    );
    expect(o).toBe("ok");
  });

  it("gives no API role — service_role included — INSERT, UPDATE or DELETE on the audit table", async () => {
    const rows = await db.q<any>(
      `SELECT r role, has_table_privilege(r, 'payment_allocation_changes', 'INSERT') ins,
              has_table_privilege(r, 'payment_allocation_changes', 'UPDATE') upd,
              has_table_privilege(r, 'payment_allocation_changes', 'DELETE') del,
              has_table_privilege(r, 'payment_allocation_changes', 'SELECT') sel
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r`,
    );
    expect(rows).toEqual([
      { role: "anon", ins: false, upd: false, del: false, sel: false },
      { role: "authenticated", ins: false, upd: false, del: false, sel: true },
      { role: "service_role", ins: false, upd: false, del: false, sel: true },
    ]);
  });

  it("shows staff only their own company's audit rows", async () => {
    // One audit row in this company, one in another.
    await reallocate(db, s.pid, [[s.tax, 25000], [s.fine, 5000]], s.actor);
    const o = await seedRental(db, { charges: [{ category: "Tax", amountCents: 1000, dueDate: "2026-10-02" }, { category: "Other", amountCents: 1000, dueDate: "2026-10-02" }] });
    const op = await insertCompletedPayment(db, o, 1000);
    await reallocate(db, op, [[o.chargeIds[1], 1000]], await seedStaff(db, o.tenantId));
    expect(await applications(db, op)).toEqual({ [o.chargeIds[1]]: 1000 });
    const seen = await db.asRole("authenticated", staffAuth, (tx) => tx.q<{ tenant_id: string }>(`SELECT DISTINCT tenant_id FROM payment_allocation_changes`));
    expect(seen).toEqual([{ tenant_id: s.r.tenantId }]);
  });
});
