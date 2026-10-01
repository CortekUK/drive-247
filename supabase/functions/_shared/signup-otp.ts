// =============================================================================
// signup-otp — the email verification code, and the rules around it.
//
// WHY IT IS HAND-ROLLED RATHER THAN SUPABASE'S OWN
// ------------------------------------------------
// Supabase can email a confirmation itself, but turning that on is a
// PROJECT-WIDE auth setting: it would start demanding confirmation for every
// user of every tenant, including the 64 operator portals and their customers,
// and `custom-auth-email` deliberately skips signup mail today. The blast
// radius of that switch is the whole platform.
//
// This lives in `app_metadata.d247_signup` instead — service-role-only, already
// the home of every other in-flight signup fact, and scoped to the one flow
// being changed. Nothing outside the signup dialog can see it or be affected
// by it.
//
// WHAT IS STORED, AND WHAT IS NOT
// -------------------------------
// The HASH, never the code. `app_metadata` is readable by anything holding the
// service key, and a plaintext code sitting there is a code anyone with a log
// line or a database dump can replay.
// =============================================================================

/** Six digits: short enough to read aloud, long enough with the attempt cap. */
const CODE_LENGTH = 6;

/** Long enough to find the email, short enough that a leaked code goes stale. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Five tries against a 6-digit code is a 1-in-200,000 chance of a blind guess.
 * The cap matters more than the length: without it, 1,000,000 attempts is a
 * few minutes of scripting.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** Stops the resend button being an email cannon pointed at someone's inbox. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export interface SignupOtp {
  hash: string;
  expiresAt: string;
  attempts: number;
  sentAt: string;
}

/**
 * A pepper, so a leaked `app_metadata` dump is not directly replayable: the
 * attacker needs the secret as well as the hash.
 *
 * Falls back to the service-role key, which is always present wherever this
 * runs. That is deliberately not ideal and deliberately not fatal — a missing
 * `SIGNUP_OTP_PEPPER` must not take signup down, and the fallback is still a
 * secret the same processes already hold.
 */
function pepper(): string {
  return (
    Deno.env.get("SIGNUP_OTP_PEPPER") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    ""
  );
}

/** Cryptographically random, and never `Math.random()` — this guards an account. */
export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += String(b % 10);
  return out;
}

export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(`${code}:${pepper()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant time. A plain `===` on the hash returns as soon as two characters
 * differ, and that timing is measurable — it turns a 1-in-a-million guess into
 * a character-by-character walk.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintOtp(): Promise<{ code: string; otp: SignupOtp }> {
  const code = generateCode();
  const now = Date.now();
  return {
    code,
    otp: {
      hash: await hashCode(code),
      expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
      attempts: 0,
      sentAt: new Date(now).toISOString(),
    },
  };
}

export type OtpVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "too_many_attempts" | "mismatch" | "absent" };

export async function checkOtp(
  otp: SignupOtp | undefined | null,
  input: string,
): Promise<OtpVerdict> {
  if (!otp) return { ok: false, reason: "absent" };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }
  if (Date.now() > new Date(otp.expiresAt).getTime()) {
    return { ok: false, reason: "expired" };
  }
  const candidate = await hashCode(String(input).trim());
  return safeEqual(candidate, otp.hash) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function canResend(otp: SignupOtp | undefined | null): boolean {
  if (!otp) return true;
  return Date.now() - new Date(otp.sentAt).getTime() >= OTP_RESEND_COOLDOWN_MS;
}

/** The email. Plain, short, and it never says who the account belongs to. */
export function otpEmailHtml(code: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px;font-size:20px;color:#111">Confirm your email</h2>
      <p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.6">
        Enter this code to finish setting up your Drive247 portal.
      </p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;
                  padding:16px;background:#f4f4f5;border-radius:12px;color:#111">${code}</div>
      <p style="margin:20px 0 0;color:#777;font-size:13px;line-height:1.6">
        The code expires in 10 minutes. If you did not start a Drive247 signup,
        you can ignore this email.
      </p>
    </div>
  `;
}
