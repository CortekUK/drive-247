// Spec 12 · Safety, privacy and isolation.
import { execSync } from "node:child_process";
import { statement, run, equal, ok, STAGING_URL } from "../../eval-kit.mjs";
import { cleanup, cred, customer, fn, link, NW, q, rest, ROOT, sql, staff, startCheck, sweep, tempStaff, verify } from "./lib/helpers.mjs";

const [{ id: OTHER }] = await sql(`select id from tenants where slug <> 'northwind' order by created_at limit 1`);
const SERVICE = cred("STAGING_SERVICE_ROLE_KEY");
const BUCKET = "verification-documents";

async function putPhoto(path) {
  const res = await fetch(`${STAGING_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });
  if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
  cleanup(() => fetch(`${STAGING_URL}/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }));
}
const exists = async (path) => (await sql(`select count(*)::int as n from storage.objects where bucket_id = '${BUCKET}' and name = ${q(path)}`))[0].n === 1;

statement("12.1", "Staff of another company get nothing back for this company's sessions, checks, events or charges", async () => {
  const c = await customer("Isolation");
  const { sessionId } = await startCheck(c);
  const other = await tempStaff("admin", OTHER);
  for (const [table, col] of [["verification_sessions", "id"], ["verification_session_checks", "session_id"], ["verification_session_events", "session_id"], ["verification_charges", "session_id"]]) {
    const r = await rest(`${table}?${col}=eq.${sessionId}&select=*`, { as: other });
    equal(Array.isArray(r.data) ? r.data.length : 0, 0, `${table} rows seen by another company`);
  }
  equal((await verify("status", { sessionId }, other)).status, 403, "the function refuses them");
});

statement("12.2", "Photos are stored in the private bucket under <tenant>/<customer>/<session>/", async () => {
  const [b] = await sql(`select public from storage.buckets where id = '${BUCKET}'`);
  equal(b.public, false, "bucket is private");
});

statement("12.3", "An anonymous request for a photo is refused", async () => {
  const path = `${NW}/${crypto.randomUUID()}/${crypto.randomUUID()}/front.jpg`;
  await putPhoto(path);
  const pub = await fetch(`${STAGING_URL}/storage/v1/object/public/${BUCKET}/${path}`);
  ok(pub.status >= 400, `public address refused (${pub.status})`);
  const anon = await fetch(`${STAGING_URL}/storage/v1/object/${BUCKET}/${path}`, { headers: { apikey: cred("STAGING_ANON_KEY") } });
  ok(anon.status >= 400, `anonymous read refused (${anon.status})`);
});

statement("12.4", "Staff see photos only through 10-minute signed links, for their own company", async () => {
  const c = await customer("Photo Links");
  const { sessionId } = await startCheck(c);
  const path = `${NW}/${c}/${sessionId}/front.jpg`;
  await putPhoto(path);
  await sql(`update verification_session_checks set raw = jsonb_build_object('photos', jsonb_build_object('front', ${q(path)})) where session_id = ${q(sessionId)} and service_key = 'standard'`);
  const r = await verify("photos", { sessionId }, await staff());
  ok(/token=/.test(r.data.front ?? ""), "a signed link");
  const exp = JSON.parse(Buffer.from(new URL(r.data.front).searchParams.get("token").split(".")[1], "base64url").toString());
  ok(exp.exp - exp.iat <= 600, `lasts at most 10 minutes (${exp.exp - exp.iat}s)`);
  const viaLink = await fetch(r.data.front);
  equal(viaLink.status, 200, "the signed link works");
  const other = await tempStaff("admin", OTHER);
  equal((await verify("photos", { sessionId }, other)).status, 403, "another company is refused");
});

