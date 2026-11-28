/**
 * eval-kit.mjs — what every feature eval is built from.
 *
 * An eval proves the Behaviour statements of ONE spec against the STAGING
 * project. One `statement()` per statement, named by the statement's number.
 * See .claude/skills/eval.
 *
 *   import { statement, cleanup, run, sql, rest, fn, signIn, equal, ok } from "../../eval-kit.mjs";
 *
 *   statement("02.5", "A renter with no date of birth gets no discount", async () => {
 *     const [row] = await sql(`select public.birthday_discount_cents(...) as cents`);
 *     equal(row.cents, 0);
 *   });
 *
 *   await run(import.meta.url);
 *
 * Rules the kit enforces: staging only (it refuses the production project),
 * and whatever a statement creates is removed by `cleanup()`, pass or fail.
 * It never opens a browser.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROD_REF = "hviqoaokxvlancmftwuo";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function credential(name) {
  if (process.env[name]) return process.env[name];
  const file = join(ROOT, ".staging-credentials.local");
  if (!existsSync(file)) return undefined;
  const hits = [...readFileSync(file, "utf8").matchAll(new RegExp(`^${name}=(.+)$`, "gm"))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}

export const STAGING_REF = credential("STAGING_REF");
export const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const ANON = credential("STAGING_ANON_KEY");
const SERVICE = credential("STAGING_SERVICE_ROLE_KEY");

/** The two staging logins every machine has: the northwind head admin and the super admin. */
export const LOGINS = {
  portal: { email: credential("STAGING_LOGIN_EMAIL"), password: credential("STAGING_LOGIN_PASSWORD") },
  admin: { email: credential("STAGING_ADMIN_EMAIL"), password: credential("STAGING_ADMIN_PASSWORD") },
};

function setup() {
  if (!STAGING_REF || !ANON || !SERVICE) throw new Error(".staging-credentials.local is missing or incomplete (repo root). Ask Ghulam for it.");
  if (STAGING_REF === PROD_REF) throw new Error("This points at PRODUCTION. Evals run on staging only.");
}

/* ------------------------------- talking to staging ------------------------------- */

let pgClient = null;

/** Without a token: the staging database itself, through the IPv4 pooler, with STAGING_DB_PASS. */
async function sqlDirect(query) {
  const pass = credential("STAGING_DB_PASS");
  if (!pass) throw new Error("Set SUPABASE_ACCESS_TOKEN (or STAGING_DB_PASS) to run SQL in an eval.");
  for (let attempt = 1; ; attempt++) {
    try {
      return await sqlDirectOnce(query, pass);
    } catch (e) {
      // A dropped connection is not an answer: reconnect and try again. A SQL error is.
      const dropped = /ECONNRESET|Connection terminated|not queryable|ETIMEDOUT|EPIPE/i.test(String(e?.message || e));
      if (!dropped || attempt >= 4) throw e;
      pgClient = null;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function sqlDirectOnce(query, pass) {
  if (!pgClient) {
    const { default: pg } = await import("pg");
    // A plain date stays the text it is (the Management API does the same).
    pg.types.setTypeParser(1082, (v) => v);
    pg.types.setTypeParser(1182, pg.types.getTypeParser(1009));
    pgClient = new pg.Client({
      host: credential("STAGING_POOLER_HOST") || "aws-1-eu-west-2.pooler.supabase.com",
      port: 5432,
      user: `postgres.${STAGING_REF}`,
      password: pass,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    });
    // Without a listener a dropped connection crashes the eval before its clean-up runs.
    pgClient.on("error", () => { pgClient = null; });
    await pgClient.connect();
  }
  try {
    const res = await pgClient.query(query);
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    // The same shape as the Management API: rows of plain JSON values.
    return JSON.parse(JSON.stringify(last?.rows ?? []));
  } catch (e) {
    const msg = String(e?.message || e);
    if (/ECONNRESET|Connection terminated|not queryable|ETIMEDOUT|EPIPE/i.test(msg)) throw e;
    throw new Error(`SQL failed: ${msg.slice(0, 400)}`);
  }
}

/** Run SQL on the staging database. Uses SUPABASE_ACCESS_TOKEN, else STAGING_DB_PASS. */
export async function sql(query) {
  setup();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return sqlDirect(query);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ query }),
    }).catch(() => null);
    if (res?.ok) return res.json();
    const text = res ? await res.text() : "connection dropped";
    // A dropped connection or a busy API is not an answer. A SQL error is.
    if (attempt < 4 && (!res || res.status >= 500 || res.status === 429)) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    throw new Error(`SQL failed: ${text.slice(0, 400)}`);
  }
}

