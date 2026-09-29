/**
 * Super-admin password recovery — the only path that crosses tenant boundaries.
 *
 * WHY IT EXISTS
 * -------------
 * The portal already has self-service reset on the login page, and
 * `admin-reset-password` lets a tenant admin reset one of their own staff.
 * Neither reaches the case that keeps arriving in support:
 *
 *   Drive Hustle — the head admin's login sits on a domain returning NXDOMAIN,
 *   so every reset email is delivered to nowhere. Self-service cannot ever work.
 *   Heirs Rental — Igor lost his password on 15 Aug and was still locked out on
 *   29 Sep, six weeks, because the only route back was an engineer running a
 *   script against production by hand.
 *
 * `admin-reset-password` cannot cover it: it authorises the caller as a
 * head_admin WITHIN the tenant, and a super admin carries `tenant_id = NULL`.
 *
 * WHAT IS PINNED, and each one is a way to turn a support tool into a backdoor:
 *   - super admin only, and an inactive one does not count;
 *   - it refuses to reset another SUPER ADMIN (mirrors admin-force-logout);
 *   - the audit row is written BEFORE the password is returned;
 *   - the target is re-checked against the tenant the caller named;
 *   - the new password forces a change at next sign-in.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const fn = readFileSync(
  resolve(ROOT, 'supabase/functions/admin-tenant-password-reset/index.ts'),
  'utf8',
);
const page = readFileSync(
  resolve(ROOT, 'apps/admin/app/admin/(protected)/rentals/[id]/page.tsx'),
  'utf8',
);

/** Comments here argue the security case at length; assertions must not read them. */
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const code = strip(fn);
const ui = strip(page);

describe('the function authorises before it acts', () => {
  it('requires a bearer token', () => {
    expect(code).toMatch(/authHeader\?\.startsWith\('Bearer '\)/);
  });

  it('identifies the caller from their own JWT, not from the request body', () => {
    expect(code).toMatch(/asCaller\.auth\.getUser\(\)/);
    expect(code).toMatch(/\.eq\('auth_user_id', auth\.user\.id\)/);
  });

  it('demands super admin, and rejects an inactive one', () => {
    expect(code).toMatch(/!caller\.is_super_admin \|\| caller\.is_active === false/);
    expect(code).toMatch(/403/);
  });

  it('never resets another super admin', () => {
    expect(code).toMatch(/target\.is_super_admin/);
    expect(code).toMatch(/A super admin password cannot be reset from here/);
  });

  it('re-checks the target really belongs to the named company', () => {
    expect(code).toMatch(/target\.tenant_id !== tenantId/);
  });

  it('refuses a row with no login rather than failing opaquely', () => {
    expect(code).toMatch(/!target\.auth_user_id/);
  });
});

describe('the reset is recorded and forced', () => {
  it('writes an audit row flagged as a super admin action', () => {
    expect(code).toMatch(/from\('audit_logs'\)/);
    expect(code).toMatch(/is_super_admin_action: true/);
    expect(code).toMatch(/action: 'super_admin_reset_password'/);
  });

  it('audits BEFORE handing the password back', () => {
    const audit = code.indexOf("from('audit_logs')");
    const ret = code.indexOf('password: newPassword,\n      mustChangePassword');
    expect(audit).toBeGreaterThan(-1);
    expect(ret).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(ret);
  });

  it('makes the operator choose their own password next sign-in', () => {
    expect(code).toMatch(/must_change_password: true/);
  });

  it('confirms the email, so an unconfirmed address can still sign in', () => {
    expect(code).toMatch(/email_confirm: true/);
  });

  it('generates from an alphabet with no look-alike characters', () => {
    // These get read down a phone line; 0/O and 1/l/I are how that goes wrong.
    expect(code).toMatch(/const ALPHABET = '[^']+'/);
    const alphabet = code.match(/const ALPHABET = '([^']+)'/)![1];
    for (const bad of ['0', 'O', '1', 'l', 'I']) {
      expect(alphabet.includes(bad), `alphabet must not contain ${bad}`).toBe(false);
    }
    expect(code).toMatch(/crypto\.getRandomValues/);
  });
});

describe('the Super Admin screen', () => {
  it('offers the action on a company record', () => {
    expect(ui).toMatch(/id: 'reset-password', label: 'Reset login password'/);
    expect(ui).toMatch(/id === 'reset-password'/);
  });

  it('calls the super-admin function, never the tenant-scoped one', () => {
    expect(ui).toMatch(/'admin-tenant-password-reset'/);
  });

  it('says plainly that the password is shown only once', () => {
    expect(ui).toMatch(/cannot be shown again/);
  });

  it('will not offer Reset on an account that has no login', () => {
    expect(ui).toMatch(/disabled=\{!u\.canReset/);
  });
});
