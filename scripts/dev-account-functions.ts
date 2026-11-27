// =============================================================================
// Local test runner for feat-001 (development only, never deployed).
//
// Serves the signup and account edge functions from THIS checkout on
// http://127.0.0.1:54399, against the STAGING database, so their new code can
// be checked on localhost before Ghulam deploys it to staging.
//
//   deno run -A --no-lock scripts/dev-account-functions.ts
//
// Then point the local apps at it (development builds only):
//   apps/web/.env.local     NEXT_PUBLIC_SIGNUP_FUNCTIONS_URL=http://127.0.0.1:54399
//   apps/portal/.env.local  NEXT_PUBLIC_SIGNUP_FUNCTIONS_URL=http://127.0.0.1:54399
// and remove those lines when done.
//
// Safety:
// - Refuses to start unless .staging-credentials.local is for the staging project.
// - Emails are NOT sent. Each one is printed here instead, with its 6-digit code
//   and any signup link, so you can read them in this window.
// - Stripe: always test mode, and no Stripe secret is loaded, so the card step
//   cannot take a payment from here (it shows "Signup is temporarily
//   unavailable"). Card checks are done on ray2.
// =============================================================================

const ROOT = new URL("../", import.meta.url);
const creds = Deno.readTextFileSync(new URL(".staging-credentials.local", ROOT));
const get = (n: string) => {
  const m = creds.match(new RegExp(`^${n}=(.*)$`, "m"));
  if (!m) throw new Error(`${n} missing from .staging-credentials.local`);
  return m[1].trim();
};
const REF = get("STAGING_REF");
if (REF !== "csjouxrkblpsoihyejel") throw new Error("Refusing: .staging-credentials.local is not the staging project.");

Deno.env.set("SUPABASE_URL", `https://${REF}.supabase.co`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", get("STAGING_SERVICE_ROLE_KEY"));
Deno.env.set(
  "SUPABASE_DB_URL",
  `postgresql://postgres.${REF}:${encodeURIComponent(get("STAGING_DB_PASS"))}@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`,
);
Deno.env.set("SIGNUP_OTP_PEPPER", get("STAGING_SERVICE_ROLE_KEY"));
Deno.env.set("RESEND_API_KEY", "re_local_stub");
// Never live: test mode, and no Stripe key of any kind.
Deno.env.set("SIGNUP_STRIPE_MODE", "test");
for (const k of Object.keys(Deno.env.toObject())) if (/STRIPE/.test(k)) Deno.env.delete(k);

// Emails: print, do not send.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request && !init ? input : new Request(input, init);
  if (new URL(req.url).host === "api.resend.com") {
    const b = await req.clone().json().catch(() => ({}));
    console.log(`\n>>> EMAIL (not sent) to ${b.to}: ${b.subject}`);
    const body = String(b.text ?? b.html ?? "");
    const code = body.match(/>\s*(\d{6})\s*</) ?? String(b.subject ?? "").match(/\b(\d{6})\b/);
    if (code) console.log(`>>> CODE ${code[1]}`);
    for (const m of String(b.html ?? "").matchAll(/href="([^"]+)"/g)) {
      if (/signup|finish|token/i.test(m[1])) console.log(`>>> LINK ${m[1].replace(/&amp;/g, "&")}`);
    }
    return new Response(JSON.stringify({ id: "local" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
};

const FUNCTIONS = [
  "signup-begin",
  "signup-begin-oauth",
  "signup-verify-otp",
  "signup-resume",
  "signup-slug-check",
  "signup-attribution",
  "signup-finish-later",
  "signup-lead",
  "signup-password-reset",
  "signup-payment-intent",
  "signup-payment-intent-v2",
  "signup-provision",
  "signup-verify-email",
  "signup-set-password",
  "account-identity-check",
  "promo-code-lookup",
];

const handlers = new Map<string, (r: Request) => Response | Promise<Response>>();
let loading = "";
const realServe = Deno.serve.bind(Deno);
Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: (h: (r: Request) => Response | Promise<Response>) => {
    handlers.set(loading, h);
    return { finished: Promise.resolve() };
  },
});
for (const name of FUNCTIONS) {
  loading = name;
  await import(new URL(`supabase/functions/${name}/index.ts`, ROOT).href);
}

realServe({ port: 54399, hostname: "127.0.0.1" }, async (req: Request) => {
  const name = new URL(req.url).pathname.replace(/^\/+/, "").split("/")[0];
  const h = handlers.get(name);
  if (!h) return new Response(JSON.stringify({ error: `no function ${name}` }), { status: 404 });
  const res = await h(req);
  console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${name} -> ${res.status}`);
  return res;
});
console.log("feat-001 functions on http://127.0.0.1:54399 (staging data, emails printed here)");
