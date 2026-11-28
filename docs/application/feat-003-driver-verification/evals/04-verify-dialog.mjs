// Spec 04 · The Verify dialog's data (what screen 1 is built from). How it looks is in the QA report.
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { customer, NW, sql, staff, startCheck, tempStaff, verify } from "./lib/helpers.mjs";

statement("04.1", "The table is every row of the price list, in sort order; nothing is named in the screen's code", async () => {
  const c = await customer("Dialog List");
  const r = await verify("context", { customerId: c }, await staff());
  const list = await sql(`select key from verification_services order by sort_order`);
  equal(r.data.services.map((s) => s.key).join(","), list.map((s) => s.key).join(","), "services");
});

statement("04.8", "The ticks start as the company's last ticks; with none saved, the standard check only", async () => {
  await sql(`delete from verification_tenant_prefs where tenant_id = '${NW}'`);
  const c = await customer("Dialog Ticks");
  equal((await verify("context", { customerId: c }, await staff())).data.lastTicks.join(","), "standard", "no prefs yet");
  await sql(`insert into verification_tenant_prefs (tenant_id, last_ticks) values ('${NW}', '{standard,licence_status}')`);
  equal((await verify("context", { customerId: c }, await staff())).data.lastTicks.join(","), "standard,licence_status", "saved prefs");
});

statement("04.9", "Sending saves the ticks for the company, so another staff member sees the same next time", async () => {
  const a = await customer("Dialog Save Ticks");
  await startCheck(a, ["standard", "licence_status"]);
  const admin = await tempStaff("admin");
  const b = await customer("Dialog Other Staff");
  equal((await verify("context", { customerId: b }, admin)).data.lastTicks.join(","), "standard,licence_status", "another admin's ticks");
});

statement("04.17", "One call gives the screen everything: services, ticks, rights, subscription, state, open session, last verified", async () => {
  const c = await customer("Dialog Context", { license_state: "TX" });
  const r = await verify("context", { customerId: c }, await staff());
  for (const k of ["services", "lastTicks", "canStart", "canTickPremium", "premiumBySubscription", "knownState", "stateFees", "openSession", "lastVerifiedAt", "customer"]) {
    ok(k in r.data, `has ${k}`);
  }
  equal(r.data.knownState, "TX", "the customer's known state");
  await startCheck(c);
  const again = await verify("context", { customerId: c }, await staff());
  ok(again.data.openSession && again.data.openSession.link.includes("/id/"), "an open check is returned, so the dialog opens on screen 3 (04.16)");
});

await run(import.meta.url);
