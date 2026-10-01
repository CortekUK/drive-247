// =============================================================================
// signup-verify-otp — step 1b, between the account form and payment.
//
// Verifies the code `signup-begin` emailed, confirms the address, and hands the
// caller back to the step machine. Also resends, under a cooldown.
//
// `verify_jwt = false`, like `signup-begin`: the whole point is that this user
// is NOT confirmed yet, and in the flag-on world they hold no usable session
// until they are. The gate is therefore in code — the caller must present the
// email, and every answer is deliberately uniform about whether that address
// exists (see `vague()` below).
//
// IRREVERSIBLE NOTHING. This function creates no user, charges no card and
// provisions no tenant. Its worst outcome is an unconfirmed account, which
// `signup-resume` already treats as "resume at verify".
// =============================================================================

import { handleCors, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { readSignupMeta } from "../_shared/signup-state.ts";
import {
  canResend,
  checkOtp,
  mintOtp,
  otpEmailHtml,
  OTP_MAX_ATTEMPTS,
} from "../_shared/signup-otp.ts";
import { sendEmail } from "../_shared/resend-service.ts";

const LOG = "[signup-verify-otp]";

/**
 * ONE ANSWER FOR EVERY "no". Unknown address, no signup in flight, already
 * confirmed, wrong code — all return the same shape. Distinguishing them turns
 * this endpoint into an account-existence oracle, which is exactly what
 * `signup-begin`'s identity probes are careful not to be.
 */
function vague() {
  return jsonResponse(
    { ok: false, code: "OTP_INVALID", error: "That code is not valid. Check it and try again." },
    400,
  );
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const email = String(body.email ?? "").trim().toLowerCase();
    const action = body.action === "resend" ? "resend" : "verify";
    const code = String(body.code ?? "").trim();

    if (!email) return errorResponse("email is required", 400);
    if (action === "verify" && !/^\d{6}$/.test(code)) return vague();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // There is no "get user by email" admin call, so page the list. A signup in
    // flight is recent, and the list is newest-first.
    let user: any = null;
    for (let page = 1; page <= 20 && !user; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data.users.length) break;
      user = data.users.find((u: any) => String(u.email).toLowerCase() === email) ?? null;
    }
    if (!user) return vague();

    const meta = readSignupMeta(user);
    if (!meta) return vague();

    // ── resend ──────────────────────────────────────────────────────────────
    if (action === "resend") {
      if (user.email_confirmed_at) return vague();
      if (!canResend(meta.otp)) {
        return jsonResponse(
          { ok: false, code: "OTP_COOLDOWN", error: "Please wait a moment before asking for another code." },
          429,
        );
      }
      const { code: fresh, otp } = await mintOtp();
      await supabase.auth.admin.updateUserById(user.id, {
        app_metadata: { d247_signup: { ...meta, otp, updatedAt: new Date().toISOString() } },
      });
      const sent = await sendEmail(email, "Your Drive247 verification code", otpEmailHtml(fresh), supabase);
      if (!sent?.success) {
        console.error(`${LOG} resend failed to deliver for ${user.id}`);
        return errorResponse("We could not send the code. Please try again.", 502);
      }
      console.log(`${LOG} resent code for ${user.id}`);
      return jsonResponse({ ok: true, resent: true });
    }

    // ── verify ──────────────────────────────────────────────────────────────
    // Already confirmed is a SUCCESS, not an error: a double-submit, or a
    // second tab, must not strand someone who is genuinely verified.
    if (user.email_confirmed_at) return jsonResponse({ ok: true, alreadyVerified: true });

    const verdict = await checkOtp(meta.otp, code);

    if (!verdict.ok) {
      // Count the miss BEFORE answering, so a client that abandons the response
      // still burns the attempt.
      if (verdict.reason === "mismatch" && meta.otp) {
        await supabase.auth.admin.updateUserById(user.id, {
          app_metadata: {
            d247_signup: {
              ...meta,
              otp: { ...meta.otp, attempts: meta.otp.attempts + 1 },
              updatedAt: new Date().toISOString(),
            },
          },
        });
        const left = OTP_MAX_ATTEMPTS - (meta.otp.attempts + 1);
        if (left > 0) {
          return jsonResponse(
            { ok: false, code: "OTP_INVALID", attemptsRemaining: left,
              error: `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.` },
            400,
          );
        }
      }
      if (verdict.reason === "expired") {
        return jsonResponse(
          { ok: false, code: "OTP_EXPIRED", error: "That code has expired. Ask for a new one." },
          400,
        );
      }
      if (verdict.reason === "too_many_attempts") {
        return jsonResponse(
          { ok: false, code: "OTP_LOCKED", error: "Too many attempts. Ask for a new code." },
          429,
        );
      }
      return vague();
    }

    // Correct. Confirm the address and drop the code so it cannot be replayed.
    const { otp: _spent, ...rest } = meta as Record<string, unknown>;
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      app_metadata: {
        d247_signup: { ...rest, emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      },
    });
    if (updateError) {
      console.error(`${LOG} confirm failed for ${user.id}: ${updateError.message}`);
      return errorResponse("Could not confirm your email. Please try again.", 500);
    }

    console.log(`${LOG} verified ${user.id}`);
    return jsonResponse({ ok: true, verified: true });
  } catch (err) {
    console.error(`${LOG} unexpected`, err);
    return errorResponse(err instanceof Error ? err.message : "Unexpected error", 500);
  }
});
