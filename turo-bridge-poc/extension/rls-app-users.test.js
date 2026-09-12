/**
 * rls-app-users.test.js — does public.app_users actually refuse the public key?
 *
 *     node turo-bridge-poc/extension/rls-app-users.test.js
 *
 * WHY THIS EXISTS. The extension's whole tenant model rests on one assumption:
 * that a Drive247 session is worth something because the data behind it is not
 * simply readable without one. That assumption was false. app_users carried six
 * RLS policies and RLS had never been switched on, so all six were inert and
 * `GRANT ALL ... TO anon` was the entire access model — every staff email,
 * tenant_id and auth_user_id in the platform was readable, and writable, with
 * the public key alone.
 *
 * A migration cannot prove it fixed that. Only a request can. So this suite
 * asks the live project the same questions an attacker would, using nothing but
 * the anon key that ships inside this extension.
 *
 * IT IS EXPECTED TO FAIL until
 * supabase/migrations/20260904120000_secure_app_users_read_access.sql is
 * deployed. That failure is the point: it is the vulnerability reporting itself
 * rather than sitting in a document.
 *
 * NO CREDENTIALS LIVE HERE. The anon key is public by design and is already in
 * background.js and the portal bundle. The optional signed-in checks read two
 * test accounts from the environment and are skipped when it is not set:
 *
 *     D247_TEST_A_EMAIL / D247_TEST_A_PASSWORD   tenant A
 *     D247_TEST_B_EMAIL / D247_TEST_B_PASSWORD   a DIFFERENT tenant
 *
 * Never point these at a real operator's account.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BASE = "https://hviqoaokxvlancmftwuo.supabase.co";
/* The public anon key, copied from extension/background.js. Publishing it here
   leaks nothing — it is served to every browser that loads the portal. */
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q";

let passed = 0, failed = 0, skipped = 0;
const ok = (n, c, x) => {
  if (c) { passed++; console.log("  ✓ " + n); }
  else { failed++; console.log("  ✗ " + n + (x !== undefined ? "  -> " + JSON.stringify(x).slice(0, 160) : "")); }
};
const skip = (n, why) => { skipped++; console.log("  – " + n + "  (" + why + ")"); };

const anonHeaders = { apikey: ANON, "Content-Type": "application/json" };

/** A request that is refused is one PostgREST would not answer with rows. */
function refused(status, body) {
  // 401 (no grant / permission denied) and 403 are the shapes a locked table
  // produces. A 200 carrying [] is NOT good enough: that means the grant
  // survived and only a policy filtered, which leaves the table addressable.
  return status === 401 || status === 403 || status === 404;
}

async function req(method, url, init) {
  const r = await fetch(BASE + url, { method, headers: anonHeaders, ...(init || {}) });
  let body = null;
  try { body = await r.json(); } catch (_) { /* empty body is fine */ }
  return { status: r.status, body };
}

// ================================================================== static ==
// These need no network and can never be skipped.

