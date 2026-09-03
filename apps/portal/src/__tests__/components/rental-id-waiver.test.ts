/**
 * The per-tenant ID-verification WAIVER on the new-rental form.
 *
 * Sibling to rental-id-verification-override.test.ts, which covers the other
 * control on the same card ("Mark as manually verified"). Two different things:
 *
 *   manual verification — asserts the ID *was* checked. Rewrites the CUSTOMER's
 *                         identity status, permanently, for every future rental.
 *   waiver              — asserts the ID was *not* checked, and says why. Scoped
 *                         to ONE rental, stamped on that row, shown forever on
 *                         the rental detail page.
 *
 * The waiver is the one behind a head-admin tenant flag
 * (tenants.allow_rental_without_id_verification).
 *
 * WHY THIS FILE EXISTS. The feature shipped and was immediately reported as
 * "the toggle is not working". It was working — every layer of it. What was
 * broken is that /rentals/new kept telling the operator the opposite: a red
 * "Customer must complete identity verification before rental can be created."
 * rendered from a ternary that knew nothing about the waiver, so with the flag
 * ON you saw a red cannot-be-created banner sitting directly above a confirmed
 * waiver and a "Create Without Verification" submit button. Nothing was wrong
 * with the switch; the screen simply denied that the switch existed.
 *
 * So these tests guard two distinct things, and the second is the regression:
 *
 *   1. WHO may waive — the gate expression, lifted and executed.
 *   2. That no surface still states the absolute "cannot be created" rule to an
 *      operator for whom it is FALSE. That claim must survive only on the path
 *      where it is true — a tenant without the flag.
 *
 * Expressions are LIFTED from the page and run, so the decision under test is
 * the shipped one, not a paraphrase. The page itself is not rendered: portal
 * pins React 18.3.1 while the monorepo root hoists React 19, and a permission
 * decision should not need a DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  readPortalSource,
  liftDeclaration,
  compileExpression,
  codeOnly,
} from '../helpers/edge-source';

const newRentalPage = readPortalSource('app/(dashboard)/rentals/new/page.tsx');
const settingsPage = readPortalSource('app/(dashboard)/settings/page.tsx');
const tenantContext = readPortalSource('contexts/TenantContext.tsx');

/** The real `tenantAllowsIdWaiver`, executed against a tenant row. */
const tenantAllowsIdWaiverFor = compileExpression<
  (tenant: unknown) => boolean
>(
  ['tenant'],
  [liftDeclaration(newRentalPage, 'tenantAllowsIdWaiver', { tsx: true })],
  'tenantAllowsIdWaiver',
);

/** The real `canWaiveIdVerification`, executed. */
const canWaiveFor = compileExpression<
  (
    tenantAllowsIdWaiver: boolean,
    canManuallyVerify: boolean,
    appUser: unknown,
  ) => boolean
>(
  ['tenantAllowsIdWaiver', 'canManuallyVerify', 'appUser'],
  [liftDeclaration(newRentalPage, 'canWaiveIdVerification', { tsx: true })],
  'canWaiveIdVerification',
);

const code = codeOnly(newRentalPage);
const ABSOLUTE_CLAIM =
  'Customer must complete identity verification before rental can be created.';

describe('tenantAllowsIdWaiver — the flag must be an opt-in, not an absence', () => {
  it('is false for a tenant that has never heard of the column', () => {
    expect(tenantAllowsIdWaiverFor({})).toBe(false);
  });

  it('is false when the tenant has not loaded yet', () => {
    expect(tenantAllowsIdWaiverFor(null)).toBe(false);
    expect(tenantAllowsIdWaiverFor(undefined)).toBe(false);
  });

  it('is false for null — a fresh column backfills as NULL, and NULL is not consent', () => {
    expect(
      tenantAllowsIdWaiverFor({ allow_rental_without_id_verification: null }),
    ).toBe(false);
  });

  it('requires the literal boolean true, not merely something truthy', () => {
    // Guards against a `=== true` becoming a loose check later. A string
    // "false" out of a mis-serialised settings payload is truthy.
    for (const truthy of ['true', 'false', 1, {}, []]) {
      expect(
        tenantAllowsIdWaiverFor({
          allow_rental_without_id_verification: truthy,
        }),
      ).toBe(false);
    }
    expect(
      tenantAllowsIdWaiverFor({ allow_rental_without_id_verification: true }),
    ).toBe(true);
  });
});

