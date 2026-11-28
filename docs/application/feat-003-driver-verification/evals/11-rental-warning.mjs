// Spec 11 · The rental warning: the one rule in one place, and the existing rental check still passing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { statement, run, equal } from "../../eval-kit.mjs";
import { customer, NW, q, ROOT, sql } from "./lib/helpers.mjs";

statement("11.6", "The portal's expiry rule is a byte-for-byte copy of the server's", async () => {
  const server = readFileSync(join(ROOT, "supabase/functions/_shared/verification/expiry.ts"), "utf8").replace(/\r\n/g, "\n");
  const portal = readFileSync(join(ROOT, "apps/portal/src/lib/verification-v2/expiry.ts"), "utf8").replace(/\r\n/g, "\n");
  equal(portal === server, true, "expiry.ts copies match");
  const p1 = readFileSync(join(ROOT, "supabase/functions/_shared/verification/pricing.ts"), "utf8").replace(/\r\n/g, "\n");
  const p2 = readFileSync(join(ROOT, "apps/portal/src/lib/verification-v2/pricing.ts"), "utf8").replace(/\r\n/g, "\n");
  equal(p2 === p1, true, "pricing.ts copies match (spec 09.12)");
});

statement("11.9", "A Verified customer counts as verified for the existing rental check (old column = verified)", async () => {
  const c = await customer("Rental Ready");
  const [s] = await sql(`insert into verification_sessions (tenant_id, customer_id, token, expires_at, sent_via, status, booking_origin)
    values (${q(NW)}, ${q(c)}, md5(random()::text) || md5(random()::text), now() + interval '1 day', 'copy', 'verified', 'https://northwind.drive-247.com') returning id`);
  await sql(`select verification_v2_set_customer_status(${q(c)}, ${q(s.id)}, 'verified')`);
  const [row] = await sql(`select identity_verification_status from customers where id = ${q(c)}`);
  equal(row.identity_verification_status, "verified", "what rental-create-v2.tsx line 1086 reads");
});

await run(import.meta.url);
