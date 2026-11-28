// feat-003 eval helpers. Lives in evals/lib/ so the runner does not run it as an eval.
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fn, rest, signIn, sql, LOGINS, STAGING_URL } from "../../../eval-kit.mjs";

export const NW = "6e5c544f-b374-451f-a662-360a634bff15";
export const RAY1 = { Origin: "https://northwind.portal.ray1.drive-247.com" };
export const TAG = `eval003-${Date.now().toString(36)}`;
export const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

export function cred(name) {
  if (process.env[name]) return process.env[name];
  const f = join(ROOT, ".staging-credentials.local");
  if (!existsSync(f)) return undefined;
  const hits = [...readFileSync(f, "utf8").matchAll(new RegExp(`^${name}=(.+)$`, "gm"))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}

// Starting a check saves the company's ticks; put them back as they were when the eval ends.
const [prefsBefore] = await sql(`select last_ticks from verification_tenant_prefs where tenant_id = '${NW}'`);
cleanup(() => prefsBefore
  ? sql(`update verification_tenant_prefs set last_ticks = '${"{" + prefsBefore.last_ticks.join(",") + "}"}' where tenant_id = '${NW}'`)
  : sql(`delete from verification_tenant_prefs where tenant_id = '${NW}'`));

let headAdmin;
export async function staff() {
  headAdmin ??= await signIn(LOGINS.portal);
  return headAdmin;
}

/** A Northwind customer made for one statement, removed afterwards with everything hanging off it. */
export async function customer(name = "Eval Renter", extra = {}) {
  const cols = { tenant_id: NW, name: `${name}`, type: "Individual", email: `${TAG}-${Math.random().toString(36).slice(2, 8)}@drive-247.test`, ...extra };
  const keys = Object.keys(cols);
  const [c] = await sql(`insert into customers (${keys.join(",")}) values (${keys.map((k) => q(cols[k])).join(",")}) returning id`);
  cleanup(async () => {
    await sql(`delete from verification_charges where customer_id = ${q(c.id)} or session_id in (select id from verification_sessions where customer_id = ${q(c.id)})`);
    await sql(`delete from audit_logs where entity_id = ${q(c.id)}`);
    await sql(`delete from customers where id = ${q(c.id)}`);
  });
  return c.id;
}

/** A temporary staff login with a role, at a company. Removed afterwards (audit rows first). */
export async function tempStaff(role, tenantId = NW, { customersEditor = false } = {}) {
  const service = cred("STAGING_SERVICE_ROLE_KEY");
  const email = `${TAG}-${role}-${Math.random().toString(36).slice(2, 6)}@drive-247.test`;
  const password = `Eval-${Math.random().toString(36).slice(2)}A1!`;
  const res = await fetch(`${STAGING_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await res.json();
  if (!user?.id) throw new Error(`could not make a ${role} login: ${JSON.stringify(user).slice(0, 120)}`);
  const [au] = await sql(`insert into app_users (auth_user_id, tenant_id, email, name, role, is_active) values (${q(user.id)}, ${q(tenantId)}, ${q(email)}, ${q(`Eval ${role}`)}, ${q(role)}, true) returning id`);
  if (customersEditor) await sql(`insert into manager_permissions (app_user_id, tab_key, access_level) values (${q(au.id)}, 'customers', 'editor')`);
  for (const p of ["privacy_policy", "terms_and_conditions"]) {
    await sql(`insert into policy_acceptances (app_user_id, policy_type, version) select ${q(au.id)}, ${q(p)}, coalesce((select ${p === "privacy_policy" ? "privacy_policy_version" : "terms_version"} from tenants where id = ${q(tenantId)}), '1') on conflict do nothing`).catch(() => {});
  }
  cleanup(async () => {
    await sql(`delete from audit_logs where actor_id = ${q(au.id)}`);
    await sql(`delete from manager_permissions where app_user_id = ${q(au.id)}`);
    await sql(`delete from policy_acceptances where app_user_id = ${q(au.id)}`).catch(() => {});
    await sql(`update verification_sessions set started_by = null where started_by = ${q(au.id)}`);
    await sql(`delete from app_users where id = ${q(au.id)}`);
    await fetch(`${STAGING_URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: { apikey: service, Authorization: `Bearer ${service}` } });
  });
  return signIn({ email, password });
}

export const verify = (action, body, as) => fn("verification-v2", { action, ...body }, { as, headers: RAY1 });
export const link = (action, body) => fn("verification-v2-link", { action, ...body });

/** Start a check and return { sessionId, token, link }. */
export async function startCheck(customerId, services = ["standard"], sentVia = "copy", as) {
  const r = await verify("start", { customerId, services, sentVia }, as ?? (await staff()));
  if (r.status !== 200) throw new Error(`start failed ${r.status} ${JSON.stringify(r.data)}`);
  return { sessionId: r.data.sessionId, link: r.data.link, token: r.data.link.split("/id/")[1] };
}

// ── Didit ───────────────────────────────────────────────────────────────────
export const DIDIT = "https://verification.didit.me";
export const diditKey = () => cred("DIDIT_SANDBOX_API_KEY");
export async function didit(method, path, body) {
  const res = await fetch(`${DIDIT}${path}`, { method, headers: { "x-api-key": diditKey(), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text();
  try { return { status: res.status, data: JSON.parse(t) }; } catch { return { status: res.status, data: t }; }
}

function shortenFloats(v) {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shortenFloats(x)]));
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((a, k) => ((a[k] = sortKeys(v[k])), a), {});
  return v;
}
/** POST a webhook to our Didit endpoint, signed like Didit signs (or not, when `secret` is given wrong). */
export async function diditWebhook(body, { secret = cred("DIDIT_WEBHOOK_SECRET"), sign = true } = {}) {
  const sig = createHmac("sha256", secret).update(JSON.stringify(sortKeys(shortenFloats(body))), "utf8").digest("hex");
  const res = await fetch(`${STAGING_URL}/functions/v1/verification-v2-didit-webhook`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(sign ? { "X-Signature-V2": sig } : {}) }, body: JSON.stringify(body),
  });
  return res.status;
}

/** Run the 5-minute sweep now, as the schedule does. */
export async function sweep(body = {}) {
  const [{ value }] = await sql(`select value from private.platform_config where key = 'verification_sweep_secret'`);
  const res = await fetch(`${STAGING_URL}/functions/v1/verification-v2-sweep`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-sweep-secret": value }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export { rest, sql, fn, cleanup };
