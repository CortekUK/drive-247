// Spec 07 · The standard check through Didit, against Didit's sandbox and our staging webhook.
// Didit's sandbox "simulate" changes only the status and returns no licence data, so the outcomes that need
// real data (07.19, 07.21, 07.25, 07.27, 07.28) are proved by the Vitest files and the QA report's phone run.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, didit, diditWebhook, link, NW, q, sleep, sql, startCheck, sweep } from "./lib/helpers.mjs";

/** A session handed to Didit; returns ids and registers the Didit clean-up. */
async function handedOff(name, extra = {}) {
  const c = await customer(name, extra);
  const { sessionId, token } = await startCheck(c);
  await link("open", { token });
  await link("consent", { token, standard: true });
  const r = await link("start-didit", { token });
  if (r.status !== 200) throw new Error(`start-didit ${r.status} ${JSON.stringify(r.data)}`);
  const [s] = await sql(`select didit_session_id from verification_sessions where id = ${q(sessionId)}`);
  return { c, sessionId, token, didit: s.didit_session_id };
}
const removeDidit = (id) => didit("DELETE", `/v3/session/${id}/delete/`);
const event = (sessionId, extra = {}) => ({
  event_id: crypto.randomUUID(), webhook_type: "status.updated", timestamp: Math.floor(Date.now() / 1000),
  vendor_data: sessionId, status: "In Progress", ...extra,
});
async function waitFor(sql1, test, tries = 15) {
  for (let i = 0; i < tries; i++) { const [r] = await sql(sql1); if (test(r)) return r; await sleep(2000); }
  const [r] = await sql(sql1); return r;
}

statement("07.1", "The Didit check is made with our workflow, our session as vendor_data and the company in its metadata", async () => {
  const h = await handedOff("Didit Create");
  try {
    const d = await didit("GET", `/v3/session/${h.didit}/decision/`);
    equal(d.data.vendor_data, h.sessionId, "vendor_data");
    equal(d.data.metadata?.tenant_id, NW, "metadata tenant");
    equal(d.data.metadata?.session_id, h.sessionId, "metadata session");
    ok(!!d.data.workflow_id, "a workflow");
    ok(Date.parse(d.data.expires_at) - Date.now() < 25 * 3600 * 1000, "ends with our 24 hours, not Didit's default 7 days");
  } finally { await removeDidit(h.didit); }
});

statement("07.2", "Each of our sessions gets its own Didit check", async () => {
  const c = await customer("Two Sessions");
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const { token, sessionId } = await startCheck(c);
    await link("open", { token }); await link("consent", { token, standard: true }); await link("start-didit", { token });
    const [s] = await sql(`select didit_session_id from verification_sessions where id = ${q(sessionId)}`);
    ids.push(s.didit_session_id);
  }
  ok(ids[0] && ids[1] && ids[0] !== ids[1], "two different Didit checks");
  for (const id of ids) await removeDidit(id);
});

statement("07.3", "The Didit session id is saved on our session and on the standard check", async () => {
  const h = await handedOff("Saved Id");
  try {
    const [k] = await sql(`select provider_ref, started_at is not null as started from verification_session_checks where session_id = ${q(h.sessionId)} and service_key = 'standard'`);
    equal(k.provider_ref, h.didit, "provider_ref");
    equal(k.started, true, "started_at");
  } finally { await removeDidit(h.didit); }
});

statement("07.6", "A webhook without a valid signature, or with a stale signed timestamp, is refused with 401", async () => {
  const c = await customer("Bad Signatures");
  const { sessionId } = await startCheck(c);
  equal(await diditWebhook(event(sessionId), { sign: false }), 401, "no signature");
  equal(await diditWebhook(event(sessionId), { secret: "not-the-secret" }), 401, "wrong secret");
  equal(await diditWebhook(event(sessionId, { timestamp: Math.floor(Date.now() / 1000) - 600 })), 401, "signed timestamp 10 minutes old");
  equal(await diditWebhook(event(sessionId)), 200, "a good one is accepted");
});

statement("07.7", "The webhook's own body is never the result: a signed 'Approved' for a check Didit has not finished changes nothing", async () => {
  const h = await handedOff("Body Not Trusted");
  try {
    equal(await diditWebhook(event(h.sessionId, { session_id: h.didit, status: "Approved", decision: { id_verifications: [{ status: "Approved" }] } })), 200, "accepted");
    await sleep(4000);
    const [s] = await sql(`select status from verification_sessions where id = ${q(h.sessionId)}`);
    equal(s.status, "in_progress", "still in progress");
  } finally { await removeDidit(h.didit); }
});

statement("07.8", "The company comes from our session row, never from the webhook", async () => {
  const c = await customer("Company From Row");
  const { sessionId } = await startCheck(c);
  await diditWebhook(event(sessionId, { metadata: { tenant_id: crypto.randomUUID() } }));
  const r = await waitFor(`select tenant_id from verification_session_events where session_id = ${q(sessionId)} and kind = 'check_started'`, (x) => !!x);
  equal(r?.tenant_id, NW, "the moment is recorded under our session's company");
});