/** Sign in as a staging user. Returns the access token to pass as `as`. */
export async function signIn({ email, password }) {
  setup();
  const res = await fetch(`${STAGING_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Could not sign in as ${email}: ${body.error_description || body.msg || res.status}`);
  return body.access_token;
}

/** Who a call is made as: "anon" (a visitor), "service" (the server), or a token from signIn(). */
function headersFor(as = "anon") {
  setup();
  const bearer = as === "anon" ? ANON : as === "service" ? SERVICE : as;
  return { apikey: as === "service" ? SERVICE : ANON, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" };
}

/**
 * A table call through the API, the way an app makes it, so row-level security applies.
 * Returns { status, data }. It does not throw on a refusal: a refusal is often the thing proved.
 */
export async function rest(path, { method = "GET", body, as = "anon", headers = {} } = {}) {
  const res = await fetch(`${STAGING_URL}/rest/v1/${path}`, {
    method,
    headers: { ...headersFor(as), Prefer: "return=representation", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** Call an edge function. Returns { status, data }. */
export async function fn(slug, body, { as = "anon", headers = {} } = {}) {
  const res = await fetch(`${STAGING_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { ...headersFor(as), ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/* ----------------------------------- checking ----------------------------------- */

const show = (v) => (typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v));

/** Fails unless the two are the same (deep, by value). */
export function equal(actual, expected, what = "value") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

/** Fails unless the condition holds. */
export function ok(condition, what) {
  if (!condition) throw new Error(what);
}

/* ---------------------------------- the eval itself ---------------------------------- */

const statements = [];
const cleanups = [];

/** One Behaviour statement from the spec. `id` is its number there, e.g. "02.5". */
export function statement(id, text, check) {
  if (!/^\d{2}\.\d+$/.test(id)) throw new Error(`"${id}" is not a statement number like 02.5`);
  if (statements.some((s) => s.id === id)) throw new Error(`Statement ${id} is checked twice`);
  statements.push({ id, text, check });
}

let cleaningUp = null;
async function runCleanups() {
  let cleaned = true;
  for (const undo of cleanups.splice(0).reverse()) {
    try { await undo(); } catch (e) { cleaned = false; console.error(`  clean-up failed: ${e?.message || e}`); }
  }
  return cleaned;
}
// A crash still removes what the eval made, then exits as a failure.
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, async (e) => {
    console.error(`  CRASH  ${e?.stack || e}`);
    cleaningUp ??= runCleanups();
    await cleaningUp;
    process.exit(1);
  });
}

/** Remove what the eval created. Runs at the end, pass or fail, newest first. */
export function cleanup(undo) {
  cleanups.push(undo);
}

/** Run every statement, clean up, print the result. Call it last: `await run(import.meta.url)`. */
export async function run(metaUrl) {
  const name = basename(fileURLToPath(metaUrl));
  const results = [];
  try {
    setup();
    for (const s of statements) {
      try {
        await s.check();
        results.push({ id: s.id, text: s.text, pass: true });
      } catch (e) {
        results.push({ id: s.id, text: s.text, pass: false, why: String(e?.message || e) });
      }
    }
  } catch (e) {
    results.push({ id: "00.0", text: "The eval could start", pass: false, why: String(e?.message || e) });
  }
  cleaningUp ??= runCleanups();
  const cleaned = await cleaningUp;
  for (const r of results) {
    console.log(`  ${r.pass ? "pass" : "FAIL"}  ${r.id}  ${r.text}`);
    if (!r.pass) console.log(`        ${r.why}`);
  }
  if (!cleaned) console.log("  FAIL  clean-up: something this eval created is still on staging");
  if (pgClient) await pgClient.end().catch(() => {});
  const passed = results.filter((r) => r.pass).length;
  console.log(`${name}: ${passed}/${results.length} statements proved`);
  // One machine-readable line for scripts/eval.mjs.
  console.log(`EVAL_RESULT ${JSON.stringify({ file: name, cleaned, results })}`);
  process.exit(passed === results.length && cleaned ? 0 : 1);
}
