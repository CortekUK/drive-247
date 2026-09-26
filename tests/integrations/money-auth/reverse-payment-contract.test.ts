/**
 * reverse-payment — the offline contract.
 *
 * Driven through the real handler (`handleReversePayment` in core.ts) with a
 * recording fake of the service-role client. Nothing reaches Supabase.
 *
 * 1. WHO MAY. The function used to verify nobody: with no config.toml block the
 *    gateway accepts any project JWT, including the public anon key in the
 *    booking bundle. Now every caller who is not active staff of the payment's
 *    own business, with a role that may edit payments, is refused BEFORE any
 *    write — and, unless they are staff at all, before the payment is even
 *    read.
 * 2. A REFUNDED PAYMENT IS NOT REVERSIBLE. The frozen original reversed a
 *    manually refunded payment, reopening its charges while the refund stood.
 * 3. EVERYTHING ELSE IS UNCHANGED for an authorised caller: the same requests
 *    go through the frozen copy of the handler as it stood at 68e90fbd
 *    (fixtures/reverse-payment-original.ts) and through core.ts, once per kind
 *    of caller the portal shows the Reverse button to, and both must answer
 *    identically with identical writes. The ordinary reversal's writes are also
 *    written out by hand, so a change to BOTH could not pass either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleReversePayment, isRefunded } from "@fn/reverse-payment/core.ts";
import { makeOriginalReversePayment } from "./fixtures/reverse-payment-original";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const RENTAL = "44444444-4444-4444-8444-444444444444";
const PAYMENT = "77777777-7777-4777-8777-777777777777";
const APP_USER = "99999999-9999-4999-8999-999999999999";
const AUTH_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHARGE_A = "c0000000-0000-4000-8000-00000000000a";
const CHARGE_B = "c0000000-0000-4000-8000-00000000000b";

/* ── the recording fake ─────────────────────────────────────────────────── */

type Filter = [string, string, unknown];
interface Op {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  columns?: string;
  payload?: any;
  filters: Filter[];
  terminal: "single" | "maybeSingle" | null;
}

interface State {
  ops: Op[];
  tokens: string[];
  authUserId: string | null;
  getUserThrows: boolean;
  appUser: any;
  appUserError: any;
  grants: any[];
  payment: any;
  paymentError: any;
  customerTenant: string | null;
  applications: any[];
  applicationsError: any;
  charges: Record<string, any>;
  pnl: any[];
  paymentLedgerEntry: any;
  paymentUpdateError: any;
}

let state: State;
const manualPayment = () => ({
  id: PAYMENT,
  tenant_id: TENANT,
  customer_id: CUSTOMER,
  rental_id: RENTAL,
  vehicle_id: null,
  amount: 150,
  status: "Applied",
  payment_method: "Cash",
  stripe_payment_intent_id: null,
  stripe_checkout_session_id: null,
  square_payment_id: null,
  refund_status: null,
  refund_reason: null,
  refund_amount: null,
});
const fresh = (): State => ({
  ops: [],
  tokens: [],
  authUserId: AUTH_USER,
  getUserThrows: false,
  appUser: { id: APP_USER, tenant_id: TENANT, role: "admin", is_active: true, is_super_admin: false },
  appUserError: null,
  grants: [],
  payment: manualPayment(),
  paymentError: null,
  customerTenant: TENANT,
  applications: [
    { id: "pa-1", charge_entry_id: CHARGE_A, amount_applied: 100 },
    { id: "pa-2", charge_entry_id: CHARGE_B, amount_applied: 50 },
  ],
  applicationsError: null,
  charges: {
    [CHARGE_A]: { id: CHARGE_A, remaining_amount: 0, amount: 100, type: "Charge" },
    [CHARGE_B]: { id: CHARGE_B, remaining_amount: 25, amount: 75, type: "Charge" },
  },
  pnl: [{ id: "pnl-1" }, { id: "pnl-2" }],
  paymentLedgerEntry: { id: "le-pay", amount: -150 },
  paymentUpdateError: null,
});

const filterValue = (op: Op, col: string) => op.filters.find(([c]) => c === col)?.[2];

