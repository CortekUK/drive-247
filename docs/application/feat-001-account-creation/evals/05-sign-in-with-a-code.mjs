// Proves spec 05 · Signing in with an email code.
//
// The code itself arrives by email, so "a code signs in" (05.3) uses a
// one-time token of the same kind, made by the admin API.
import { statement, run, equal, ok, sql } from "../../eval-kit.mjs";
import { makeUser, testEmail, deliverableTestEmail, askSignInCode, linkSignIn, passwordSignIn, updateUser, source } from "./lib/account.mjs";

statement("05.2", "The login page asks for a code without making users, and a known email is accepted", async () => {
  const page = source("apps/portal/src/components/auth-v2/sign-in-code-dialog.tsx");
  ok(/SignInCodeDialog/.test(source("apps/portal/src/app/(auth)/login/page.tsx")) && /SignInCodeDialog/.test(source("apps/portal/src/components/auth-v2/login-v2.tsx")), "a login page does not offer the sign-in code");
  ok(/signInWithOtp/.test(page) && /shouldCreateUser:\s*false/.test(page), "the login page has no sign-in code with shouldCreateUser: false");
  const known = await makeUser({ tag: "known", password: "Known12345x", email: deliverableTestEmail("known") });
  ok((await askSignInCode(known.email)).status < 300, "a known email was refused");
});

statement("05.3", "A sign-in code for the account signs the person in", async () => {
  const u = await makeUser({ tag: "codein", confirmed: true });
  ok(await linkSignIn(u.email), "no session");
});

statement("05.6", "Forgot password: after the new password, the old one stops working", async () => {
  const u = await makeUser({ tag: "forgot", password: "Oldpass12345" });
  await updateUser(u.id, { password: "Newpass12345" }); // the last step of the flow
  ok((await passwordSignIn(u.email, "Oldpass12345")).status >= 400, "the old password still works");
  equal((await passwordSignIn(u.email, "Newpass12345")).status, 200, "the new password");
});

statement("05.7", "Asking for a code never makes a new user", async () => {
  const email = testEmail("ghost");
  await askSignInCode(email);
  const rows = await sql(`select count(*)::int as n from auth.users where lower(email) = lower('${email}')`);
  equal(rows[0].n, 0, "users made");
});

await run(import.meta.url);
