// The world the referral end-to-end test runs in: the REAL edge functions, a
// real Postgres (PGlite, in-process) with the real migrations, and emulated
// PostgREST, GoTrue, Stripe and Resend behind a patched fetch. Nothing leaves
// the machine except module downloads, and no key or secret is needed.
//
// Existing tables are stand-ins generated from the admin app's Supabase types
// (the production schema as last generated): same columns, required columns
// NOT NULL, timestamps as timestamptz. The referral tables come from the
// migrations themselves.
// deno-lint-ignore-file no-explicit-any
import { PGlite } from "npm:@electric-sql/pglite@0.5.8";
import { makeRest, type RestLog } from "./postgrest_emulator.ts";
import { StripeEmu } from "./stripe_emulator.ts";

const REPO = new URL("../../../../", import.meta.url);
// Normalised to \n: a Windows checkout (core.autocrlf) has \r\n line endings.
const repoFile = (path: string) => Deno.readTextFileSync(new URL(path, REPO)).replace(/\r\n/g, "\n");

export const SERVICE_KEY = "service-role-emu-key";
export const ANON_KEY = "anon-emu-key";
export const UAE_TEST = "sk_test_emu_uae";
export const UK_TEST = "sk_test_emu_uk";

for (const [k, v] of Object.entries({
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: ANON_KEY,
  STRIPE_UAE_TEST_SECRET_KEY: UAE_TEST,
  STRIPE_SUBSCRIPTION_TEST_SECRET_KEY: UK_TEST,
  STRIPE_UAE_TEST_PUBLISHABLE_KEY: "pk_test_emu0000000000000000",
  SIGNUP_STRIPE_MODE: "test",
  RESEND_API_KEY: "re_emu",
  PUBLIC_SITE_URL: "https://drive-247.com",
  PORTAL_ROOT_DOMAIN: "portal.drive-247.com",
})) Deno.env.set(k, v);

// ── stand-ins for the existing tables the referral functions touch ─────────
const STANDIN_TABLES = [
  "tenants", "app_users", "tenant_subscriptions", "tenant_subscription_invoices",
  "subscription_links", "subscription_plans", "contact_requests", "notifications",
  "signup_plans", "signup_attempts", "login_attempts", "audit_logs", "email_notification_prefs",
];
/** uuid where the referral tables' foreign keys (or joins) need it. */
const UUID_COLS = new Set([
  "tenants.id", "app_users.id", "app_users.tenant_id", "app_users.auth_user_id",
  "tenant_subscriptions.tenant_id", "tenant_subscription_invoices.tenant_id",
  "subscription_links.tenant_id", "notifications.tenant_id",
]);
const TIMESTAMP_NAMES = new Set([
  "current_period_end", "current_period_start", "trial_end", "period_start", "period_end",
  "invoice_date", "due_date", "next_payment_attempt", "cancel_at", "ended_at", "canceled_at",
]);

function standinsSql(): string {
  const types = repoFile("apps/admin/src/integrations/supabase/types.ts");
  const block = (table: string, kind: "Row" | "Insert") => {
    const re = kind === "Row"
      ? new RegExp(`\\n      ${table}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}`)
      : new RegExp(`\\n      ${table}: \\{\\n        Row: \\{\\n[\\s\\S]*?\\n        \\}\\n        Insert: \\{\\n([\\s\\S]*?)\\n        \\}`);
    const m = types.match(re);
    if (!m) throw new Error(`no ${kind} type for ${table} in the admin app's Supabase types`);
    return m[1];
  };
  const sqlType = (ts: string) => {
    const base = ts.replace(/\|\s*null/g, "").trim();
    if (base.endsWith("[]")) {
      const inner = base.slice(0, -2).replace(/[() ]/g, "");
      return ({ string: "text[]", number: "numeric[]", boolean: "boolean[]" } as Record<string, string>)[inner] ?? "jsonb";
    }
    if (base === "number") return "numeric";
    if (base === "boolean") return "boolean";
    if (base === "Json" || base === "unknown") return "jsonb";
    return "text";
  };

  const out: string[] = [];
  for (const table of STANDIN_TABLES) {
    const required = new Set([...block(table, "Insert").matchAll(/^\s+([a-z_0-9]+): /gm)].map(m => m[1]));
    const lines = block(table, "Row").split("\n");
    const cols: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s+([a-z_0-9]+): (.*)$/);
      if (!m) continue;
      const name = m[1];
      let ts = m[2];
      while (ts.trimEnd().endsWith("|") && i + 1 < lines.length) ts += " " + lines[++i].trim();
      const nullable = ts.includes("| null") || ts.trim().startsWith("|");
      let type = UUID_COLS.has(`${table}.${name}`) ? "uuid" : sqlType(ts);
      if (type === "text" && (name.endsWith("_at") || TIMESTAMP_NAMES.has(name))) type = "timestamptz";
      if (name === "id") {
        cols.push(type === "numeric" ? "  id bigserial PRIMARY KEY" : "  id uuid PRIMARY KEY DEFAULT gen_random_uuid()");
        continue;
      }
      const def = name === "created_at" || name === "updated_at" ? " DEFAULT now()" : "";
      const notNull = required.has(name) && !nullable ? " NOT NULL" : "";
      cols.push(`  ${name} ${type}${notNull}${def}`);
    }
    out.push(`CREATE TABLE public.${table} (\n${cols.join(",\n")}\n);`);
  }
  return out.join("\n\n");
}

