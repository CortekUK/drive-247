// feat-001 step 4 (spec 01): the REAL signup-begin, run in Deno against an
// in-memory Supabase (Auth + a permissive PostgREST) and a fake email sender.
// No network, no keys, nothing deployed.
//
// Run from the repo root:
//   deno test -A --no-check supabase/functions/_tests/signup-begin-3step_test.ts
// deno-lint-ignore-file no-explicit-any

for (const [k, v] of Object.entries({
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUPABASE_ANON_KEY: "anon-key",
  SIGNUP_OTP_PEPPER: "test-pepper",
  RESEND_API_KEY: "re_test",
  SIGNUP_STRIPE_MODE: "test",
})) Deno.env.set(k, v);

const { hashCode } = await import("../_shared/signup-otp.ts");

// ── in-memory world ─────────────────────────────────────────────────────────
type User = { id: string; email: string; password: string; email_confirmed_at: string | null; app_metadata: any; user_metadata: any };
const users = new Map<string, User>();
const rows: Record<string, any[]> = {}; // table -> inserted rows
const emails: Array<{ to: string; subject: string }> = [];
const otherHosts: string[] = [];
let resendDown = false;

const json = (b: unknown, s = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", ...h } });
const view = (u: User) => ({ id: u.id, email: u.email, email_confirmed_at: u.email_confirmed_at, app_metadata: u.app_metadata, user_metadata: u.user_metadata, aud: "authenticated" });

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const req = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.protocol === "file:" || url.host.endsWith("esm.sh") || url.host === "deno.land") return realFetch(input, init);
  if (url.host === "api.resend.com") {
    if (resendDown) return json({ message: "down" }, 503);
    const b = await req.json();
    emails.push({ to: Array.isArray(b.to) ? b.to[0] : b.to, subject: b.subject });
    return json({ id: `em_${emails.length}` });
  }
  if (url.host === "supabase.test") {
    const p = url.pathname;
    if (p.startsWith("/rest/v1/")) {
      const table = p.slice("/rest/v1/".length).split("?")[0];
      if (req.method === "HEAD") return new Response(null, { status: 200, headers: { "Content-Range": "*/0" } });
      if (req.method === "POST" || req.method === "PATCH") {
        const text = await req.text();
        let body: any = null;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        (rows[table] ??= []).push(...(Array.isArray(body) ? body : [body]));
        return json(Array.isArray(body) ? body : [body], 201);
      }
      if (table === "app_users") {
        const want = (url.searchParams.get("email") ?? "").replace(/^ilike\./, "").toLowerCase();
        return json((rows.app_users ?? []).filter((r) => String(r.email).toLowerCase() === want), 200, { "Content-Range": "0-0/*" });
      }
      return json([], 200, { "Content-Range": "*/0" });
    }
    if (p === "/auth/v1/admin/users" && req.method === "GET") {
      const f = (url.searchParams.get("filter") ?? "").toLowerCase();
      return json({ users: [...users.values()].filter((u) => u.email.includes(f)).map(view) });
    }
    if (p === "/auth/v1/admin/users" && req.method === "POST") {
      const b = await req.json();
      if ([...users.values()].some((u) => u.email === b.email)) return json({ code: "email_exists", msg: "A user with this email address has already been registered" }, 422);
      const u: User = { id: crypto.randomUUID(), email: b.email, password: b.password, email_confirmed_at: b.email_confirm ? new Date().toISOString() : null, app_metadata: b.app_metadata ?? {}, user_metadata: b.user_metadata ?? {} };
      users.set(u.id, u);
      return json(view(u));
    }
    const m = p.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (m) {
      const u = users.get(m[1]);
      if (!u) return json({ msg: "User not found" }, 404);
      if (req.method === "GET") return json(view(u));
      if (req.method === "PUT") {
        const b = await req.json();
        if (b.app_metadata) u.app_metadata = { ...u.app_metadata, ...b.app_metadata };
        return json(view(u));
      }
    }
    return json({ msg: `not handled ${req.method} ${p}` }, 404);
  }
  otherHosts.push(url.host);
  return json({}, 200); // e.g. Meta's conversions API: answered, and noted
};

let handler: (r: Request) => Promise<Response>;
Object.defineProperty(Deno, "serve", { configurable: true, writable: true, value: (h: any) => { handler = h; return { finished: Promise.resolve() }; } });
await import("../signup-begin/index.ts");

