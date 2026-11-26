// Proves spec 01 · Signup in three steps, against staging.
import { statement, run, fn, sql, equal, ok } from "../../eval-kit.mjs";
import { testEmail, forgetEmail, findUserByEmail, makeUser, source, PENDING_EMAIL, PENDING_PASSWORD } from "./lib/account.mjs";

let planId = null;
async function aPlan() {
  if (!planId) [{ id: planId }] = await sql(`select plan_key as id from signup_plans where is_visible order by sort_order limit 1`);
  return planId;
}
const beginBody = async (email) => ({ fullName: "Eval Feat001", email, password: "Evalstandin1", planId: await aPlan() });

// One real signup-begin, shared by the statements about what it makes.
let begun = null;
async function begin() {
  if (begun) return begun;
  const email = testEmail("begin");
  forgetEmail(email);
  const res = await fn("signup-begin", await beginBody(email));
  begun = { email, res, user: await findUserByEmail(email) };
  return begun;
}

statement("01.2", "signup-begin makes the user with a stand-in password and the email pending", async () => {
  const { res, user } = await begin();
  ok(res.status < 300, `signup-begin refused: ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
  ok(user, "no user was made");
  ok(user.has_password, "the user has no password at all");
  ok(user.email_confirmed_at, "Supabase does not treat the email as confirmed, so no session can be made");
});

statement("01.3", "signup-begin sends the browser straight on, and the account signs in at once", async () => {
  const { res, email } = await begin();
  equal([res.data?.requiresVerification, res.data?.threeStep], [false, true], "answer");
  const { passwordSignIn } = await import("./lib/account.mjs");
  equal((await passwordSignIn(email, "Evalstandin1")).status, 200, "signing in with the password the browser sent");
});

statement("01.4", "The new user is marked email-pending and password-pending in app_metadata", async () => {
  const { user } = await begin();
  equal(user?.app_meta?.[PENDING_EMAIL], true, PENDING_EMAIL);
  equal(user?.app_meta?.[PENDING_PASSWORD], true, PENDING_PASSWORD);
});

statement("01.5", "signup-begin sends the email code when the account is made", async () => {
  const { user } = await begin();
  const otp = user?.app_meta?.d247_signup?.otp;
  ok(otp?.hash && otp?.sentAt, "no code was stored for the new user");
});

statement("01.6", "A Google signup sets neither pending flag", async () => {
  const g = await makeUser({ tag: "google", confirmed: true, appMeta: { provider: "google", providers: ["google"] } });
  const res = await fn("signup-begin-oauth", { email: g.email }, { as: "service" });
  const user = await findUserByEmail(g.email);
  ok(res.status < 500, `signup-begin-oauth failed: ${res.status}`);
  equal(user?.app_meta?.[PENDING_EMAIL] ?? false, false, PENDING_EMAIL);
  equal(user?.app_meta?.[PENDING_PASSWORD] ?? false, false, PENDING_PASSWORD);
});

statement("01.10", "An email that already has an account is refused and no second user is made", async () => {
  const existing = await makeUser({ tag: "taken", password: "Existing12345" });
  const res = await fn("signup-begin", await beginBody(existing.email));
  ok(res.status >= 400, `a second signup was accepted (${res.status})`);
  ok(res.data?.code !== "PLAN_UNKNOWN" && res.data?.code !== "INVALID_BODY", `refused for the wrong reason: ${res.data?.code}`);
  ok(!res.data?.session, "a session was handed out for an address that already has an account");
  const again = await findUserByEmail(existing.email);
  equal(again.id, existing.id, "the user id");
});

statement("01.13", "The stand-in password is never put in localStorage or logged", async () => {
  const src = source("apps/web/src/components/onboarding/signup-stand-in.ts");
  ok(!/localStorage/.test(src), "signup-stand-in.ts uses localStorage");
  ok(!/console\.(log|info|warn|error)/.test(src), "signup-stand-in.ts logs");
});

await run(import.meta.url);
