/**
 * The payment-reallocate edge function's real handler (supabase/functions/
 * payment-reallocate/core.ts), driven offline against real Postgres: its
 * database client is a thin PGlite adapter that runs every query and RPC AS
 * service_role — the role the deployed function holds — and returns
 * supabase-js' { data, error } shape. So a renamed SQL parameter, a missing
 * grant, a wrong status mapping or a skipped { error } check all show up here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cloneDatabase, REPO_ROOT } from "../harness/pglite";
import {
  handlePaymentReallocate,
  mapRpcError,
  parseRequest,
  servesTenant,
  type DbClientLike,
} from "@fn/payment-reallocate/core.ts";
import { applications, insertCompletedPayment, remainingCents, seedRental, seedStaff, type Db, type SeededRental } from "./helpers";

// ─── A supabase-js-shaped client over PGlite, as service_role ────────────────

function pgError(e: any) {
  return { message: e?.message ?? String(e), code: e?.code ?? "", details: e?.detail ?? null, hint: e?.hint ?? null };
}

async function asServiceRole<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE service_role`);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}

class PgQuery {
  private where: string[] = [];
  private params: unknown[] = [];
  private cols = "*";
  private orderBy = "";
  private lim = "";
  constructor(private db: Db, private table: string) {}
  select(cols: string) {
    if (/[():]/.test(cols)) throw new Error(`adapter: embedded selects are not supported (${cols})`);
    this.cols = cols;
    return this;
  }
  eq(col: string, v: unknown) {
    this.params.push(v);
    this.where.push(`${col} = $${this.params.length}`);
    return this;
  }
  contains(col: string, v: unknown[]) {
    this.params.push(v);
    this.where.push(`${col} @> $${this.params.length}`);
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.orderBy = ` ORDER BY ${col} ${o.ascending === false ? "DESC" : "ASC"}`;
    return this;
  }
  limit(n: number) {
    this.lim = ` LIMIT ${Number(n)}`;
    return this;
  }
  private sql() {
    return `SELECT ${this.cols} FROM ${this.table}${this.where.length ? " WHERE " + this.where.join(" AND ") : ""}${this.orderBy}${this.lim}`;
  }
  async maybeSingle() {
    try {
      const rows = await asServiceRole(this.db, () => this.db.q(this.sql(), this.params));
      if (rows.length > 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
      return { data: rows[0] ?? null, error: null };
    } catch (e) {
      return { data: null, error: pgError(e) };
    }
  }
  then(resolve: (v: any) => void, reject: (e: any) => void) {
    asServiceRole(this.db, () => this.db.q(this.sql(), this.params))
      .then((rows) => resolve({ data: rows, error: null }), (e) => resolve({ data: null, error: pgError(e) }))
      .catch(reject);
  }
}

function pgliteClient(db: Db, sessions: Record<string, string>): DbClientLike & { rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    from: (table: string) => new PgQuery(db, table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(fn);
      const names = Object.keys(args);
      const vals = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      const sql = `SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) AS r`;
      try {
        const rows = await asServiceRole(db, () => db.q<{ r: unknown }>(sql, vals));
        return { data: rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: pgError(e) };
      }
    },
    auth: {
      getUser: async (jwt: string) =>
        sessions[jwt] ? { data: { user: { id: sessions[jwt] } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } },
    },
  };
}

// ─── Fixture ─────────────────────────────────────────────────────────────────

let db: Db;
let r: SeededRental;
let slug: string;
const sessions: Record<string, string> = {};
let client: ReturnType<typeof pgliteClient>;

/** A member of staff with a session token. */
async function staff(token: string, tenantId: string | null, opts: Parameters<typeof seedStaff>[2] = {}, grant?: "editor" | "viewer") {
  const id = await seedStaff(db, tenantId, opts);
  sessions[token] = (await db.one<any>(`SELECT auth_user_id FROM app_users WHERE id = $1`, [id]))!.auth_user_id;
  if (grant) await db.q(`INSERT INTO manager_permissions (app_user_id, tab_key, access_level) VALUES ($1, 'payments', $2)`, [id, grant]);
  return id;
}

function call(body: unknown, token: string | null, slugs: string | null = slug) {
  const req = new Request("http://localhost/payment-reallocate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return handlePaymentReallocate(req, { createAdminClient: () => client, tenantSlugs: slugs }).then(async (res) => ({
    status: res.status,
    body: (await res.json()) as any,
  }));
}