let ipN = 0;
async function begin(body: Record<string, unknown>) {
  ipN++;
  const res = await handler(new Request("http://supabase.test/functions/v1/signup-begin", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.0.${ipN}` },
    body: JSON.stringify({ fullName: "Test Operator", password: "Standin12345abcA1", planId: "growth", ...body }),
  }));
  return { status: res.status, json: await res.json() };
}
const byEmail = (e: string) => [...users.values()].find((u) => u.email === e);
function eq(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── spec 01 ─────────────────────────────────────────────────────────────────
Deno.test("01.2 the account is created ready to sign in, with the stand-in password", async () => {
  const r = await begin({ email: "new1@example.com" });
  eq(r.status, 200, "status");
  const u = byEmail("new1@example.com")!;
  if (!u) throw new Error("no user was made");
  if (!u.email_confirmed_at) throw new Error("not ready to sign in (email_confirm false)");
  eq(u.password, "Standin12345abcA1", "the password the browser sent (the stand-in)");
  eq(u.user_metadata.role, "head_admin", "role");
});

Deno.test("01.3 the answer sends the browser straight on: no code screen, 3-step signup", async () => {
  const r = await begin({ email: "new2@example.com" });
  eq([r.json.requiresVerification, r.json.threeStep, r.json.stage], [false, true, "account_created"], "answer");
  if (JSON.stringify(r.json).includes("Standin12345abcA1")) throw new Error("the password was echoed back");
});

Deno.test("01.4 both 'still to do' flags are set on the account, server-side", async () => {
  await begin({ email: "new3@example.com" });
  const meta = byEmail("new3@example.com")!.app_metadata;
  eq([meta.d247_signup_email_pending, meta.d247_signup_password_pending], [true, true], "flags");
  eq(meta.d247_signup.v, 1, "the signup record keeps its version");
  eq(meta.d247_signup.planId, "growth", "plan");
});

Deno.test("01.5 the code is emailed when the account is made, and it is the stored one", async () => {
  const before = emails.length;
  await begin({ email: "new4@example.com" });
  eq(emails.length, before + 1, "one email");
  const mail = emails.at(-1)!;
  eq(mail.to, "new4@example.com", "to the new address");
  const code = mail.subject.match(/\d{6}/)?.[0];
  if (!code) throw new Error(`no code in the subject: ${mail.subject}`);
  const otp = byEmail("new4@example.com")!.app_metadata.d247_signup.otp;
  eq(otp.hash, await hashCode(code), "the stored code matches the emailed one");
  eq(otp.attempts, 0, "no tries used");
});

Deno.test("01.5 if the email can't be sent, the signup still goes on (they can ask again in the portal)", async () => {
  resendDown = true;
  try {
    const r = await begin({ email: "new5@example.com" });
    eq([r.status, r.json.threeStep], [200, true], "signup continues");
    eq(byEmail("new5@example.com")!.app_metadata.d247_signup_email_pending, true, "email still to confirm");
  } finally {
    resendDown = false;
  }
});

Deno.test("01.10 an email that already has an account is refused, and no second account is made", async () => {
  await begin({ email: "taken@example.com" });
  const count = () => [...users.values()].filter((u) => u.email === "taken@example.com").length;
  const r = await begin({ email: "Taken@Example.com" });
  if (r.status < 400) throw new Error(`a second signup was accepted (${r.status})`);
  eq(count(), 1, "accounts with that email");
});

Deno.test("01.10 portal staff with that email are refused", async () => {
  (rows.app_users ??= []).push({ id: "a1", email: "staff@example.com", auth_user_id: null });
  const r = await begin({ email: "staff@example.com" });
  eq([r.status, r.json.code], [409, "EMAIL_EXISTS_SIGN_IN"], "refused");
  eq(byEmail("staff@example.com"), undefined, "no account made");
});

Deno.test("edge: the honeypot field makes nothing, but answers like a success", async () => {
  const r = await begin({ email: "bot@example.com", companyWebsite: "http://spam.example" });
  eq(r.status, 200, "looks like success to the bot");
  eq(byEmail("bot@example.com"), undefined, "no account");
});

Deno.test("edge: a broken address or a weak password is refused before anything is made", async () => {
  eq((await begin({ email: "not-an-email" })).status >= 400, true, "bad email refused");
  eq((await begin({ email: "weak@example.com", password: "short" })).status >= 400, true, "weak password refused");
  eq(byEmail("weak@example.com"), undefined, "no account for the weak password");
});
