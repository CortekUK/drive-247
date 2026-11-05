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

const LOGO_LIGHT = "https://www.drive-247.com/logo-light.png";
const LOGO_DARK = "https://www.drive-247.com/logo-dark.png";

/**
 * The email. Short, branded, and it never says who the account belongs to.
 *
 * LIGHT AND DARK. Clients that honour `prefers-color-scheme` (Apple Mail, iOS
 * Mail, Outlook for Mac, Hey) get the dark palette and the white-letter logo
 * from the `<style>` block; Outlook.com gets the same through `[data-ogsc]`.
 * Gmail ignores both and decides for itself: the web app shows it light, the
 * phone apps recolour it, so every colour here is one that survives that.
 * Inline styles are the light defaults, because some clients strip `<style>`.
 */
export function otpEmailHtml(code: string): string {
  const minutes = Math.round(OTP_TTL_MS / 60_000);
  const font = "'DM Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your Drive247 verification code</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .d-logo { display:none; max-height:0; overflow:hidden; mso-hide:all; }
  @media (prefers-color-scheme: dark) {
    .d-page { background:#0e0e16 !important; }
    .d-card { background:#16161f !important; border-color:#262633 !important; }
    .d-ink { color:#ededf3 !important; }
    .d-body { color:#b4b4c4 !important; }
    .d-muted { color:#8a8aa0 !important; }
    .d-code { background:#1c1a3d !important; border-color:#2f2c6b !important; color:#c7d2fe !important; }
    .d-rule { border-color:#262633 !important; }
    .l-logo { display:none !important; max-height:0 !important; }
    .d-logo { display:block !important; max-height:none !important; overflow:visible !important; }
  }
  [data-ogsc] .d-page { background:#0e0e16 !important; }
  [data-ogsc] .d-card { background:#16161f !important; border-color:#262633 !important; }
  [data-ogsc] .d-ink { color:#ededf3 !important; }
  [data-ogsc] .d-body { color:#b4b4c4 !important; }
  [data-ogsc] .d-muted { color:#8a8aa0 !important; }
  [data-ogsc] .d-code { background:#1c1a3d !important; border-color:#2f2c6b !important; color:#c7d2fe !important; }
  [data-ogsc] .l-logo { display:none !important; }
  [data-ogsc] .d-logo { display:block !important; max-height:none !important; }
</style>
</head>
<body class="d-page" style="margin:0;padding:0;background:#f4f4f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">Your Drive247 code is ${code}. It expires in ${minutes} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-page" style="background:#f4f4f8;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td align="center" style="padding:0 0 24px;">
            <img class="l-logo" src="${LOGO_LIGHT}" width="132" height="30" alt="Drive247" style="display:block;border:0;width:132px;height:auto;">
            <img class="d-logo" src="${LOGO_DARK}" width="132" height="30" alt="Drive247" style="border:0;width:132px;height:auto;">
          </td>
        </tr>
        <tr>
          <td class="d-card" style="background:#ffffff;border:1px solid #e8e8f0;border-radius:16px;padding:36px 32px;font-family:${font};">
            <h1 class="d-ink" style="margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:600;color:#0b0b1a;">Confirm your email</h1>
            <p class="d-body" style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4a5c;">
              Here is your code. Enter it on the signup screen and I'll carry on setting up your Drive247 portal.
            </p>
            <div class="d-code" style="background:#eef2ff;border:1px solid #e0e7ff;border-radius:12px;padding:20px 12px;text-align:center;font-size:34px;line-height:1;font-weight:700;letter-spacing:10px;color:#4338ca;font-family:${font};">${code}</div>
            <p class="d-muted" style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#7a7a8c;text-align:center;">
              This code expires in ${minutes} minutes.
            </p>
            <hr class="d-rule" style="border:0;border-top:1px solid #ececf3;margin:28px 0 20px;">
            <p class="d-muted" style="margin:0;font-size:13px;line-height:1.6;color:#7a7a8c;">
              Didn't start a Drive247 signup? You can ignore this email. Nobody can use your address without this code.
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" class="d-muted" style="padding:20px 0 0;font-family:${font};font-size:12px;line-height:1.6;color:#9a9aac;">
            Drive247 · <a href="https://www.drive-247.com" class="d-muted" style="color:#9a9aac;text-decoration:none;">drive-247.com</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
