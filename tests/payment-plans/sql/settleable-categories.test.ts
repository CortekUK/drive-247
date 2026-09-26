/**
 * ledger_settleable_categories() (added to 20260925120000_ledger_allocation_
 * prerequisites.sql, Wave 1 fix D3) and the order guard at the top of
 * 20260926120000_balance_adjustments.sql, on real Postgres (PGlite).
 *
 * Pinned:
 *   1. the function returns EXACTLY the categories of payment_apply_fifo_v2's
 *      cat_order — parsed here from the function body the database holds — in
 *      its priority order (ties by name, C collation). One list, two readers:
 *      the allocator and the portal.
 *   2. it is GET-able (IMMUTABLE), callable by staff, not by anon; the live
 *      schema (no migration) has no such function, which is what makes the
 *      portal fall back to its old list there.
 *   3. the balance migration refuses to run before the prerequisites: no
 *      function → refused; a function without 'Adjustment' → refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bootDatabase, migrationPath, type Db } from "../harness/pglite";

const BALANCE = "20260926120000_balance_adjustments.sql";

let live: Db;
let migrated: Db;
beforeAll(async () => {
  [live, migrated] = await Promise.all([bootDatabase({ migrations: false }), bootDatabase()]);
}, 120_000);
afterAll(async () => {
  await live?.close();
  await migrated?.close();
});

/** cat_order's (category, priority) pairs, parsed from the allocator's body in the database. */
async function catOrderOfAllocator(db: Db): Promise<{ cat: string; pri: number }[]> {
  const src = (await db.one<{ src: string }>(`SELECT prosrc src FROM pg_proc WHERE proname = 'payment_apply_fifo_v2'`))!.src;
  const start = src.indexOf("cat_order(cat, pri) AS (");
  const end = src.indexOf("SELECT le.id", start);
  expect(start, "cat_order block").toBeGreaterThan(-1);
  expect(end, "end of cat_order block").toBeGreaterThan(start);
  const block = src.slice(start, end).replace(/--[^\n]*/g, "");
  return [...block.matchAll(/\('([^']+)'(?:::text)?,\s*([0-9.]+)(?:::numeric)?\)/g)].map((m) => ({ cat: m[1], pri: Number(m[2]) }));
}

/** Priority, then name in C (code-unit) order — the function's own ORDER BY. */
const byPriorityThenName = (a: { cat: string; pri: number }, b: { cat: string; pri: number }) =>
  a.pri - b.pri || (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : 0);

describe("ledger_settleable_categories() — one list with the allocator", () => {
  it("returns exactly payment_apply_fifo_v2's cat_order, in its priority order", async () => {
    const pairs = await catOrderOfAllocator(migrated);
    // Sanity on the parse (hand-counted from the migration): 14 existing rows
    // + 8 newly visible + Security Deposit = 23.
    expect(pairs).toHaveLength(23);
    const expected = [...pairs].sort(byPriorityThenName).map((p) => p.cat);
    const got = (await migrated.one<{ c: string[] }>(`SELECT ledger_settleable_categories() c`))!.c;
    expect(got).toEqual(expected);
    // The categories the portal's old list called unsettleable are all in it.
    for (const c of ["Excess Mileage", "Unlimited Mileage", "Adjustment", "Supercharger", "Extension", "InitialFee", "Initial Fees"]) {
      expect(got).toContain(c);
    }
    expect(got[0]).toBe("Rental");
    expect(got[got.length - 1]).toBe("Security Deposit");
  });

  it("every category the ledger CHECK allows is on it (so no allowed charge is ever called unpayable)", async () => {
    const def = (await migrated.one<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'ledger_entries_category_check'`,
    ))!.d;
    const allowed = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    const got = (await migrated.one<{ c: string[] }>(`SELECT ledger_settleable_categories() c`))!.c;
    expect(allowed.length).toBeGreaterThan(20);
    expect(allowed.filter((c) => !got.includes(c))).toEqual([]);
  });

  it("is IMMUTABLE (PostgREST serves it over GET), staff may call it, anon may not", async () => {
    const r = await migrated.one<{ v: string; auth: boolean; anon: boolean; svc: boolean; secdef: boolean }>(
      `SELECT provolatile v, prosecdef secdef,
              has_function_privilege('authenticated', oid, 'EXECUTE') auth,
              has_function_privilege('anon', oid, 'EXECUTE') anon,
              has_function_privilege('service_role', oid, 'EXECUTE') svc
         FROM pg_proc WHERE proname = 'ledger_settleable_categories'`,
    );
    expect(r).toEqual({ v: "i", secdef: false, auth: true, anon: false, svc: true });
    const asStaff = await migrated.asRole("authenticated", "aaaaaaaa-0000-4000-8000-0000000000aa", (tx) =>
      tx.q<{ c: string[] }>(`SELECT ledger_settleable_categories() c`),
    );
    expect(asStaff[0].c).toContain("Adjustment");
  });

  it("does not exist on the live schema — the portal's fallback case", async () => {
    const r = await live.one<{ p: string | null }>(`SELECT to_regprocedure('public.ledger_settleable_categories()')::text p`);
    expect(r!.p).toBeNull();
  });
});

describe("the balance migration's order guard", () => {
  it("refuses to run before the allocation prerequisites (no function)", async () => {
    await expect(bootDatabase({ migrations: [BALANCE] })).rejects.toThrow(
      /Apply 20260925120000_ledger_allocation_prerequisites\.sql first: ledger_settleable_categories\(\) does not exist/,
    );
  }, 120_000);

  it("refuses when the function does not list Adjustment", async () => {
    const db = await bootDatabase({ migrations: false });
    try {
      await db.exec(`CREATE FUNCTION public.ledger_settleable_categories() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['Rental'] $$;`);
      await expect(db.exec(readFileSync(migrationPath(BALANCE), "utf8"))).rejects.toThrow(/does not list Adjustment/);
      // and it wrote nothing
      expect(await db.one<{ t: string | null }>(`SELECT to_regclass('public.balance_adjustments')::text t`)).toEqual({ t: null });
    } finally {
      await db.close();
    }
  }, 120_000);

  it("runs once the prerequisites are in (the default harness order)", async () => {
    expect(await migrated.one<{ t: string | null }>(`SELECT to_regclass('public.balance_adjustments')::text t`)).toEqual({ t: "balance_adjustments" });
  });
});
