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
