/**
 * edge-harness — run a REAL Deno edge function offline, against a recording
 * fake of everything outside it.
 *
 * WHY: the functions under test are Deno modules that import from
 * https://esm.sh and https://deno.land, which no Node loader resolves. Vitest's
 * `vi.mock` DOES intercept those specifiers when given a factory, so a test file
 * mocks the six remote modules this family uses (the list is REMOTE_SPECIFIERS
 * below) with the stand-ins exported here, and then imports the function's own
 * index.ts. Its top-level `serve(...)` / `Deno.serve(...)` hands the handler to
 * this harness, and the test calls it with real Request objects.
 *
 * Everything the handler touches is recorded in ONE ordered list of ops:
 *   db      every PostgREST call (select / insert / update / upsert / delete)
 *   rpc     every SQL function call
 *   stripe  every Stripe SDK call (resource.method, args)
 *   fetch   every outbound HTTP call (other functions, Resend, Bonzah…)
 *   invoke  every supabase.functions.invoke
 * Reads are recorded too, so a test can prove the guard ran BEFORE the first
 * read of the row the request names; `effects()` filters to the side effects.
 *
 * THE DIFFERENTIAL CHECK. `loadWithoutGuard` loads the same function with every
 * block between `[staff-auth:begin]` and `[staff-auth:end]` cut out — the
 * function exactly as it was before the guard (verified against 68e90fbd when
 * the guard was added). Driving both with the same authorised request and the
 * same fake world, and requiring identical responses and identical effects,
 * proves the guard is invisible to every operator it lets through — for every
 * later version of the function too, not just the one it was written against.
 *
 * The fake answers a select on a table with `world.rows[table]` whatever the
 * filters: it does not model the database, it only has to answer both variants
 * the same way.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");

export const REMOTE_SPECIFIERS = [
  "https://esm.sh/@supabase/supabase-js@2.57.4",
  "https://esm.sh/@supabase/supabase-js@2.45.0",
  "https://esm.sh/@supabase/supabase-js@2",
  "https://deno.land/std@0.168.0/http/server.ts",
  "https://deno.land/std@0.190.0/http/server.ts",
  "https://esm.sh/stripe@14.21.0?target=deno",
] as const;

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
export const APP_USER = "99999999-9999-4999-8999-999999999999";
export const AUTH_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const ENV: Record<string, string> = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
  SUPABASE_ANON_KEY: "anon-key",
  STRIPE_TEST_SECRET_KEY: "sk_test_fake",
  STRIPE_LIVE_SECRET_KEY: "sk_live_fake",
  STRIPE_TEST_PUBLISHABLE_KEY: "pk_test_fake",
  STRIPE_LIVE_PUBLISHABLE_KEY: "pk_live_fake",
  RESEND_API_KEY: "re_fake",
  PORTAL_URL: "https://portal.test",
  BOOKING_URL: "https://booking.test",
};

/* ── the world ──────────────────────────────────────────────────────────── */

export interface Op {
  kind: "db" | "rpc" | "stripe" | "fetch" | "invoke";
  table?: string;
  action?: "select" | "insert" | "update" | "upsert" | "delete";
  columns?: string;
  payload?: unknown;
  filters?: [string, ...unknown[]][];
  terminal?: string | null;
  name?: string;
  args?: unknown;
  /** Which key the client was built with — service role, anon, or a user's. */
  clientKey?: string;
}

export interface World {
  ops: Op[];
  tokens: string[];
  /** GoTrue: the user a token resolves to (null = not a user). */
  authUserId: string | null;
  getUserThrows: boolean;
  appUser: Record<string, unknown> | null;
  grants: { tab_key: string; access_level: string }[];
  /** select results, per table (any filters). */
  rows: Record<string, unknown[]>;
  env: Record<string, string>;
}

export function freshWorld(): World {
  return {
    ops: [],
    tokens: [],
    authUserId: AUTH_USER,
    getUserThrows: false,
    appUser: { id: APP_USER, tenant_id: TENANT, role: "admin", is_active: true, is_super_admin: false },
    grants: [],
    rows: {},
    env: { ...ENV },
  };
}

