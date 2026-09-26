/**
 * adjust-customer-balance — the offline contract.
 *
 * Driven through the real handler (`handleAdjustCustomerBalance` in core.ts)
 * with a recording fake of the service-role client. Nothing reaches Supabase.
 *
 * 1. v1 is UNCHANGED. The Edit Balance dialog's request shape goes through the
 *    frozen copy of the handler as it stood at 61f877d1
 *    (fixtures/adjust-customer-balance-v1-original.ts) and through core.ts,
 *    and both must answer every request identically — same status, same body,
 *    same writes. The expected payload for the ordinary cases is also written
 *    out by hand, so a change to BOTH could not pass either.
 * 2. v2 — any body with `kind` or `reverses_id` — calls exactly one SQL
 *    function with exactly the arguments below, takes WHO from the caller's
 *    token (never the body), and turns the function's refusals into statuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAdjustCustomerBalance, isV2Request } from "@fn/adjust-customer-balance/core.ts";
import { makeOriginalHandler } from "./fixtures/adjust-customer-balance-v1-original";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const RENTAL = "44444444-4444-4444-8444-444444444444";
const EXTENSION = "55555555-5555-4555-8555-555555555555";
const CHARGE = "66666666-6666-4666-8666-666666666666";
const PAYMENT = "77777777-7777-4777-8777-777777777777";
const ADJ = "88888888-8888-4888-8888-888888888888";
const APP_USER = "99999999-9999-4999-8999-999999999999";
const AUTH_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/* ── the recording fake ─────────────────────────────────────────────────── */

type Filter = [string, string, unknown];
interface Op {
  table: string;
  action: "select" | "insert";
  columns?: string;
  payload?: any;
  filters: Filter[];
  terminal: "single" | "maybeSingle" | null;
  returning?: string;
}

interface State {
  ops: Op[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
  tokens: string[];
  customer: any;
  customerError: any;
  insertError: any;
  authUserId: string | null;
  appUser: any;
  grants: any[];
  rpcResult: { data: any; error: any };
}

let state: State;
const fresh = (): State => ({
  ops: [],
  rpcs: [],
  tokens: [],
  customer: { id: CUSTOMER, tenant_id: TENANT },
  customerError: null,
  insertError: null,
  authUserId: AUTH_USER,
  appUser: { id: APP_USER, tenant_id: TENANT, role: "admin", is_active: true, is_super_admin: false },
  grants: [],
  rpcResult: { data: null, error: null },
});

function respond(op: Op): { data: any; error: any } {
  if (op.table === "customers") return { data: state.customerError ? null : state.customer, error: state.customerError };
  if (op.table === "app_users") return { data: state.appUser, error: null };
  if (op.table === "manager_permissions") return { data: state.grants, error: null };
  if (op.table === "ledger_entries" && op.action === "insert") {
    if (state.insertError) return { data: null, error: state.insertError };
    return { data: { id: "le-new", ...op.payload }, error: null };
  }
  return { data: null, error: null };
}

function builder(table: string) {
  const op: Op = { table, action: "select", filters: [], terminal: null };
  const run = () => {
    state.ops.push(op);
    return Promise.resolve(respond(op));
  };
  const b: any = {
    select(cols?: string) {
      if (op.action === "select") op.columns = cols;
      else op.returning = cols ?? "*";
      return b;
    },
    insert(payload: any) {
      op.action = "insert";
      op.payload = payload;
      return b;
    },
    eq(col: string, val: unknown) {
      op.filters.push([col, "eq", val]);
      return b;
    },
    maybeSingle() {
      op.terminal = "maybeSingle";
      return run();
    },
    single() {
      op.terminal = "single";
      return run();
    },
    then(res: any, rej: any) {
      return run().then(res, rej);
    },
  };
  return b;
}

const fakeClient = () => ({
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Record<string, unknown>) => {
    state.rpcs.push({ fn, args });
    return Promise.resolve(state.rpcResult);
  },
  auth: {
    getUser: (jwt: string) => {
      state.tokens.push(jwt);
      return Promise.resolve(
        state.authUserId ? { data: { user: { id: state.authUserId } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } },
      );
    },
  },
});

