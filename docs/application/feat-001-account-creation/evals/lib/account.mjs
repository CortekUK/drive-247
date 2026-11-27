/**
 * Helpers shared by feat-001's evals. Not an eval itself (the runner only runs
 * the .mjs files directly in evals/).
 *
 * Test people are made on STAGING with addresses at example.com, which no one
 * receives, so an eval never emails a real person. Each one is removed by
 * cleanup(), pass or fail.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, sql, STAGING_URL } from "../../../eval-kit.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

function credential(name) {
  if (process.env[name]) return process.env[name];
  const file = join(ROOT, ".staging-credentials.local");
  if (!existsSync(file)) return undefined;
  const hits = [...readFileSync(file, "utf8").matchAll(new RegExp(`^${name}=(.+)$`, "gm"))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}
const ANON = credential("STAGING_ANON_KEY");
const SERVICE = credential("STAGING_SERVICE_ROLE_KEY");

/** A fresh address no one receives. */
export function testEmail(tag) {
  return `eval-feat001-${tag}-${randomBytes(4).toString("hex")}@example.com`;
}

/** Read a source file of the repo, for statements about how the code is written. */
export function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

async function auth(path, { method = "GET", body, token, service = false } = {}) {
  const res = await fetch(`${STAGING_URL}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: service ? SERVICE : ANON,
      Authorization: `Bearer ${service ? SERVICE : token || ANON}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** Remove every trace of a test address. Registered straight after it is used. */
export function forgetEmail(email) {
  cleanup(async () => {
    const e = email.replace(/'/g, "''");
    await sql(`delete from public.signup_leads where lower(email) = lower('${e}')`).catch(() => {});
    await sql(`delete from auth.users where lower(email) = lower('${e}')`);
  });
}

/** Make a user directly (the admin API), for statements that start after signup. */
export async function makeUser({ tag = "user", password, confirmed = true, appMeta = {}, email: given } = {}) {
  const email = given ?? testEmail(tag);
  forgetEmail(email);
  const res = await auth("admin/users", {
    method: "POST",
    service: true,
    body: { email, password, email_confirm: confirmed, app_metadata: appMeta },
  });
  if (res.status >= 300) throw new Error(`Could not make a test user: ${JSON.stringify(res.data).slice(0, 200)}`);
  return { email, id: res.data.id, password };
}

export async function getUser(id) {
  const res = await auth(`admin/users/${id}`, { service: true });
  return res.data;
}

export async function updateUser(id, body) {
  return auth(`admin/users/${id}`, { method: "PUT", service: true, body });
}

export async function findUserByEmail(email) {
  const rows = await sql(`select id, email, email_confirmed_at, created_at, raw_app_meta_data as app_meta,
    raw_user_meta_data as user_meta, encrypted_password <> '' as has_password
    from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')`);
  return rows[0] || null;
}

/** Sign in with a password. Returns { status, token }. */
export async function passwordSignIn(email, password) {
  const res = await auth("token?grant_type=password", { method: "POST", body: { email, password } });
  return { status: res.status, token: res.data?.access_token || null, data: res.data };
}

/**
 * Put a known signup code on a user, the way `signup-otp.ts` stores it.
 * The hash is sha256(`${code}:${pepper}`). Staging has no SIGNUP_OTP_PEPPER of
 * its own, so the pepper is the service-role key; if that changes, the
 * right-code checks fail with "OTP_INVALID" and this helper needs the pepper.
 */
export async function plantCode(userId, code, { minutesAgo = 0, attempts = 0 } = {}) {
  const user = await getUser(userId);
  const meta = user?.app_metadata?.d247_signup || {};
  const sentAt = Date.now() - minutesAgo * 60_000;
  const otp = {
    hash: createHash("sha256").update(`${code}:${SERVICE}`).digest("hex"),
    expiresAt: new Date(sentAt + 30 * 60_000).toISOString(),
    attempts,
    sentAt: new Date(sentAt).toISOString(),
  };
  await updateUser(userId, { app_metadata: { d247_signup: { ...meta, otp } } });
}

/** A one-time magic-link token for an address, the way signup-provision makes one. */
export async function magicLinkHash(email) {
  const res = await auth("admin/generate_link", { method: "POST", service: true, body: { type: "magiclink", email } });
  return res.data?.hashed_token || res.data?.properties?.hashed_token;
}

/** Use a magic-link token. Returns the HTTP status (200 = signed in). */
export async function useMagicLink(hash) {
  const res = await auth("verify", { method: "POST", body: { type: "magiclink", token_hash: hash } });
  return res.status;
}

/** Ask for an email sign-in code (no new users). Returns { status, data }. */
export async function askSignInCode(email) {
  return auth("otp", { method: "POST", body: { email, create_user: false } });
}

/** Sign in through a one-time link (for a person with no password). Returns the access token. */
export async function linkSignIn(email) {
  const res = await auth("verify", { method: "POST", body: { type: "magiclink", token_hash: await magicLinkHash(email) } });
  return res.data?.access_token || null;
}

/** Change your own account, as the signed-in person (what the profile sheet calls). */
export async function updateSelf(token, body) {
  return auth("user", { method: "PUT", token, body });
}

export const PENDING_EMAIL = "d247_signup_email_pending";
export const PENDING_PASSWORD = "d247_signup_password_pending";

/**
 * An address the email service really delivers to (Resend's test inbox, which
 * keeps nothing). For a statement that needs an auth email SENT: the auth email
 * hook fails with a 500 when Resend refuses `@example.com`.
 */
export function deliverableTestEmail(tag) {
  return `delivered+feat001-${tag}-${randomBytes(4).toString("hex")}@resend.dev`;
}
