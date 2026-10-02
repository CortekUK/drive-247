// =============================================================================
// The emailed code: name/email/password → code → company & slug → payment.
//
// The server half shipped first and sat behind SIGNUP_OTP_ENABLED with nothing
// to render, because turning it on without this screen creates unconfirmed
// accounts with nowhere to go — locked out, with no way to clear it. This is
// that screen, plus the routing that makes the flag safe to flip.
//
// THE ORDER MATTERS AND IS EASY TO GET WRONG. A verified address goes to the
// BUSINESS fields, not to the card: paying first would leave signup-provision
// with nothing to name the tenant after. `submitTenantDetails` then routes to
// payment because nothing has been charged — the same branch the Google path
// uses, which is why both flows end up on one code path rather than two.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const begin = strip(read('supabase/functions/signup-begin/index.ts'));
const provider = strip(read('apps/web/src/components/onboarding/onboarding-provider.tsx'));
const dialog = strip(read('apps/web/src/components/onboarding/onboarding-dialog.tsx'));
const screen = strip(read('apps/web/src/components/onboarding/steps/verify-step.tsx'));

describe('the server decides whether a code is coming', () => {
  it('reports it in the signup-begin response', () => {
    expect(begin).toMatch(/requiresVerification: OTP_ENABLED/);
  });

  it('the client branches on that answer, not on its own flag', () => {
    // Two flags that can disagree would either show a code screen for an email
    // nobody sent, or walk an unverified account into payment.
    expect(provider).toMatch(/if \(begun\?\.requiresVerification\)/);
    expect(provider).not.toMatch(/NEXT_PUBLIC_SIGNUP_OTP/);
  });

  it('does not mint a payment intent while they read their inbox', () => {
    const branch = provider.slice(
      provider.indexOf('if (begun?.requiresVerification)'),
      provider.indexOf('dispatch({ type: "goto", step: "payment" });\n        handedOff'),
    );
    expect(branch).not.toMatch(/startPaymentInternal/);
  });
});

describe('a verified address goes to the business fields, not the card', () => {
  const fn = provider.slice(
    provider.indexOf('const verifyEmailCode'),
    provider.indexOf('const clearVerifyError'),
  );

  it('switches to tenant mode on success', () => {
    expect(fn).toMatch(/setAccountMode\("tenant"\)/);
    expect(fn).toMatch(/step: "account"/);
  });

  it('never routes straight to payment', () => {
    // signup-provision would have nothing to name the tenant after.
    expect(fn).not.toMatch(/step: "payment"/);
  });

  it('treats an already-verified account as success', () => {
    expect(fn).toMatch(/res\.alreadyVerified/);
  });
});