beforeAll(async () => {
  db = await cloneDatabase();
  // Not in the harness schema; the live table's shape (permissions.ts / update-manager-permissions).
  await db.exec(`CREATE TABLE manager_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_user_id uuid NOT NULL, tab_key text NOT NULL,
    access_level text NOT NULL CHECK (access_level IN ('viewer', 'editor')));`);
  r = await seedRental(db, {
    charges: [
      { category: "Tax", amountCents: 30000, dueDate: "2026-10-02" },
      { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
    ],
  });
  slug = (await db.one<any>(`SELECT slug FROM tenants WHERE id = $1`, [r.tenantId]))!.slug;
  await staff("head", r.tenantId, { role: "head_admin" });
  await staff("admin", r.tenantId, { role: "admin" });
  await staff("mgr-editor", r.tenantId, { role: "manager" }, "editor");
  await staff("mgr-viewer", r.tenantId, { role: "manager" }, "viewer");
  await staff("mgr-none", r.tenantId, { role: "manager" });
  await staff("ops", r.tenantId, { role: "ops" });
  await staff("viewer", r.tenantId, { role: "viewer" });
  await staff("inactive", r.tenantId, { role: "admin", active: false });
  await staff("super", null, { role: "admin", superAdmin: true });
  const elsewhere = await seedRental(db, {});
  await staff("stranger", elsewhere.tenantId, { role: "head_admin" });
  client = pgliteClient(db, sessions);
}, 120_000);
afterAll(async () => db?.close());

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("payment-reallocate edge function — moving a payment end to end", () => {
  it("moves 100.00 from Tax to Fine for a head admin and returns the audit id with before and after", async () => {
    const pid = await insertCompletedPayment(db, r, 30000);
    const res = await call(
      { action: "reallocate", paymentId: pid, reason: "customer asked", note: "call 10-06",
        targets: [{ chargeEntryId: r.chargeIds[0], amountCents: 20000 }, { chargeEntryId: r.chargeIds[1], amountCents: 10000 }] },
      "head",
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.before.applications.map((a: any) => a.applied_cents)).toEqual([30000]);
    expect(res.body.after.applications.map((a: any) => [a.category, a.applied_cents])).toEqual([["Tax", 20000], ["Fine", 10000]]);
    expect(await applications(db, pid)).toEqual({ [r.chargeIds[0]]: 20000, [r.chargeIds[1]]: 10000 });
    const audit = await db.one<any>(`SELECT reason, note, created_by FROM payment_allocation_changes WHERE id = $1`, [res.body.auditId]);
    const head = await db.one<any>(`SELECT id FROM app_users WHERE auth_user_id = $1`, [sessions.head]);
    // WHO is the token's own app user, never anything in the body.
    expect(audit).toEqual({ reason: "customer asked", note: "call 10-06", created_by: head!.id });
  });

  it("recomputes a drifted charge and lists the history of the bill, newest first", async () => {
    const x = await seedRental(db, { tenantId: r.tenantId, charges: [{ category: "Other", amountCents: 5000, dueDate: "2026-10-02" }] });
    await db.q(`UPDATE ledger_entries SET remaining_amount = 0 WHERE id = $1`, [x.chargeIds[0]]);
    const options = await call({ action: "reconcile_options", rentalId: x.rentalId }, "viewer");
    expect(options.status).toBe(200);
    expect(options.body.options.charges.map((c: any) => c.problem)).toEqual(["settled_without_payment"]);

    const res = await call({ action: "recompute_charge", chargeEntryId: x.chargeIds[0], reason: "reconcile" }, "admin");
    expect(res.status).toBe(200);
    expect([res.body.before.remaining_cents, res.body.after.remaining_cents]).toEqual([0, 5000]);
    expect(await remainingCents(db, x.chargeIds[0])).toBe(5000);

    const again = await call({ action: "recompute_charge", chargeEntryId: x.chargeIds[0], reason: "reconcile" }, "admin");
    expect(again).toEqual({ status: 409, body: { code: "not_drifted", error: expect.stringMatching(/^This charge already ties out/) } });

    const history = await call({ action: "history", rentalId: x.rentalId }, "ops");
    expect(history.status).toBe(200);
    expect(history.body.changes.map((c: any) => [c.kind, c.charge_entry_id])).toEqual([["recompute_remaining", x.chargeIds[0]]]);
  });
});

describe("payment-reallocate edge function — who may do what", () => {
  // An over-placed request: an allowed caller reaches the SQL (422 over_allocation);
  // a refused caller never does.
  let pid: string;
  let y: SeededRental;
  beforeAll(async () => {
    y = await seedRental(db, { tenantId: r.tenantId, charges: [{ category: "Rental", amountCents: 1000, dueDate: "2026-10-02" }] });
    pid = await insertCompletedPayment(db, y, 1000);
  });
  const overPlace = () => ({ action: "reallocate", paymentId: pid, reason: "x", targets: [{ chargeEntryId: y.chargeIds[0], amountCents: 999999 }] });

  it("lets head_admin, admin, a manager with editor access to payments and a super admin move money; refuses everyone else", async () => {
    const got: Record<string, number> = {};
    for (const who of ["head", "admin", "mgr-editor", "super", "mgr-viewer", "mgr-none", "ops", "viewer", "inactive", "stranger", "nobody"]) {
      got[who] = (await call(overPlace(), who === "nobody" ? null : who)).status;
    }
    expect(got).toEqual({
      head: 422, admin: 422, "mgr-editor": 422, super: 422,
      "mgr-viewer": 403, "mgr-none": 403, ops: 403, viewer: 403, inactive: 403, stranger: 403, nobody: 401,
    });
  });

  it("refuses a token that is not a user (the public anon key has no user)", async () => {
    expect((await call(overPlace(), "anon-key-jwt")).status).toBe(401);
  });

  it("lets any staff of the company read the reconcile options, except a manager with no access to payments", async () => {
    const got: Record<string, number> = {};
    for (const who of ["head", "ops", "viewer", "mgr-viewer", "mgr-none", "stranger"]) {
      got[who] = (await call({ action: "reconcile_options", rentalId: y.rentalId }, who)).status;
    }
    expect(got).toEqual({ head: 200, ops: 200, viewer: 200, "mgr-viewer": 200, "mgr-none": 403, stranger: 403 });
  });

  it("acts for a member of staff with accounts in two companies in the company the payment belongs to", async () => {
    const other = await seedRental(db, {});
    // Same auth user, a second app_users row as a viewer elsewhere.
    await db.q(
      `INSERT INTO app_users (auth_user_id, email, role, tenant_id) VALUES ($1, 'dual@example.test', 'viewer', $2)`,
      [sessions.head, other.tenantId],
    );
    expect((await call(overPlace(), "head")).status).toBe(422);
  });

  it("serves northwind only unless configured: another company gets 403 not_enabled", async () => {
    const res = await call(overPlace(), "head", null);
    expect(res).toEqual({ status: 403, body: { code: "not_enabled", error: "Reconciliation is not available for this company yet." } });
    expect(servesTenant("northwind", null)).toBe(true);
    expect(servesTenant("NorthWind", "acme, northwind")).toBe(true);
    expect(servesTenant("acme", null)).toBe(false);
  });
});

describe("payment-reallocate edge function — the refusals an operator sees", () => {
  it("passes the SQL sentence through with the status its code means", async () => {
    const z = await seedRental(db, {
      tenantId: r.tenantId,
      charges: [
        { category: "Tax", amountCents: 30000, dueDate: "2026-10-02" },
        { category: "Fine", amountCents: 15000, dueDate: "2026-10-05" },
      ],
    });
    const pid = await insertCompletedPayment(db, z, 30000);
    const stranger = await seedRental(db, { tenantId: r.tenantId, charges: [{ category: "Fine", amountCents: 100, dueDate: "2026-10-05" }] });
    const hold = (await db.one<{ id: string }>(
      `INSERT INTO payments (customer_id, rental_id, tenant_id, amount, remaining_amount, payment_date, status, capture_status)
       VALUES ($1, $2, $3, 50, 50, '2026-10-02', 'Pending', 'requires_capture') RETURNING id`,
      [z.customerId, z.rentalId, z.tenantId],
    ))!.id;
    const move = (paymentId: string, targets: [string, number][]) =>
      call({ action: "reallocate", paymentId, reason: "x", targets: targets.map(([chargeEntryId, amountCents]) => ({ chargeEntryId, amountCents })) }, "head");

    expect(await move(pid, [[z.chargeIds[0], 20000], [z.chargeIds[1], 15000]])).toEqual({
      status: 422,
      body: { code: "over_allocation", error: "This payment can place at most 300.00 (300.00 received), and the amounts add up to 350.00" },
    });
    expect((await move(pid, [[stranger.chargeIds[0], 100]])).body.code).toBe("charge_not_eligible");
    expect((await move(pid, [[z.chargeIds[0], 30000]])).body).toMatchObject({ code: "no_change" });
    expect(await move(hold, [[z.chargeIds[0], 50]])).toMatchObject({ status: 409, body: { code: "payment_not_captured" } });
    expect(await move("00000000-0000-4000-8000-000000000000", [[z.chargeIds[0], 50]])).toMatchObject({ status: 404, body: { code: "not_found" } });
    // Nothing above changed the payment.
    expect(await applications(db, pid)).toEqual({ [z.chargeIds[0]]: 30000 });
  });

  it("refuses a malformed body before any lookup: 400 with the field named", () => {
    const bad = (body: unknown) => {
      try {
        parseRequest(body);
        return "ok";
      } catch (e: any) {
        return `${e.status} ${e.message}`;
      }
    };
    const P = "11111111-1111-4111-8111-111111111111";
    const C = "22222222-2222-4222-8222-222222222222";
    expect(bad({ action: "reallocate", paymentId: P, reason: "x", targets: [{ chargeEntryId: C, amount: 100 }] }))
      .toBe('400 targets[0] has an unknown field "amount" — money is amountCents (integer cents).');
    expect(bad({ action: "reallocate", paymentId: P, reason: "x", targets: [{ chargeEntryId: C, amountCents: 10.5 }] }))
      .toBe("400 targets[0].amountCents must be a positive whole number of cents.");
    expect(bad({ action: "reallocate", paymentId: P, reason: "x", targets: [{ chargeEntryId: C, amountCents: 1 }, { chargeEntryId: C.toUpperCase(), amountCents: 2 }] }))
      .toBe("400 A charge is listed twice — give each charge one amount.");
    expect(bad({ action: "reallocate", paymentId: P, reason: " ", targets: [] })).toBe("400 Say why (a reason is required).");
    expect(bad({ action: "history", rentalId: P, paymentId: P })).toBe("400 Give exactly one of rentalId or paymentId.");
    expect(bad({ action: "delete_everything" })).toBe("400 Unknown action 'delete_everything'.");
    expect(bad({ action: "reallocate", paymentId: P, reason: "x", targets: [] })).toBe("ok");
  });

  it("says the database update is missing (503) rather than failing obscurely when the functions are not applied", () => {
    expect(mapRpcError({ code: "PGRST202", message: "Could not find the function" }).status).toBe(503);
    expect(mapRpcError({ code: "42883", message: "function payment_reallocate does not exist" }).status).toBe(503);
    expect(mapRpcError({ code: "40P01", message: "deadlock detected" })).toMatchObject({ status: 409, body: { code: "concurrent_change" } });
    expect(mapRpcError({ code: "XX000", message: "boom" })).toMatchObject({ status: 500, body: { code: "unexpected" } });
    expect(mapRpcError({ code: "P0001", message: "write_failed: payment x was not updated — nothing was changed" }))
      .toEqual({ status: 500, body: { code: "write_failed", error: "Payment x was not updated — nothing was changed" } });
  });
});

describe("payment-reallocate edge function — its RPCs match the SQL signatures", () => {
  it("passes exactly the parameter names each function takes, and every one without a default", async () => {
    const src = readFileSync(path.join(REPO_ROOT, "supabase/functions/payment-reallocate/core.ts"), "utf8");
    const calls = [...src.matchAll(/\.rpc\(\s*"([a-z_]+)"\s*,\s*\{([\s\S]*?)\}\s*\)/g)].map((m) => ({
      fn: m[1],
      keys: [...m[2].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((k) => k[1]),
    }));
    expect(calls.map((c) => c.fn).sort()).toEqual(["bill_reconcile_options", "charge_recompute_remaining", "payment_reallocate"]);
    const problems: string[] = [];
    for (const c of calls) {
      const p = await db.one<{ args: string[]; nargs: number; ndefaults: number }>(
        `SELECT proargnames args, pronargs nargs, pronargdefaults ndefaults FROM pg_proc WHERE proname = $1`,
        [c.fn],
      );
      const inputs = p!.args.slice(0, p!.nargs);
      for (const k of c.keys) if (!inputs.includes(k)) problems.push(`${c.fn}: unknown ${k}`);
      for (const k of inputs.slice(0, p!.nargs - p!.ndefaults)) if (!c.keys.includes(k)) problems.push(`${c.fn}: omits ${k}`);
    }
    expect(problems).toEqual([]);
  });
});
