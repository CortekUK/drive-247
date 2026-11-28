// Spec 05 · The session, sending the link, and the progress screen.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, NW, q, sql, staff, startCheck, sweep, verify } from "./lib/helpers.mjs";

const [{ id: OTHER }] = await sql(`select id from tenants where slug <> 'northwind' order by created_at limit 1`);

statement("05.1", "start makes one link_sent session, 24 hours long, with one check row per ticked service at its frozen price", async () => {
  const c = await customer("Session Basic");
  const { sessionId, token } = await startCheck(c, ["standard", "licence_status"]);
  const [s] = await sql(`select status, extract(epoch from (expires_at - created_at))::int as secs, length(token) as len, token from verification_sessions where id = ${q(sessionId)}`);
  equal(s.status, "link_sent", "status");
  equal(s.secs, 86400, "lifetime in seconds");
  ok(s.len >= 43, "token length");
  equal(s.token, token, "the link carries this session's token");
  const checks = await sql(`select k.service_key, k.provider_cost_cents, k.margin_cents, v.provider_cost_cents as list_cost, v.margin_cents as list_margin
    from verification_session_checks k join verification_services v on v.key = k.service_key where k.session_id = ${q(sessionId)} order by k.service_key`);
  equal(checks.map((k) => k.service_key).join(","), "licence_status,standard", "check rows");
  for (const k of checks) {
    equal(k.provider_cost_cents, k.list_cost, `${k.service_key} cost frozen from the list`);
    equal(k.margin_cents, k.list_margin, `${k.service_key} margin frozen from the list`);
  }
});

statement("05.4", "Email with no address is refused with no_email", async () => {
  const c = await customer("No Email", { email: null });
  const r = await verify("start", { customerId: c, services: ["standard"], sentVia: "email" }, await staff());
  equal(r.status, 400, "status");
  equal(r.data?.error, "no_email", "error");
});

statement("05.5", "A text is refused with sms_not_available when the company cannot send texts", async () => {
  const [t] = await sql(`select integration_twilio_sms from tenants where id = ${q(NW)}`);
  equal(t.integration_twilio_sms, false, "Northwind on staging has texts off");
  const c = await customer("No SMS", { phone: "+15555550100" });
  const r = await verify("start", { customerId: c, services: ["standard"], sentVia: "sms" }, await staff());
  equal(r.status, 400, "status");
  equal(r.data?.error, "sms_not_available", "error");
});

statement("05.6", "qr records code_shown and copy records link_copied; both return the link and send nothing", async () => {
  for (const [via, kind] of [["qr", "code_shown"], ["copy", "link_copied"]]) {
    const c = await customer(`Via ${via}`);
    const { sessionId, link } = await startCheck(c, ["standard"], via);
    ok(link.includes("/id/"), `${via} returns the link`);
    const ev = await sql(`select kind from verification_session_events where session_id = ${q(sessionId)} order by at`);
    equal(ev.map((e) => e.kind).join(","), `session_created,${kind}`, `${via} moments`);
  }
});

statement("05.7", "The link is <booking origin>/id/<token>, on the booking site of the portal it was made from", async () => {
  const c = await customer("Origin");
  const { link, token } = await startCheck(c);
  equal(link, `https://northwind.ray1.drive-247.com/id/${token}`, "a session made from the ray1 portal");
});

statement("05.8", "A new session ends the open one: not_verified, replaced_by, and a replaced moment", async () => {
  const c = await customer("Replace");
  const first = await startCheck(c);
  const second = await startCheck(c);
  const [old] = await sql(`select status, replaced_by from verification_sessions where id = ${q(first.sessionId)}`);
  equal(old.status, "not_verified", "old status");
  equal(old.replaced_by, second.sessionId, "points at the new one");
  const [ev] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(first.sessionId)} and kind = 'replaced'`);
  equal(ev.n, 1, "replaced moment");
});

statement("05.9", "The 11th session for a customer in an hour is refused with too_many", async () => {
  const c = await customer("Rate Limit");
  await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status, booking_origin)
    select ${q(NW)}, ${q(c)}, md5(random()::text) || md5(random()::text), now(), 'copy', 'failed', 'https://northwind.drive-247.com' from generate_series(1, 10)`);
  const r = await verify("start", { customerId: c, services: ["standard"], sentVia: "copy" }, await staff());
  equal(r.status, 429, "status");
  equal(r.data?.error, "too_many", "error");
});

statement("05.10", "resend sends the same link again without a new session and records reminder_sent", async () => {
  const c = await customer("Resend");
  const { sessionId, link } = await startCheck(c);
  await sql(`update verification_session_events set at = at - interval '2 minutes' where session_id = ${q(sessionId)}`);
  const r = await verify("resend", { sessionId, sentVia: "copy" }, await staff());
  equal(r.status, 200, "status");
  equal(r.data.link, link, "same link");
  const [n] = await sql(`select (select count(*) from verification_sessions where customer_id = ${q(c)})::int as sessions,
    (select count(*) from verification_session_events where session_id = ${q(sessionId)} and kind = 'reminder_sent')::int as reminders`);
  equal(n.sessions, 1, "sessions");
  equal(n.reminders, 1, "reminder moments");
});