describe('canWaiveIdVerification — flag AND role AND a named actor', () => {
  const actor = { id: 'app-user-1' };

  it('needs all three; no single one is sufficient', () => {
    expect(canWaiveFor(true, true, actor)).toBe(true);

    expect(canWaiveFor(false, true, actor)).toBe(false); // flag off
    expect(canWaiveFor(true, false, actor)).toBe(false); // untrusted role
    expect(canWaiveFor(true, true, null)).toBe(false); // nobody to attribute it to
  });

  it('the tenant flag alone never confers authority on an untrusted role', () => {
    // ops/viewer reach canManuallyVerify === false. Switching the tenant flag on
    // must not hand them a bypass that the role gate denies them.
    expect(canWaiveFor(true, false, actor)).toBe(false);
  });

  it('refuses to waive without an actor id, so a waiver can never be anonymous', () => {
    // id_verification_waived_by is stamped from appUser.id and the audit insert
    // is gated on it. A waiver naming nobody AND writing no audit row is the one
    // outcome this feature must never produce; the DB CHECK
    // rentals_id_waiver_needs_actor backs the same invariant at rest.
    expect(canWaiveFor(true, true, undefined)).toBe(false);
    expect(canWaiveFor(true, true, {})).toBe(false);
    expect(canWaiveFor(true, true, { id: '' })).toBe(false);
  });

  it('returns a real boolean, never a truthy object leaking out of &&', () => {
    // `a && b && appUser?.id` without the !! would return the id STRING here,
    // which reads fine in JSX and then silently mistypes the gate.
    expect(canWaiveFor(true, true, actor)).toStrictEqual(true);
    expect(canWaiveFor(true, false, actor)).toStrictEqual(false);
  });
});

