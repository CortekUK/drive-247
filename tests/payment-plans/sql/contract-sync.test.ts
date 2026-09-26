/**
 * The seams nothing else can run offline:
 *   1. every pp_* RPC the Deno Supabase store makes (payment-plans-deno/
 *      supabase-store.ts) names a real function with real parameter names,
 *      and supplies every parameter that has no default — PostgREST resolves
 *      functions BY NAMED ARGUMENTS, so a renamed parameter is a production
 *      404, not a type error;
 *   2. every string union in types.ts that a CHECK constraint mirrors lists
 *      exactly the same values as that constraint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { bootDatabase, REPO_ROOT, type Db } from "../harness/pglite";

let db: Db;
beforeAll(async () => {
  db = await bootDatabase();
}, 60_000);
afterAll(async () => db?.close());

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("Deno Supabase store → pp_* signatures", () => {
  const src = read("supabase/functions/_shared/payment-plans-deno/supabase-store.ts");
  const calls = [...src.matchAll(/this\.(?:call|rows)(?:<[^>]*>)?\(\s*"(pp_[a-z_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g)].map((m) => ({
    fn: m[1],
    keys: [...m[2].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((k) => k[1]),
  }));

  it("the parse found the store's calls (not vacuous)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(20);
    // Wave 3: every renewal RPC the Deno store makes is among them.
    for (const fn of ["pp_list_renewal_plans", "pp_append_renewal_period", "pp_post_renewal_period", "pp_record_renewal_insurance", "pp_reconcile_renewals"]) {
      expect(calls.map((c) => c.fn)).toContain(fn);
    }
  });

  it("every call names an existing function, passes only real parameter names, and every parameter without a default", async () => {
    const problems: string[] = [];
    for (const c of calls) {
      const procs = await db.q<{ args: string[] | null; nargs: number; ndefaults: number }>(
        `SELECT proargnames args, pronargs nargs, pronargdefaults ndefaults FROM pg_proc WHERE proname = $1`,
        [c.fn],
      );
      if (procs.length !== 1) {
        problems.push(`${c.fn}: ${procs.length} functions with that name`);
        continue;
      }
      const p = procs[0];
      const inputs = (p.args ?? []).slice(0, p.nargs);
      const required = inputs.slice(0, p.nargs - p.ndefaults);
      for (const k of c.keys) if (!inputs.includes(k)) problems.push(`${c.fn}: passes unknown parameter ${k}`);
      for (const k of required) if (!c.keys.includes(k)) problems.push(`${c.fn}: omits required parameter ${k}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("types.ts unions ↔ SQL CHECK lists", () => {
  // Line comments stripped first: a ';' inside one would end the union early.
  const types = read("supabase/functions/_shared/payment-plans/types.ts").replace(/\/\/[^\n]*/g, "");
  const union = (name: string): string[] => {
    const m = types.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
    if (!m) throw new Error(`type ${name} not found in types.ts`);
    return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
  };
  const check = async (conname: string): Promise<string[]> => {
    const d = (await db.one<{ d: string }>(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = $1`, [conname]))?.d;
    if (!d) throw new Error(`constraint ${conname} not found`);
    return [...d.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]).sort();
  };

  it.each([
    ["OccurrenceStatus", "payment_plan_occurrences_status_check"],
    ["AttemptStatus", "payment_plan_attempts_status_check"],
    ["PlanEventKind", "payment_plan_events_kind_check"],
    ["PlanStatus", "payment_plans_status_check"],
    ["Freq", "payment_plans_freq_check"],
    ["EndKind", "payment_plans_end_kind_check"],
    ["AmountMode", "payment_plans_amount_mode_check"],
    ["CollectionMethod", "payment_plans_collection_method_check"],
    ["CollectionMethod", "payment_plan_occurrences_collection_method_check"],
    ["CollectionMethod", "payment_plan_attempts_method_check"],
    // Wave 3 (20260926120200_open_ended_plans.sql)
    ["RenewalInsuranceStatus", "payment_plan_occurrences_insurance_status_check"],
    ["RenewalPeriodUnit", "payment_plans_renewal_unit_check"],
  ])("%s = %s", async (typeName, conname) => {
    const ts = union(typeName);
    expect(ts.length).toBeGreaterThanOrEqual(3);
    expect(await check(conname)).toEqual(ts);
  });
});
