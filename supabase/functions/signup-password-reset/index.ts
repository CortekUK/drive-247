// =============================================================================
// signup-password-reset
//
// Password recovery for the self-serve signup dialog on drive-247.com.
//
// Two actions on one endpoint:
//   { action: "request",  email }                     -> emails a 6-digit code
//   { action: "complete", email, code, newPassword }  -> verifies AND sets it
//
// THE ONE RULE THIS FILE EXISTS TO UPHOLD: verification and the password change
// happen in a SINGLE server call. The platform already has
// `reset-password-with-otp`, which — despite its name — accepts
// { email, new_password } and calls auth.admin.updateUserById with no code check
// at all. It is reachable with the public anon key, which makes it a total
// account-takeover primitive. Nothing here may be composed into that shape:
// there is deliberately no endpoint that says "this code was valid" without
// also consuming it and writing the new password in the same transaction.
//
// Deliberate departures from the existing OTP pair (send-verification-otp /
// verify-otp), each of which is a real defect in those functions:
//   * codes are stored HASHED. `verification_otps` has no migration file, so
//     its grants cannot be read from the repo, and the precedent is bad
//     (`login_attempts` carries GRANT ALL TO anon). Probed live 2026-08-02: RLS
//     IS enabled — an anon SELECT returns [] and an anon INSERT is rejected with
//     42501 — so the table is not currently writable from a browser. Hashing is
//     therefore defence in depth rather than the only thing standing between a
//     public anon key and a forged code row. Keep it: the hash is what makes a
//     future grant slip non-fatal, and note that hashing protects a LEAKED
//     table, not a WRITABLE one — the RLS check is what covers that.
//   * codes come from crypto.getRandomValues, not Math.random().
//   * the "invalidate the previous code" delete uses `.is("tenant_id", null)`.
//     send-verification-otp line 31 uses `.eq("tenant_id", tenant_id || "")`,
//     which sends `tenant_id=eq.` for a tenant-less caller — Postgres 22P02,
//     swallowed unchecked — so for exactly our population old codes are never
//     invalidated and several stay live at once.
//   * a per-email attempt cap, so a 6-digit code (~20 bits) cannot be walked.
//     verify-otp has none.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import {
  clientIp,
  checkThrottle,
  readSignupMeta,
  recordAttempt,
  signupError,
} from "../_shared/signup-state.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";

const LOG = "[signup-password-reset]";

/** Codes live 15 minutes, matching send-verification-otp so the copy is consistent. */
const CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Wrong guesses allowed before the code is destroyed. Five keeps a fat-fingered
 * paste survivable while leaving a 6-digit space (1e6) statistically untouchable:
 * an attacker gets 5 tries per issued code, and issuing codes is itself throttled.
 */
const MAX_ATTEMPTS = 5;

/** A new code cannot be requested more often than this, per address. */
const REQUEST_COOLDOWN_MS = 60_000;

/**
 * Every response to `request` is padded to this floor. The branches do wildly
 * different amounts of work — an eligible address does a GoTrue lookup, two
 * profile probes, a delete, an insert and (in the background) a Resend call,
 * while an unknown address does one lookup — and that difference is a timing
 * oracle for "does this address have an account". Chosen above the p99 of the
 * slowest branch, with the email dispatched AFTER the response is sized.
 */
const RESPONSE_FLOOR_MS = 1200;

/** app_metadata key holding reset attempt state. Service-role writable only. */
const RESET_META_KEY = "d247_pwreset";

interface ResetMeta {
  /** Wrong guesses against the currently-issued code. */
  attempts?: number;
  /** ISO of the last code issued, for the resend cooldown. */
  lastRequestAt?: string;
}

/**
 * Excludes `%` and `_` as well as whitespace and `@`.
 *
 * They are valid nowhere in a real address, but they ARE SQL LIKE wildcards,
 * and this address is handed to GoTrue's `?filter=` — a partial match. A
 * request for `%@%` would ask the auth service to scan every user on the
 * project, unauthenticated, which is a cheap CPU amplifier even though the
 * exact re-check in `findAuthUser` means it can never actually match anyone.
 */
const EMAIL_RE = /^[^\s@%_]+@[^\s@%_]+\.[^\s@%_]{2,}$/;

function canonicalEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * SHA-256 over `email:code`. Salting with the address means a stolen hash is
 * only usable against the address it was minted for, so a leaked table cannot
 * be rainbow-tabled across every pending reset at once.
 */
