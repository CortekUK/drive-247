/**
 * ID-verification override on the new-rental form — who may record one.
 *
 * GMT request #2: "Could we also get an admin override to be able to create a
 * rental without id verification". The gate used to be unconditional:
 *
 *   if (!isCustomerVerified) {
 *     throw new Error("Customer must complete identity verification …");
 *   }
 *
 * An override to that gate is the single most dangerous control on the page: it
 * is the only way to put a car in the hands of someone whose identity nobody
 * checked, so who may press it is not a UI detail. Two ways to get it wrong, and
 * the second is the quiet one:
 *
 *   * offering it to a role that should never move money or risk — `viewer` and
 *     `ops`;
 *   * offering it to a MANAGER on the strength of the permission that merely got
 *     them onto the page. Reaching the new-rental form requires `rentals`
 *     editor. The override mutates the CUSTOMER's identity status, so it must
 *     require `customers` editor as well — otherwise every manager who can
 *     create a rental can also declare any customer verified.
 *
 * `canManuallyVerify`, `canEdit` and `hasRole`/`isAdmin` are LIFTED from their
 * real files and executed — the permission decision under test is the shipped
 * one. (The page itself cannot be rendered here: apps/portal pins React 18.3.1
 * while the monorepo root hoists React 19 for admin/web, so root-hoisted UI
 * packages hand React-19 elements to portal's React-18 renderer. A permission
 * decision should not need a DOM to be checked anyway.)
 */

import { describe, it, expect } from 'vitest';
import {
  readPortalSource,
  liftDeclaration,
  liftProperty,
  compileExpression,
  codeOnly,
} from '../helpers/edge-source';
import { canEditFor, editor, viewerOn, type Role, type Perm } from '../helpers/permissions-source';

const newRentalPage = readPortalSource('app/(dashboard)/rentals/new/page.tsx');
const authStore = readPortalSource('stores/auth-store.ts');

// ---------------------------------------------------------------------------
// The real permission primitives, wired together
// ---------------------------------------------------------------------------

/** The real `hasRole` / `isAdmin` off the auth store, over a fake `get()`. */
const makeAuth = (appUser: { role: Role; is_active: boolean } | null) => {
  const store: Record<string, unknown> = { appUser };
  const get = () => store;
  store.hasRole = compileExpression<(g: unknown) => (role: string | string[]) => boolean>(
    ['get'],
    [liftProperty(authStore, 'hasRole')],
    'hasRole',
  )(get);
  store.isAdmin = compileExpression<(g: unknown) => () => boolean>(
    ['get'],
    [liftProperty(authStore, 'isAdmin')],
    'isAdmin',
  )(get);
  return store as { hasRole: (r: string | string[]) => boolean; isAdmin: () => boolean };
};

/**
 * The real `canEdit` out of useManagerPermissions — lifted together with the
 * `READ_ONLY_ROLES` / `isReadOnlyRole` / `isManager` bindings it closes over.
 * See `helpers/permissions-source.ts`: lifting `canEdit` alone stopped working
 * the moment a role guard was added to it, and hand-writing that guard here
 * would move the role model into the test.
 */

/** The real predicate off the new-rental page. */
const canManuallyVerifyFor = compileExpression<
  (isAdmin: () => boolean, isManager: boolean, canEdit: (k: string) => boolean) => boolean
>(
  ['isAdmin', 'isManager', 'canEdit'],
  [liftDeclaration(newRentalPage, 'canManuallyVerify', { tsx: true })],
  'canManuallyVerify',
);

/** Everything a staff member is, collapsed into the one answer that matters. */
const mayOverride = (role: Role, opts: { permissions?: Perm[]; is_active?: boolean } = {}): boolean => {
  const auth = makeAuth({ role, is_active: opts.is_active ?? true });
  const isManager = role === 'manager';
  const canEdit = canEditFor(role, opts.permissions ?? []);
  return canManuallyVerifyFor(auth.isAdmin, isManager, canEdit);
};

// ---------------------------------------------------------------------------