statement("12.5", "Deleting a customer removes their photos (the sweep clears the folder)", async () => {
  const [c] = await sql(`insert into customers (tenant_id, name, type) values (${q(NW)}, 'Photo Delete', 'Individual') returning id`);
  const path = `${NW}/${c.id}/${crypto.randomUUID()}/front.jpg`;
  await putPhoto(path);
  ok(await exists(path), "photo stored");
  await sql(`delete from customers where id = ${q(c.id)}`);
  equal((await sweep()).status, 200, "sweep ran");
  equal(await exists(path), false, "photo removed");
});

statement("12.6", "No answer from the functions carries a Didit or RentID key or secret", async () => {
  const secrets = [cred("DIDIT_SANDBOX_API_KEY"), cred("DIDIT_WEBHOOK_SECRET")].filter(Boolean);
  const c = await customer("No Secrets");
  const { sessionId, token } = await startCheck(c);
  const answers = [
    await verify("context", { customerId: c }, await staff()),
    await verify("status", { sessionId }, await staff()),
    await link("open", { token }),
    await link("consent", { token, standard: true }),
  ];
  const text = JSON.stringify(answers.map((a) => a.data));
  for (const s of secrets) ok(!text.includes(s), "no secret in any answer");
  ok(!/sk_test_|sk_live_|ent_test_|ent_live_|whsec_/.test(text), "no key-shaped text");
});

statement("12.8", "Viewing photos and running a premium check again are audit-logged", async () => {
  const a = await customer("Audit Photos");
  const { sessionId } = await startCheck(a);
  await verify("photos", { sessionId }, await staff());
  const v = await customer("Audit Rerun", { verification_status: "verified", license_number: `K${Date.now()}`, license_state: "TX" });
  equal((await verify("run-premium", { customerId: v, service: "licence_status" }, await staff())).status, 200, "run again");
  const rows = await sql(`select action from audit_logs where entity_id in (${q(a)}, ${q(v)}) and action like 'verification_%' order by created_at`);
  const acts = rows.map((r) => r.action);
  ok(acts.includes("verification_photos_viewed") && acts.includes("verification_premium_rerun"), acts.join(","));
});

statement("12.9", "Today's verification functions are not edited by this feature", async () => {
  const diff = execSync(`git -C "${ROOT}" diff --stat origin/staging...HEAD -- supabase/functions/create-ai-verification-session supabase/functions/process-ai-verification supabase/functions/send-verification-link-v2`).toString().trim();
  equal(diff, "", "changes to the old functions");
});

statement("12.10", "The booking site's /verify/<token> page is not edited", async () => {
  const diff = execSync(`git -C "${ROOT}" diff --stat origin/staging...HEAD -- "apps/booking/src/app/(legacy)/verify"`).toString().trim();
  equal(diff, "", "changes to the old page");
});

statement("12.11", "The old flow still writes an identity_verifications row", async () => {
  const c = await customer("Old Flow");
  const r = await fn("create-ai-verification-session", { customerId: c, tenantId: NW, tenantSlug: "northwind" }, { as: await staff() });
  ok(r.status === 200, `old function answered ${r.status}`);
  const [n] = await sql(`select count(*)::int as n from identity_verifications where customer_id = ${q(c)}`);
  equal(n.n, 1, "rows written by the old flow");
  cleanup(() => sql(`delete from identity_verifications where customer_id = ${q(c)}`));
});

statement("12.12", "No shared v1 file is edited: shared screens were forked to -v2 files", async () => {
  const shared = [
    "apps/portal/src/components/rentals/AdminExtendRentalDialog.tsx",
    "apps/portal/src/components/customers/start-verification-dialog.tsx",
    "apps/portal/src/components/customers/customer-form-modal.tsx",
    "apps/portal/src/client-schemas/customers/customer-form-modal.ts",
    "apps/portal/src/components/customers-v2/verify-id-screen-v2.tsx",
  ];
  const diff = execSync(`git -C "${ROOT}" diff --stat origin/staging...HEAD -- ${shared.map((f) => `"${f}"`).join(" ")}`).toString().trim();
  equal(diff, "", "changes to shared v1 files");
});

await run(import.meta.url);
