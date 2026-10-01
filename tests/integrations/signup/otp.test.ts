// =============================================================================
// signup OTP — the email verification code.
//
// WHY IT IS NOT SUPABASE'S OWN CONFIRMATION. Turning that on is a PROJECT-WIDE
// auth setting: it would demand confirmation from every user of every tenant,
// including 64 operator portals and their renters, and `custom-auth-email`
// deliberately skips signup mail today. The code lives in
// `app_metadata.d247_signup` instead — scoped to the one flow being changed.
//
// WHAT IS PINNED, and each one is a way to turn a verification step into a
// formality:
//   - the HASH is stored, never the code;
//   - the comparison is constant time;
//   - attempts are capped, and a miss is counted BEFORE the answer is sent;
//   - the code is deleted once spent, so it cannot be replayed;
//   - every "no" looks the same, so this is not an account-existence oracle;
//   - the whole thing is off unless a super admin has switched it on, and a
//     failed read of that switch means OFF, not on.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const helper = strip(read('supabase/functions/_shared/signup-otp.ts'));
const verify = strip(read('supabase/functions/signup-verify-otp/index.ts'));
const begin = strip(read('supabase/functions/signup-begin/index.ts'));
const adminSwitch = strip(read('apps/admin/components/admin/signup-otp-switch.tsx'));

describe('the code itself', () => {
  it('is cryptographically random, never Math.random', () => {
    expect(helper).toMatch(/crypto\.getRandomValues/);
    expect(helper).not.toMatch(/Math\.random/);
  });

  it('stores a hash, never the code', () => {
    expect(helper).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    expect(helper).toMatch(/hash: await hashCode\(code\)/);
  });

  it('is peppered, so a metadata dump is not directly replayable', () => {
    expect(helper).toMatch(/SIGNUP_OTP_PEPPER/);
  });

  it('compares in constant time', () => {
    expect(helper).toMatch(/diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\)/);
  });

  it('expires, caps attempts, and cools down resends', () => {
    expect(helper).toMatch(/OTP_TTL_MS/);
    expect(helper).toMatch(/OTP_MAX_ATTEMPTS = \d+/);
    expect(helper).toMatch(/OTP_RESEND_COOLDOWN_MS/);
  });
});

describe('the verify endpoint', () => {
  it('counts a wrong attempt before answering', () => {
    // A client that abandons the response must still burn the attempt.
    const miss = verify.indexOf('attempts: meta.otp.attempts + 1');
    const answer = verify.indexOf('attemptsRemaining: left');
    expect(miss).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(-1);
    expect(miss).toBeLessThan(answer);
  });

  it('deletes the code once spent, and confirms the address', () => {
    expect(verify).toMatch(/const \{ otp: _spent, \.\.\.rest \}/);
    expect(verify).toMatch(/email_confirm: true/);
  });

  it('gives one uniform answer to every "no"', () => {
    expect(verify).toMatch(/function vague\(\)/);
    expect(verify).toMatch(/code: "OTP_INVALID"/);
  });

  it('treats an already-confirmed user as success — for that user only', () => {
    /*
     * A double-submit or a second tab must not strand someone who is verified.
     * The first version answered that from the EMAIL alone, and a live probe
     * caught what that meant: unknown address 400, real address 200, so anyone
     * could ask this endpoint which addresses have accounts by sending a junk
     * code. The genuine caller always has a session by then — submitAccount
     * signs in right after signup-begin — so the shortcut costs a token.
     */
    expect(verify).toMatch(/alreadyVerified: true/);
    expect(verify).toMatch(/supabase\.auth\.getUser\(bearer\)/);
    expect(verify).toMatch(/sameUser \? jsonResponse\(\{ ok: true, alreadyVerified: true \}\) : vague\(\)/);
  });

  it('never answers already-verified to an anonymous caller', () => {
    // That is the oracle. The fall-through must be `vague()`, the same answer
    // a wrong code against an unknown address gets.
    const block = verify.slice(verify.indexOf('if (user.email_confirmed_at)'), verify.indexOf('const verdict'));
    expect(block).toMatch(/vague\(\)/);
  });

  it('rate-limits resend separately from verify', () => {
    expect(verify).toMatch(/canResend\(meta\.otp\)/);
    expect(verify).toMatch(/OTP_COOLDOWN/);
  });
});

describe('the switch lives in the database, not in a secret', () => {
  /*
   * It was `SIGNUP_OTP_ENABLED` in the function environment and there was no
   * secret slot left for it. A row is the better home: it is a checkbox on the
   * Signup Plans tab, so if verification email stops being delivered the fix is
   * a click rather than a deploy.
   */
  const fn = begin.slice(begin.indexOf('async function otpEnabled'), begin.indexOf('const MIN_DWELL_MS'));

  it('reads admin_settings, beside the other platform flags', () => {
    expect(fn).toMatch(/\.from\("admin_settings"\)/);
    expect(fn).toMatch(/\.select\("signup_otp_enabled"\)/);
  });

  it('still honours the env var, so freeing a slot later changes nothing', () => {
    expect(fn).toMatch(/SIGNUP_OTP_ENABLED"\) === "true"/);
  });

  it('FAILS OFF on a read error and on a throw', () => {
    // Failing ON would create unconfirmed accounts during a database blip, and
    // nothing in the UI could verify them — locked out of a portal they paid
    // for. Failing off is just today's behaviour.
    expect(fn).toMatch(/if \(error\) \{[\s\S]*?return false;/);
    expect(fn).toMatch(/catch \(e\) \{[\s\S]*?return false;/);
    // Past the read, nothing returns an unconditional true: the answer can
    // only come from the row, so no failure path can hand back "on".
    expect(fn.slice(fn.indexOf('.from("admin_settings")'))).not.toMatch(/return true/);
  });

  it('is resolved once per request, not once per cold start', () => {
    // A module-level const would pin the value until the function next cold
    // starts, which is exactly the redeploy this was meant to avoid.
    expect(begin).toMatch(/const OTP_ENABLED = await otpEnabled\(supabase\);/);
    expect(begin).not.toMatch(/^const OTP_ENABLED/m);
  });

  it('the function and the admin switch read the row the same way', () => {
    // A flag the super admin sees as ON while signup reads it OFF is worse
    // than either value: nobody can tell which way signup is behaving.
    expect(fn).toMatch(/signup_otp_enabled === true/);
    expect(adminSwitch).toMatch(/rows\.some\(\(row\) => row\.signup_otp_enabled === true\)/);
    expect(adminSwitch).toMatch(/\.update\(\{ signup_otp_enabled: next/);
  });

  it('the switch reports an update that changed nothing', () => {
    // RLS, or no settings row: without the .select() the UI would show a
    // success toast for a flag that did not move.
    expect(adminSwitch).toMatch(/\.select\('id'\)/);
    expect(adminSwitch).toMatch(/!data \|\| data\.length === 0/);
  });
});

describe('signup-begin stays safe while the screen does not exist', () => {

  it('still auto-confirms when OTP is off, exactly as before', () => {
    expect(begin).toMatch(/email_confirm: !OTP_ENABLED/);
  });

  it('never fails the signup because an email did not send', () => {
    // The account exists by then; failing the call would show an error for a
    // signup that actually succeeded.
    expect(begin).toMatch(/OTP email not delivered/);
    expect(begin).toMatch(/OTP send threw/);
  });
});
