// Proves spec 07 · Connecting and disconnecting Google.
//
// Google's own sign-in page cannot run here, so each case starts from a test
// user given a Google identity row directly, then calls account-identity-check.
import { randomUUID } from "node:crypto";
import { statement, run, fn, equal, ok, sql } from "../../eval-kit.mjs";
import { makeUser, passwordSignIn, linkSignIn, testEmail, forgetEmail } from "./lib/account.mjs";

async function addGoogle(userId, googleEmail) {
  const sub = randomUUID().replace(/-/g, "").slice(0, 21);
  await sql(`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values ('${sub}', '${userId}', jsonb_build_object('sub','${sub}','email','${googleEmail}','email_verified',true), 'google', now(), now(), now())`);
}
const googleCount = async (userId) =>
  (await sql(`select count(*)::int as n from auth.identities where user_id='${userId}' and provider='google'`))[0].n;
const check = (body, token) => fn("account-identity-check", body, { as: token });

statement("07.4", "A Google account with a different email is refused and left unlinked", async () => {
  const u = await makeUser({ tag: "gdiff", password: "Gdiff12345x" });
  const s = await passwordSignIn(u.email, "Gdiff12345x");
  await addGoogle(u.id, testEmail("someoneelse"));
  equal((await check({ action: "check_google" }, s.token)).data?.code, "GOOGLE_EMAIL_MISMATCH", "code");
  equal(await googleCount(u.id), 0, "Google identities left");
});

statement("07.5", "A Google account already linked to another user is refused", async () => {
  const a = await makeUser({ tag: "ga", password: "Gaaaa12345" });
  const b = await makeUser({ tag: "gb", password: "Gbbbb12345" });
  await addGoogle(a.id, b.email);
  const s = await passwordSignIn(b.email, "Gbbbb12345");
  equal((await check({ action: "check_google", googleEmail: b.email }, s.token)).data?.code, "IDENTITY_IN_USE", "code");
});

statement("07.6", "Disconnect Google is refused while there is no password", async () => {
  const u = await makeUser({ tag: "gonly", confirmed: true });
  await addGoogle(u.id, u.email);
  const token = await linkSignIn(u.email);
  equal((await check({ action: "unlink_google" }, token)).data?.code, "NO_PASSWORD", "code");
  equal(await googleCount(u.id), 1, "Google identities left");
});

statement("07.7", "With a password, Disconnect Google removes the link", async () => {
  const u = await makeUser({ tag: "gboth", password: "Gboth12345x" });
  await addGoogle(u.id, u.email);
  const s = await passwordSignIn(u.email, "Gboth12345x");
  const res = await check({ action: "unlink_google" }, s.token);
  ok(res.status < 300, `unlink refused: ${JSON.stringify(res.data)}`);
  equal(await googleCount(u.id), 0, "Google identities left");
});

statement("07.8", "The last way to sign in can never be removed", async () => {
  const u = await makeUser({ tag: "glast", password: "Glast12345x" });
  const s = await passwordSignIn(u.email, "Glast12345x");
  const code = (await check({ action: "unlink_google" }, s.token)).data?.code;
  ok(code === "LAST_METHOD" || code === "NOT_LINKED", `code was ${code}`);
  equal((await passwordSignIn(u.email, "Glast12345x")).status, 200, "the password still signs in");
});

statement("07.9", "Changing the email removes the Google link", async () => {
  const u = await makeUser({ tag: "gmove", password: "Gmove12345x" });
  await addGoogle(u.id, u.email);
  const s = await passwordSignIn(u.email, "Gmove12345x");
  const next = testEmail("gmovenew");
  forgetEmail(next);
  const res = await check({ action: "email_changed", newEmail: next }, s.token);
  ok(res.status < 300, `refused: ${JSON.stringify(res.data)}`);
  equal(await googleCount(u.id), 0, "Google identities left");
});

await run(import.meta.url);
