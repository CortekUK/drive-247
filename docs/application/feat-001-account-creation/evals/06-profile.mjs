// Proves spec 06 · The profile panel (built behaviour, plus 06.10).
import { statement, run, equal, ok, sql } from "../../eval-kit.mjs";
import { makeUser, passwordSignIn, testEmail, forgetEmail, updateUser, updateSelf, getUser, source } from "./lib/account.mjs";

statement("06.3", "The photo picker refuses non-images and files over its size limit", async () => {
  const src = source("apps/portal/src/components/shared/layout/profile-sheet-v2.tsx");
  ok(/image\//.test(src), "the profile sheet does not check the file is an image");
  ok(/\.size\s*>/.test(src), "the profile sheet does not check the file size");
});

statement("06.5", "An email change only happens after the code to the new address", async () => {
  const u = await makeUser({ tag: "chg", password: "Change12345" });
  const s = await passwordSignIn(u.email, "Change12345");
  const next = testEmail("chgnew");
  forgetEmail(next);
  // What the profile sheet calls. Staging may fail to send the code to an
  // example.com address; either way the email must not change yet.
  await updateSelf(s.token, { email: next });
  equal((await getUser(u.id)).email, u.email, "the email before the code");
});

statement("06.6", "An email that belongs to another account is refused", async () => {
  const a = await makeUser({ tag: "a", password: "Aaaaa12345" });
  const b = await makeUser({ tag: "b", password: "Bbbbb12345" });
  const s = await passwordSignIn(a.email, "Aaaaa12345");
  ok((await updateSelf(s.token, { email: b.email })).status >= 400, "the change to a taken address was accepted");
});

statement("06.7", "After an email change the new email signs in and the old does not", async () => {
  const u = await makeUser({ tag: "moved", password: "Moved12345x" });
  const next = testEmail("movednew");
  forgetEmail(next);
  await updateUser(u.id, { email: next, email_confirm: true }); // the end of the code flow
  equal((await passwordSignIn(next, "Moved12345x")).status, 200, "the new email");
  ok((await passwordSignIn(u.email, "Moved12345x")).status >= 400, "the old email still signs in");
});

statement("06.8", "Changing the password: the old one stops working", async () => {
  const u = await makeUser({ tag: "pw", password: "Before12345" });
  await updateUser(u.id, { password: "After123456" });
  ok((await passwordSignIn(u.email, "Before12345")).status >= 400, "the old password still works");
  equal((await passwordSignIn(u.email, "After123456")).status, 200, "the new password");
});

statement("06.9", "Invited staff are made with must_change_password", async () => {
  const src = source("supabase/functions/admin-create-user/index.ts");
  ok(/must_change_password:\s*(true|!isExistingUser)/.test(src), "admin-create-user does not set must_change_password for new users");
  const cols = await sql(`select 1 from information_schema.columns where table_schema='public' and table_name='app_users' and column_name='must_change_password'`);
  equal(cols.length, 1, "app_users.must_change_password exists");
});

statement("06.10", "Temporary staff passwords are not made with Math.random", async () => {
  ok(!/Math\.random/.test(source("apps/portal/src/app/(dashboard)/users/page.tsx")), "users/page.tsx still uses Math.random");
});

await run(import.meta.url);
