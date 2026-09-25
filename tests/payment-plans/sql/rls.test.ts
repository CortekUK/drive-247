/**
 * RLS and privileges on the five plan tables and every pp_* function.
 *
 * The harness recreates Supabase's DEFAULT PRIVILEGES (every new table and
 * function in public granted to anon + authenticated + service_role), so these
 * tests fail if the migration forgets a REVOKE — they do not just re-read the
 * migration text.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootDatabase, seedRental, type Db } from "../harness/pglite";
import { BASE_DRAFTS, BASE_DUE_AT, basePlanJson } from "../harness/plan-fixture";

const TABLES = ["payment_plans", "payment_plan_occurrences", "payment_plan_attempts", "payment_plan_events", "payment_plan_revisions"];
const STAFF_A = "11111111-1111-4111-8111-111111111111";
const SUPER = "22222222-2222-4222-8222-222222222222";

let db: Db;
let tenantA: string;
let tenantB: string;
const counts: Record<string, Record<string, number>> = {};

beforeAll(async () => {
  db = await bootDatabase();
  await db.setNow("2026-10-02T14:00:00.000Z");
  for (const label of ["A", "B"]) {
    const r = await seedRental(db, { owedCents: 60000 });
    const planId = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb,$2::jsonb) id`, [JSON.stringify(basePlanJson(r)), JSON.stringify(BASE_DRAFTS)]))!.id;
    await db.q(`SELECT * FROM pp_collect_due($1, NULL, $2)`, [BASE_DUE_AT[0], planId]);
    const occ = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE plan_id=$1 AND seq=1`, [planId]))!.id;
    await db.q(`SELECT pp_claim($1,'auto_charge','acct_x')`, [occ]);
    await db.q(`SELECT pp_move_occurrence(id, '2026-10-12', NULL) FROM payment_plan_occurrences WHERE plan_id=$1 AND seq=2`, [planId]);
    if (label === "A") tenantA = r.tenantId;
    else tenantB = r.tenantId;
  }
  // Tenant B also gets a revision (replace_future needs no charge in flight → a second plan).
  const r2 = await seedRental(db, { owedCents: 60000, tenantId: tenantB });
  const p2 = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb,$2::jsonb) id`, [JSON.stringify(basePlanJson(r2)), JSON.stringify(BASE_DRAFTS)]))!.id;
  await db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'rev')`, [p2, JSON.stringify(BASE_DRAFTS)]);
  const r3 = await seedRental(db, { owedCents: 60000, tenantId: tenantA });
  const p3 = (await db.one<{ id: string }>(`SELECT pp_create_plan($1::jsonb,$2::jsonb) id`, [JSON.stringify(basePlanJson(r3)), JSON.stringify(BASE_DRAFTS)]))!.id;
  await db.q(`SELECT pp_replace_future($1, 1, '{}'::jsonb, $2::jsonb, NULL, 'rev')`, [p3, JSON.stringify(BASE_DRAFTS)]);

  await db.q(`INSERT INTO app_users (auth_user_id, email, role, tenant_id) VALUES ($1, 'a@x.test', 'admin', $2)`, [STAFF_A, tenantA]);
  await db.q(`INSERT INTO app_users (auth_user_id, email, role, tenant_id, is_super_admin) VALUES ($1, 's@x.test', 'admin', NULL, true)`, [SUPER]);

  for (const t of TABLES) {
    const rows = await db.q<{ tenant_id: string; n: number }>(`SELECT tenant_id, count(*)::int n FROM ${t} GROUP BY tenant_id`);
    counts[t] = Object.fromEntries(rows.map((x) => [x.tenant_id, x.n]));
  }
}, 60_000);
afterAll(async () => db?.close());

describe("RLS — staff read their own tenant only", () => {
  it("the fixture really has rows for BOTH tenants in all five tables (else the next test proves nothing)", () => {
    for (const t of TABLES) {
      expect(counts[t][tenantA], `${t} A`).toBeGreaterThan(0);
      expect(counts[t][tenantB], `${t} B`).toBeGreaterThan(0);
    }
  });

  it.each(TABLES)("%s: tenant-A staff see exactly tenant A's rows", async (t) => {
    const rows = await db.asRole("authenticated", STAFF_A, (tx) => tx.q<{ tenant_id: string; n: number }>(`SELECT tenant_id, count(*)::int n FROM ${t} GROUP BY tenant_id`));
    expect(Object.fromEntries(rows.map((x) => [x.tenant_id, x.n]))).toEqual({ [tenantA]: counts[t][tenantA] });
  });

  it.each(TABLES)("%s: a super admin sees both tenants", async (t) => {
    const rows = await db.asRole("authenticated", SUPER, (tx) => tx.q<{ tenant_id: string; n: number }>(`SELECT tenant_id, count(*)::int n FROM ${t} GROUP BY tenant_id`));
    expect(Object.fromEntries(rows.map((x) => [x.tenant_id, x.n]))).toEqual(counts[t]);
  });

  it.each(TABLES)("%s: a signed-in user with no app_users row sees nothing", async (t) => {
    const rows = await db.asRole("authenticated", "33333333-3333-4333-8333-333333333333", (tx) => tx.q(`SELECT 1 FROM ${t}`));
    expect(rows).toEqual([]);
  });

  it.each(TABLES)("%s: anon has no access at all", async (t) => {
    await expect(db.asRole("anon", null, (tx) => tx.q(`SELECT 1 FROM ${t}`))).rejects.toThrow(/permission denied/);
  });
});

describe("RLS — nobody but service_role writes", () => {
  const writes = (t: string): [string, string][] => [
    ["INSERT", `INSERT INTO ${t} (tenant_id) VALUES ('${tenantA}')`],
    ["UPDATE", `UPDATE ${t} SET tenant_id = tenant_id`],
    ["DELETE", `DELETE FROM ${t}`],
  ];
  it.each(TABLES)("%s: authenticated staff cannot INSERT, UPDATE or DELETE even their own tenant's rows", async (t) => {
    for (const [verb, sql] of writes(t)) {
      await expect(db.asRole("authenticated", STAFF_A, (tx) => tx.q(sql)), `${verb} ${t}`).rejects.toThrow(/permission denied/);
    }
  });

  it("only SELECT policies exist on the five tables", async () => {
    const pols = await db.q<{ tablename: string; cmd: string; roles: string }>(
      `SELECT tablename, cmd, roles::text FROM pg_policies WHERE tablename = ANY($1) ORDER BY tablename`, [TABLES]);
    expect(pols).toHaveLength(5);
    expect(new Set(pols.map((p) => `${p.cmd} ${p.roles}`))).toEqual(new Set(["SELECT {authenticated}"]));
  });
});

describe("pp_* functions — service_role only", () => {
  let fns: { oid: string; sig: string }[];
  beforeAll(async () => {
    fns = await db.q(`SELECT p.oid::text oid, p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.proname LIKE 'pp%' ORDER BY 2`);
  });

  it("every pp_* function: EXECUTE for service_role, not for anon, authenticated or PUBLIC", async () => {
    expect(fns.length).toBeGreaterThanOrEqual(30);
    const bad: string[] = [];
    for (const f of fns) {
      const p = await db.one<{ anon: boolean; authn: boolean; svc: boolean; pub: boolean }>(
        `SELECT has_function_privilege('anon', $1::oid, 'EXECUTE') anon,
                has_function_privilege('authenticated', $1::oid, 'EXECUTE') authn,
                has_function_privilege('service_role', $1::oid, 'EXECUTE') svc,
                EXISTS (SELECT 1 FROM pg_proc, aclexplode(COALESCE(proacl, acldefault('f', proowner))) a
                         WHERE pg_proc.oid = $1::oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') pub`,
        [f.oid],
      );
      if (p!.anon || p!.authn || !p!.svc || p!.pub) bad.push(`${f.sig} ${JSON.stringify(p)}`);
    }
    expect(bad).toEqual([]);
  });

  it("every state-changing pp_ function is SECURITY DEFINER with search_path pinned", async () => {
    const rows = await db.q<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname LIKE 'pp\\_%' AND proname NOT IN
         ('pp_clock','pp_due_at','pp_occurrence_transition_allowed','pp_attempt_transition_allowed','pp_trg_occurrence_guard','pp_trg_attempt_guard','pp__plan_from_json','pp__plan_to_json')`);
    const bad = rows.filter((r) => !r.prosecdef || !(r.proconfig ?? []).some((c) => c === "search_path=public"));
    expect(bad.map((r) => r.proname)).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(24);
  });

  it("authenticated staff calling pp_claim / pp_record_success / pp_create_plan get 'permission denied'", async () => {
    const occ = (await db.one<{ id: string }>(`SELECT id FROM payment_plan_occurrences WHERE tenant_id=$1 LIMIT 1`, [tenantA]))!.id;
    for (const sql of [
      `SELECT pp_claim('${occ}', 'auto_charge', NULL)`,
      `SELECT pp_record_success('${occ}', 100, NULL, NULL, NULL, 'stripe', 'uk', '2026-10-02', 'Card', NULL)`,
      `SELECT pp_create_plan('{}'::jsonb, '[]'::jsonb, NULL)`,
      `SELECT pp_rental_owed_cents('${occ}')`,
    ]) {
      await expect(db.asRole("authenticated", STAFF_A, (tx) => tx.q(sql)), sql).rejects.toThrow(/permission denied for function/);
    }
  });

  it("service_role can call them (and bypasses RLS to read every tenant)", async () => {
    const rentalA = (await db.one<{ rental_id: string }>(`SELECT rental_id FROM payment_plans WHERE tenant_id=$1 LIMIT 1`, [tenantA]))!.rental_id;
    const n = await db.asRole("service_role", null, (tx) => tx.q<{ n: number }>(`SELECT pp_rental_owed_cents($1)::int n`, [rentalA]));
    expect(n[0].n).toBe(60000);
    const all = await db.asRole("service_role", null, (tx) => tx.q<{ n: number }>(`SELECT count(DISTINCT tenant_id)::int n FROM payment_plans`));
    expect(all[0].n).toBe(2);
  });
});
