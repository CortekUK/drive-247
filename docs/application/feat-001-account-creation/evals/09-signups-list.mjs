// Proves spec 09 · The signups list.
import { statement, run, fn, sql, signIn, LOGINS, rest, equal, ok } from "../../eval-kit.mjs";
import { testEmail, forgetEmail, source } from "./lib/account.mjs";

statement("09.1", "signup-lead's steps are details 1, business 2, card 3, done 4", async () => {
  const src = source("supabase/functions/signup-lead/index.ts");
  const order = src.match(/STEP_ORDER[^{]*\{([^}]*)\}/)?.[1] || "";
  const pairs = Object.fromEntries([...order.matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  equal({ details: pairs.details, business: pairs.business, card: pairs.card, done: pairs.done }, { details: 1, business: 2, card: 3, done: 4 }, "STEP_ORDER");
});

statement("09.2", "A recorded step never moves back", async () => {
  const email = testEmail("lead");
  forgetEmail(email);
  const token = (await import("node:crypto")).randomBytes(32).toString("hex");
  const details = { fullName: "Eval Feat001", email };
  const a = await fn("signup-lead", { action: "save", token, step: "business", details });
  ok(a.status < 300, `signup-lead refused: ${JSON.stringify(a.data)}`);
  await fn("signup-lead", { action: "save", token, step: "details", details });
  const rows = await sql(`select last_step from signup_leads where lower(email) = lower('${email}')`);
  ok(rows.length === 1, `expected one lead, found ${rows.length}`);
  equal(rows[0].last_step, "business", "last_step");
});

statement("09.3", "Old rows at email_code or password are labelled as the old signup", async () => {
  const src = source("apps/admin/components/admin/customer-management/signups-tab.tsx");
  ok(/email_code:\s*["'][^"']*old signup/.test(src), "email_code is not labelled as the old signup");
  ok(/password:\s*["'][^"']*old signup/.test(src), "password is not labelled as the old signup");
});

statement("09.4", "The signups list says whether the email is verified and a password is set", async () => {
  const token = await signIn(LOGINS.admin);
  const res = await rest("rpc/admin_signups", { method: "POST", body: {}, as: token });
  ok(res.status < 300, `admin_signups failed (${res.status})`);
  const row = Array.isArray(res.data) ? res.data[0] : null;
  ok(row && "email_confirmed" in row && "password_set" in row, "admin_signups has no email_confirmed / password_set");
});

await run(import.meta.url);
