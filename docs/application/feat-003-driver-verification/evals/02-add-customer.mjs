// Spec 02 · Add customer without verifying, and typed details (what the database does; the dialog itself is QA).
import { statement, run, equal, ok } from "../../eval-kit.mjs";
import { cleanup, NW, q, rest, sql, staff, TAG } from "./lib/helpers.mjs";

/** Insert a customer the way the v2 dialog does: through the API, with the staff member's token. */
async function addLikeTheDialog(body) {
  const r = await rest("customers", { method: "POST", body: { tenant_id: NW, type: "Individual", customer_type: "Individual", status: "Active", is_gig_driver: false, ...body }, as: await staff() });
  if (r.status >= 300) throw new Error(`insert ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  const id = r.data[0].id;
  cleanup(async () => { await sql(`delete from audit_logs where entity_id = ${q(id)}`); await sql(`delete from customers where id = ${q(id)}`); });
  return id;
}

statement("02.3", "A new customer is saved Not verified, with no details source, and unverified in the old column", async () => {
  const id = await addLikeTheDialog({ name: "Added Plain", email: `${TAG}-a@drive-247.test` });
  const [c] = await sql(`select verification_status, identity_details_source, identity_verification_status from customers where id = ${q(id)}`);
  equal(`${c.verification_status}/${c.identity_details_source}/${c.identity_verification_status}`, "not_verified/null/unverified", "statuses");
});

statement("02.4", "Saving a new customer makes no verification session of either kind", async () => {
  const id = await addLikeTheDialog({ name: "Added No Session", email: `${TAG}-b@drive-247.test` });
  const [n] = await sql(`select (select count(*) from verification_sessions where customer_id = ${q(id)})::int as v2,
    (select count(*) from identity_verifications where customer_id = ${q(id)})::int as v1`);
  equal(`${n.v2}/${n.v1}`, "0/0", "sessions");
});

statement("02.5", "A customer can be saved with neither email nor phone", async () => {
  const id = await addLikeTheDialog({ name: "Added No Contact" });
  ok(!!id, "saved");
});

statement("02.10", "Typing details by hand does not change the verification status", async () => {
  const id = await addLikeTheDialog({ name: "Typed Details", email: `${TAG}-c@drive-247.test` });
  const r = await rest(`customers?id=eq.${id}`, { method: "PATCH", body: { date_of_birth: "1991-02-03", license_number: `T${Date.now()}`, licence_expiry_date: "2030-01-01", identity_details_source: "typed" }, as: await staff() });
  equal(r.status, 200, "saved");
  const [c] = await sql(`select verification_status, identity_details_source from customers where id = ${q(id)}`);
  equal(`${c.verification_status}/${c.identity_details_source}`, "not_verified/typed", "status unchanged, marked typed");
});

await run(import.meta.url);
