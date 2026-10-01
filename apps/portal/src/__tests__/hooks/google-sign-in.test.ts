/**
 * "Continue with Google" on the OPERATOR portal login.
 *
 * The portal is tenant-scoped by subdomain. A password login makes landing on
 * the wrong one unlikely — you have to type credentials at someone else's
 * address on purpose. Google makes it one click from anywhere, so the check
 * that was implicit has to become explicit.
 *
 * `app_users.auth_user_id` is unique, so one login belongs to exactly one
 * tenant. After the redirect, `appUser.tenant_id` either matches this
 * subdomain's tenant or it does not — and "does not" means signing an
 * authenticated user back out, which is the one behaviour worth pinning.
 *
 * RLS would still scope the DATA to their own tenant, so a mismatch is not a
 * leak. It is worse-looking than it is: every label and logo around them would
 * belong to a company they do not work for.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hook = readFileSync(resolve(__dirname, '../../hooks/use-google-sign-in.ts'), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = strip(hook);

describe('the portal Google button is gated', () => {
  it('is off unless the flag is exactly "true"', () => {
    expect(code).toMatch(/NEXT_PUBLIC_PORTAL_GOOGLE_ENABLED === "true"/);
  });

  it('is a DIFFERENT flag from the signup side', () => {
    // apps/web's signup dialog has its own; one switch for two apps would mean
    // turning on a login button by enabling a signup button.
    expect(code).not.toMatch(/NEXT_PUBLIC_SIGNUP_GOOGLE_ENABLED/);
  });
});

describe('a Google account from another tenant is refused', () => {
  it('compares the resolved app_user against this subdomain tenant', () => {
    expect(code).toMatch(/appUser\.tenant_id !== tenant\.id/);
  });

  it('signs them back out rather than letting them in', () => {
    expect(code).toMatch(/signOut\(\)/);
    expect(code).toMatch(/different company's portal/);
  });

  it('refuses an account with no Drive247 login at all', () => {
    expect(code).toMatch(/if \(!appUser\)/);
    expect(code).toMatch(/no Drive247 login/);
  });
});

describe('it waits for the profile before judging membership', () => {
  it('polls rather than reading appUser once', () => {
    // Reading too early reports "not a member" for someone who is one, and
    // signs them out of their own portal.
    expect(code).toMatch(/while \(!appUser && Date\.now\(\) < deadline\)/);
  });

  it('gives up eventually instead of spinning forever', () => {
    expect(code).toMatch(/deadline = Date\.now\(\) \+ \d+/);
  });
});

describe('both login screens carry it', () => {
  const screens = [
    'apps/portal/src/app/(auth)/login/page.tsx',
    'apps/portal/src/components/auth-v2/login-v2.tsx',
  ];
  for (const rel of screens) {
    it(`${rel.includes('auth-v2') ? 'v2' : 'v1'}: renders the button behind the hook's own flag`, () => {
      const src = strip(readFileSync(resolve(__dirname, '../../../../../', rel), 'utf8'));
      expect(src).toMatch(/useGoogleSignIn\(\)/);
      expect(src).toMatch(/google\.enabled &&/);
      expect(src).toMatch(/Continue with Google/);
    });
  }
});