function respond(op: Op): { data: any; error: any } {
  const t = op.table;
  if (t === "app_users") return { data: state.appUserError ? null : state.appUser, error: state.appUserError };
  if (t === "manager_permissions") {
    const tabs = (filterValue(op, "tab_key") as string[] | undefined) ?? [];
    return { data: state.grants.filter((g) => tabs.includes(g.tab_key) && g.access_level === "editor"), error: null };
  }
  if (t === "customers" && op.action === "select") return { data: state.customerTenant === undefined ? null : { tenant_id: state.customerTenant }, error: null };
  if (t === "payments" && op.action === "select") {
    if (state.paymentError || !state.payment) return { data: null, error: state.paymentError ?? { message: "0 rows" } };
    return { data: state.payment, error: null };
  }
  if (t === "payments" && op.action === "update") return { data: null, error: state.paymentUpdateError };
  if (t === "payment_applications" && op.action === "select") {
    return { data: state.applicationsError ? null : state.applications, error: state.applicationsError };
  }
  if (t === "ledger_entries" && op.action === "select") {
    if (filterValue(op, "type") === "Payment") return { data: state.paymentLedgerEntry, error: null };
    const charge = state.charges[filterValue(op, "id") as string];
    return charge ? { data: charge, error: null } : { data: null, error: { message: "0 rows" } };
  }
  if (t === "pnl_entries" && op.action === "select") return { data: state.pnl, error: null };
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
      op.columns = cols;
      return b;
    },
    insert(payload: any) {
      op.action = "insert";
      op.payload = payload;
      return b;
    },
    update(payload: any) {
      op.action = "update";
      op.payload = payload;
      return b;
    },
    delete() {
      op.action = "delete";
      return b;
    },
    eq(col: string, val: unknown) {
      op.filters.push([col, "eq", val]);
      return b;
    },
    in(col: string, vals: unknown) {
      op.filters.push([col, "in", vals]);
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
  auth: {
    getUser: (jwt: string) => {
      state.tokens.push(jwt);
      if (state.getUserThrows) return Promise.reject(new Error("GoTrue unreachable"));
      return Promise.resolve(
        state.authUserId ? { data: { user: { id: state.authUserId } }, error: null } : { data: { user: null }, error: { message: "invalid claim: missing sub claim" } },
      );
    },
  },
});

const ENV: Record<string, string> = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", SUPABASE_ANON_KEY: "anon-key" };
const clientsMade: string[][] = [];
const original = makeOriginalReversePayment((url, key) => {
  clientsMade.push([url, key]);
  return fakeClient();
}, ENV);
const current = (req: Request) => handleReversePayment(req, { createAdminClient: () => fakeClient(), env: (k) => ENV[k] });

const post = (body: unknown, token: string | null = "user-jwt") =>
  new Request("https://fn.local/reverse-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

let applySetup: ((s: State) => void) | null = null;

async function run(handler: (r: Request) => Promise<Response>, req: Request) {
  state = fresh();
  applySetup?.(state);
  const res = await handler(req);
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cors: res.headers.get("Access-Control-Allow-Origin"),
    ops: state.ops,
    tokens: state.tokens,
  };
}

const writes = (ops: Op[]) => ops.filter((o) => o.action !== "select");
const moneyOps = (ops: Op[]) => ops.filter((o) => o.table !== "app_users" && o.table !== "manager_permissions");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T15:30:00.000Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  applySetup = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const BODY = { paymentId: PAYMENT, reason: "Recorded against the wrong customer" };

/* ── 1. who may ─────────────────────────────────────────────────────────── */

