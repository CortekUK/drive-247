// What the feat-001 evals share: a second company with its own owner and a
// team member, made fresh and removed after, and a few small helpers.
// Lives in lib/ so the eval runner does not run it as an eval.

import { randomUUID } from "node:crypto";
import { cleanup, rest, signIn, sql, LOGINS, STAGING_URL } from "../../../eval-kit.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
function credential(name) {
  if (process.env[name]) return process.env[name];
  const hits = [...readFileSync(join(ROOT, ".staging-credentials.local"), "utf8").matchAll(new RegExp(`^${name}=(.+)$`, "gm"))];
  return hits.length ? hits[hits.length - 1][1].trim() : undefined;
}
const SERVICE = credential("STAGING_SERVICE_ROLE_KEY");
const ANON = credential("STAGING_ANON_KEY");

/** Call a database function as someone. Returns { status, data, error }. */
export async function rpc(name, args = {}, as = "anon") {
  const res = await rest(`rpc/${name}`, { method: "POST", body: args, as });
  const failed = res.status >= 300;
  return { status: res.status, data: failed ? null : res.data, error: failed ? res.data : null };
}

/** A staging auth user and its app_users row. Removed at the end. */
async function makeUser({ tenantId, role, name }) {
  const email = `eval+${randomUUID().slice(0, 8)}@example.com`;
  const password = `Eval-${randomUUID()}`;
  const res = await fetch(`${STAGING_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await res.json();
  if (!res.ok || !user.id) throw new Error(`Could not make a test user: ${JSON.stringify(user).slice(0, 200)}`);
  cleanup(async () => {
    await sql(`delete from public.app_users where auth_user_id = '${user.id}'`);
    await fetch(`${STAGING_URL}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
  });
  await sql(`insert into public.app_users (auth_user_id, tenant_id, email, name, role, is_active, is_super_admin)
             values ('${user.id}', '${tenantId}', '${email}', '${name}', '${role}', true, false)`);
  const token = await signIn({ email, password });
  return { email, token, authId: user.id };
}

/** A new v2 company in its first days, with an owner and a team member. */
export async function makeCompany({ timezone = "Asia/Karachi", createdDaysAgo = 1 } = {}) {
  const slug = `evalco-${randomUUID().slice(0, 8)}`;
  const [t] = await sql(`insert into public.tenants (slug, company_name, portal_experience, timezone, created_at)
                         values ('${slug}', 'Eval Co ${slug.slice(7)}', 'v2', '${timezone}', now() - interval '${createdDaysAgo} days')
                         returning id`);
  cleanup(() => sql(`delete from public.tenants where id = '${t.id}'`));
  const owner = await makeUser({ tenantId: t.id, role: "head_admin", name: "Eval Owner" });
  const member = await makeUser({ tenantId: t.id, role: "ops", name: "Eval Member" });
  return { id: t.id, slug, owner, member };
}

/** Northwind, its owner's token, and its call row put back as it was at the end. */
export async function northwind() {
  const [t] = await sql(`select id from public.tenants where slug = 'northwind'`);
  const [row] = await sql(`select row_to_json(c) as r from public.tenant_onboarding_calls c where tenant_id = '${t.id}'`);
  cleanup(async () => {
    await sql(`delete from public.onboarding_call_bookings where tenant_id = '${t.id}' and email like 'eval+%@example.com'`);
    if (row) {
      await sql(`update public.tenant_onboarding_calls c set (call_booked_at, call_booked_via, call_scheduled_for, call_completed_at, call_cancelled_at, call_missed_at, dismissed_at)
                 = (select call_booked_at, call_booked_via, call_scheduled_for, call_completed_at, call_cancelled_at, call_missed_at, dismissed_at
                      from json_populate_record(null::public.tenant_onboarding_calls, '${JSON.stringify(row.r).replace(/'/g, "''")}'))
                 where c.tenant_id = '${t.id}'`);
    } else {
      await sql(`delete from public.tenant_onboarding_calls where tenant_id = '${t.id}'`);
    }
  });
  return { id: t.id, token: await signIn(LOGINS.portal) };
}

export const admin = () => signIn(LOGINS.admin);

/** The free times a company sees now. */
export async function freeSlots(token) {
  const r = await rpc("get_onboarding_call_calendar", {}, token);
  if (r.error) throw new Error(`calendar: ${JSON.stringify(r.error)}`);
  return r.data.slots;
}

export const testEmail = () => `eval+${randomUUID().slice(0, 8)}@example.com`;

export function book(token, startsAt, extra = {}) {
  return rpc("book_onboarding_call", {
    p_starts_at: startsAt,
    p_name: "Eval Person",
    p_email: testEmail(),
    p_timezone: "Asia/Karachi",
    ...extra,
  }, token);
}

/** The settings row as it is, put back at the end whatever the eval changed. */
export async function keepSettings() {
  const [s] = await sql(`select row_to_json(s) as r from public.onboarding_call_settings s where id`);
  const [blocks] = await sql(`select coalesce(json_agg(b), '[]') as r from public.onboarding_call_blocks b`);
  cleanup(async () => {
    const r = s.r;
    await sql(`update public.onboarding_call_settings set
      host_name = ${q(r.host_name)}, host_title = ${q(r.host_title)}, host_email = ${q(r.host_email)},
      host_photo_url = ${q(r.host_photo_url)}, meeting_url = ${q(r.meeting_url)},
      duration_minutes = ${r.duration_minutes}, buffer_minutes = ${r.buffer_minutes}, timezone = ${q(r.timezone)},
      weekly_hours = ${q(JSON.stringify(r.weekly_hours))}::jsonb, blocked_dates = ${q(`{${r.blocked_dates.join(",")}}`)}::date[],
      min_notice_hours = ${r.min_notice_hours}, max_days_ahead = ${r.max_days_ahead}, is_accepting = ${r.is_accepting}
      where id`);
    await sql(`delete from public.onboarding_call_blocks where true`);
    for (const b of blocks.r) {
      await sql(`insert into public.onboarding_call_blocks (id, starts_at, ends_at, label, created_at)
                 values (${q(b.id)}, ${q(b.starts_at)}, ${q(b.ends_at)}, ${q(b.label)}, ${q(b.created_at)})`);
    }
  });
  return s.r;
}

/** A SQL literal. */
export function q(v) {
  if (v === null || v === undefined) return "null";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export { ANON, SERVICE };