const clientsMade: string[][] = [];
const original = makeOriginalHandler(
  (url: string, key: string) => {
    clientsMade.push([url, key]);
    return fakeClient();
  },
  { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" },
);
const current = (req: Request) => handleAdjustCustomerBalance(req, { createAdminClient: () => fakeClient() as any });

const post = (body: unknown, token: string | null = "user-jwt") =>
  new Request("https://fn.local/adjust-customer-balance", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function run(handler: (r: Request) => Promise<Response>, req: Request) {
  state = fresh();
  applySetup?.(state);
  const res = await handler(req);
  const text = await res.text();
  return {
    status: res.status,
    body: text === "ok" ? "ok" : JSON.parse(text),
    cors: res.headers.get("Access-Control-Allow-Origin"),
    ops: state.ops,
    rpcs: state.rpcs,
    tokens: state.tokens,
  };
}

let applySetup: ((s: State) => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:30:00.000Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  applySetup = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── 1. v1: identical to the frozen original ────────────────────────────── */

const V1_CASES: { name: string; body: unknown; setup?: (s: State) => void; token?: string | null }[] = [
  { name: "increase, rounded to cents", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 12.345, direction: "increase", reason: "  Late return fee  " } },
  { name: "decrease on the account", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 30, direction: "decrease", reason: "Goodwill" } },
  { name: "decrease scoped to a rental and extension", body: { customerId: CUSTOMER, tenantId: TENANT, amount: "25.5", direction: "decrease", reason: "x", rentalId: RENTAL, extensionId: EXTENSION } },
  { name: "reason longer than 500 is cut", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "r".repeat(700) } },
  { name: "no token at all (v1 never asked for one)", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x" }, token: null },
  { name: "missing customerId", body: { tenantId: TENANT, amount: 1, direction: "increase", reason: "x" } },
  { name: "missing tenantId", body: { customerId: CUSTOMER, amount: 1, direction: "increase", reason: "x" } },
  { name: "bad direction", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "up", reason: "x" } },
  { name: "zero amount", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 0, direction: "increase", reason: "x" } },
  { name: "negative amount", body: { customerId: CUSTOMER, tenantId: TENANT, amount: -5, direction: "increase", reason: "x" } },
  { name: "non-numeric amount", body: { customerId: CUSTOMER, tenantId: TENANT, amount: "abc", direction: "increase", reason: "x" } },
  { name: "blank reason", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "   " } },
  { name: "customer lookup error", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x" }, setup: (s) => (s.customerError = { message: "db down" }) },
  { name: "customer not found", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x" }, setup: (s) => (s.customer = null) },
  { name: "customer of another tenant", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x" }, setup: (s) => (s.customer = { id: CUSTOMER, tenant_id: OTHER_TENANT }) },
  { name: "insert error", body: { customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x" }, setup: (s) => (s.insertError = { message: "unique violation" }) },
  { name: "a null body", body: "null" },
  { name: "not JSON", body: "{nope" },
];

describe("v1 — the Edit Balance dialog's contract is unchanged", () => {
  it.each(V1_CASES)("$name: identical to the frozen original", async ({ body, setup, token }) => {
    applySetup = setup ?? null;
    const before = await run(original, post(body, token === undefined ? "user-jwt" : token));
    applySetup = setup ?? null;
    const after = await run(current, post(body, token === undefined ? "user-jwt" : token));
    expect(after).toEqual(before);
    // v1 never reads the token, never looks up staff, never calls a SQL function.
    expect(after.tokens).toEqual([]);
    expect(after.rpcs).toEqual([]);
    expect(after.ops.map((o) => o.table).filter((t) => t !== "customers" && t !== "ledger_entries")).toEqual([]);
  });

  it("OPTIONS preflight is identical", async () => {
    const pre = () => new Request("https://fn.local/adjust-customer-balance", { method: "OPTIONS" });
    const a = await original(pre());
    const b = await current(pre());
    expect([b.status, await b.text(), b.headers.get("Access-Control-Allow-Headers")]).toEqual([a.status, await a.text(), a.headers.get("Access-Control-Allow-Headers")]);
  });

  it("the ordinary increase, written out by hand", async () => {
    const out = await run(current, post({ customerId: CUSTOMER, tenantId: TENANT, amount: 12.345, direction: "increase", reason: "  Late return fee  " }));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, entryId: "le-new", direction: "increase", amount: 12.35, signedAmount: 12.35 });
    const insert = out.ops.find((o) => o.action === "insert")!;
    expect(insert.table).toBe("ledger_entries");
    expect(insert.payload).toEqual({
      customer_id: CUSTOMER, tenant_id: TENANT, rental_id: null, vehicle_id: null, type: "Charge", category: "Adjustment",
      amount: 12.35, remaining_amount: 12.35, entry_date: "2026-09-26", due_date: "2026-09-26", reference: "Late return fee",
    });
  });

  it("the scoped decrease, written out by hand", async () => {
    const out = await run(current, post({ customerId: CUSTOMER, tenantId: TENANT, amount: "25.5", direction: "decrease", reason: "x", rentalId: RENTAL, extensionId: EXTENSION }));
    expect(out.body).toEqual({ ok: true, entryId: "le-new", direction: "decrease", amount: 25.5, signedAmount: -25.5 });
    expect(out.ops.find((o) => o.action === "insert")!.payload).toMatchObject({ rental_id: RENTAL, extension_id: EXTENSION, amount: -25.5, remaining_amount: -25.5 });
  });

  it("the frozen original really was exercised (it built its client from the environment)", () => {
    expect(clientsMade.length).toBeGreaterThan(0);
    expect(clientsMade[0]).toEqual(["https://x.supabase.co", "svc"]);
  });

  it("nothing the v1 dialog sends is a v2 request", () => {
    expect(isV2Request({ customerId: CUSTOMER, tenantId: TENANT, amount: 1, direction: "increase", reason: "x", rentalId: RENTAL, extensionId: EXTENSION })).toBe(false);
    expect(isV2Request(null)).toBe(false);
    expect(isV2Request({ kind: "goodwill" })).toBe(true);
    expect(isV2Request({ reverses_id: ADJ })).toBe(true);
  });
});

/* ── 2. v2: one SQL function per operation ──────────────────────────────── */

const BASE = { customerId: CUSTOMER, tenantId: TENANT };
const WHO = { p_tenant_id: TENANT, p_customer_id: CUSTOMER, p_created_by: APP_USER };

describe("v2 — the three operations and undo", () => {
  it("(a) a charge was wrong → balance_adjust with the signed amount and the charge", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: ADJ, ledger_entry_id: "le-1", kind: "charge_correction", amount: -40, reference: "Weekly rate · ADJ-88888888" }, error: null });
    const out = await run(current, post({ ...BASE, kind: "charge_correction", amount: 40, direction: "decrease", reason_code: "wrong_rate", note: "Weekly rate", charge_id: CHARGE, rentalId: RENTAL }));
    expect(out.rpcs).toEqual([{
      fn: "balance_adjust",
      args: { ...WHO, p_kind: "charge_correction", p_amount: -40, p_reason_code: "wrong_rate", p_note: "Weekly rate", p_rental_id: RENTAL, p_extension_id: null, p_target_charge_id: CHARGE },
    }]);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true, kind: "charge_correction", adjustmentId: ADJ, entryId: "le-1", paymentId: null, reversesId: null, signedAmount: -40, reference: "Weekly rate · ADJ-88888888" });
    expect(out.tokens).toEqual(["user-jwt"]);
    // no direct ledger write from the edge function on the v2 path
    expect(out.ops.some((o) => o.action === "insert")).toBe(false);
  });

  it("a payment request → balance_adjust, positive, no charge", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: ADJ, ledger_entry_id: "le-2", kind: "charge_correction", amount: 300 }, error: null });
    const out = await run(current, post({ ...BASE, kind: "charge_correction", amount: 300, direction: "increase", reason_code: "payment_request", note: "Parking ticket" }));
    expect(out.rpcs[0]).toEqual({
      fn: "balance_adjust",
      args: { ...WHO, p_kind: "charge_correction", p_amount: 300, p_reason_code: "payment_request", p_note: "Parking ticket", p_rental_id: null, p_extension_id: null, p_target_charge_id: null },
    });
  });

  it("(c) goodwill → balance_adjust with a NEGATIVE amount (direction defaults to decrease)", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: ADJ, ledger_entry_id: "le-3", kind: "goodwill", amount: -30 }, error: null });
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 30, reason_code: "late_delivery", note: "Car was late" }));
    expect(out.rpcs[0].args).toMatchObject({ p_kind: "goodwill", p_amount: -30, p_target_charge_id: null });
    expect(out.body.signedAmount).toBe(-30);
  });

  it("goodwill can never raise the balance", async () => {
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 30, direction: "increase", reason_code: "goodwill", note: "x" }));
    expect(out.status).toBe(400);
    expect(out.rpcs).toEqual([]);
  });

  it("(b) off-platform payment → balance_record_off_platform_payment with the payment id", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: ADJ, payment_id: PAYMENT, kind: "off_platform_payment", amount: -200 }, error: null });
    const out = await run(current, post({ ...BASE, kind: "off_platform_payment", payment_id: PAYMENT, reason_code: "paid_in_person", note: "Cash at the desk" }));
    expect(out.rpcs).toEqual([{ fn: "balance_record_off_platform_payment", args: { ...WHO, p_payment_id: PAYMENT, p_reason_code: "paid_in_person", p_note: "Cash at the desk" } }]);
    expect(out.body).toMatchObject({ ok: true, paymentId: PAYMENT, entryId: null, signedAmount: -200 });
  });

  it("undo → balance_adjustment_reverse", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: "new", reverses_id: ADJ, ledger_entry_id: "le-4", kind: "goodwill", amount: 30 }, error: null });
    const out = await run(current, post({ ...BASE, kind: "goodwill", reverses_id: ADJ, reason_code: "entered_by_mistake", note: "Wrong customer" }));
    expect(out.rpcs).toEqual([{ fn: "balance_adjustment_reverse", args: { ...WHO, p_adjustment_id: ADJ, p_reason_code: "entered_by_mistake", p_note: "Wrong customer" } }]);
    expect(out.body).toMatchObject({ ok: true, reversesId: ADJ, signedAmount: 30 });
  });

  it("WHO comes from the token, never the body", async () => {
    applySetup = (s) => (s.rpcResult = { data: { adjustment_id: ADJ, ledger_entry_id: "le", kind: "goodwill", amount: -1 }, error: null });
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 1, reason_code: "goodwill", note: "x", created_by: "someone-else", p_created_by: "someone-else" }));
    expect(out.rpcs[0].args.p_created_by).toBe(APP_USER);
  });
});

