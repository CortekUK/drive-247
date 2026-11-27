// Small helpers for checking feat-001 by hand on STAGING (development only).
//
//   node scripts/dev-account-tools.mjs status <email>        what the account owes, and its Google links
//   node scripts/dev-account-tools.mjs code <email>          a fresh "Email me a sign-in code" code
//   node scripts/dev-account-tools.mjs age <email> <hours>   pretend the account signed up <hours> ago
//                                                            (to see "2 days left", "24 hours left",
//                                                            and the 3-day block at 72)
//   node scripts/dev-account-tools.mjs owe <email>           mark it as owing the email code and a password again
//   node scripts/dev-account-tools.mjs delete <email>        delete a test signup (only hamza.shafique12123+… addresses)
//
// Reads .staging-credentials.local and refuses anything but the staging project.
import { readFileSync } from "node:fs";

const creds = readFileSync(new URL("../.staging-credentials.local", import.meta.url), "utf8");
const get = (n) => creds.match(new RegExp(`^${n}=(.*)$`, "m"))?.[1].trim();
const REF = get("STAGING_REF");
if (REF !== "csjouxrkblpsoihyejel") throw new Error("Refusing: not the staging project.");
const URL_ = `https://${REF}.supabase.co`;
const KEY = get("STAGING_SERVICE_ROLE_KEY");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function sql(query) {
  if (!TOKEN) throw new Error("Set SUPABASE_ACCESS_TOKEN (the sync PDF's token) to use this command.");
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
async function userId(email) {
  const rows = await sql(`select id from auth.users where lower(email)=lower(${quote(email)})`);
  if (!rows[0]) throw new Error(`No account for ${email}`);
  return rows[0].id;
}
const put = (id, body) => fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: "PUT", headers: h, body: JSON.stringify(body) });

const [cmd, email, arg] = process.argv.slice(2);
if (!cmd || !email) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 12).join("\n"));
  process.exit(0);
}

if (cmd === "status") {
  const rows = await sql(`select u.email, u.created_at,
      u.raw_app_meta_data->>'d247_signup_email_pending' as email_owed,
      u.raw_app_meta_data->>'d247_signup_password_pending' as password_owed,
      (select json_agg(i.provider || ':' || coalesce(i.identity_data->>'email','')) from auth.identities i where i.user_id = u.id) as sign_ins
    from auth.users u where lower(u.email) = lower(${quote(email)})`);
  console.log(rows[0] ?? "no account");
} else if (cmd === "code") {
  const r = await (await fetch(`${URL_}/auth/v1/admin/generate_link`, { method: "POST", headers: h, body: JSON.stringify({ type: "magiclink", email }) })).json();
  console.log(r.email_otp ?? r.properties?.email_otp ?? r);
} else if (cmd === "age") {
  const hours = Number(arg);
  if (!Number.isFinite(hours) || hours < 0) throw new Error("Give the hours, e.g. 70");
  const id = await userId(email);
  await sql(`update auth.users set created_at = now() - interval '${hours} hours' where id = ${quote(id)}`);
  console.log(`${email} now signed up ${hours} hours ago. Reload the portal.`);
} else if (cmd === "owe") {
  const id = await userId(email);
  const r = await put(id, { app_metadata: { d247_signup_email_pending: true, d247_signup_password_pending: true } });
  console.log(r.ok ? "Now owes the email code and a password. Sign out and in again to see the window." : await r.text());
} else if (cmd === "delete") {
  if (!/^hamza\.shafique12123\+\d+@gmail\.com$/i.test(email)) throw new Error("Only test addresses hamza.shafique12123+N@gmail.com can be deleted here.");
  const id = await userId(email).catch(() => null);
  if (id) {
    const r = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h });
    console.log("account:", r.status);
  }
  await sql(`delete from signup_leads where lower(email) = lower(${quote(email)})`);
  console.log("lead removed. (A test company it built, if any, is deleted from Super admin.)");
} else {
  console.log("Unknown command.");
}
