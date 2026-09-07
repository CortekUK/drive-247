/**
 * "Check with Stripe" — permission gating on the manual hold-verification action.
 *
 * WHAT THE ACTION DOES
 * The rental page's Security Deposit row and the Add Hold dialog both offer a
 * "Check with Stripe" button that calls `verify-deposit-hold`. It is not a read:
 * it CORRECTS `rentals.deposit_hold_status`, re-stamps
 * `deposit_hold_expires_at` / `_expiry_source` / `_verified_at`, and pushes the
 * chain bound forward. Its whole purpose is to move a row off 'held' when the
 * authorisation is dead — which is precisely what unblocks placement, i.e. what
 * permits a fresh authorisation on a renter's card. So it is an editor action,
 * not a viewer one, and the code says so in as many words:
 *
 *   // Gated on canEdit because verify-deposit-hold WRITES (it corrects
 *   // deposit_hold_status), so it is not a viewer action.
 *
 * `canEdit` here is the real one from `useManagerPermissions`, lifted and
 * executed — together with the `READ_ONLY_ROLES` / `isReadOnlyRole` / `isManager`
 * bindings it closes over, so the role model under test is the shipped one. The
 * last block of this file used to record a gap: the hook answered a question
 * about MANAGERS and returned `true` for a `viewer`, and the edge function
 * checked tenant membership but never read `role`. Both are now closed, and that
 * block asserts the closure rather than the hole.
 */

import { describe, it, expect } from 'vitest';
import { readPortalSource, readEdgeSource, liftDeclaration, compile, compileExpression } from '../helpers/edge-source';
import {
  canEditFor,
  editor,
  viewerOn,
  permissionsHookSource as permissionsHook,
  type Role,
  type Perm,
} from '../helpers/permissions-source';

const rentalPage = readPortalSource('app/(dashboard)/rentals/[id]/page.tsx');
const addHoldDialog = readPortalSource('components/shared/dialogs/add-hold-dialog.tsx');
const verifyFn = readEdgeSource('verify-deposit-hold/index.ts');

/** Is the "Check with Stripe" button rendered for this user? */
const buttonShown = (role: Role, permissions: Perm[] = [], depositHoldStatus: string | null = 'held') =>
  Boolean(depositHoldStatus) && canEditFor(role, permissions)('rentals');

describe('Check with Stripe — hidden from a manager who may not edit rentals', () => {
  it('is not offered to a manager with no permissions at all', () => {
    expect(buttonShown('manager')).toBe(false);
  });

  it('is not offered to a manager granted VIEWER on rentals', () => {
    // The exact shape of the manager RBAC: a tab grant at 'viewer' level means
    // "may look", and this button writes.
    expect(buttonShown('manager', viewerOn('rentals'))).toBe(false);
  });

  it('is not offered to a manager whose editor grant is on some other tab', () => {
    expect(buttonShown('manager', editor('payments', 'customers'))).toBe(false);
  });

  it('IS offered to a manager granted editor on rentals', () => {
    expect(buttonShown('manager', editor('rentals'))).toBe(true);
  });

  it('is offered to head_admin and admin', () => {
    expect(buttonShown('head_admin')).toBe(true);
    expect(buttonShown('admin')).toBe(true);
  });
});

describe('Check with Stripe — offered only where there is something to check', () => {
  it('is not offered on a rental that never had a hold', () => {
    // No PaymentIntent means nothing for verify-deposit-hold to ask about; the
    // call would just 404 against Stripe.
    expect(buttonShown('admin', [], null)).toBe(false);
  });

  it('is offered for every status that DOES have a hold record behind it', () => {
    for (const status of ['held', 'processing', 'refreshing', 'failed', 'expired', 'requires_action', 'needs_review']) {
      expect(buttonShown('admin', [], status), status).toBe(true);
    }
  });

  it('is wired to canEdit in both places it appears', () => {
    expect(rentalPage).toContain("{depositHoldStatus && canEdit('rentals') && (");
    expect(rentalPage).toContain('Check with Stripe');
    // The Add Hold dialog's copy of the button sits inside the conflict panel.
    expect(addHoldDialog).toContain('onClick={handleVerify}');
    expect(addHoldDialog).toMatch(/Check with Stripe/);
  });

  it('the rental page states WHY it is an editor action', () => {
    // Left as an assertion because the reason is the thing most likely to be
    // lost in a refactor, and losing it is how the gate gets removed.
    expect(rentalPage).toMatch(
      /verify-deposit-hold WRITES \(it corrects\s*\n?\s*\*?\s*deposit_hold_status\), so it is not a viewer action/,
    );
  });
});