describe("reverse-payment — who may reverse a payment", () => {
  it("the frozen original reversed for ANYONE: no token → 200 and every write (the hole being closed)", async () => {
    const out = await run(original, post(BODY, null));
    expect(out.status).toBe(200);
    expect(writes(out.ops).length).toBeGreaterThan(0);
  });

  it.each([
    ["no token at all", null, null, 401],
    ["the public anon key as the bearer (refused by value; GoTrue is never asked)", "anon-key", null, 401],
    ["the service-role key as the bearer", "svc", null, 401],
    ["a token GoTrue does not recognise as a user", "forged", (s: State) => (s.authUserId = null), 401],
    ["GoTrue unreachable (fails safe)", "user-jwt", (s: State) => (s.getUserThrows = true), 401],
    ["a booking-site renter (a user with no staff row)", "user-jwt", (s: State) => (s.appUser = null), 403],
    ["a deactivated staff account", "user-jwt", (s: State) => (s.appUser.is_active = false), 403],
    ["a viewer", "user-jwt", (s: State) => (s.appUser.role = "viewer"), 403],
    ["a staff row with no role", "user-jwt", (s: State) => (s.appUser.role = null), 403],
    ["a manager with no grant", "user-jwt", (s: State) => (s.appUser.role = "manager"), 403],
    ["a manager with VIEWER on payments", "user-jwt", (s: State) => { s.appUser.role = "manager"; s.grants = [{ tab_key: "payments", access_level: "viewer" }]; }, 403],
    ["a manager with editor on rentals only", "user-jwt", (s: State) => { s.appUser.role = "manager"; s.grants = [{ tab_key: "rentals", access_level: "editor" }]; }, 403],
    ["a staff lookup that fails (fails safe)", "user-jwt", (s: State) => (s.appUserError = { message: "db down" }), 500],
  ] as const)("%s → %i, and the payment is never even read", async (_n, token, setup, status) => {
    applySetup = setup;
    const out = await run(current, post(BODY, token));
    expect(out.status).toBe(status);
    expect(out.body.success).toBe(false);
    expect(typeof out.body.error).toBe("string");
    expect(out.ops.filter((o) => o.table !== "app_users" && o.table !== "manager_permissions")).toEqual([]);
    if (token === null || token === "anon-key" || token === "svc") expect(out.tokens).toEqual([]);
  });

  it("staff of ANOTHER business → 403, with nothing written", async () => {
    applySetup = (s) => (s.appUser.tenant_id = OTHER_TENANT);
    const out = await run(current, post(BODY));
    expect(out.status).toBe(403);
    expect(writes(out.ops)).toEqual([]);
  });

  it("a payment with no tenant is judged by its customer's tenant: another business → 403, nothing written", async () => {
    applySetup = (s) => {
      s.payment.tenant_id = null;
      s.customerTenant = OTHER_TENANT;
    };
    const out = await run(current, post(BODY));
    expect(out.status).toBe(403);
    expect(writes(out.ops)).toEqual([]);
  });

  it("a payment with no tenant whose customer is ours → reversed", async () => {
    applySetup = (s) => (s.payment.tenant_id = null);
    const out = await run(current, post(BODY));
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
  });

  it("a payment with no tenant and no findable customer → 403 for staff (no tenant, no check, no write)", async () => {
    applySetup = (s) => {
      s.payment.tenant_id = null;
      s.customerTenant = null;
    };
    const out = await run(current, post(BODY));
    expect(out.status).toBe(403);
    expect(writes(out.ops)).toEqual([]);
  });

  it("the token checked is the caller's own, and the staff row is read before the payment", async () => {
    const out = await run(current, post(BODY));
    expect(out.tokens).toEqual(["user-jwt"]);
    expect(out.ops[0]).toMatchObject({ table: "app_users", filters: [["auth_user_id", "eq", AUTH_USER]] });
    expect(out.ops[1]).toMatchObject({ table: "payments", action: "select" });
  });
});

/* ── 2. a refunded payment ──────────────────────────────────────────────── */

describe("reverse-payment — a refunded payment is not reversible", () => {
  it.each([
    ["a manual refund recorded as refund_amount", (s: State) => (s.payment.refund_amount = 40)],
    ["refund_amount as the string PostgREST returns for numeric", (s: State) => (s.payment.refund_amount = "12.50")],
    ["status Refunded", (s: State) => (s.payment.status = "Refunded")],
    ["status Partial Refund", (s: State) => (s.payment.status = "Partial Refund")],
  ] as const)("%s → 400 and nothing written — where the frozen original reversed it", async (_n, setup) => {
    applySetup = setup;
    const before = await run(original, post(BODY));
    expect(before.status, "the defect: the original reversed a refunded payment").toBe(200);
    expect(writes(before.ops).length).toBeGreaterThan(0);

    applySetup = setup;
    const after = await run(current, post(BODY));
    expect(after.status).toBe(400);
    expect(after.body).toEqual({
      success: false,
      error: "Cannot reverse a payment that has been refunded, in full or in part. Reversing it would ask the customer to pay again for money already returned.",
    });
    expect(writes(after.ops)).toEqual([]);
  });

  it.each([
    [{ refund_amount: null, status: "Applied" }, false],
    [{ refund_amount: 0, status: "Applied" }, false],
    [{ refund_amount: "0.00", status: "Partial" }, false],
    [{ refund_amount: undefined, status: "Credit" }, false],
    [{ refund_amount: 0.01, status: "Applied" }, true],
    [{ refund_amount: null, status: "Refunded" }, true],
    [{ refund_amount: null, status: "Partial Refund" }, true],
  ])("isRefunded(%j) = %s", (p, expected) => {
    expect(isRefunded(p)).toBe(expected);
  });
});

/* ── 3. unchanged for every authorised caller ───────────────────────────── */

const AUTHORISED_CALLERS: { who: string; as: (s: State) => void }[] = [
  { who: "an admin", as: () => {} },
  { who: "a head admin", as: (s) => (s.appUser.role = "head_admin") },
  { who: "an ops user", as: (s) => (s.appUser.role = "ops") },
  { who: "a super admin with no tenant", as: (s) => { s.appUser.tenant_id = null; s.appUser.is_super_admin = true; } },
  { who: "a manager with editor on payments", as: (s) => { s.appUser.role = "manager"; s.grants = [{ tab_key: "payments", access_level: "editor" }]; } },
];