describe('the step machine admits it', () => {
  it('account can reach verify, and verify can only reach account', () => {
    expect(provider).toMatch(/account: \["account", "verify"/);
    expect(provider).toMatch(/verify: \["verify", "account", "plan"\]/);
  });

  it('verify is not a stage on the progress bar', () => {
    // It is a gate between two stages; a third segment would make the bar jump
    // backwards for every signup that does not need one.
    expect(dialog).toMatch(/step === "verify" \? "account"/);
    const meta = dialog.slice(dialog.indexOf('const STEP_META'), dialog.indexOf('] as const;'));
    expect(meta).not.toMatch(/verify/);
  });

  it('the account form does not render underneath it', () => {
    expect(dialog).toMatch(/dialogStep === "account" && step !== "verify"/);
  });
});

describe('the screen itself', () => {
  it('offers no way to skip', () => {
    // A verification step that can be skipped is one that does not exist.
    expect(screen).not.toMatch(/skip/i);
  });

  it('submits on the sixth digit', () => {
    expect(screen).toMatch(/if \(digits\.length === 6\) void submit\(digits\)/);
  });

  it('lets a phone fill the code from the notification', () => {
    expect(screen).toMatch(/autoComplete="one-time-code"/);
    expect(screen).toMatch(/inputMode="numeric"/);
  });

  it('clears a wrong code instead of making them delete six characters', () => {
    expect(screen).toMatch(/if \(!ok\) \{\s*setCode\(""\)/);
  });

  it('always offers a resend, behind the server cooldown', () => {
    expect(screen).toMatch(/Resend in \$\{cooldown\}s/);
    expect(screen).toMatch(/RESEND_COOLDOWN_SECONDS = 60/);
  });

  it('offers a way back when the address was typed wrong', () => {
    expect(screen).toMatch(/Use a different email/);
  });
});

// ===========================================================================
// The sign-in cannot happen before the address is confirmed
// ===========================================================================
describe('an unconfirmed account is never asked for a session', () => {
  /*
   * THE BUG THIS CLOSES, found on a brand-new address on 2 Oct 2026.
   *
   * `signup-begin` creates the account UNCONFIRMED when verification is on —
   * that is the point. GoTrue will not issue a password session for an
   * unconfirmed address, so the sign-in that ran immediately after it failed
   * every single time, and the failure handler replaced the code screen with
   * "An account already exists for this email". The account was real, the code
   * was in their inbox, and the one screen that could spend it was unreachable.
   *
   * The signup log showed exactly one signup-begin call, which is what ruled
   * out a double submit and pointed here.
   */
  const fn = provider.slice(
    provider.indexOf('const submitAccount'),
    provider.indexOf('const submitTenantDetails'),
  );

  it('routes to the code screen BEFORE it tries to sign in', () => {
    const branch = fn.indexOf('if (begun?.requiresVerification)');
    const signIn = fn.indexOf('signInWithPassword');
    expect(branch).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(-1);
    expect(
      branch < signIn,
      'submitAccount signs in before checking whether a code is coming. GoTrue ' +
        'refuses an unconfirmed address, so every verified signup dies on the first screen.',
    ).toBe(true);
  });

  it('carries the password in a ref, never in state', () => {
    // It has to survive to the verify step, and it must not land in a devtools
    // snapshot or a serialised error on the way.
    expect(provider).toMatch(/const pendingPasswordRef = useRef<string \| null>\(null\)/);
    expect(fn).toMatch(/pendingPasswordRef\.current = values\.password/);
    expect(fn).not.toMatch(/type: "setPassword"/);
  });

  it('keeps a reload during the code screen survivable', () => {
    // The local draft needs no session; the server copy waits for one.
    expect(fn).toMatch(/writeLocalTenantDraft\(tenant\)/);
  });
});

describe('the session is minted once the code is accepted', () => {
  const fn = provider.slice(
    provider.indexOf('const verifyEmailCode'),
    provider.indexOf('const clearVerifyError'),
  );

  it('signs in after verifying, which is the first moment GoTrue will allow it', () => {
    expect(fn).toMatch(/signInWithPassword/);
    const verify = fn.indexOf('signupVerifyOtp');
    const signIn = fn.indexOf('signInWithPassword');
    expect(verify).toBeLessThan(signIn);
  });

  it('spends the password and drops it', () => {
    expect(fn).toMatch(/pendingPasswordRef\.current = null/);
  });

  it('asks for the password rather than stranding them if that sign-in fails', () => {
    // They are verified by then; there is nothing left to enter on the code
    // screen, so leaving them there would be a dead end.
    expect(fn).toMatch(/reason: "SIGN_IN_FAILED"/);
  });

  it('writes the server-side draft only once a session exists', () => {
    const signIn = fn.indexOf('signInWithPassword');
    const draft = fn.indexOf('saveTenantDraft');
    expect(draft).toBeGreaterThan(-1);
    expect(signIn).toBeLessThan(draft);
  });
});

// ===========================================================================
// A half-finished signup is sent back to its code, not to a password box
// ===========================================================================
describe('an unverified signup never lands on the password panel', () => {
  /*
   * WHAT HAPPENED, 2 Oct 2026. Someone whose signup was waiting on its code
   * started again with the same address, was shown "Welcome back — enter your
   * password", pressed "Forgot password?", reset it, was told "sign in with
   * your new password to carry on", and was refused again. The password was
   * never what was wrong: the address is unconfirmed, so GoTrue refuses a
   * session whatever is typed. The panel was a room with no door.
   */
  const fn = provider.slice(
    provider.indexOf('const submitAccount'),
    provider.indexOf('const submitTenantDetails'),
  );

  it('asks the endpoint that knows, because the 409 does not say', () => {
    // A resend succeeds only for an account that is unconfirmed and mid-signup.
    expect(fn).toMatch(/signupVerifyOtp\(\{ email, action: "resend" \}\)/);
  });

  it('treats a cooldown as proof too — the code it refers to is still good', () => {
    expect(fn).toMatch(/res\.ok \|\| res\.code === "OTP_COOLDOWN"/);
  });

  it('goes to the code screen and keeps the password for the other side', () => {
    const branch = fn.slice(fn.indexOf('action: "resend"'), fn.indexOf('Not an unverified signup'));
    expect(branch).toMatch(/pendingPasswordRef\.current = values\.password/);
    expect(branch).toMatch(/step: "verify"/);
  });

  it('still shows the password panel for everyone else', () => {
    // A confirmed account, a renter, a finished signup: the panel is right for
    // all of them, and an unreachable resend must not change that.
    expect(fn).toMatch(/prompt: \{ email, reason: error\.code \}/);
    const order = fn.indexOf('action: "resend"') < fn.indexOf('reason: error.code');
    expect(order, 'the resend probe now runs after the panel is already shown').toBe(true);
  });
});
