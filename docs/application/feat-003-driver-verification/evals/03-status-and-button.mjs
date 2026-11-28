// Spec 03 · The one status, the Verify button and who may use it.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { cleanup, customer, NW, q, sql, staff, startCheck, tempStaff, verify } from "./lib/helpers.mjs";

const [{ id: OTHER }] = await sql(`select id from tenants where slug <> 'northwind' order by created_at limit 1`);

statement("03.1", "A customer's status is the status of their latest session; with none it is not_verified", async () => {
  const c = await customer("Status Latest");
  const before = await verify("context", { customerId: c }, await staff());
  equal(before.data.status, "not_verified", "status with no session");
  const { sessionId } = await startCheck(c);
  const [row] = await sql(`select verification_status, verification_session_id from customers where id = ${q(c)}`);
  equal(row.verification_status, "link_sent", "status after a start");
  equal(row.verification_session_id, sessionId, "points at the latest session");
});

statement("03.2", "An open session past its end shows as expired before the sweep writes it", async () => {
  const c = await customer("Status Clock");
  const { sessionId } = await startCheck(c);
  await sql(`update verification_sessions set expires_at = now() - interval '1 minute' where id = ${q(sessionId)}`);
  const ctx = await verify("context", { customerId: c }, await staff());
  equal(ctx.data.status, "expired", "shown status");
  const [s] = await sql(`select status from verification_sessions where id = ${q(sessionId)}`);
  equal(s.status, "link_sent", "stored status not yet changed");
});

statement("03.8", "The old status column keeps being written with values the old screens understand", async () => {
  const c = await customer("Status Mapping");
  const [s] = await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status, booking_origin)
    values (${q(NW)}, ${q(c)}, ${q(`${crypto.randomUUID()}${crypto.randomUUID()}`)}, now() + interval '1 day', 'copy', 'failed', 'https://northwind.drive-247.com') returning id`);
  const want = { not_verified: "unverified", expired: "unverified", link_sent: "pending", in_progress: "pending", needs_review: "pending", verified: "verified", failed: "rejected" };
  for (const [status, old] of Object.entries(want)) {
    await sql(`select verification_v2_set_customer_status(${q(c)}, ${q(s.id)}, ${q(status)})`);
    const [row] = await sql(`select identity_verification_status from customers where id = ${q(c)}`);
    equal(row.identity_verification_status, old, `${status} maps to`);
  }
  await sql(`update customers set identity_verification_status = 'manually_verified' where id = ${q(c)}`);
  await sql(`select verification_v2_set_customer_status(${q(c)}, ${q(s.id)}, 'link_sent')`);
  const [kept] = await sql(`select identity_verification_status from customers where id = ${q(c)}`);
  equal(kept.identity_verification_status, "manually_verified", "a manual verification stands until a check finishes");
});

statement("03.11", "A viewer's start request is refused with 403", async () => {
  const viewer = await tempStaff("viewer");
  const c = await customer("Viewer Target");
  const r = await verify("start", { customerId: c, services: ["standard"], sentVia: "copy" }, viewer);
  equal(r.status, 403, "status");
  const [n] = await sql(`select count(*)::int as n from verification_sessions where customer_id = ${q(c)}`);
  equal(n.n, 0, "sessions made");
});

statement("03.12", "Head admins, admins and managers with Customers edit may tick premium checks", async () => {
  for (const who of ["head_admin", "admin", "manager"]) {
    const token = who === "head_admin" ? await staff() : await tempStaff(who, NW, { customersEditor: who === "manager" });
    const c = await customer(`Premium ${who}`);
    const r = await verify("start", { customerId: c, services: ["standard", "licence_status"], sentVia: "copy" }, token);
    equal(r.status, 200, `${who} start with a premium check`);
  }
  const viewOnly = await tempStaff("manager");
  const c = await customer("Premium view-only manager");
  const r = await verify("start", { customerId: c, services: ["standard"], sentVia: "copy" }, viewOnly);
  equal(r.status, 403, "a view-only manager cannot start a check (03.10)");
});

statement("03.13", "Ops may send the standard check only; a premium tick is refused with premium_not_allowed", async () => {
  const ops = await tempStaff("ops");
  const a = await customer("Ops Standard");
  equal((await verify("start", { customerId: a, services: ["standard"], sentVia: "copy" }, ops)).status, 200, "standard");
  const b = await customer("Ops Premium");
  const r = await verify("start", { customerId: b, services: ["standard", "licence_status"], sentVia: "copy" }, ops);
  equal(r.status, 403, "status");
  equal(r.data?.error, "premium_not_allowed", "error");
});

async function withSubscription(status, fn) {
  const [sub] = await sql(`select id, status from tenant_subscriptions where tenant_id = ${q(NW)} order by created_at desc limit 1`);
  await sql(`update tenant_subscriptions set status = ${q(status)} where id = ${q(sub.id)}`);
  cleanup(() => sql(`update tenant_subscriptions set status = ${q(sub.status)} where id = ${q(sub.id)}`));
  try { await fn(); } finally { await sql(`update tenant_subscriptions set status = ${q(sub.status)} where id = ${q(sub.id)}`); }
}

statement("03.14", "Premium checks need an active or trialing subscription; otherwise 402 subscription_required", async () => {
  await withSubscription("past_due", async () => {
    const c = await customer("Premium Past Due");
    const r = await verify("start", { customerId: c, services: ["standard", "licence_status"], sentVia: "copy" }, await staff());
    equal(r.status, 402, "status");
    equal(r.data?.error, "subscription_required", "error");
    const ctx = await verify("context", { customerId: c }, await staff());
    equal(ctx.data.premiumBySubscription, false, "context says premium is greyed");
  });
  await withSubscription("trialing", async () => {
    const c = await customer("Premium Trial");
    equal((await verify("start", { customerId: c, services: ["standard", "licence_status"], sentVia: "copy" }, await staff())).status, 200, "trialing is allowed");
  });
});

statement("03.15", "The standard check needs no subscription", async () => {
  await withSubscription("canceled", async () => {
    const c = await customer("Standard No Sub");
    equal((await verify("start", { customerId: c, services: ["standard"], sentVia: "copy" }, await staff())).status, 200, "status");
  });
});

statement("03.16", "Another company's staff are refused with not_enabled", async () => {
  const otherAdmin = await tempStaff("admin", OTHER);
  const r = await verify("context", { customerId: crypto.randomUUID() }, otherAdmin);
  equal(r.status, 403, "status");
  equal(r.data?.error, "not_enabled", "error");
  ok(true, "done");
});

await run(import.meta.url);