async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Length-independent comparison. Both operands here are fixed-width hex
 * digests, so this is belt-and-braces, but a code path that compares a secret
 * with `===` is the kind of thing that gets copied into somewhere it matters.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Uniform 6-digit code from the CSPRNG. Rejection-sampled so 0–999999 is flat. */
function generateCode(): string {
  const buf = new Uint32Array(1);
  // 4294967295 % 1000000 != 0, so a plain modulo would bias the low codes.
  // Discard the short tail instead.
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Find an auth user by exact address.
 *
 * GoTrue's `?filter=` is a PARTIAL match, so `listUsers({ filter })` on
 * "bob@x.com" also returns "rob@x.com.attacker.net". Every caller in this repo
 * re-checks in JS; so do we.
 */
async function findAuthUser(admin: any, email: string): Promise<any | null> {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
    filter: email,
  });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const match = (data?.users ?? []).find(
    (u: any) => (u.email ?? "").toLowerCase() === email,
  );
  return match ?? null;
}

type Eligibility =
  | { kind: "eligible"; user: any }
  | { kind: "refer_portal"; user: any; portalUrl: string | null }
  | { kind: "refuse" };

/**
 * WHO MAY BE RESET FROM A PUBLIC MARKETING-SITE ENDPOINT.
 *
 * Default deny. The only account this may touch is one that is EXCLUSIVELY a
 * self-serve signup identity — it carries a `d247_signup` blob and is not staff
 * and not a renter. Everything else is refused, and the refusal is invisible to
 * the caller (identical response); only the email differs.
 *
 * The reasoning per class:
 *   super admin  — bypasses tenant RLS platform-wide. Resettable from a public
 *                  form would be a whole-platform takeover.
 *   tenant staff — owns customer PII, Stripe payout config and staff creation
 *                  for their tenant. They have their own portal login.
 *   renter       — belongs to a tenant's booking site, not to us. signup-begin
 *                  already refuses to touch these for the same reason.
 *   provisioned  — already has a product; this dialog has nothing to give them.
 *   unclassified — fail closed. An auth user with no blob and no profile is
 *                  exactly where a half-rebuilt staff row would hide.
 */
