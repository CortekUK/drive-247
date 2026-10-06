import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * Password reset has to actually send an email.
 *
 * It did not, for every operator on every tenant, from the day the auth email
 * hook shipped. Both login screens call `supabase.auth.resetPasswordForEmail`,
 * Supabase asks `custom-auth-email` to send the recovery mail, and the hook
 * threw it away:
 *
 *   // Skip signup and recovery emails — these are handled via OTP flow
 *   // (send-verification-otp / verify-otp / reset-password-with-otp)
 *
 * Nothing ever called that flow. Grepping apps/portal and apps/admin for those
 * three functions finds one comment and no code. So the request succeeded, the
 * UI said "Check your email", and nothing was sent — a failure with no error
 * anywhere, which is why it survived so long.
 *
 * SIGNUP IS DIFFERENT and must stay skipped: `signup-begin` issues its own code
 * and `signup-verify-otp` checks it, so a confirmation from the hook would be a
 * duplicate. The two action types are not interchangeable, which is the thing
 * these tests exist to hold apart.
 */

const ROOT = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const hook = strip(read('supabase/functions/custom-auth-email/index.ts'));
const hookRaw = read('supabase/functions/custom-auth-email/index.ts');

describe('the auth email hook sends recovery mail', () => {
  it('does not skip recovery', () => {
    // The exact shape of the bug: recovery short-circuited to an empty 200.
    expect(hook).not.toMatch(/email_action_type === "recovery"[\s\S]{0,200}return new Response/);
  });

  it('still skips signup, which genuinely is handled elsewhere', () => {
    expect(hook).toMatch(/email_action_type === "signup"/);
    expect(hook).toMatch(/Skipping signup email/);
  });

  it('has somewhere for a recovery mail to land', () => {
    // The template was always written — it was simply unreachable.
    expect(hookRaw).toMatch(/case "recovery":/);
    expect(hookRaw).toMatch(/Reset Your Password/);
    expect(hookRaw).toMatch(/Reset your \$\{companyName\} password/);
  });
});

describe('the screens that trigger it', () => {
  for (const [label, path] of [
    ['v1 login', 'apps/portal/src/app/(auth)/login/page.tsx'],
    ['v2 login', 'apps/portal/src/components/auth-v2/login-v2.tsx'],
  ] as const) {
    it(`${label} asks Supabase for a verified recovery link`, () => {
      const src = strip(read(path));
      expect(src).toMatch(/supabase\.auth\.resetPasswordForEmail\(/);
      // Supabase mints and verifies the token. That is what proves control of
      // the mailbox, and it is the reason this route is preferred to the OTP
      // endpoint — see the suite below.
      expect(src).toMatch(/redirectTo:/);
    });
  }

  it('lands on a page built for that link', () => {
    const page = read('apps/portal/src/app/(auth)/reset-password/page.tsx');
    expect(page).toMatch(/resetPasswordForEmail/);
  });
});

/*
 * Why the OTP route was NOT wired up instead, recorded so nobody tries again
 * without reading the endpoint first.
 */
describe('reset-password-with-otp is not a safe alternative', () => {
  const otp = strip(read('supabase/functions/reset-password-with-otp/index.ts'));

  it('changes a password without checking any code', () => {
    // It is named for a verification it never performs: no read of
    // verification_otps, no token, no comparison. Email + new password is the
    // entire contract.
    expect(otp).toMatch(/updateUserById/);
    expect(otp).not.toMatch(/verification_otps/);
  });

  it('performs no caller authorisation either', () => {
    // emergency-password-reset had the same hole and was fixed to require an
    // authenticated super admin. This one was never given that treatment, and
    // `verify_jwt` does not help: the anon key is a valid JWT and ships in the
    // browser bundle.
    expect(otp).not.toMatch(/is_super_admin/);
  });

  it('whereas emergency-password-reset now does authorise', () => {
    const emergency = strip(read('supabase/functions/emergency-password-reset/index.ts'));
    expect(emergency).toMatch(/is_super_admin/);
  });
});