describe("v2 — who may", () => {
  const body = { ...BASE, kind: "goodwill", amount: 1, reason_code: "goodwill", note: "x" };
  const ok = (s: State) => (s.rpcResult = { data: { adjustment_id: ADJ, ledger_entry_id: "le", kind: "goodwill", amount: -1 }, error: null });

  it.each([
    ["no token", null, null, 401],
    ["a token that is not a user", "anon-key", (s: State) => (s.authUserId = null), 401],
    ["no staff row", "user-jwt", (s: State) => (s.appUser = null), 403],
    ["a deactivated account", "user-jwt", (s: State) => (s.appUser.is_active = false), 403],
    ["another business's staff", "user-jwt", (s: State) => (s.appUser.tenant_id = OTHER_TENANT), 403],
    ["a viewer", "user-jwt", (s: State) => (s.appUser.role = "viewer"), 403],
    ["a manager with no payments grant", "user-jwt", (s: State) => (s.appUser.role = "manager"), 403],
    ["a manager with viewer on payments", "user-jwt", (s: State) => { s.appUser.role = "manager"; s.grants = [{ tab_key: "payments", access_level: "viewer" }]; }, 403],
  ] as const)("%s → %i and no SQL call", async (_n, token, setup, status) => {
    applySetup = (s) => {
      ok(s);
      setup?.(s);
    };
    const out = await run(current, post(body, token));
    expect(out.status).toBe(status);
    expect(out.rpcs).toEqual([]);
  });

  it.each([
    ["a manager with editor on payments", (s: State) => { s.appUser.role = "manager"; s.grants = [{ tab_key: "payments", access_level: "editor" }]; }],
    ["a super admin with no tenant", (s: State) => { s.appUser.tenant_id = null; s.appUser.is_super_admin = true; }],
    ["an ops user", (s: State) => (s.appUser.role = "ops")],
  ] as const)("%s → allowed", async (_n, setup) => {
    applySetup = (s) => {
      ok(s);
      setup(s);
    };
    const out = await run(current, post(body));
    expect(out.status).toBe(200);
    expect(out.rpcs).toHaveLength(1);
  });

  it("a customer of another tenant → 404 before any SQL call", async () => {
    applySetup = (s) => (s.customer = { id: CUSTOMER, tenant_id: OTHER_TENANT });
    const out = await run(current, post(body));
    expect(out.status).toBe(404);
    expect(out.rpcs).toEqual([]);
  });
});