describe('the regression: no surface states the absolute rule when it is false', () => {
  it('still states it plainly for a tenant WITHOUT the waiver', () => {
    // The safety-critical path must be untouched.
    expect(code).toContain(ABSOLUTE_CLAIM);
    expect(code).toContain('<Alert variant="destructive">');
  });

  it('renders the destructive alert only in the else-branch of a waiver check', () => {
    expect(code).toContain('{canWaiveIdVerification ? (');

    // Every occurrence of the destructive banner must sit on the false side of
    // a ternary. If someone later un-guards it, the preceding `) : (` vanishes.
    const alertJsx = `<Alert variant="destructive"><XCircle`;
    const at = code.indexOf(alertJsx);
    expect(at).toBeGreaterThan(-1);
    const preceding = code.slice(Math.max(0, at - 220), at);
    expect(preceding).toContain(') : (');
  });

  it('shows a waiver-aware notice instead when the waiver is available', () => {
    expect(code).toContain('This customer has not completed identity verification.');
    // Amber, not the default grey — a warning that is merely colourless is a
    // warning nobody reads. Every other unverified signal on this page is amber.
    expect(code).toMatch(/canWaiveIdVerification \? \(\s*<Alert className="border-amber-300/);
  });

  it('does not label the submit button with a hard rule that does not apply', () => {
    expect(code).toContain('"Verification Required"');
    expect(code).toMatch(/canWaiveIdVerification\s*\?\s*"Verify or Waive to Continue"/);
  });

  it('the submit-gate error names the routes instead of denying they exist', () => {
    // Fixing only the banner would have moved the falsehood into the red error
    // alert that appears when you press the button without choosing a route.
    expect(code).toContain('Choose how to proceed:');
    expect(code).toMatch(/canWaiveIdVerification\s*\n?\s*\?\s*"Choose how to proceed:/);
  });
});

describe('the waiver still costs something to use', () => {
  it('re-validates the reason at submit rather than trusting dialog state', () => {
    expect(code).toContain('const waiverReason = (idWaiverAccepted ?? "").trim();');
    expect(code).toMatch(
      /canWaiveIdVerification && waiverReason\.length >= ID_WAIVER_MIN_REASON/,
    );
  });

  it('keeps a meaningful minimum reason length', () => {
    const min = liftDeclaration(newRentalPage, 'ID_WAIVER_MIN_REASON', { tsx: true });
    expect(min).toMatch(/=\s*15\b/);
  });

  it('writes the waiver columns only when the reason actually qualifies', () => {
    expect(code).toContain('...(waiverApplied');
    expect(code).toContain('id_verification_waived: true,');
    expect(code).toContain('id_verification_waived_reason: waiverReasonForInsert,');
    expect(code).toContain('id_verification_waived_by: appUser?.id ?? null,');
  });

  it('clears a typed reason when the customer changes', () => {
    // A reason typed for customer A must never ride along to customer B.
    expect(code).toContain('setIdWaiverAccepted(null);');
  });
});

describe('the switch that turns it on', () => {
  const settings = codeOnly(settingsPage);

  it('is restricted to head admins, and says so on screen', () => {
    expect(settings).toContain("const isHeadAdmin = appUser?.role === 'head_admin';");
    expect(settings).toContain('disabled={savingIdWaiver || !isHeadAdmin}');
    expect(settingsPage).toContain('Only a head admin can change this.');
  });

  it('never reports success on a write that changed no rows', () => {
    // An RLS-blocked UPDATE returns 200 with an empty body. Without this guard
    // the switch would settle into its new position having saved nothing.
    expect(settings).toContain('if (!data || data.length === 0)');
  });

  it('does not fail silently when the tenant has not loaded', () => {
    // A bare `return` here is a dead click: no movement, no error, nothing
    // written — indistinguishable from the broken toggle that was reported.
    expect(settings).toContain('Could not save');
    expect(settings).not.toMatch(/if \(!tenant\?\.id\) return;\s*\n\s*setPending\(next\)/);
  });

  it('re-reads the tenant after saving so /rentals/new sees it without a reload', () => {
    expect(settings).toContain('await refetchTenant();');
  });
});

describe('the flag reaches the page that needs it', () => {
  it('is selected by the portal tenant context', () => {
    expect(tenantContext).toContain('allow_rental_without_id_verification');
    const optional = liftDeclaration(tenantContext, 'TENANT_OPTIONAL_COLUMNS');
    expect(optional).toContain('allow_rental_without_id_verification');
  });

  it('rides in the OPTIONAL tier, so a GRANT — not the retry — is what protects it', () => {
    // The tenant row is selected in two tiers because `anon` holds COLUMN-level
    // grants on `tenants`: one ungranted column makes Postgres refuse the whole
    // row, and the login page then hangs for every tenant.
    //
    // This flag is read from /rentals/new, i.e. after a session exists, so it
    // sits in OPTIONAL and is deliberately NOT re-sent by the fallback. If its
    // grant ever goes missing the operator still logs in and the waiver reads
    // as off — strictly better than the previous arrangement, where the retry
    // re-sent the identical column list and nobody logged in at all.
    const minimal = liftDeclaration(tenantContext, 'TENANT_MINIMAL_COLUMNS');
    const optional = liftDeclaration(tenantContext, 'TENANT_OPTIONAL_COLUMNS');
    expect(optional).toContain('allow_rental_without_id_verification');
    expect(minimal).not.toContain('allow_rental_without_id_verification');
  });

  it('keeps the fallback meaningful: MINIMAL is a strict subset of the full select', () => {
    // The property that makes the retry a real safety net rather than a re-run
    // of the query that just failed. If these two tiers ever overlap, or the
    // retry stops being a subset of the first attempt, the guard is decorative.
    const cols = (decl: string) =>
      liftDeclaration(tenantContext, decl)
        .slice(liftDeclaration(tenantContext, decl).indexOf("'") + 1)
        .replace(/'[\s\S]*$/, '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);

    const minimal = cols('TENANT_MINIMAL_COLUMNS');
    const optional = cols('TENANT_OPTIONAL_COLUMNS');

    expect(minimal.length).toBeGreaterThan(0);
    expect(optional.length).toBeGreaterThan(0);
    expect(minimal.filter((c) => optional.includes(c))).toEqual([]);
    // Login and branding cannot render without these.
    for (const required of ['id', 'slug', 'company_name', 'status', 'auth_logo_url']) {
      expect(minimal).toContain(required);
    }
  });
});
