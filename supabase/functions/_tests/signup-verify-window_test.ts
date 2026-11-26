// feat-001 spec 03 (server side): the REAL signup-verify-email and
// signup-set-password, run in Deno against an in-memory Supabase Auth and a
// fake email sender. No network, no keys, nothing deployed.
//
// Run from the repo root:
//   deno test -A --no-check supabase/functions/_tests/signup-verify-window_test.ts
// deno-lint-ignore-file no-explicit-any

for (const [k, v] of Object.entries({
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUPABASE_ANON_KEY: "anon-key",
  SIGNUP_OTP_PEPPER: "test-pepper",
  RESEND_API_KEY: "re_test",
})) Deno.env.set(k, v);

const { hashCode } = await import("../_shared/signup-otp.ts");

// ── in-memory Supabase Auth ────────────────────────────────────────────────
type User = { id: string; email: string; password: string | null; app_metadata: Record<string, any>; user_metadata: Record<string, any>; email_confirmed_at: string | null };
const users = new Map<string, User>();
const tokens = new Map<string, string>(); // token -> user id
const emails: Array<{ to: string; subject: string }> = [];

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const view = (u: User) => ({ id: u.id, email: u.email, app_metadata: u.app_metadata, user_metadata: u.user_metadata, email_confirmed_at: u.email_confirmed_at, aud: "authenticated", role: "authenticated" });

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const req = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.protocol === "file:" || url.host.endsWith("esm.sh") || url.host === "deno.land") return realFetch(input, init);
  if (url.host === "api.resend.com") {
    const b = await req.json();
    emails.push({ to: Array.isArray(b.to) ? b.to[0] : b.to, subject: b.subject });
    return json({ id: `em_${emails.length}` });
  }
  if (url.host === "supabase.test") {
    if (url.pathname.startsWith("/rest/v1/")) return json([], 201); // email_send_log and friends
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const id = tokens.get((req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, ""));
      const u = id ? users.get(id) : undefined;
      return u ? json(view(u)) : json({ msg: "invalid JWT" }, 401);
    }
    const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m) {
      const u = users.get(m[1]);
      if (!u) return json({ msg: "User not found" }, 404);
      if (req.method === "GET") return json(view(u));
      if (req.method === "PUT") {
        const b = await req.json();
        if (b.email && b.email !== u.email) {
          if ([...users.values()].some((x) => x.email === b.email)) return json({ code: "email_exists", msg: "A user with this email address has already been registered" }, 422);
          u.email = b.email;
        }
        if (b.password) u.password = b.password;
        if (b.email_confirm) u.email_confirmed_at ??= new Date().toISOString();
        if (b.app_metadata) u.app_metadata = { ...u.app_metadata, ...b.app_metadata }; // GoTrue merges shallowly
        return json(view(u));
      }
    }
  }
  throw new Error(`unexpected network call ${req.method} ${req.url}`);
};

// ── load the two real functions, capturing their handlers ──────────────────
const handlers = new Map<string, (r: Request) => Promise<Response>>();
let loading = "";
Object.defineProperty(Deno, "serve", { configurable: true, writable: true, value: (h: any) => { handlers.set(loading, h); return { finished: Promise.resolve() }; } });
for (const name of ["signup-verify-email", "signup-set-password"]) {
  loading = name;
  await import(`../${name}/index.ts`);
}