interface Hooks {
  world: World;
  handler: ((req: Request) => Promise<Response> | Response) | null;
}
const g = globalThis as any;
const hooks: Hooks = (g.__moneyAuthHarness ??= { world: freshWorld(), handler: null });

export const world = (): World => hooks.world;
export function resetWorld(setup?: (w: World) => void): World {
  hooks.world = freshWorld();
  setup?.(hooks.world);
  return hooks.world;
}

/** Side effects only: every write, SQL call, Stripe call, HTTP call and invoke — no reads. */
export const effects = (ops: Op[]) => ops.filter((o) => o.kind !== "db" || o.action !== "select");
/** Everything except the staff check's own reads. */
export const withoutStaffReads = (ops: Op[]) =>
  ops.filter((o) => !(o.kind === "db" && (o.table === "app_users" || o.table === "manager_permissions")));

/* ── the supabase-js stand-in ───────────────────────────────────────────── */

function pickRows(op: Op): unknown[] {
  const w = hooks.world;
  if (op.table === "app_users") return w.appUser ? [w.appUser] : [];
  if (op.table === "manager_permissions") {
    const inFilter = op.filters?.find((f) => f[0] === "in:tab_key");
    const tabs = (inFilter?.[1] as string[] | undefined) ?? null;
    const eqTab = op.filters?.find((f) => f[0] === "eq:tab_key")?.[1] as string | undefined;
    return w.grants.filter((gr) => (tabs ? tabs.includes(gr.tab_key) : eqTab ? gr.tab_key === eqTab : true));
  }
  return (w.rows[op.table!] ?? []) as unknown[];
}

function answer(op: Op): { data: any; error: any; count?: number } {
  if (op.action === "select") {
    const rows = pickRows(op);
    if (op.terminal === "single") return rows.length ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "0 rows" } };
    if (op.terminal === "maybeSingle") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null, count: rows.length };
  }
  // writes: echo what was written, with an id, when the caller asks for it back
  const payload = Array.isArray(op.payload) ? op.payload[0] : op.payload;
  const echoed = { id: `${op.table}-new`, ...(payload && typeof payload === "object" ? payload : {}) };
  if (op.terminal === "single" || op.terminal === "maybeSingle") return { data: echoed, error: null };
  return { data: op.columns !== undefined ? [echoed] : null, error: null };
}

function builder(table: string, clientKey: string) {
  const op: Op = { kind: "db", table, action: "select", filters: [], terminal: null, clientKey };
  let recorded = false;
  const run = () => {
    if (!recorded) {
      hooks.world.ops.push(op);
      recorded = true;
    }
    return Promise.resolve(answer(op));
  };
  const b: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (res: any, rej: any) => run().then(res, rej);
        if (prop === "select") return (cols?: string) => {
          if (op.action === "select") op.columns = cols;
          else op.columns = cols ?? "*";
          return b;
        };
        if (prop === "insert" || prop === "update" || prop === "upsert") return (payload: unknown) => {
          op.action = prop;
          op.payload = payload;
          return b;
        };
        if (prop === "delete") return () => {
          op.action = "delete";
          return b;
        };
        if (prop === "single" || prop === "maybeSingle") return () => {
          op.terminal = prop;
          return run();
        };
        // every filter / modifier: record it, keep chaining
        return (...args: unknown[]) => {
          op.filters!.push([`${prop}:${String(args[0])}`, ...args.slice(1)]);
          return b;
        };
      },
    },
  );
  return b;
}