describe('new rental — who may record a manual ID verification', () => {
  it('is not offered to a viewer', () => {
    expect(mayOverride('viewer')).toBe(false);
    // …not even if somebody has left permission rows on the account. Those only
    // mean anything for role='manager'.
    expect(mayOverride('viewer', { permissions: editor('customers', 'rentals') })).toBe(false);
  });

  it('is not offered to ops', () => {
    expect(mayOverride('ops')).toBe(false);
  });

  it('is not offered to a manager without the rentals editor permission', () => {
    expect(mayOverride('manager', { permissions: editor('customers') })).toBe(false);
    expect(mayOverride('manager', { permissions: [...editor('customers'), ...viewerOn('rentals')] })).toBe(false);
  });

  it('is not offered to a manager without the CUSTOMERS editor permission', () => {
    // The quiet one. `rentals` editor is what got them onto this page; the
    // action mutates the customer's identity status, so it needs its own grant.
    expect(mayOverride('manager', { permissions: editor('rentals') })).toBe(false);
    expect(mayOverride('manager', { permissions: [...editor('rentals'), ...viewerOn('customers')] })).toBe(false);
  });

  it('is offered to a manager holding editor on BOTH tabs', () => {
    expect(mayOverride('manager', { permissions: editor('customers', 'rentals') })).toBe(true);
  });

  it('is offered to head_admin and admin', () => {
    expect(mayOverride('head_admin')).toBe(true);
    expect(mayOverride('admin')).toBe(true);
  });

  it('covers super admins, who the auth store hands the head_admin role', () => {
    // fetchAppUserResult rewrites a super admin's row to
    // `{ ...data, role: 'head_admin', is_active: true }`, so they arrive here as
    // head_admin rather than needing a fourth branch.
    expect(authStore).toContain("role: 'head_admin', is_active: true");
    expect(mayOverride('head_admin')).toBe(true);
  });

  it('is withdrawn from a deactivated account, whatever its role says', () => {
    // hasRole() enforces is_active, so a deactivated admin fails the isAdmin()
    // arm. (A deactivated manager is stopped by the dashboard layout before it
    // gets this far, and by RLS after.)
    expect(mayOverride('admin', { is_active: false })).toBe(false);
    expect(mayOverride('head_admin', { is_active: false })).toBe(false);
  });

  it('reads as a positive grant, never as "not one of the blocked roles"', () => {
    // A deny list is how a new role (or a null role) silently acquires the most
    // dangerous control on the page.
    const decl = liftDeclaration(newRentalPage, 'canManuallyVerify', { tsx: true });
    expect(decl).toContain('isAdmin()');
    expect(decl).toContain('isManager && canEdit("customers") && canEdit("rentals")');
    expect(decl).not.toContain('!==');
    expect(decl).not.toMatch(/!\s*\[/);
  });
});

describe('new rental — the override is gated in the UI as well as in the predicate', () => {
  it('hides the trigger behind the same predicate, and only where it is needed', () => {
    // Shown only to someone permitted AND only while the customer is still
    // unverified — an override offered on an already-verified customer is an
    // invitation to use it out of habit.
    expect(newRentalPage).toContain('{!isCustomerVerified && canManuallyVerify && (');
    expect(newRentalPage).toContain('Mark as manually verified');
  });

  it('re-checks the permission in the handler, not only in the JSX', () => {
    // A hidden button is not a permission check: the handler is reachable from a
    // stale render, and this one writes to the customer's identity status.
    expect(newRentalPage).toContain('if (!canManuallyVerify) return;');
  });

  it('refuses to apply without a written reason', () => {
    // The reason is the only narrative the audit trail carries, so "ok" must not
    // pass. Enforced twice: the submit handler returns early, and the confirm
    // button is disabled.
    expect(newRentalPage).toMatch(/const MANUAL_VERIFY_MIN_REASON = \d+;/);
    expect(newRentalPage).toContain('if (reason.length < MANUAL_VERIFY_MIN_REASON) return;');
    const dialogFooter = newRentalPage.slice(newRentalPage.indexOf('value={manualVerifyReason}'));
    expect(dialogFooter).toContain('manualVerifyReason.trim().length < MANUAL_VERIFY_MIN_REASON');
  });

  it('records the reason and the acting user', () => {
    expect(newRentalPage).toContain('const MANUAL_VERIFY_AUDIT_ACTION = "customer_identity_manually_verified";');
    expect(newRentalPage).toContain('action: MANUAL_VERIFY_AUDIT_ACTION,');
    const handler = newRentalPage.slice(
      newRentalPage.indexOf('const reason = manualVerifyReason.trim();'),
      newRentalPage.indexOf('const reason = manualVerifyReason.trim();') + 3000,
    );
    expect(handler).toMatch(/reason/);
    expect(handler).toMatch(/approved_by_(name|email|id)|appUser/);
  });

  it('says loudly when the decision was applied but the audit entry was not', () => {
    // Silently succeeding here would leave an unverified renter driving with no
    // record of who authorised it.
    expect(newRentalPage).toContain(
      'The customer was marked as manually verified, but the audit entry could not be saved. Please record this decision manually.',
    );
  });

  it('shows who overrode it, and why, on any later visit', () => {
    expect(newRentalPage).toContain('manualVerifyRecord');
    expect(newRentalPage).toContain('.eq("action", MANUAL_VERIFY_AUDIT_ACTION)');
    expect(newRentalPage).toMatch(/Reason: &ldquo;\{manualVerifyRecord\.details\.reason\}&rdquo;/);
  });

  it('does not let a click-away abandon an in-flight write', () => {
    expect(newRentalPage).toContain('if (manualVerifying) return;');
  });

  it('leaves the strict gate in force for everyone else', () => {
    // The override is an addition, not a replacement: a customer who is neither
    // verified nor overridden still cannot be given a car.
    expect(codeOnly(newRentalPage)).toMatch(
      /Customer must complete identity verification before rental can be created\./,
    );
  });
});

describe('new rental — the page itself is closed to a manager without rentals editor', () => {
  it('redirects rather than rendering a form they cannot submit', () => {
    expect(newRentalPage).toContain("if (isManager && !canEdit('rentals')) {");
    expect(newRentalPage).toContain("if (isManager && !canEdit('rentals')) return null;");
  });
});
