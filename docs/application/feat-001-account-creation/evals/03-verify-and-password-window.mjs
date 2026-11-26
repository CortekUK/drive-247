// Proves spec 03 · The verify and password window in the portal.
import { statement, run, fn, equal, ok } from "../../eval-kit.mjs";
import {
  makeUser, getUser, findUserByEmail, plantCode, passwordSignIn, testEmail, forgetEmail, source,
  PENDING_EMAIL, PENDING_PASSWORD,
} from "./lib/account.mjs";

const STAND_IN = "Standin12345x";

/** A person straight out of the new signup (spec 01): signed in, both flags pending. */
async function newOperator(tag, flags = { [PENDING_EMAIL]: true, [PENDING_PASSWORD]: true }) {
  const u = await makeUser({ tag, password: STAND_IN, confirmed: true, appMeta: flags });
  const s = await passwordSignIn(u.email, STAND_IN);
  if (!s.token) throw new Error(`the test operator could not sign in (${s.status})`);
  return { ...u, token: s.token };
}

const verifyCall = (body, token) => fn("signup-verify-email", body, { as: token });
const setPassword = (password, token) => fn("signup-set-password", { password }, { as: token });

statement("03.1", "The window's functions refuse someone who is not signed in", async () => {
  const a = await fn("signup-verify-email", { action: "verify", code: "123456" });
  ok(a.status === 401 || a.status === 403, `signup-verify-email let a visitor in (${a.status})`);
  const b = await fn("signup-set-password", { password: "Chosen12345" });
  ok(b.status === 401 || b.status === 403, `signup-set-password let a visitor in (${b.status})`);
});

statement("03.2", "A password is only set after the code", async () => {
  const u = await newOperator("order");
  equal((await setPassword("Chosen12345", u.token)).data?.code, "EMAIL_NOT_CONFIRMED", "code");
});

statement("03.4", "The right code clears the email flag and records when", async () => {
  const u = await newOperator("right");
  await plantCode(u.id, "482913");
  const res = await verifyCall({ action: "verify", code: "482913" }, u.token);
  ok(res.status < 300, `the right code was refused: ${JSON.stringify(res.data)}`);
  const after = await findUserByEmail(u.email);
  equal(after.app_meta?.[PENDING_EMAIL] ?? false, false, PENDING_EMAIL);
  ok(after.app_meta?.d247_signup?.emailVerifiedAt, "emailVerifiedAt was not recorded");
});

statement("03.5", "A wrong code says how many tries are left; after 5 even the right code is refused", async () => {
  const u = await newOperator("wrong");
  await plantCode(u.id, "111111");
  const first = await verifyCall({ action: "verify", code: "999999" }, u.token);
  equal(first.data?.code, "OTP_INVALID", "a wrong code");
  equal(first.data?.attemptsRemaining, 4, "tries left after one wrong code");
  await plantCode(u.id, "111111", { attempts: 5 });
  equal((await verifyCall({ action: "verify", code: "111111" }, u.token)).data?.code, "OTP_LOCKED", "after 5 wrong codes");
});

statement("03.6", "A code older than 30 minutes is refused as expired", async () => {
  const u = await newOperator("old");
  await plantCode(u.id, "222222", { minutesAgo: 31 });
  equal((await verifyCall({ action: "verify", code: "222222" }, u.token)).data?.code, "OTP_EXPIRED", "code");
});

statement("03.7", "A new code is refused within 60 seconds of the last one", async () => {
  const u = await newOperator("resend");
  await plantCode(u.id, "333333");
  const res = await verifyCall({ action: "resend" }, u.token);
  equal(res.status, 429, "status");
  equal(res.data?.code, "RESEND_COOLDOWN", "code");
});

statement("03.8", "Wrong email: a taken or invalid address is refused, a good one replaces it", async () => {
  const u = await newOperator("fix");
  const other = await makeUser({ tag: "other", password: "Other12345x" });
  equal((await verifyCall({ action: "change_email", newEmail: other.email }, u.token)).data?.code, "EMAIL_TAKEN", "an address with an account");
  equal((await verifyCall({ action: "change_email", newEmail: "not-an-email" }, u.token)).data?.code, "EMAIL_INVALID", "a broken address");
  const fixed = testEmail("fixed");
  forgetEmail(fixed);
  const res = await verifyCall({ action: "change_email", newEmail: fixed }, u.token);
  ok(res.status < 300, `a good address was refused: ${JSON.stringify(res.data)}`);
  const after = await getUser(u.id);
  equal(after.email, fixed, "the account's email");
  ok(after.app_metadata?.d247_signup?.otp?.hash, "no new code was made for the new address");
});

statement("03.9", "The email cannot be changed this way once it is verified", async () => {
  const u = await newOperator("verified", { [PENDING_PASSWORD]: true });
  const fixed = testEmail("late");
  forgetEmail(fixed);
  equal((await verifyCall({ action: "change_email", newEmail: fixed }, u.token)).data?.code, "ALREADY_CONFIRMED", "code");
});

statement("03.10", "A password that breaks the rule is refused", async () => {
  const u = await newOperator("rule", { [PENDING_PASSWORD]: true });
  for (const bad of ["short1", "allletters", "12345678"]) {
    equal((await setPassword(bad, u.token)).data?.code, "PASSWORD_RULE", `"${bad}"`);
  }
});

statement("03.11", "Saving the password clears the flag and the stand-in stops working", async () => {
  const u = await newOperator("save", { [PENDING_PASSWORD]: true });
  const res = await setPassword("Chosen12345", u.token);
  ok(res.status < 300, `the password was refused: ${JSON.stringify(res.data)}`);
  equal((await findUserByEmail(u.email)).app_meta?.[PENDING_PASSWORD] ?? false, false, PENDING_PASSWORD);
  ok((await passwordSignIn(u.email, STAND_IN)).status >= 400, "the stand-in still signs in");
  equal((await passwordSignIn(u.email, "Chosen12345")).status, 200, "the new password");
});

statement("03.13", "The window reuses PasswordChangePanelV2", async () => {
  let src = "";
  try { src = source("apps/portal/src/components/onboarding/verify-account-dialog-v2.tsx"); } catch { /* not built yet */ }
  ok(/PasswordChangePanelV2/.test(src), "verify-account-dialog-v2.tsx is missing or does not use PasswordChangePanelV2");
});

await run(import.meta.url);