describe('`viewer` is excluded — in the UI and, independently, at the server', () => {
  /**
   * WHAT THIS BLOCK USED TO SAY
   * It recorded a hole. `canEdit` opened with `if (!isManager) return true;` — it
   * answered a question about MANAGERS and handed `true` to every other role,
   * including `viewer`, whose entire definition in the users UI is "Viewer -
   * Read-only access". And `verify-deposit-hold` authenticated the caller as
   * active staff of the rental's tenant and stopped there, reading no role at
   * all. So a viewer could move a rental's deposit_hold_status, and a
   * viewer-triggered correction to 'expired' is what re-opens the placement
   * paths.
   *
   * Two assertions in that block pinned the insecure shape in place — they
   * required the `app_users` select to be the four-column one and required the
   * source NOT to read `role`. They are inverted below: the shape they now
   * require is the secure one, so removing the gate turns this file red.
   *
   * The two layers are asserted SEPARATELY on purpose. The hook is UX gating and
   * nothing more — a hidden button is not an authorisation boundary, since the
   * function is reachable with a fetch from any session on the project (booking
   * customers authenticate against the same Supabase project). The edge
   * function's own gate is the boundary, and it has to hold on its own.
   */
  it('hides Check with Stripe from a viewer', () => {
    expect(canEditFor('viewer')('rentals')).toBe(false);
    expect(buttonShown('viewer')).toBe(false);
    // Not even if permission rows were left on the account: those are read only
    // for role='manager', and the read-only guard runs before they are consulted.
    expect(buttonShown('viewer', editor('rentals'))).toBe(false);
    expect(buttonShown('viewer', viewerOn('rentals'))).toBe(false);
  });

  it('checks read-only-ness BEFORE the manager question, so it cannot be skipped', () => {
    const decl = liftDeclaration(permissionsHook, 'canEdit');
    expect(decl).toContain('if (isReadOnlyRole) return false;');
    expect(decl).toContain('if (!isManager) return true;');
    expect(decl.indexOf('isReadOnlyRole')).toBeLessThan(decl.indexOf('if (!isManager)'));
    expect(permissionsHook).toContain("const isManager = appUser?.role === 'manager';");
  });

  it('applies the same guard to the settings sub-tabs', () => {
    // Otherwise the hole simply moves: canEditSettings is the gate on every
    // settings write, including the deposit and Stripe configuration.
    expect(liftDeclaration(permissionsHook, 'canEditSettings')).toContain('if (isReadOnlyRole) return false;');
  });

  it('still permits ops — a deliberate scope decision, not an oversight', () => {
    // `ops` is "Operations - Day-to-day operations": login routes it to
    // /vehicles, and canEdit is the gate on Add Vehicle, Add Rental, Add
    // Payment, fines, reminders and the CMS. Denying it here would strip an ops
    // user of their day job in all 28 tenants — a far larger behaviour change
    // than the hole being closed. It is asserted rather than left implicit so
    // that widening READ_ONLY_ROLES is a visible decision.
    expect(canEditFor('ops')('rentals')).toBe(true);
    expect(buttonShown('ops')).toBe(true);
    const readOnlyRoles = compile<ReadonlySet<string>>(
      [liftDeclaration(permissionsHook, 'READ_ONLY_ROLES')],
      'READ_ONLY_ROLES',
    );
    expect(readOnlyRoles.has('viewer')).toBe(true);
    expect(readOnlyRoles.has('ops')).toBe(false);
  });
});