statement("05.11", "Reminders are limited: not within 60 seconds of the last send, and at most 3", async () => {
  const c = await customer("Reminder Limit");
  const { sessionId } = await startCheck(c);
  const soon = await verify("resend", { sessionId, sentVia: "copy" }, await staff());
  equal(soon.status, 429, "a reminder straight after the first send");
  await sql(`update verification_sessions set reminders_sent = 3 where id = ${q(sessionId)}`);
  await sql(`update verification_session_events set at = at - interval '2 minutes' where session_id = ${q(sessionId)}`);
  const fourth = await verify("resend", { sessionId, sentVia: "copy" }, await staff());
  equal(fourth.status, 429, "a fourth reminder");
});

statement("05.12", "cancel ends the session, records who and when, and leaves nothing to charge", async () => {
  const c = await customer("Cancel");
  const { sessionId } = await startCheck(c, ["standard", "licence_status"]);
  const r = await verify("cancel", { sessionId }, await staff());
  equal(r.status, 200, "status");
  const [s] = await sql(`select status, cancelled_at is not null as at, cancelled_by is not null as by from verification_sessions where id = ${q(sessionId)}`);
  equal(`${s.status}/${s.at}/${s.by}`, "not_verified/true/true", "session");
  const pending = await sql(`select result from verification_session_checks where session_id = ${q(sessionId)}`);
  ok(pending.every((k) => k.result === "not_run"), "no check left pending");
  const [ch] = await sql(`select count(*)::int as n from verification_charges where session_id = ${q(sessionId)}`);
  equal(ch.n, 0, "charges");
  const [cust] = await sql(`select verification_status from customers where id = ${q(c)}`);
  equal(cust.verification_status, "not_verified", "customer status");
});

statement("05.13", "The sweep sets a session past its 24 hours to expired and records expired", async () => {
  const c = await customer("Expire");
  const { sessionId } = await startCheck(c);
  await sql(`update verification_sessions set expires_at = now() - interval '1 minute' where id = ${q(sessionId)}`);
  const r = await sweep();
  equal(r.status, 200, "sweep ran");
  const [s] = await sql(`select status from verification_sessions where id = ${q(sessionId)}`);
  equal(s.status, "expired", "session");
  const [ev] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(sessionId)} and kind = 'expired'`);
  equal(ev.n, 1, "expired moment");
  const [cust] = await sql(`select verification_status from customers where id = ${q(c)}`);
  equal(cust.verification_status, "expired", "customer status");
});

statement("05.14", "Every moment is stored with its time and listed in time order by status", async () => {
  const c = await customer("Moments");
  const { sessionId } = await startCheck(c);
  const r = await verify("status", { sessionId }, await staff());
  equal(r.data.events.map((e) => e.kind).join(","), "session_created,link_copied", "moments");
  ok(r.data.events.every((e) => !Number.isNaN(Date.parse(e.at))), "each has a time");
  ok(Date.parse(r.data.events[0].at) <= Date.parse(r.data.events[1].at), "in time order");
});

statement("05.15", "start, resend and cancel each write an audit entry", async () => {
  const c = await customer("Audit");
  const { sessionId } = await startCheck(c);
  await sql(`update verification_session_events set at = at - interval '2 minutes' where session_id = ${q(sessionId)}`);
  await verify("resend", { sessionId, sentVia: "copy" }, await staff());
  await verify("cancel", { sessionId }, await staff());
  const rows = await sql(`select action from audit_logs where entity_id = ${q(c)} order by created_at`);
  equal(rows.map((a) => a.action).join(","), "verification_started,verification_reminded,verification_cancelled", "audit actions");
});

statement("05.16", "A replaced session can never change the customer's status again", async () => {
  const c = await customer("Stale Session");
  const first = await startCheck(c);
  await startCheck(c);
  const [r] = await sql(`select verification_v2_set_customer_status(${q(c)}, ${q(first.sessionId)}, 'verified') as moved`);
  equal(r.moved, false, "function answer");
  const [cust] = await sql(`select verification_status from customers where id = ${q(c)}`);
  equal(cust.verification_status, "link_sent", "status unchanged");
});

statement("05.17", "Another company's customer or session is refused with 404", async () => {
  const [oc] = await sql(`insert into customers (tenant_id, name, type) values (${q(OTHER)}, 'Other Co Renter', 'Individual') returning id`);
  try {
    const r = await verify("start", { customerId: oc.id, services: ["standard"], sentVia: "copy" }, await staff());
    equal(r.status, 404, "start on another company's customer");
    const s = await verify("cancel", { sessionId: crypto.randomUUID() }, await staff());
    equal(s.status, 404, "cancel of an unknown session");
  } finally {
    await sql(`delete from customers where id = ${q(oc.id)}`);
  }
});

await run(import.meta.url);