const SCENARIOS: { name: string; body: unknown; setup?: (s: State) => void }[] = [
  { name: "the ordinary reversal: two allocations, P&L rows, a payment ledger row", body: BODY },
  { name: "no allocations, no P&L, no payment ledger row", body: BODY, setup: (s) => { s.applications = []; s.pnl = []; s.paymentLedgerEntry = null; } },
  { name: "a charge that can no longer be read is skipped", body: BODY, setup: (s) => delete s.charges[CHARGE_B] },
  { name: "missing paymentId", body: { reason: "x" } },
  { name: "blank reason", body: { paymentId: PAYMENT, reason: "   " } },
  { name: "payment not found", body: BODY, setup: (s) => (s.payment = null) },
  { name: "a Stripe card payment", body: BODY, setup: (s) => (s.payment.stripe_payment_intent_id = "pi_123") },
  { name: "a Square payment", body: BODY, setup: (s) => (s.payment.square_payment_id = "sq_123") },
  { name: "refund_status completed", body: BODY, setup: (s) => (s.payment.refund_status = "completed") },
  { name: "refund_status processing", body: BODY, setup: (s) => (s.payment.refund_status = "processing") },
  { name: "already reversed", body: BODY, setup: (s) => (s.payment.refund_reason = "[REVERSED] oops") },
  { name: "allocations could not be read", body: BODY, setup: (s) => (s.applicationsError = { message: "db down" }) },
  { name: "the payment update fails", body: BODY, setup: (s) => (s.paymentUpdateError = { message: "check violation" }) },
  { name: "not JSON", body: "{nope" },
];

describe("reverse-payment — unchanged for every authorised caller", () => {
  const matrix = AUTHORISED_CALLERS.flatMap((c) => SCENARIOS.map((sc) => ({ ...sc, who: c.who, as: c.as })));

  it.each(matrix)("$who · $name: identical to the frozen original", async ({ body, setup, as }) => {
    const both = (s: State) => {
      as(s);
      setup?.(s);
    };
    applySetup = both;
    const before = await run(original, post(body));
    applySetup = both;
    const after = await run(current, post(body));
    expect({ ...after, ops: moneyOps(after.ops), tokens: [] }).toEqual({ ...before, tokens: [] });
    expect(after.tokens).toEqual(["user-jwt"]);
  });

  it("OPTIONS preflight is identical and asks nobody who they are", async () => {
    const pre = () => new Request("https://fn.local/reverse-payment", { method: "OPTIONS" });
    state = fresh();
    const a = await original(pre());
    const b = await current(pre());
    expect([b.status, await b.text(), b.headers.get("Access-Control-Allow-Headers")]).toEqual([a.status, await a.text(), a.headers.get("Access-Control-Allow-Headers")]);
    expect(state.ops).toEqual([]);
  });

  it("the ordinary reversal, written out by hand", async () => {
    const out = await run(current, post(BODY));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      success: true,
      message: "Payment reversed successfully",
      details: { paymentId: PAYMENT, amount: 150, applicationsReversed: 2, reason: BODY.reason },
    });
    const w = writes(out.ops).map((o) => ({ table: o.table, action: o.action, payload: o.payload, filters: o.filters }));
    expect(w).toEqual([
      { table: "ledger_entries", action: "update", payload: { remaining_amount: 100, updated_at: "2026-09-26T15:30:00.000Z" }, filters: [["id", "eq", CHARGE_A]] },
      { table: "ledger_entries", action: "update", payload: { remaining_amount: 75, updated_at: "2026-09-26T15:30:00.000Z" }, filters: [["id", "eq", CHARGE_B]] },
      { table: "payment_applications", action: "delete", payload: undefined, filters: [["payment_id", "eq", PAYMENT]] },
      { table: "pnl_entries", action: "delete", payload: undefined, filters: [["payment_id", "eq", PAYMENT]] },
      {
        table: "ledger_entries",
        action: "insert",
        payload: {
          rental_id: RENTAL, customer_id: CUSTOMER, vehicle_id: null, tenant_id: TENANT, entry_date: "2026-09-26",
          type: "Adjustment", category: "Adjustment", amount: 150, remaining_amount: 0,
          reference: `Payment Reversal: ${BODY.reason}`, payment_id: PAYMENT,
        },
        filters: [],
      },
      {
        table: "payments",
        action: "update",
        payload: {
          status: "Reversed", remaining_amount: 0, refund_reason: `[REVERSED] ${BODY.reason}`,
          refund_processed_at: "2026-09-26T15:30:00.000Z", updated_at: "2026-09-26T15:30:00.000Z",
        },
        filters: [["id", "eq", PAYMENT]],
      },
    ]);
  });

  it("the frozen original really was exercised (it built its client from the environment)", () => {
    expect(clientsMade.length).toBeGreaterThan(0);
    expect(clientsMade[0]).toEqual(["https://x.supabase.co", "svc"]);
  });
});
