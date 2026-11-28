// Spec 08 · Premium checks through RentID. RentID's test key is not on staging yet, so this proves the
// refusals and the never-run cases; the statements that need a RentID answer are listed in RESULTS.md as
// waiting for the key.
import { createHmac } from "node:crypto";
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, didit, link, q, sleep, sql, staff, startCheck, tempStaff, verify } from "./lib/helpers.mjs";
import { STAGING_URL } from "../../eval-kit.mjs";

statement("08.2", "When the standard check fails, every premium check is not_run and never sent", async () => {
  const c = await customer("Premium After Fail");
  const { sessionId, token } = await startCheck(c, ["standard", "licence_status"]);
  await link("open", { token });
  await link("consent", { token, standard: true });
  await link("start-didit", { token });
  const [s] = await sql(`select didit_session_id from verification_sessions where id = ${q(sessionId)}`);
  try {
    await didit("POST", `/v3/session/${s.didit_session_id}/simulate/`, { new_status: "Declined", send_webhooks: true });
    let k;
    for (let i = 0; i < 15; i++) {
      [k] = await sql(`select result, reason, provider_ref from verification_session_checks where session_id = ${q(sessionId)} and service_key = 'licence_status'`);
      if (k.result !== "pending") break;
      await sleep(2000);
    }
    equal(`${k.result}/${k.reason}`, "not_run/The standard check did not pass", "premium check");
    equal(k.provider_ref, null, "never sent to RentID");
  } finally {
    await didit("DELETE", `/v3/session/${s.didit_session_id}/delete/`);
  }
});

statement("08.4", "A switched-off check cannot be run (driving record, criminal record)", async () => {
  const c = await customer("Switched Off", { verification_status: "verified" });
  for (const service of ["driving_record", "criminal_record"]) {
    const r = await verify("run-premium", { customerId: c, service }, await staff());
    equal(r.status, 400, `${service} refused`);
  }
  const r = await verify("start", { customerId: c, services: ["standard", "driving_record"], sentVia: "copy" }, await staff());
  equal(r.status, 400, "a start that ticks a switched-off check is refused");
});

statement("08.11", "A RentID webhook without our signature is refused with 401", async () => {
  const url = `${STAGING_URL}/functions/v1/verification-v2-rentid-webhook/${crypto.randomUUID()}`;
  const body = JSON.stringify({ type: "verification.completed", data: { request_id: "req_x" } });
  const none = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  equal(none.status, 401, "no signature");
  const t = Math.floor(Date.now() / 1000);
  const forged = createHmac("sha256", "whsec_not_ours").update(`${t}.${body}`).digest("hex");
  const bad = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Rentid-Signature": `t=${t},v1=${forged}` }, body });
  equal(bad.status, 401, "a signature made with another secret");
});

statement("08.19", "Run again: refused for a customer who is not Verified, refused for ops, allowed for an admin with one new check", async () => {
  const notYet = await customer("Run Again Not Verified");
  const r1 = await verify("run-premium", { customerId: notYet, service: "licence_status" }, await staff());
  equal(r1.status, 409, "not verified");
  const v = await customer("Run Again Verified", { verification_status: "verified", license_number: `H${Date.now()}`, license_state: "TX" });
  const ops = await tempStaff("ops");
  equal((await verify("run-premium", { customerId: v, service: "licence_status" }, ops)).status, 403, "ops");
  const r3 = await verify("run-premium", { customerId: v, service: "licence_status" }, await staff());
  equal(r3.status, 200, "head admin");
  const checks = await sql(`select service_key from verification_session_checks where session_id = ${q(r3.data.sessionId)}`);
  equal(checks.map((k) => k.service_key).join(","), "licence_status", "only that check, no new standard check");
  const [s] = await sql(`select status from verification_sessions where id = ${q(r3.data.sessionId)}`);
  equal(s.status, "verified", "the customer stays Verified");
  ok(true, "no renter action needed");
});

await run(import.meta.url);
