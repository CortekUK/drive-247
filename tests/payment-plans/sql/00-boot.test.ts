import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDatabase, type Db } from "../harness/pglite";

describe("PGlite harness boots the live schema and both migrations", () => {
  let db: Db;
  beforeAll(async () => {
    db = await bootDatabase();
  }, 60_000);
  afterAll(async () => db?.close());

  it("runs Postgres, with the five plan tables and every pp_* function", async () => {
    const v = await db.one<{ v: string }>("select version() v");
    expect(v!.v).toMatch(/^PostgreSQL 1[5-9]/);
    const tables = await db.q<{ t: string }>(
      `select tablename t from pg_tables where schemaname='public' and tablename like 'payment_plan%' order by 1`,
    );
    expect(tables.map((r) => r.t)).toEqual([
      "payment_plan_attempts", "payment_plan_events", "payment_plan_occurrences", "payment_plan_revisions", "payment_plans",
    ]);
  });
});