statement("07.9", "A webhook for a finished session changes nothing and answers 200", async () => {
  const c = await customer("Already Finished");
  const { sessionId } = await startCheck(c);
  await sql(`update verification_sessions set status = 'failed', finished_at = now() where id = ${q(sessionId)}`);
  equal(await diditWebhook(event(sessionId)), 200, "answer");
  await sleep(3000);
  const [n] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(sessionId)} and kind = 'check_started'`);
  equal(n.n, 0, "no new moment");
});

statement("07.10", "The same webhook delivered twice gives one moment (Didit's event_id)", async () => {
  const c = await customer("Twice");
  const { sessionId } = await startCheck(c);
  const body = event(sessionId);
  await diditWebhook(body);
  await diditWebhook({ ...body, timestamp: Math.floor(Date.now() / 1000) });
  await sleep(4000);
  const [n] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(sessionId)} and kind = 'check_started'`);
  equal(n.n, 1, "check_started moments");
});

statement("07.11", "The sweep fetches the decision when the webhook was missed", async () => {
  const h = await handedOff("Missed Webhook");
  try {
    const sim = await didit("POST", `/v3/session/${h.didit}/simulate/`, { new_status: "Approved", send_webhooks: false });
    equal(sim.status, 200, "Didit marked it decided without telling us");
    await sql(`update verification_sessions set opened_at = now() - interval '5 minutes' where id = ${q(h.sessionId)}`);
    equal((await sweep()).status, 200, "sweep ran");
    const [s] = await sql(`select status from verification_sessions where id = ${q(h.sessionId)}`);
    ok(!["link_sent", "in_progress"].includes(s.status), `finished by the sweep (${s.status})`);
  } finally { await removeDidit(h.didit); }
});

statement("07.23", "A decision we could not read is Needs a look, never Verified", async () => {
  const h = await handedOff("Empty Decision");
  try {
    await didit("POST", `/v3/session/${h.didit}/simulate/`, { new_status: "Approved", send_webhooks: true });
    const s = await waitFor(`select status from verification_sessions where id = ${q(h.sessionId)}`, (x) => x.status !== "in_progress");
    equal(s.status, "needs_review", "session");
    const [cust] = await sql(`select verification_status, identity_verification_status from customers where id = ${q(h.c)}`);
    equal(`${cust.verification_status}/${cust.identity_verification_status}`, "needs_review/pending", "customer");
  } finally { await removeDidit(h.didit); }
});

statement("07.24", "Didit declining with no line we can name fails the check as 'Didit declined the check'", async () => {
  const h = await handedOff("Declined");
  try {
    await didit("POST", `/v3/session/${h.didit}/simulate/`, { new_status: "Declined", send_webhooks: true });
    const s = await waitFor(`select status from verification_sessions where id = ${q(h.sessionId)}`, (x) => x.status !== "in_progress");
    equal(s.status, "failed", "session");
    const [k] = await sql(`select reason from verification_session_checks where session_id = ${q(h.sessionId)} and service_key = 'standard'`);
    equal(k.reason, "Didit declined the check", "reason");
  } finally { await removeDidit(h.didit); }
});

statement("07.26", "On a fail nothing on the customer is overwritten", async () => {
  const lic = `G${Date.now()}`;
  const h = await handedOff("Keep Details", { license_number: lic, date_of_birth: "1985-04-04", license_state: "TX" });
  try {
    await didit("POST", `/v3/session/${h.didit}/simulate/`, { new_status: "Declined", send_webhooks: true });
    await waitFor(`select status from verification_sessions where id = ${q(h.sessionId)}`, (x) => x.status !== "in_progress");
    const [cust] = await sql(`select license_number, date_of_birth::text as dob, license_state, identity_details_source from customers where id = ${q(h.c)}`);
    equal(`${cust.license_number}/${cust.dob}/${cust.license_state}/${cust.identity_details_source}`, `${lic}/1985-04-04/TX/null`, "details unchanged");
  } finally { await removeDidit(h.didit); }
});

statement("07.29", "A result writes the standard_result moment, the check's lines and the statuses", async () => {
  const h = await handedOff("Result Written");
  try {
    await didit("POST", `/v3/session/${h.didit}/simulate/`, { new_status: "Approved", send_webhooks: true });
    await waitFor(`select status from verification_sessions where id = ${q(h.sessionId)}`, (x) => x.status !== "in_progress");
    const [k] = await sql(`select result, jsonb_array_length(lines) as n, finished_at is not null as done, raw ? 'decision' as raw from verification_session_checks where session_id = ${q(h.sessionId)} and service_key = 'standard'`);
    equal(`${k.n}/${k.done}/${k.raw}`, "10/true/true", "ten lines, finished, raw kept");
    const [e] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(h.sessionId)} and kind = 'standard_result'`);
    equal(e.n, 1, "standard_result moment");
  } finally { await removeDidit(h.didit); }
});

statement("07.30", "Each finished standard check keeps Drive247's cost of 33 cents against the company", async () => {
  const c = await customer("Our Cost");
  const { sessionId } = await startCheck(c);
  const [k] = await sql(`select provider_cost_cents, margin_cents, tenant_id from verification_session_checks where session_id = ${q(sessionId)} and service_key = 'standard'`);
  equal(`${k.provider_cost_cents}/${k.margin_cents}/${k.tenant_id}`, `33/0/${NW}`, "cost row");
});

await run(import.meta.url);