export function fakeClient(url: string, key: string, opts?: any) {
  const userAuth = opts?.global?.headers?.Authorization as string | undefined;
  const clientKey = userAuth ? `user:${userAuth.replace(/^Bearer\s+/i, "")}` : key;
  return {
    from: (table: string) => builder(table, clientKey),
    rpc: (name: string, args: unknown) => {
      hooks.world.ops.push({ kind: "rpc", name, args, clientKey });
      return Promise.resolve({ data: null, error: null });
    },
    auth: {
      getUser: (jwt?: string) => {
        const token = jwt ?? (userAuth ?? "").replace(/^Bearer\s+/i, "");
        hooks.world.tokens.push(token);
        if (hooks.world.getUserThrows) return Promise.reject(new Error("GoTrue unreachable"));
        const id = hooks.world.authUserId;
        return Promise.resolve(id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "invalid claim: missing sub claim" } });
      },
    },
    functions: {
      invoke: (name: string, init?: unknown) => {
        hooks.world.ops.push({ kind: "invoke", name, args: init, clientKey });
        return Promise.resolve({ data: { success: true }, error: null });
      },
    },
    storage: {
      from: (bucket: string) =>
        new Proxy({}, {
          get: (_t, method: string) => (...args: unknown[]) => {
            hooks.world.ops.push({ kind: "invoke", name: `storage:${bucket}.${method}`, args });
            return Promise.resolve({ data: null, error: null });
          },
        }),
    },
  };
}

export const supabaseJsModule = () => ({ createClient: fakeClient, SupabaseClient: class {} });

/* ── std/http serve and Stripe ──────────────────────────────────────────── */

export const stdServeModule = () => ({
  serve: (handler: any) => {
    hooks.handler = handler;
  },
});

function stripeResult(resource: string, method: string, args: unknown[]) {
  if (method === "list") return { data: [], has_more: false };
  const id = typeof args[0] === "string" ? (args[0] as string) : `${resource}_fake`;
  return {
    id,
    object: resource,
    status: "succeeded",
    amount: 0,
    amount_received: 0,
    currency: "usd",
    url: "https://checkout.stripe.test/session",
    payment_intent: "pi_fake",
    latest_charge: "ch_fake",
    client_secret: "secret_fake",
    metadata: {},
  };
}

class FakeStripe {
  constructor(_key: string, _opts?: unknown) {
    const make = (path: string[]): any =>
      new Proxy(function () {}, {
        get: (_t, prop: string) => (prop === "then" ? undefined : make([...path, prop])),
        apply: (_t, _this, args: unknown[]) => {
          const name = path.join(".");
          hooks.world.ops.push({ kind: "stripe", name, args });
          return Promise.resolve(stripeResult(path[0] ?? "", path[path.length - 1] ?? "", args));
        },
      });
    return make([]);
  }
}
export const stripeModule = () => ({ default: FakeStripe, Stripe: FakeStripe });

/* ── Deno, fetch, and loading a function ────────────────────────────────── */

let realFetch: typeof fetch | null = null;

/** Install Deno + fetch stand-ins. Call in beforeAll; undo with uninstallGlobals in afterAll. */
export function installGlobals() {
  g.Deno = {
    env: { get: (k: string) => hooks.world.env[k] },
    serve: (a: any, b?: any) => {
      hooks.handler = typeof a === "function" ? a : b;
    },
  };
  if (!realFetch) realFetch = g.fetch;
  g.fetch = (input: any, init?: any) => {
    hooks.world.ops.push({ kind: "fetch", name: String(input?.url ?? input), args: { method: init?.method ?? "GET", body: init?.body ?? null } });
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  };
}
export function uninstallGlobals() {
  delete g.Deno;
  if (realFetch) g.fetch = realFetch;
  realFetch = null;
}

export type Handler = (req: Request) => Promise<Response>;

/** Import a module whose top level registers a handler, and hand the handler back. */
export async function captureHandler(importer: () => Promise<unknown>): Promise<Handler> {
  hooks.handler = null;
  await importer();
  const h = hooks.handler;
  if (!h) throw new Error("the module registered no handler (serve / Deno.serve was never called)");
  return (req: Request) => Promise.resolve(h(req));
}