async function classify(admin: any, user: any): Promise<Eligibility> {
  // Staff first — the most dangerous class, so it short-circuits everything.
  const { data: appUsers, error: appErr } = await admin
    .from("app_users")
    .select("id, role, tenant_id, is_super_admin, is_active")
    .eq("auth_user_id", user.id);
  // A failed probe must NOT fall through to "eligible" — that would turn a
  // transient DB blip into a staff-account reset.
  if (appErr) {
    console.error(`${LOG} app_users probe failed:`, appErr.message);
    return { kind: "refuse" };
  }
  if ((appUsers ?? []).some((r: any) => r.is_super_admin || r.tenant_id === null)) {
    return { kind: "refuse" };
  }

  const { data: customerUsers, error: custErr } = await admin
    .from("customer_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1);
  if (custErr) {
    console.error(`${LOG} customer_users probe failed:`, custErr.message);
    return { kind: "refuse" };
  }
  if ((customerUsers ?? []).length > 0) return { kind: "refuse" };

  const meta = readSignupMeta(user);
  if (!meta) return { kind: "refuse" };

  // Already provisioned, or carries a staff row: they have a portal. Point them
  // at it rather than minting a credential for a dialog they are done with.
  if (meta.tenantId || (appUsers ?? []).length > 0) {
    let portalUrl: string | null = meta.portalUrl ?? null;
    if (!portalUrl && meta.slug) {
      portalUrl = `https://${meta.slug}.portal.drive-247.com/login`;
    }
    return { kind: "refer_portal", user, portalUrl };
  }

  return { kind: "eligible", user };
}

function codeEmailHtml(code: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0f172a">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Reset your Drive247 password</h1>
  <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px">
    Enter this code in the signup window to choose a new password. It expires in 15 minutes.
  </p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;color:#4f46e5">
    ${code}
  </div>
  <p style="font-size:13px;line-height:1.6;color:#64748b;margin:24px 0 0">
    If you didn't ask for this, you can ignore this email — your password will not change.
    Never share this code with anyone, including someone claiming to be from Drive247.
  </p>
</div>`;
}

function referEmailHtml(portalUrl: string | null): string {
  const target = portalUrl
    ? `<p style="font-size:14px;line-height:1.6;color:#475569">Sign in to your portal here: <a href="${portalUrl}" style="color:#4f46e5">${portalUrl}</a></p>`
    : "";
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#0f172a">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">About your Drive247 account</h1>
  <p style="font-size:14px;line-height:1.6;color:#475569">
    Someone asked to reset a password for this address from drive-247.com. This
    account already has a Drive247 portal, so its password is managed there rather
    than from the signup window.
  </p>
  ${target}
  <p style="font-size:13px;line-height:1.6;color:#64748b;margin-top:24px">
    If this wasn't you, no action is needed — nothing has changed. If you cannot get
    into your account, reply to this email and we'll help.
  </p>
</div>`;
}

/**
 * Fire-and-forget email. Never awaited inside the measured window: a Resend
 * round-trip only happens on SOME branches, so awaiting it would leak which
 * branch ran through response latency.
 */
function dispatchEmail(to: string, subject: string, html: string): void {
  const p = sendResendEmail({ to, subject, html })
    .then((r: any) => {
      if (!r?.success) console.error(`${LOG} email send failed:`, r?.error);
    })
    .catch((e: unknown) => console.error(`${LOG} email threw:`, e));
  // Keep the isolate alive past the response where the runtime supports it.
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

function readResetMeta(user: any): ResetMeta {
  const raw = user?.app_metadata?.[RESET_META_KEY];
  return raw && typeof raw === "object" ? (raw as ResetMeta) : {};
}

async function writeResetMeta(admin: any, user: any, next: ResetMeta | null): Promise<void> {
  // Send ONLY our key, never a spread of the whole blob.
  //
  // Two reasons. GoTrue's UpdateAppMetaData merges the submitted map into the
  // existing one — present keys overwrite, an explicit `null` deletes, and
  // ABSENT keys are preserved. So `{...app_metadata}` minus a key does not
  // delete that key, it just omits it, and the stale value survives. An
  // explicit null is the only thing that removes it.
  //
  // And spreading a snapshot back would clobber a concurrent `d247_signup`
  // write with whatever this isolate happened to read a moment ago —
  // `writeSignupMeta` re-reads before merging for exactly that reason.
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { [RESET_META_KEY]: next },
  });
  if (error) throw new Error(`app_metadata write failed: ${error.message}`);
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const startedAt = Date.now();
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return signupError("INVALID_BODY", "Malformed request.", 400);
  }

  const action = body?.action;
  const email = canonicalEmail(body?.email);
  const ip = clientIp(req);

  if (action !== "request" && action !== "complete") {
    return signupError("INVALID_BODY", "Unknown action.", 400);
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return signupError("EMAIL_INVALID", "Enter a valid email address.", 400);
  }

  // -------------------------------------------------------------------------
  // request — mint and email a code. Constant response, always.
  // -------------------------------------------------------------------------
  if (action === "request") {
    // Throttle before any user lookup so a flood cannot even enumerate timing.
    const rules = [
      ...(ip ? [{ scope: "password_reset_ip", key: ip, limit: 20, windowMs: 60 * 60 * 1000 }] : []),
      { scope: "password_reset_email", key: email, limit: 5, windowMs: 60 * 60 * 1000 },
    ];
    const allowed = await checkThrottle(admin, rules);

    // THE GATE ROW. `checkThrottle` counts rows whose `scope` is
    // `ledgerScope(rule.scope)` ("password_reset") and whose `outcome` is
    // "allowed" or "blocked" — so a row written with any other scope or outcome
    // is invisible to it and the limit silently never engages. It must also be
    // written for a BLOCK, or a blocked flood never accumulates, and it must
    // carry EVERY rule so the login_attempts fallback counts the per-email rule
    // too. Written before the work, so a crash mid-request still costs a slot.
    await recordAttempt(admin, {
      scope: "password_reset",
      ip_address: ip,
      email,
      outcome: allowed ? "allowed" : "blocked",
      throttleRules: rules.map((r) => ({ scope: r.scope, key: r.key })),
    });

    if (!allowed) {
      await sleep(Math.max(0, RESPONSE_FLOOR_MS - (Date.now() - startedAt)));
      // Deliberately the SAME success envelope. Telling a caller "you are rate
      // limited" on a specific address confirms the address is worth limiting.
      return jsonResponse({ ok: true });
    }

    try {
      const user = await findAuthUser(admin, email);
      let verdict: Eligibility = { kind: "refuse" };
      if (user) verdict = await classify(admin, user);

      if (verdict.kind === "eligible") {
        const prior = readResetMeta(verdict.user);
        const last = prior.lastRequestAt ? Date.parse(prior.lastRequestAt) : 0;
        const cooling = Number.isFinite(last) && Date.now() - last < REQUEST_COOLDOWN_MS;

        if (!cooling) {
          const code = generateCode();
          const codeHash = await hashCode(email, code);

          // Invalidate any previous code for this address FIRST, so a second
          // request can never leave two live codes. `.is("tenant_id", null)` —
          // signup owners have no tenant, and `.eq()` never matches NULL.
          await admin
            .from("verification_otps")
            .delete()
            .eq("email", email)
            .is("tenant_id", null);

          const { error: insErr } = await admin.from("verification_otps").insert({
            email,
            code: codeHash,
            tenant_id: null,
            expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
          });
          if (insErr) throw new Error(`otp insert failed: ${insErr.message}`);

          // `attempts` is a diagnostic hint only — the enforced budget lives in
          // the throttle ledger, because a counter kept here could be erased by
          // concurrent guesses all reading the same snapshot. `lastRequestAt`
          // IS load-bearing: it is what the 60s resend cooldown reads.
          await writeResetMeta(admin, verdict.user, {
            attempts: 0,
            lastRequestAt: new Date().toISOString(),
          });

          dispatchEmail(email, "Your Drive247 password reset code", codeEmailHtml(code));
        }
      } else if (verdict.kind === "refer_portal") {
        // Cooldown-gated exactly like the eligible branch. Without it this arm
        // is a mail amplifier: one "About your Drive247 account" email per
        // request, at whatever rate the throttle allows, all from our own
        // domain and all aimed at a real operator's inbox.
        const prior = readResetMeta(verdict.user);
        const last = prior.lastRequestAt ? Date.parse(prior.lastRequestAt) : 0;
        const cooling = Number.isFinite(last) && Date.now() - last < REQUEST_COOLDOWN_MS;
        if (!cooling) {
          await writeResetMeta(admin, verdict.user, {
            ...prior,
            lastRequestAt: new Date().toISOString(),
          });
          dispatchEmail(email, "About your Drive247 account", referEmailHtml(verdict.portalUrl));
        }
      }
      // verdict.kind === "refuse" and "no such user" both send nothing at all.

      // Audit row, NOT a gate row — `outcome` is deliberately outside the
      // ("allowed","blocked") set `checkThrottle` counts, so it cannot double
      // count against the limit the gate row above already recorded.
      await recordAttempt(admin, {
        scope: "password_reset_request",
        ip_address: ip,
        email,
        outcome: verdict.kind,
      });
    } catch (e) {
      // An internal failure must not change the shape of the reply — a 500 on
      // one address and a 200 on another is an existence oracle.
      console.error(`${LOG} request failed:`, e);
    }

    await sleep(Math.max(0, RESPONSE_FLOOR_MS - (Date.now() - startedAt)));
    return jsonResponse({ ok: true });
  }

  // -------------------------------------------------------------------------
  // complete — verify the code AND set the password, in this one call.
  // -------------------------------------------------------------------------
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  /** Every exit from this branch is padded — see `done`. */
  async function done(res: Response): Promise<Response> {
    // The request branch pads religiously, but this branch does wildly
    // different amounts of work per outcome too — an unknown address is one
    // GoTrue call, a wrong code is that plus two probes, a select and a write.
    // Leaving it unpadded hands back the exact existence oracle the other
    // branch spends 1200ms closing.
    await sleep(Math.max(0, RESPONSE_FLOOR_MS - (Date.now() - startedAt)));
    return res;
  }

  if (code.length !== 6) {
    return done(
      signupError("RESET_CODE_INVALID", "That code isn't right. Check it and try again.", 400),
    );
  }
  // Mirrors signup-begin exactly (length >= 10, a letter and a digit). An
  // endpoint that is anon-callable must not be a softer door into the same
  // account than the one that created it — otherwise the reset becomes a
  // password-policy downgrade you can drive from curl.
  if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return done(
      signupError(
        "RESET_PASSWORD_WEAK",
        "Use at least 10 characters, including a letter and a number.",
        400,
      ),
    );
  }
  if (newPassword.length > 72) {
    // bcrypt truncates past 72 bytes; silently accepting a longer one would
    // mean the password the user thinks they set is not the one that works.
    return done(signupError("RESET_PASSWORD_WEAK", "Use 72 characters or fewer.", 400));
  }

  // The per-EMAIL rule is the real brute-force control and it is deliberately
  // here rather than in app_metadata. A counter read off a user snapshot and
  // written back is a read-modify-write: N concurrent guesses all read the same
  // value, all pass the check, and the "5 attempts" budget becomes "5 batches".
  // Routed through the ledger the increment is an INSERT and the check a COUNT,
  // which concurrency cannot erase.
  const verifyRules = [
    ...(ip
      ? [{ scope: "password_reset_verify_ip", key: ip, limit: 30, windowMs: 60 * 60 * 1000 }]
      : []),
    { scope: "password_reset_verify_email", key: email, limit: MAX_ATTEMPTS, windowMs: CODE_TTL_MS },
  ];
  const allowed = await checkThrottle(admin, verifyRules);

  // Written BEFORE the code is checked, so a FAILED guess costs a slot. Writing
  // it only on success (as this first did) means wrong guesses are free and the
  // limit never accumulates — the exact opposite of what it is for.
  await recordAttempt(admin, {
    scope: "password_reset_verify",
    ip_address: ip,
    email,
    outcome: allowed ? "allowed" : "blocked",
    throttleRules: verifyRules.map((r) => ({ scope: r.scope, key: r.key })),
  });

  if (!allowed) {
    return done(signupError("RATE_LIMITED", "Too many attempts. Try again later.", 429));
  }

  try {
    const user = await findAuthUser(admin, email);
    // Same generic error as a wrong code: distinguishing "no such account" here
    // would re-open the enumeration the request step is careful to close.
    if (!user) {
      return done(
        signupError("RESET_CODE_INVALID", "That code isn't right or has expired.", 400),
      );
    }

    const verdict = await classify(admin, user);
    if (verdict.kind !== "eligible") {
      return done(
        signupError("RESET_CODE_INVALID", "That code isn't right or has expired.", 400),
      );
    }

    const { data: rows, error: selErr } = await admin
      .from("verification_otps")
      .select("id, code, expires_at")
      .eq("email", email)
      .is("tenant_id", null);
    if (selErr) throw new Error(`otp select failed: ${selErr.message}`);

    const now = Date.now();
    const candidateHash = await hashCode(email, code);
    // Newest first: a race that produced two rows must not let an older code win.
    const live = (rows ?? [])
      .filter((r: any) => Date.parse(r.expires_at) > now)
      .sort((a: any, b: any) => Date.parse(b.expires_at) - Date.parse(a.expires_at));
    const hit = live.find((r: any) => timingSafeEqual(String(r.code), candidateHash));

    if (!hit) {
      // The failed guess is already recorded as a gate row above, so the budget
      // shrinks whether or not anything is written here. Nothing further to do.
      return done(
        signupError("RESET_CODE_INVALID", "That code isn't right or has expired.", 400),
      );
    }

    // Consume the code BEFORE touching the password, and make the consume the
    // thing that decides who wins.
    //
    // `.delete()` alone returns no error when it matches zero rows, so two
    // concurrent requests holding the same valid code would both "successfully"
    // delete and both go on to set a different password — last write wins.
    // `.select("id")` makes the delete report what it actually removed, so
    // exactly one racer sees a row and the loser stops here.
    const { data: consumed, error: delErr } = await admin
      .from("verification_otps")
      .delete()
      .eq("id", hit.id)
      .select("id");
    if (delErr) throw new Error(`otp consume failed: ${delErr.message}`);
    if (!consumed || consumed.length !== 1) {
      return done(
        signupError("RESET_CODE_INVALID", "That code isn't right or has expired.", 400),
      );
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (pwErr) {
      // The code is already spent — say so plainly rather than pretend it can
      // be retried, and let the user request a fresh one.
      console.error(`${LOG} password update failed:`, pwErr.message);
      return done(
        signupError(
          "RESET_FAILED",
          "We couldn't set your new password. Request a new code and try again.",
          500,
        ),
      );
    }

    await writeResetMeta(admin, user, null);

    // Best-effort revocation of other sessions. GoTrue revokes refresh tokens on
    // an admin password change, but this repo has previously found
    // auth.admin.signOut to be a no-op in places, so it is belt-and-braces and
    // its failure must not fail the reset the user just completed.
    try {
      await admin.auth.admin.signOut(user.id, "global");
    } catch (e) {
      console.error(`${LOG} signOut best-effort failed:`, e);
    }

    await recordAttempt(admin, {
      scope: "password_reset_complete",
      ip_address: ip,
      email,
      auth_user_id: user.id,
      outcome: "success",
    });

    return done(jsonResponse({ ok: true }));
  } catch (e) {
    console.error(`${LOG} complete failed:`, e);
    return done(signupError("RESET_FAILED", "Something went wrong. Please try again.", 500));
  }
});