describe('verify-deposit-hold refuses a viewer with 403 — the server-side gate', () => {
  /**
   * WHERE THE GATE LIVES
   * It started inline in verify-deposit-hold, and is being extracted into
   * `_shared/deposit-hold-auth.ts` as the sibling hold endpoints (capture,
   * place, release, create-hold-checkout) get the same treatment. The two
   * spellings differ only in names — ALWAYS_ALLOWED_ROLES vs STAFF_WRITE_ROLES,
   * an inline manager_permissions query vs `managerMayEditRentals` — so this
   * block resolves whichever one the function actually uses and asserts the
   * PROPERTIES, not the spelling. That way an in-progress extraction does not
   * turn the suite red for a refactor that changes no behaviour, while deleting
   * the gate from both places still does.
   */
  const usesSharedGate = /_shared\/deposit-hold-auth/.test(verifyFn);
  const gateSource = usesSharedGate ? readEdgeSource('_shared/deposit-hold-auth.ts') : verifyFn;
  const allowListName = usesSharedGate ? 'STAFF_WRITE_ROLES' : 'ALWAYS_ALLOWED_ROLES';

  /** The real allow-list, lifted from wherever it lives. */
  const allowList = compile<ReadonlySet<string>>(
    [liftDeclaration(gateSource, allowListName)],
    allowListName,
  );

  /**
   * The real first-pass role decision, executed. `roleAllowed` is later widened
   * for a manager holding the rentals editor grant (an async lookup, asserted
   * separately below), so this is the decision BEFORE that lookup.
   */
  const roleAllowedFor = compileExpression<(isSuperAdmin: boolean, role: string | null) => boolean>(
    ['isSuperAdmin', 'role'],
    [liftDeclaration(gateSource, allowListName), liftDeclaration(gateSource, 'roleAllowed')],
    'roleAllowed',
  );

  it('reads the role at all — staff membership is not authority to write', () => {
    // The inverse of what this file used to assert. The old four-column select
    // was the hole: with no role in hand, no role could be enforced.
    expect(gateSource).toContain('.select("id, tenant_id, role, is_super_admin, is_active")');
    expect(gateSource).toMatch(/app_users[\s\S]{0,300}select\([^)]*\brole\b/);
    // And the pre-fix select must not survive anywhere on this path.
    expect(verifyFn).not.toContain('.select("id, tenant_id, is_super_admin, is_active")');
    expect(gateSource).not.toContain('.select("id, tenant_id, is_super_admin, is_active")');
  });

  it('refuses a viewer', () => {
    expect(allowList.has('viewer')).toBe(false);
    expect(roleAllowedFor(false, 'viewer')).toBe(false);
  });

  it('default-denies an unknown or missing role rather than admitting it', () => {
    // A deny list is how the next role added to the product silently acquires a
    // write on someone's card authorisation.
    expect(roleAllowedFor(false, null)).toBe(false);
    expect(roleAllowedFor(false, '')).toBe(false);
    expect(roleAllowedFor(false, 'auditor')).toBe(false);
  });

  it('admits the operator roles and any super admin', () => {
    for (const role of ['head_admin', 'admin', 'ops']) {
      expect(roleAllowedFor(false, role), role).toBe(true);
    }
    // A super admin's app_users row carries tenant_id = NULL, so the tenant
    // check would reject them on tenant alone; is_super_admin is what carries
    // them here.
    expect(roleAllowedFor(true, null)).toBe(true);
  });

  it('admits a manager only on an editor grant for rentals, mirroring the portal', () => {
    // Not in the blanket allow-list…
    expect(allowList.has('manager')).toBe(false);
    expect(roleAllowedFor(false, 'manager')).toBe(false);
    // …and promoted only by the same grant the UI checks: the rentals tab, at
    // editor level, for this app_user.
    expect(gateSource).toContain('role === "manager"');
    expect(gateSource).toContain('.from("manager_permissions")');
    expect(gateSource).toContain('.eq("access_level", "editor")');
    expect(gateSource).toMatch(/\.eq\("tab_key", MANAGER_\w*TAB_KEY\)/);
    expect(gateSource).toMatch(/const MANAGER_\w*TAB_KEY = "rentals";/);
  });

  it('treats a failed grant lookup as a refusal, never as a grant', () => {
    // The dangerous default: a transient error on manager_permissions must not
    // read as "no restriction found". Either spelling must DENY on error.
    expect(gateSource).toMatch(/manager_permissions lookup failed; denying/);
    expect(gateSource).toMatch(/manager_permissions lookup failed; denying[\s\S]{0,200}(return false|!grantErr)/);
  });

  it('answers a refusal with 403 and something the operator can act on', () => {
    expect(gateSource).toMatch(/Your role does not permit changing a deposit hold\. Ask an admin to /);
    expect(gateSource).toMatch(/Your role does not permit changing a deposit hold[\s\S]{0,200}403|403[\s\S]{0,200}Your role does not permit changing a deposit hold/);
  });

  it('still scopes the caller to the rental\'s own tenant', () => {
    // The role gate is additive: passing it does not entitle anyone to another
    // tenant's rental. Both checks must survive together.
    // `caller.tenant_id` inline, `callerTenantId` in the shared module.
    expect(gateSource).toMatch(/(tenant_id|TenantId) !== rental\.tenant_id/);
    expect(gateSource).toMatch(/Not authorised for this rental/);
  });

  it('keeps the machine path open for cron and function-to-function calls', () => {
    // The reconciler has no app_users row; gating it on a role would break the
    // automatic recovery of stranded holds.
    expect(gateSource).toMatch(/serviceRoleKey|platform_verify_secret/);
  });
});
