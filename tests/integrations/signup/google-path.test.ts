// =============================================================================
// Path A: Continue with Google → company & slug → payment.
//
// WHAT BROKE ON 1 OCT, and why this file exists.
//
// The Google button validated the business name and web address before the
// redirect. Removing that check looked like a one-line UX win and stranded
// every Google signup: the handoff stash ran the blob through `toDraft`, which
// rejects a company name under two characters, so the return read `null`,
// `completeGoogleReturn` hit `if (!pending)` and returned — signed in, sitting
// on the home page, with only a console warning to say why.
//
// The check was load-bearing. It is only safe to remove once the far side can
// actually ask, which is the three things pinned here:
//
//   1. the stash survives an empty business draft (only `planId` is required);
//   2. the return puts the dialog into `tenant` mode when it has no company;
//   3. that step goes to PAYMENT when nothing has been charged — provisioning
//      first would ask signup-provision to build a tenant nobody paid for, and
//      it verifies the charge against Stripe and refuses.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const draft = strip(read('apps/web/src/components/onboarding/tenant-draft.ts'));
const provider = strip(read('apps/web/src/components/onboarding/onboarding-provider.tsx'));
const account = strip(read('apps/web/src/components/onboarding/steps/account-step.tsx'));

describe('1. the handoff survives an empty business draft', () => {
  it('requires only the plan', () => {
    const fn = draft.slice(draft.indexOf('export function readPendingOauth'), draft.indexOf('export function clearPendingOauth'));
    expect(fn).toMatch(/if \(!isSignupPlanId\(blob\.planId\)\) return null;/);
    // `toDraft` rejects a short company name — running the handoff through it
    // is what made an un-filled Google signup unrecoverable.
    expect(fn).not.toMatch(/toDraft\(/);
  });

  it('treats a missing company name as empty, not as invalid', () => {
    const fn = draft.slice(draft.indexOf('export function readPendingOauth'), draft.indexOf('export function clearPendingOauth'));
    expect(fn).toMatch(/companyName: typeof blob\.companyName === "string" \? blob\.companyName : ""/);
  });
});

describe('2. the return asks for the business when it has none', () => {
  it('switches the account step to the tenant-only fields', () => {
    expect(provider).toMatch(/if \(!pending\.values\.companyName\.trim\(\) \|\| !pending\.values\.slug\.trim\(\)\) \{/);
    expect(provider).toMatch(/setAccountMode\("tenant"\)/);
  });

  it('does not fall through to the server-chosen step in that case', () => {
    // The server answers `payment` for a freshly stamped signup, which would
    // take the card before anything knows what to name the tenant.
    const branch = provider.slice(
      provider.indexOf('if (!pending.values.companyName.trim()'),
      provider.indexOf('await resolveResume(pending.planId)'),
    );
    expect(branch).toMatch(/return;/);
  });
});

describe('3. the tenant step pays before it provisions', () => {
  const fn = provider.slice(
    provider.indexOf('const submitTenantDetails'),
    provider.indexOf('const startGoogleSignup'),
  );

  it('routes to payment when nothing has been charged', () => {
    expect(fn).toMatch(/if \(!s\.payment\.paid\) \{/);
    expect(fn).toMatch(/dispatch\(\{ type: "goto", step: "payment" \}\)/);
  });

  it('still provisions directly when the money is already in', () => {
    // The original caller: a paid signup that lost its draft.
    expect(fn).toMatch(/dispatch\(\{ type: "goto", step: "provisioning" \}\)/);
    const pay = fn.indexOf('step: "payment"');
    const provision = fn.indexOf('step: "provisioning"');
    expect(pay).toBeLessThan(provision);
  });
});

describe('only then is the button allowed to skip the form', () => {
  const fn = account.slice(account.indexOf('const handleGoogle'), account.indexOf('const handleSignIn'));

  it('no longer gates the redirect on the tenant fields', () => {
    expect(fn).not.toMatch(/tenantErrors\(\)/);
    expect(fn).not.toMatch(/focusFirst/);
  });

  it('still carries across whatever was typed first', () => {
    // Someone who filled them in before noticing the button skips the second
    // screen entirely.
    expect(fn).toMatch(/onGoogle\(tenantValues\(\)\)/);
  });
});