/** Cut every [staff-auth:begin] … [staff-auth:end] block (inclusive, whole lines). */
export function stripStaffAuth(src: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of src.split("\n")) {
    if (line.includes("[staff-auth:begin]")) {
      if (inside) throw new Error("nested [staff-auth:begin]");
      inside = true;
      continue;
    }
    if (line.includes("[staff-auth:end]")) {
      if (!inside) throw new Error("[staff-auth:end] without a begin");
      inside = false;
      continue;
    }
    if (!inside) out.push(line);
  }
  if (inside) throw new Error("unterminated [staff-auth:begin]");
  return out.join("\n");
}

export const readFunction = (fn: string) => readFileSync(join(FUNCTIONS_DIR, fn, "index.ts"), "utf8");

let tmpRoot: string | null = null;
/**
 * Load the function with its guard blocks cut out. The stripped copy is written
 * to a temp directory with its `../_shared/` imports pointed at the real files,
 * so it shares every other module with the guarded copy.
 */
export async function loadWithoutGuard(fn: string): Promise<Handler> {
  const stripped = stripStaffAuth(readFunction(fn)).replace(/(["'])\.\.\/_shared\//g, `$1${join(FUNCTIONS_DIR, "_shared")}/`);
  tmpRoot ??= mkdtempSync(join(tmpdir(), "money-auth-"));
  const dir = join(tmpRoot, fn);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "index.ts");
  writeFileSync(file, stripped);
  return captureHandler(() => import(/* @vite-ignore */ file));
}

/* ── requests ───────────────────────────────────────────────────────────── */

export const post = (fnName: string, body: unknown, token: string | null = "user-jwt") =>
  new Request(`https://fn.local/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

export async function call(handler: Handler, req: Request, setup?: (w: World) => void) {
  const w = resetWorld(setup);
  const res = await handler(req);
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, body, ops: w.ops, tokens: w.tokens };
}

/* ── the callers ────────────────────────────────────────────────────────── */

export type Setup = (w: World) => void;

/** Callers the staff check must refuse, with the status each gets. */
export const REFUSED: { who: string; token: string | null; setup?: Setup; status: number }[] = [
  { who: "no token at all", token: null, status: 401 },
  { who: "the public anon key as the bearer", token: "anon-key", status: 401 },
  { who: "the service-role key as the bearer", token: "svc-key", status: 401 },
  { who: "a token GoTrue does not recognise", token: "forged", setup: (w) => (w.authUserId = null), status: 401 },
  { who: "GoTrue unreachable (fails safe)", token: "user-jwt", setup: (w) => (w.getUserThrows = true), status: 401 },
  { who: "a booking-site renter (no staff row)", token: "user-jwt", setup: (w) => (w.appUser = null), status: 403 },
  { who: "a deactivated staff account", token: "user-jwt", setup: (w) => (w.appUser!.is_active = false), status: 403 },
  { who: "a viewer", token: "user-jwt", setup: (w) => (w.appUser!.role = "viewer"), status: 403 },
  { who: "a manager with no grant", token: "user-jwt", setup: (w) => (w.appUser!.role = "manager"), status: 403 },
  {
    who: "a manager with a VIEWER grant on every tab",
    token: "user-jwt",
    setup: (w) => {
      w.appUser!.role = "manager";
      w.grants = ["rentals", "payments", "fines", "customers", "invoices"].map((tab_key) => ({ tab_key, access_level: "viewer" }));
    },
    status: 403,
  },
];

/** Callers the staff check must let through (given the right manager tab). */
export const authorisedCallers = (managerTab: string): { who: string; setup: Setup }[] => [
  { who: "an admin", setup: () => {} },
  { who: "a head admin", setup: (w) => (w.appUser!.role = "head_admin") },
  { who: "an ops user", setup: (w) => (w.appUser!.role = "ops") },
  { who: "a super admin with no tenant", setup: (w) => { w.appUser!.tenant_id = null; w.appUser!.is_super_admin = true; } },
  { who: `a manager with editor on ${managerTab}`, setup: (w) => { w.appUser!.role = "manager"; w.grants = [{ tab_key: managerTab, access_level: "editor" }]; } },
];

/** Staff of another business. */
export const otherTenantStaff: Setup = (w) => (w.appUser!.tenant_id = OTHER_TENANT);