function staticChecks() {
  console.log("\nThe migration says what it must say");

  const MIG = path.join(__dirname, "..", "..", "supabase", "migrations",
    "20260904120000_secure_app_users_read_access.sql");
  const RB = path.join(__dirname, "..", "..", "supabase", "migrations",
    "20260904120000_secure_app_users_read_access.ROLLBACK.sql");

  ok("the migration exists", fs.existsSync(MIG));
  ok("a rollback exists beside it", fs.existsSync(RB));
  if (!fs.existsSync(MIG)) return;

  const sql = fs.readFileSync(MIG, "utf8");
  ok("it enables row level security", /ALTER TABLE public\.app_users ENABLE ROW LEVEL SECURITY/.test(sql));
  ok("it revokes anon's grant", /REVOKE ALL ON TABLE public\.app_users FROM anon/.test(sql));
  ok("it keeps service_role, which every edge function needs",
     /GRANT ALL ON TABLE public\.app_users TO service_role/.test(sql));
  /* IT MUST CREATE NO POLICY AT ALL. The live database already has
     app_users_select_policy covering own row, super admin and
     same-tenant-for-admins; it had simply never been enforced. An earlier draft
     of this migration added a policy of its own, which would have widened
     same-tenant reads from admins-only to every authenticated member of the
     tenant -- quietly undoing a restriction somebody had chosen. Enabling RLS
     was the entire fix. */
  ok("it creates no policy of its own", !/CREATE POLICY/.test(sql.replace(/--.*$/gm, "")));
  ok("...and says why in the file", /already covers own row, super admin/i.test(sql));

  ok("it does not FORCE RLS, which would recurse through the helpers",
     !/FORCE ROW LEVEL SECURITY/.test(sql.replace(/--.*$/gm, "")));

  /* NO DATA MAY MOVE. A security migration that edits rows is a migration
     nobody can safely roll back. */
  const executable = sql.replace(/--.*$/gm, "");
  ok("it never inserts, updates or deletes a row",
     !/\b(INSERT\s+INTO|UPDATE\s+public\.app_users|DELETE\s+FROM)\b/i.test(executable), executable.match(/\b(INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM)\b/i));
  ok("it does not disable RLS anywhere", !/DISABLE ROW LEVEL SECURITY/.test(executable));
  ok("it does not touch another table",
     !/(ALTER|DROP)\s+TABLE\s+public\.(?!app_users)/i.test(executable));

  console.log("\nThe rollback refuses to reopen the hole by accident");
  const rb = fs.readFileSync(RB, "utf8");
  const rbLive = rb.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
  /* Every restoring statement must be commented out. Uncommenting is meant to
     be a decision someone makes, not something a runner does. */
  ok("every statement in it is commented out", rbLive === "", rbLive.slice(0, 200));
  ok("it warns that Section B reopens public access", /re-?opens? the (vulnerability|hole)/i.test(rb));
  ok("it changes no user data", !/\b(INSERT\s+INTO|DELETE\s+FROM)\s+public\.app_users/i.test(rb));

  console.log("\nNo service-role key is anywhere near the extension");
  for (const f of ["background.js", "popup.js", "manifest.json", "content-turo.js"]) {
    const p = path.join(__dirname, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    /* What matters is a KEY, not the phrase. background.js discusses
       service_role in prose ("write to them from anyone, service_role
       included"), and a check that trips on documentation is a check people
       learn to ignore. So: strip comments, then look for the word in live code,
       and separately for the base64 a real key's payload would contain
       (\"role\":\"service_role\" encodes to one of these fragments depending on
       byte alignment). */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const encoded = /InNlcnZpY2Vfcm9sZSI|Jyb2xlIjoic2VydmljZV9yb2xlI|cm9sZSI6InNlcnZpY2Vfcm9sZS/;
    ok(f + " carries no service-role key",
       !/service_role/.test(code) && !encoded.test(src),
       /service_role/.test(code) ? "live code mentions service_role" : "encoded key fragment found");
  }
}

// ================================================================== network ==

async function anonChecks() {
  console.log("\nThe public anon key, with no session, can read nothing");

  const cases = [
    ["cannot list app_users", "/rest/v1/app_users?select=email,tenant_id,auth_user_id"],
    ["cannot read a single row", "/rest/v1/app_users?select=email&limit=1"],
    ["cannot filter by email", "/rest/v1/app_users?select=email&email=eq.nobody%40example.invalid"],
    ["cannot filter by tenant_id", "/rest/v1/app_users?select=email&tenant_id=eq.00000000-0000-0000-0000-000000000000"],
    ["cannot filter by auth_user_id", "/rest/v1/app_users?select=email&auth_user_id=eq.00000000-0000-0000-0000-000000000000"],
    ["cannot count the table", "/rest/v1/app_users?select=id"],
    ["cannot reach role or status", "/rest/v1/app_users?select=role,is_active,is_super_admin&limit=1"],
  ];

  for (const [name, url] of cases) {
    const r = await req("GET", url);
    ok(name, refused(r.status, r.body), { status: r.status, rows: Array.isArray(r.body) ? r.body.length : r.body });
  }

  console.log("\n...and cannot write either");
  /* The all-zero uuid can match no row, so these probe the GRANT and nothing
     else. Even before the fix they changed nothing. */
  const NIL = "00000000-0000-0000-0000-000000000000";
  {
    const r = await req("PATCH", `/rest/v1/app_users?id=eq.${NIL}`, { body: JSON.stringify({ name: "probe" }) });
    ok("cannot update", refused(r.status, r.body), { status: r.status });
  }
  {
    const r = await req("DELETE", `/rest/v1/app_users?id=eq.${NIL}`);
    ok("cannot delete", refused(r.status, r.body), { status: r.status });
  }
  {
    const r = await req("POST", "/rest/v1/app_users", {
      body: JSON.stringify({ email: "probe@example.invalid", role: "viewer", auth_user_id: NIL }),
    });
    ok("cannot insert", refused(r.status, r.body) || r.status >= 400, { status: r.status });
  }
}

/** Sign in and return an access token, or null. Never logs the password. */
async function signIn(email, password) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.access_token ? j : null;
}

