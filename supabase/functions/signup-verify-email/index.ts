// =============================================================================
// signup-verify-email — feat-001 spec 03: the portal's "check your email"
// window, for an account made by the 3-step signup.
//
// The person is SIGNED IN (they land in their portal after the card), so every
// action works on the caller's own account, found from their token. Nothing is
// looked up by email, so nothing here can tell anyone whether an address has an
// account.
//
//   { action: "verify", code }        the 6-digit code from the email
//   { action: "resend" }              a new code (60 s cooldown)
//   { action: "change_email", newEmail }  "Wrong email?": correct the address
//                                     and send the code there (same cooldown)
//
// It is new, beside `signup-verify-otp`, which today's 5-step signup still
// calls by email without a session. That one is retired with the old steps
// (feat-001 step 4); until then both work, so deploying this changes nothing
// for anyone signing up now.
//
// The code rules are signup-otp.ts's: 6 digits, 30 minutes, 5 tries.
// =============================================================================

import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { readSignupMeta } from "../_shared/signup-state.ts";
import {
  canResend,
  checkOtp,
  mintOtp,
  otpEmailHtml,
  otpEmailText,
  otpSubject,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
} from "../_shared/signup-otp.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { DRIVE247_SENDER } from "../_shared/drive247-email.ts";
import { isEmailPending, normaliseEmail, PENDING_EMAIL } from "../_shared/signup-account-rules.ts";

const LOG = "[signup-verify-email]";

const answer = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ ok: false, code, error, ...extra }, status);

/** Seconds until another code may be sent. */
function cooldownLeft(otp: { sentAt?: string } | undefined | null): number {
  if (!otp?.sentAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(otp.sentAt) + OTP_RESEND_COOLDOWN_MS - Date.now()) / 1000));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return answer(405, "METHOD_NOT_ALLOWED", "Use POST.");

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── who is asking ──────────────────────────────────────────────────────
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: who } = bearer ? await supabase.auth.getUser(bearer) : { data: null };
    if (!who?.user) return answer(401, "UNAUTHORIZED", "Please sign in again.");
    // Read fresh: the token's copy of app_metadata can be minutes old.
    const { data: fresh, error: readError } = await supabase.auth.admin.getUserById(who.user.id);
    if (readError || !fresh?.user) return answer(401, "UNAUTHORIZED", "Please sign in again.");
    const user = fresh.user;
    const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
    // The signup blob as stored, kept whole when it is written back (its `v`
    // marker included, so signup-state.ts can still read it).
    const stored = appMeta.d247_signup;
    const meta = (readSignupMeta(user) ?? (stored && typeof stored === "object" ? stored : {})) as Record<string, any>;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action ?? "");

    if (!isEmailPending(appMeta)) {
      // Already proved: the window has nothing left to do with the code.
      if (action === "verify") return jsonResponse({ ok: true, alreadyVerified: true });
      return answer(400, "ALREADY_CONFIRMED", "Your email is already confirmed.");
    }

    // ── a new code, to the current address or a corrected one ──────────────
    const sendCode = async (to: string, extraMeta: Record<string, unknown> = {}, emailChange?: string) => {
      const { code, otp } = await mintOtp();
      const { error } = await supabase.auth.admin.updateUserById(user.id, {
        ...(emailChange ? { email: emailChange, email_confirm: true } : {}),
        app_metadata: {
          d247_signup: { ...meta, ...extraMeta, otp, updatedAt: new Date().toISOString() },
        },
      });
      if (error) return { error };
      const sent = await sendResendEmail(
        { to, subject: otpSubject(code), html: otpEmailHtml(code), text: otpEmailText(code), ...DRIVE247_SENDER, source: "signup-verify-email" },
        supabase,
      );
      return { error: null, delivered: !!sent?.success };
    };

    if (action === "resend" || action === "change_email") {
      if (!canResend(meta.otp)) {
        const wait = cooldownLeft(meta.otp);
        return answer(429, "RESEND_COOLDOWN", `Please wait ${wait} seconds before asking for another code.`, { retryAfterSeconds: wait });
      }
    }

    if (action === "resend") {
      const r = await sendCode(String(user.email));
      if (r.error) return answer(500, "UNAVAILABLE", "We could not send a code. Please try again.");
      if (!r.delivered) return answer(502, "EMAIL_NOT_SENT", "We could not send the code. Please try again.");
      console.log(`${LOG} resent a code to ${user.id}`);
      return jsonResponse({ ok: true, resent: true });
    }

    if (action === "change_email") {
      const newEmail = normaliseEmail(body.newEmail);
      if (!newEmail) return answer(400, "EMAIL_INVALID", "Enter a valid email address.");
      if (newEmail === String(user.email).toLowerCase()) {
        return answer(400, "EMAIL_SAME", "That is the email we already sent the code to.");
      }
      const r = await sendCode(newEmail, { email: newEmail, emailCorrectedAt: new Date().toISOString() }, newEmail);
      if (r.error) {
        const msg = String((r.error as { message?: string }).message ?? "");
        const status = (r.error as { status?: number }).status;
        if (status === 422 || /already|registered|exists/i.test(msg)) {
          return answer(400, "EMAIL_TAKEN", "That email already has a Drive247 account.");
        }
        console.error(`${LOG} change_email failed for ${user.id}: ${msg}`);
        return answer(500, "UNAVAILABLE", "We could not change your email. Please try again.");
      }
      console.log(`${LOG} ${user.id} corrected their email`);
      return jsonResponse({ ok: true, email: newEmail, delivered: r.delivered });
    }

    if (action !== "verify") return answer(400, "INVALID_BODY", "Unknown action.");

    // ── verify ─────────────────────────────────────────────────────────────
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return answer(400, "OTP_INVALID", "Enter the 6-digit code from the email.");

    const verdict = await checkOtp(meta.otp, code);
    if (!verdict.ok) {
      if (verdict.reason === "expired") return answer(400, "OTP_EXPIRED", "That code has expired. Ask for a new one.");
      if (verdict.reason === "too_many_attempts") return answer(429, "OTP_LOCKED", "Too many tries. Ask for a new code.");
      if (verdict.reason === "mismatch" && meta.otp) {
        // Count the miss before answering, so walking away still spends the try.
        const attempts = Number(meta.otp.attempts ?? 0) + 1;
        await supabase.auth.admin.updateUserById(user.id, {
          app_metadata: { d247_signup: { ...meta, otp: { ...meta.otp, attempts }, updatedAt: new Date().toISOString() } },
        });
        const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
        if (left === 0) return answer(429, "OTP_LOCKED", "Too many tries. Ask for a new code.");
        return answer(400, "OTP_INVALID", `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`, { attemptsRemaining: left });
      }
      return answer(400, "OTP_INVALID", "That code is not right. Ask for a new one.");
    }

    // Right: the email is proved. Drop the code so it cannot be used again.
    const { otp: _spent, ...rest } = meta;
    const { error: confirmError } = await supabase.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      app_metadata: {
        [PENDING_EMAIL]: false,
        d247_signup: { ...rest, emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      },
    });
    if (confirmError) {
      console.error(`${LOG} confirm failed for ${user.id}: ${confirmError.message}`);
      return answer(500, "UNAVAILABLE", "We could not confirm your email. Please try again.");
    }
    console.log(`${LOG} ${user.id} proved their email`);
    return jsonResponse({ ok: true, verified: true });
  } catch (err) {
    console.error(`${LOG} unexpected`, err);
    return answer(500, "UNAVAILABLE", "Something went wrong. Please try again.");
  }
});