// ── database ────────────────────────────────────────────────────────────────
export const db = new PGlite();
await db.waitReady;
await db.exec(`SET TIME ZONE 'UTC';`);
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`);
await db.exec(standinsSql());
await db.exec(`
  CREATE FUNCTION public.get_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  -- The real settle function flips the link to paid; enough for the success path.
  CREATE FUNCTION public.settle_subscription_link(p_link_id uuid, p_source text, p_stripe_subscription_id text)
  RETURNS boolean LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE public.subscription_links SET status = 'paid', paid_at = now(), paid_source = p_source,
      stripe_subscription_id = p_stripe_subscription_id WHERE id = p_link_id AND status = 'pending';
    RETURN EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE stripe_subscription_id = p_stripe_subscription_id);
  END $$;
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET command = EXCLUDED.command RETURNING jobid $$;
  INSERT INTO cron.job (jobname, schedule, command) VALUES ('reconcile-subscriptions', '17 * * * *',
    'SELECT net.http_post(url := ''x/functions/v1/reconcile-subscriptions'', body := ''{"dryRun":false}''::jsonb)');
`);
for (const f of [
  "20260922120000_platform_promo_codes.sql",
  "20260922120100_promo_code_on_links_and_leads.sql",
  "20260922120200_schedule_referral_engine.sql",
]) {
  await db.exec(repoFile(`supabase/migrations/${f}`));
}

export const restLog: RestLog[] = [];
const rest = makeRest(db as any, restLog);

// ── auth (GoTrue) ──────────────────────────────────────────────────────────
export type AuthUser = { id: string; email: string; app_metadata: Record<string, any>; user_metadata: Record<string, any> };
const usersByToken = new Map<string, AuthUser>();
const usersById = new Map<string, AuthUser>();
export function addAuthUser(token: string, user: AuthUser) {
  usersByToken.set(token, user);
  usersById.set(user.id, user);
}

async function gotrue(req: Request, path: string): Promise<Response> {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const view = (u: AuthUser) => ({ ...u, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString() });
  if (path === "/auth/v1/user" && req.method === "GET") {
    const u = usersByToken.get((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, ""));
    return u ? json(view(u)) : json({ code: 401, error_code: "bad_jwt", msg: "invalid JWT" }, 401);
  }
  const m = path.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
  if (m) {
    const u = usersById.get(m[1]);
    if (!u) return json({ code: 404, msg: "User not found" }, 404);
    if (req.method === "GET") return json(view(u));
    if (req.method === "PUT") {
      const body = await req.json();
      if (body.app_metadata) u.app_metadata = { ...u.app_metadata, ...body.app_metadata }; // GoTrue merges shallowly
      if (body.user_metadata) u.user_metadata = { ...u.user_metadata, ...body.user_metadata };
      return json(view(u));
    }
  }
  return json({ msg: `auth emulator: ${req.method} ${path} not handled` }, 404);
}

// ── Stripe, Resend ─────────────────────────────────────────────────────────
export const stripe = new StripeEmu();
export const emails: Array<{ to: unknown; subject: string; text?: string }> = [];

// ── edge functions: capture Deno.serve, call the handlers in-process ────────
type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
let loading = "";
Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: (a: any, b?: any) => {
    handlers.set(loading, typeof a === "function" ? a : typeof b === "function" ? b : a.handler);
    return { finished: Promise.resolve(), shutdown: async () => {}, ref() {}, unref() {}, addr: { hostname: "emu", port: 0 } };
  },
});

// EdgeRuntime.waitUntil: background work the test can wait for.
const background: Promise<unknown>[] = [];
(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { background.push(p); } };
export async function settleBackground() {
  while (background.length) await Promise.allSettled(background.splice(0));
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
  const req = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.protocol === "file:") return realFetch(input, init);
  if (url.host === "supabase.test") {
    if (url.pathname.startsWith("/rest/v1/")) return rest(req);
    if (url.pathname.startsWith("/auth/v1/")) return gotrue(req, url.pathname);
    if (url.pathname.startsWith("/functions/v1/")) {
      const h = handlers.get(url.pathname.slice("/functions/v1/".length).split("/")[0]);
      return h ? h(req) : new Response(JSON.stringify({ error: "function not loaded" }), { status: 404 });
    }
  }
  if (url.host === "api.stripe.com") return stripe.handle(req);
  if (url.host === "api.resend.com") {
    const body = await req.json();
    emails.push({ to: body.to, subject: body.subject, text: body.text });
    return new Response(JSON.stringify({ id: `email_${emails.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`referral test: unexpected network call ${req.method} ${req.url}`);
};

for (const name of [
  "promo-code-lookup", "subscription-link-v2", "referral-engine", "tenant-referrals",
  "admin-promo-codes", "apply-subscription-discount-v2", "signup-payment-intent-v2",
]) {
  loading = name;
  await import(new URL(`supabase/functions/${name}/index.ts`, REPO).href);
  if (!handlers.has(name)) throw new Error(`${name} did not register a handler`);
}

/** Call a function the way the gateway would. */
export async function call(
  name: string,
  opts: { token?: string; body?: unknown; method?: string; query?: string; form?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }
  const res = await handlers.get(name)!(new Request(`http://supabase.test/functions/v1/${name}${opts.query ?? ""}`, { method: opts.method ?? "POST", headers, body }));
  const text = res.status === 303 ? "" : await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}

export async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  return (await db.query(sql, params)).rows as any[];
}