describe("v2 — validation and the SQL function's answers", () => {
  it.each([
    [{ kind: "nope", amount: 1, reason_code: "x", note: "x" }, 400],
    [{ kind: "goodwill", amount: 1, note: "x" }, 400],
    [{ kind: "goodwill", amount: 1, reason_code: "goodwill", note: "   " }, 400],
    [{ kind: "goodwill", amount: 0, reason_code: "goodwill", note: "x" }, 400],
    [{ kind: "charge_correction", amount: 5, reason_code: "wrong_rate", note: "x" }, 400], // no direction
    [{ kind: "charge_correction", amount: 5, direction: "decrease", reason_code: "wrong_rate", note: "x", charge_id: "not-an-id" }, 400],
    [{ kind: "off_platform_payment", reason_code: "paid_in_person", note: "x" }, 400], // no payment_id
    [{ kind: "goodwill", reverses_id: "nope", reason_code: "other", note: "x" }, 400],
  ])("%j → %i, no SQL call", async (extra, status) => {
    const out = await run(current, post({ ...BASE, ...extra }));
    expect(out.status).toBe(status);
    expect(out.rpcs).toEqual([]);
  });

  it.each([
    ["P0001", 400],
    ["22023", 400],
    ["42501", 403],
    ["P0002", 404],
    ["23505", 409],
    ["XX000", 500],
  ])("SQLSTATE %s → %i, message passed through verbatim", async (code, status) => {
    applySetup = (s) => (s.rpcResult = { data: null, error: { code, message: "That is more than the charge: at most 12.00 can be credited against it." } });
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 1, reason_code: "goodwill", note: "x" }));
    expect(out.status).toBe(status);
    expect(out.body).toEqual({ error: "That is more than the charge: at most 12.00 can be credited against it." });
  });

  it("the function missing (migration not applied) → 503 in plain words", async () => {
    applySetup = (s) => (s.rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.balance_adjust" } });
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 1, reason_code: "goodwill", note: "x" }));
    expect(out.status).toBe(503);
    expect(out.body.error).toMatch(/not switched on yet/);
  });

  it("an unconfirmed write is an error, never a success", async () => {
    applySetup = (s) => (s.rpcResult = { data: null, error: null });
    const out = await run(current, post({ ...BASE, kind: "goodwill", amount: 1, reason_code: "goodwill", note: "x" }));
    expect(out.status).toBe(500);
  });
});
