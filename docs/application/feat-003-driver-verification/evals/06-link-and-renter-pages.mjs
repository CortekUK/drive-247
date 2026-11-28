// Spec 06 · The link and the renter's pages (called the way the /id/<token> page calls them).
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, didit, link, q, sql, startCheck } from "./lib/helpers.mjs";

const PRIVATE_KEY = /license_number|licence_number|document_number|date_of_birth|^dob$|image|photo|url$/i;
/** Every key in the answer, at any depth, except the company's own logo. */
function keysOf(v, out = []) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k !== "logoUrl") out.push(k); keysOf(x, out); }
  return out;
}

statement("06.2", "Opening the link moves link_sent to in_progress and records link_opened once", async () => {
  const c = await customer("Open Once");
  const { sessionId, token } = await startCheck(c);
  equal((await link("open", { token })).status, 200, "first open");
  await link("open", { token });
  const [s] = await sql(`select status, opened_at is not null as opened from verification_sessions where id = ${q(sessionId)}`);
  equal(`${s.status}/${s.opened}`, "in_progress/true", "session");
  const [n] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(sessionId)} and kind = 'link_opened'`);
  equal(n.n, 1, "link_opened moments");
  const [cust] = await sql(`select verification_status from customers where id = ${q(c)}`);
  equal(cust.verification_status, "in_progress", "customer status");
});

statement("06.3", "open returns only the company, the first name, the checks with their consents, and the state", async () => {
  const lic = `E${Date.now()}`;
  const c = await customer("Private Person", { license_number: lic, date_of_birth: "1990-01-01" });
  const { token } = await startCheck(c, ["standard", "licence_status"]);
  const r = await link("open", { token });
  equal(Object.keys(r.data).sort().join(","), "checkStarted,checks,company,consentGiven,consentVersion,expiresAt,firstName,premiumConsents,standardConsent,state", "fields");
  equal(r.data.firstName, "Private", "first name only");
  const text = JSON.stringify(r.data);
  equal(keysOf(r.data).filter((k) => PRIVATE_KEY.test(k)).join(","), "", "private fields in the answer");
  ok(!text.includes(lic) && !text.includes("1990-01-01"), "no licence number or date of birth in the answer");
});

statement("06.4", "An unknown token answers 404", async () => {
  const r = await link("open", { token: `${crypto.randomUUID()}${crypto.randomUUID()}` });
  equal(r.status, 404, "status");
  equal(r.data?.error, "unknown", "error");
});

statement("06.5", "An expired or cancelled session shows the ended state", async () => {
  const a = await customer("Ended Expired");
  const x = await startCheck(a);
  await sql(`update verification_sessions set expires_at = now() - interval '1 minute' where id = ${q(x.sessionId)}`);
  equal((await link("open", { token: x.token })).data.state, "ended", "expired");
  const b = await customer("Ended Cancelled");
  const y = await startCheck(b);
  await sql(`update verification_sessions set status = 'not_verified', cancelled_at = now() where id = ${q(y.sessionId)}`);
  equal((await link("open", { token: y.token })).data.state, "ended", "cancelled");
});

statement("06.6", "A replaced session shows the replaced state", async () => {
  const c = await customer("Replaced Link");
  const first = await startCheck(c);
  await startCheck(c);
  equal((await link("open", { token: first.token })).data.state, "replaced", "state");
});

statement("06.7", "A finished session shows verified or failed, with nothing private", async () => {
  for (const status of ["verified", "failed"]) {
    const lic = `F${Date.now()}${status}`;
    const c = await customer(`Finished ${status}`, { license_number: lic });
    const { sessionId, token } = await startCheck(c);
    await sql(`update verification_sessions set status = ${q(status)}, finished_at = now() where id = ${q(sessionId)}`);
    const r = await link("open", { token });
    equal(r.data.state, status, "state");
    ok(!JSON.stringify(r.data).includes(lic), "no licence number");
  }
});

statement("06.11", "Agreeing records the consent with its words' version, the time, the IP and the browser", async () => {
  const c = await customer("Consent Record");
  const { sessionId, token } = await startCheck(c, ["standard", "licence_status"]);
  await link("open", { token });
  equal((await link("consent", { token, standard: true })).status, 200, "consent");
  const [s] = await sql(`select consent_at is not null as at, consent_text_version as v from verification_sessions where id = ${q(sessionId)}`);
  ok(s.at && !!s.v, "time and version saved on the session");
  const [e] = await sql(`select detail from verification_session_events where session_id = ${q(sessionId)} and kind = 'consent_given'`);
  ok(e && "ip" in e.detail && "ua" in e.detail && e.detail.version === s.v, "the moment carries the IP, the browser and the version");
  const checks = await sql(`select service_key, consent from verification_session_checks where session_id = ${q(sessionId)} order by service_key`);
  equal(checks.map((k) => `${k.service_key}:${k.consent}`).join(","), "licence_status:given,standard:given", "consents per check");
});

statement("06.12", "A premium check whose consent is refused is not_run and never charged", async () => {
  const c = await customer("Refuse Premium");
  const { sessionId, token } = await startCheck(c, ["standard", "licence_status"]);
  // licence status is covered by the standard words; prove the refusal with a check that has its own consent.
  await sql(`insert into verification_session_checks (session_id, tenant_id, service_key, provider_cost_cents, margin_cents)
    select ${q(sessionId)}, tenant_id, 'driving_record', 299, 50 from verification_sessions where id = ${q(sessionId)}`);
  await link("open", { token });
  await link("consent", { token, standard: true, premium: { driving_record: false } });
  const [k] = await sql(`select consent, result, reason from verification_session_checks where session_id = ${q(sessionId)} and service_key = 'driving_record'`);
  equal(`${k.consent}/${k.result}/${k.reason}`, "refused/not_run/The customer did not agree", "check");
  const [ch] = await sql(`select count(*)::int as n from verification_charges where session_id = ${q(sessionId)}`);
  equal(ch.n, 0, "charges");
});

statement("06.13", "Refusing the photo and face consent fails the session and the customer", async () => {
  const c = await customer("Refuse Standard");
  const { sessionId, token } = await startCheck(c);
  await link("open", { token });
  await link("consent", { token, standard: false });
  const [s] = await sql(`select status from verification_sessions where id = ${q(sessionId)}`);
  equal(s.status, "failed", "session");
  const [ev] = await sql(`select count(*)::int as n from verification_session_events where session_id = ${q(sessionId)} and kind = 'consent_refused'`);
  equal(ev.n, 1, "consent_refused moment");
  const [cust] = await sql(`select verification_status from customers where id = ${q(c)}`);
  equal(cust.verification_status, "failed", "customer");
});

statement("06.16", "Opening the link again carries on: the same Didit check, no second consent", async () => {
  const c = await customer("Carry On");
  const { sessionId, token } = await startCheck(c);
  await link("open", { token });
  await link("consent", { token, standard: true });
  const a = await link("start-didit", { token });
  equal(a.status, 200, "first hand-off");
  const reopened = await link("open", { token });
  equal(reopened.data.consentGiven, true, "no second consent asked");
  const b = await link("start-didit", { token });
  const [s] = await sql(`select didit_session_id from verification_sessions where id = ${q(sessionId)}`);
  ok(!!s.didit_session_id, "Didit check saved");
  equal(b.data.url, a.data.url, "the same Didit check reopens");
  await didit("DELETE", `/v3/session/${s.didit_session_id}/delete/`);
});

statement("06.20", "More than 30 requests on one link in 10 minutes are refused with 429", async () => {
  const c = await customer("Link Limit");
  const { sessionId, token } = await startCheck(c);
  await sql(`update verification_sessions set link_hits = 30, link_window_started_at = now() where id = ${q(sessionId)}`);
  const r = await link("open", { token });
  equal(r.status, 429, "status");
});

await run(import.meta.url);
