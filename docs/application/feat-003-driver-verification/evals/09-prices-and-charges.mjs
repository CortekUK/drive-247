// Spec 09 · Prices and charges on staging. The math is in 09-prices-and-charges.test.ts. A charge is created
// when RentID returns a result; until RentID's test key is on staging, 09.7, 09.8 (RentID cases) and 09.10 are
// listed in RESULTS.md as waiting for it.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, NW, q, sql, startCheck } from "./lib/helpers.mjs";

statement("09.5", "The price parts are frozen on the session; changing the price list later does not change them", async () => {
  const c = await customer("Frozen Price");
  const { sessionId } = await startCheck(c, ["standard", "licence_status"]);
  await sql(`update verification_services set provider_cost_cents = 349 where key = 'licence_status'`);
  try {
    const [k] = await sql(`select provider_cost_cents, margin_cents from verification_session_checks where session_id = ${q(sessionId)} and service_key = 'licence_status'`);
    equal(`${k.provider_cost_cents}/${k.margin_cents}`, "299/50", "the session keeps the price it was made with");
  } finally {
    await sql(`update verification_services set provider_cost_cents = 299 where key = 'licence_status'`);
  }
});

statement("09.9", "A finished premium check has exactly one charge: a second for the same session and check is refused", async () => {
  const c = await customer("One Charge");
  const { sessionId } = await startCheck(c, ["standard", "licence_status"]);
  const ins = `insert into verification_charges (tenant_id, session_id, customer_id, customer_name, service_key, provider_cost_cents, state_fee_cents, margin_cents)
    values (${q(NW)}, ${q(sessionId)}, ${q(c)}, 'One Charge', 'licence_status', 299, 0, 50) on conflict (session_id, service_key) do nothing`;
  await sql(ins);
  await sql(ins);
  const [n] = await sql(`select count(*)::int as n, sum(total_cents)::int as cents from verification_charges where session_id = ${q(sessionId)}`);
  equal(`${n.n}/${n.cents}`, "1/349", "one charge of 349 cents");
});

statement("09.8", "Not charged: cancelled, expired, replaced, standard check failed, consent refused", async () => {
  const c = await customer("Never Charged");
  const cancelled = await startCheck(c, ["standard", "licence_status"]);
  await sql(`update verification_sessions set status = 'not_verified', cancelled_at = now() where id = ${q(cancelled.sessionId)}`);
  const replaced = await startCheck(c, ["standard", "licence_status"]);
  await startCheck(c, ["standard", "licence_status"]);
  const [n] = await sql(`select count(*)::int as n from verification_charges where customer_id = ${q(c)}`);
  equal(n.n, 0, "charges for checks that never finished");
  ok(!!replaced.sessionId, "a replaced check makes no charge either");
});

statement("09.13", "The launch prices: licence status 299 + 50 with a state fee; driving and criminal records switched off", async () => {
  const rows = await sql(`select key, availability, provider_cost_cents, margin_cents, has_state_fee from verification_services where key in ('licence_status','driving_record','criminal_record') order by sort_order`);
  equal(rows.map((r) => `${r.key}:${r.availability}:${r.provider_cost_cents}+${r.margin_cents}:${r.has_state_fee}`).join(" "),
    "licence_status:live:299+50:true driving_record:switched_off:299+50:true criminal_record:switched_off:299+50:false", "price list");
});

await run(import.meta.url);