async function authedChecks() {
  const A = { email: process.env.D247_TEST_A_EMAIL, password: process.env.D247_TEST_A_PASSWORD };
  const B = { email: process.env.D247_TEST_B_EMAIL, password: process.env.D247_TEST_B_PASSWORD };

  console.log("\nA signed-in user sees their own tenant and no other");
  if (!A.email || !A.password) {
    skip("the signed-in matrix", "set D247_TEST_A_* and D247_TEST_B_* to run it");
    return;
  }

  const sa = await signIn(A.email, A.password);
  if (!sa) { skip("the signed-in matrix", "test user A could not sign in"); return; }
  const ha = { apikey: ANON, Authorization: `Bearer ${sa.access_token}` };

  /* THE EXTENSION'S OWN LOOKUP, verbatim. If this ever stops returning a row,
     the extension cannot resolve a tenant and every sync stops. */
  const own = await fetch(
    `${BASE}/rest/v1/app_users?select=id,tenant_id,is_active,is_super_admin,must_change_password,name,email,role` +
      `&auth_user_id=eq.${encodeURIComponent(sa.user.id)}&limit=1`, { headers: ha });
  const ownRows = await own.json().catch(() => []);
  ok("the extension's profile lookup still returns exactly one row",
     own.status === 200 && Array.isArray(ownRows) && ownRows.length === 1, { status: own.status });

  const tenantA = ownRows[0] && ownRows[0].tenant_id;
  ok("...carrying the tenant the extension needs", !!tenantA);

  /* The portal's Users page, which is why the same-tenant policy exists. */
  const same = await fetch(`${BASE}/rest/v1/app_users?select=id,email&tenant_id=eq.${tenantA}`, { headers: ha });
  const sameRows = await same.json().catch(() => []);
  ok("a tenant's staff list is still readable by that tenant",
     same.status === 200 && Array.isArray(sameRows) && sameRows.length >= 1,
     { status: same.status, rows: Array.isArray(sameRows) ? sameRows.length : sameRows });

  /* The whole point. */
  const all = await fetch(`${BASE}/rest/v1/app_users?select=id,tenant_id`, { headers: ha });
  const allRows = await all.json().catch(() => []);
  const foreign = Array.isArray(allRows) ? allRows.filter((r) => r.tenant_id && r.tenant_id !== tenantA) : [];
  ok("an unfiltered read returns nothing from another tenant", foreign.length === 0, { leaked: foreign.length });

  if (!B.email || !B.password) { skip("the cross-tenant probe", "set D247_TEST_B_* to run it"); return; }
  const sb = await signIn(B.email, B.password);
  if (!sb) { skip("the cross-tenant probe", "test user B could not sign in"); return; }
  const hb = { apikey: ANON, Authorization: `Bearer ${sb.access_token}` };

  const cross = await fetch(`${BASE}/rest/v1/app_users?select=id,email&tenant_id=eq.${tenantA}`, { headers: hb });
  const crossRows = await cross.json().catch(() => []);
  ok("tenant B cannot read tenant A's staff, even naming the tenant outright",
     Array.isArray(crossRows) && crossRows.length === 0, { rows: crossRows });

  const crossUser = await fetch(
    `${BASE}/rest/v1/app_users?select=id,email&auth_user_id=eq.${encodeURIComponent(sa.user.id)}`, { headers: hb });
  const crossUserRows = await crossUser.json().catch(() => []);
  ok("...nor a specific user of theirs by auth_user_id",
     Array.isArray(crossUserRows) && crossUserRows.length === 0, { rows: crossUserRows });
}

// ==================================================================== main ==

async function main() {
  console.log("\nDrive247 — app_users access control\n");

  staticChecks();

  let online = true;
  try {
    await fetch(`${BASE}/rest/v1/`, { headers: anonHeaders });
  } catch (_) { online = false; }

  if (!online) {
    console.log("\n  – every live check skipped (the Supabase project is unreachable)");
    skipped++;
  } else {
    await anonChecks();
    await authedChecks();
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed && online) {
    console.log(
      "If the anon checks are the ones failing, the migration has NOT been deployed yet:\n" +
      "  supabase/migrations/20260904120000_secure_app_users_read_access.sql\n" +
      "Until it is, every staff email, tenant_id and auth_user_id in the platform is\n" +
      "readable — and writable — with the public key alone.\n");
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