async function call(name: string, body: unknown, token?: string) {
  const res = await handlers.get(name)!(new Request(`http://supabase.test/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
}

/** A person straight out of the 3-step signup: signed in, both flags set. */
let n = 0;
function newOperator(flags: Record<string, boolean> = { d247_signup_email_pending: true, d247_signup_password_pending: true }) {
  n++;
  const u: User = {
    id: crypto.randomUUID(), email: `op${n}@example.com`, password: "stand-in-a1", email_confirmed_at: new Date().toISOString(),
    app_metadata: { ...flags, d247_signup: { v: 1, email: `op${n}@example.com`, fullName: "Test Operator" } }, user_metadata: {},
  };
  users.set(u.id, u);
  const token = `tok_${u.id}`;
  tokens.set(token, u.id);
  return { u, token };
}

async function plant(u: User, code: string, opts: { minutesAgo?: number; attempts?: number } = {}) {
  const sent = Date.now() - (opts.minutesAgo ?? 0) * 60_000;
  u.app_metadata.d247_signup = {
    ...u.app_metadata.d247_signup,
    otp: { hash: await hashCode(code), expiresAt: new Date(sent + 30 * 60_000).toISOString(), attempts: opts.attempts ?? 0, sentAt: new Date(sent).toISOString() },
  };
}

function eq(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── spec 03 ─────────────────────────────────────────────────────────────────
Deno.test("03.1 both functions refuse someone who is not signed in", async () => {
  eq((await call("signup-verify-email", { action: "verify", code: "123456" })).status, 401, "verify-email, no token");
  eq((await call("signup-verify-email", { action: "verify", code: "123456" }, "tok_forged")).status, 401, "verify-email, a made-up token");
  eq((await call("signup-set-password", { password: "Chosen12345" })).status, 401, "set-password, no token");
});

Deno.test("03.2 a password is only set after the code", async () => {
  const { token } = newOperator();
  eq((await call("signup-set-password", { password: "Chosen12345" }, token)).json.code, "EMAIL_NOT_CONFIRMED", "code");
});

Deno.test("03.4 the right code clears the email flag, records when, and the code is spent", async () => {
  const { u, token } = newOperator();
  await plant(u, "482913");
  const r = await call("signup-verify-email", { action: "verify", code: "482913" }, token);
  eq([r.status, r.json.verified], [200, true], "answer");
  eq(u.app_metadata.d247_signup_email_pending, false, "email flag");
  eq(u.app_metadata.d247_signup_password_pending, true, "password flag untouched");
  if (!u.app_metadata.d247_signup.emailVerifiedAt) throw new Error("emailVerifiedAt not recorded");
  eq(u.app_metadata.d247_signup.otp, undefined, "the code is removed");
  eq(u.app_metadata.d247_signup.v, 1, "the signup blob keeps its version");
  eq((await call("signup-verify-email", { action: "verify", code: "482913" }, token)).json.alreadyVerified, true, "a second try is harmless");
});

Deno.test("03.5 a wrong code says the tries left; the 5th locks it, even for the right code", async () => {
  const { u, token } = newOperator();
  await plant(u, "111111");
  const lefts: number[] = [];
  for (let i = 0; i < 4; i++) lefts.push((await call("signup-verify-email", { action: "verify", code: "999999" }, token)).json.attemptsRemaining);
  eq(lefts, [4, 3, 2, 1], "tries left after each wrong code");
  const fifth = await call("signup-verify-email", { action: "verify", code: "999999" }, token);
  eq([fifth.status, fifth.json.code], [429, "OTP_LOCKED"], "the 5th wrong code");
  eq((await call("signup-verify-email", { action: "verify", code: "111111" }, token)).json.code, "OTP_LOCKED", "the right code after 5 misses");
  eq(u.app_metadata.d247_signup_email_pending, true, "still not proved");
});

Deno.test("03.6 a code older than 30 minutes is refused as expired", async () => {
  const { u, token } = newOperator();
  await plant(u, "222222", { minutesAgo: 31 });
  eq((await call("signup-verify-email", { action: "verify", code: "222222" }, token)).json.code, "OTP_EXPIRED", "31 minutes");
  await plant(u, "222222", { minutesAgo: 29 });
  eq((await call("signup-verify-email", { action: "verify", code: "222222" }, token)).json.verified, true, "29 minutes still works");
});

Deno.test("03.7 a new code: refused within 60 s, then sent, and the old code stops working", async () => {
  const { u, token } = newOperator();
  await plant(u, "333333");
  const early = await call("signup-verify-email", { action: "resend" }, token);
  eq([early.status, early.json.code], [429, "RESEND_COOLDOWN"], "within 60 s");
  if (!(early.json.retryAfterSeconds > 0 && early.json.retryAfterSeconds <= 60)) throw new Error(`retryAfterSeconds ${early.json.retryAfterSeconds}`);
  await plant(u, "333333", { minutesAgo: 2 });
  const before = emails.length;
  const r = await call("signup-verify-email", { action: "resend" }, token);
  eq([r.status, r.json.resent], [200, true], "after 60 s");
  eq(emails.length, before + 1, "one email sent");
  eq(emails.at(-1)!.to, u.email, "to the account's address");
  eq((await call("signup-verify-email", { action: "verify", code: "333333" }, token)).json.code, "OTP_INVALID", "the old code no longer works");
});

Deno.test("03.8 wrong email: refused if invalid, the same, or taken; a good one replaces it and gets the code", async () => {
  const { u, token } = newOperator();
  const { u: other } = newOperator();
  eq((await call("signup-verify-email", { action: "change_email", newEmail: "not-an-email" }, token)).json.code, "EMAIL_INVALID", "broken address");
  eq((await call("signup-verify-email", { action: "change_email", newEmail: u.email.toUpperCase() }, token)).json.code, "EMAIL_SAME", "same address");
  eq((await call("signup-verify-email", { action: "change_email", newEmail: other.email }, token)).json.code, "EMAIL_TAKEN", "an address with an account");
  eq(u.email.startsWith("op"), true, "unchanged after refusals");
  const before = emails.length;
  const r = await call("signup-verify-email", { action: "change_email", newEmail: "  Fixed.Address@Example.com " }, token);
  eq([r.status, r.json.email], [200, "fixed.address@example.com"], "answer");
  eq(u.email, "fixed.address@example.com", "the account's email");
  eq(u.app_metadata.d247_signup.email, "fixed.address@example.com", "the signup record's email");
  eq(emails.length, before + 1, "one email sent");
  eq(emails.at(-1)!.to, "fixed.address@example.com", "the code went to the new address only");
  eq(u.app_metadata.d247_signup_email_pending, true, "still to be proved at the new address");
  eq((await call("signup-verify-email", { action: "change_email", newEmail: "again@example.com" }, token)).json.code, "RESEND_COOLDOWN", "a second change waits 60 s too");
});

Deno.test("03.9 the email cannot be changed this way once it is proved", async () => {
  const { token } = newOperator({ d247_signup_password_pending: true });
  eq((await call("signup-verify-email", { action: "change_email", newEmail: "late@example.com" }, token)).json.code, "ALREADY_CONFIRMED", "code");
  eq((await call("signup-verify-email", { action: "resend" }, token)).json.code, "ALREADY_CONFIRMED", "no new code either");
});

Deno.test("03.10 a password that breaks the rule is refused", async () => {
  const { token } = newOperator({ d247_signup_password_pending: true });
  // 73 characters: one over the 72 the rule allows (bcrypt reads no further).
  for (const bad of ["short1", "allletters", "12345678", "", "x".repeat(72) + "1"]) {
    eq((await call("signup-set-password", { password: bad }, token)).json.code, "PASSWORD_RULE", JSON.stringify(bad).slice(0, 20));
  }
});

Deno.test("03.11 saving the password replaces the stand-in and clears the flag", async () => {
  const { u, token } = newOperator({ d247_signup_password_pending: true });
  const r = await call("signup-set-password", { password: "Chosen12345" }, token);
  eq([r.status, r.json.ok], [200, true], "answer");
  eq(u.password, "Chosen12345", "the new password is set");
  eq(u.app_metadata.d247_signup_password_pending, false, "flag cleared");
  eq((await call("signup-set-password", { password: "Another12345" }, token)).json.code, "NOT_PENDING", "a second time goes to the profile instead");
});
