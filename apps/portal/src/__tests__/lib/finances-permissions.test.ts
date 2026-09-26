/**
 * Finances — who may open it, which views they see, and what they may do.
 *
 * Design §1: managers keep their three existing keys (no manager_permissions
 * migration). `/finances` opens on ANY of payments / invoices / fines; each
 * view shows only when its own key is held (Received and Upcoming ← payments,
 * Billed ← invoices, Fines ← fines); a viewer grant hides the actions, never
 * the numbers.
 *
 * Executed against the SHIPPED `canAccessRoute` / `canEdit` (lifted out of
 * use-manager-permissions.ts) and the shipped route table.
 */
import { describe, expect, it } from 'vitest';
import { ROUTE_ALSO_ALLOWED_BY, ROUTE_TO_TAB, getTabKeysForRoute } from '@/lib/permissions';
import { FINANCE_VIEW_TAB_KEY, financeViewsFor } from '@/lib/finances-nav';
import { compileExpression, liftDeclaration } from '../helpers/edge-source';
import { canEditFor, editor, permissionsHookSource, viewerOn, type Perm, type Role } from '../helpers/permissions-source';

const canAccessRouteFor = (role: Role | null, permissions: Perm[] = []) =>
  compileExpression<
    (appUser: unknown, permissions: Perm[], getTabKeysForRoute: (p: string) => string[]) => (pathname: string) => boolean
  >(
    ['appUser', 'permissions', 'getTabKeysForRoute'],
    [
      liftDeclaration(permissionsHookSource, 'isManager'),
      liftDeclaration(permissionsHookSource, 'canView'),
      liftDeclaration(permissionsHookSource, 'canAccessRoute'),
    ],
    'canAccessRoute',
  )(role === null ? {} : { role }, permissions, getTabKeysForRoute);

const canViewFor = (permissions: Perm[]) => (key: string) => permissions.some((p) => p.tab_key === key);

describe('the route', () => {
  it('maps /finances to payments, and also opens it on invoices or fines', () => {
    expect(ROUTE_TO_TAB['/finances']).toBe('payments');
    expect(ROUTE_ALSO_ALLOWED_BY['/finances']).toEqual(['invoices', 'fines']);
    expect(getTabKeysForRoute('/finances')).toEqual(['payments', 'invoices', 'fines']);
  });

  it.each([
    ['payments', true],
    ['invoices', true],
    ['fines', true],
  ])('opens for a manager holding only %s', (key) => {
    expect(canAccessRouteFor('manager', viewerOn(key as string))('/finances')).toBe(true);
  });

  it('refuses a manager holding none of the three', () => {
    const guard = canAccessRouteFor('manager', editor('rentals', 'customers', 'vehicles', 'expenses'));
    expect(guard('/finances')).toBe(false);
  });

  it('does not open anything else on those grants', () => {
    // A fines-only manager reaches Finances, and still not Payments or Invoices.
    const guard = canAccessRouteFor('manager', editor('fines'));
    expect(guard('/fines')).toBe(true);
    expect(guard('/payments')).toBe(false);
    expect(guard('/invoices')).toBe(false);
    expect(guard('/expenses')).toBe(false);
  });

  it('leaves the old routes mapped exactly as they were', () => {
    expect(ROUTE_TO_TAB['/payments']).toBe('payments');
    expect(ROUTE_TO_TAB['/invoices']).toBe('invoices');
    expect(ROUTE_TO_TAB['/fines']).toBe('fines');
    expect(getTabKeysForRoute('/payments')).toEqual(['payments']);
    expect(getTabKeysForRoute('/fines/abc')).toEqual(['fines']);
  });

  it('is open to every non-manager role (the route itself is canary-gated)', () => {
    for (const role of ['head_admin', 'admin', 'ops', 'viewer'] as Role[]) {
      expect(canAccessRouteFor(role)('/finances'), role).toBe(true);
    }
  });
});

describe('the views, per grant', () => {
  it('ties each view to its own key', () => {
    expect(FINANCE_VIEW_TAB_KEY).toEqual({ billed: 'invoices', received: 'payments', upcoming: 'payments', fines: 'fines' });
  });

  it.each([
    [['payments'], ['received', 'upcoming']],
    [['invoices'], ['billed']],
    [['fines'], ['fines']],
    [['payments', 'fines'], ['received', 'upcoming', 'fines']],
    [['invoices', 'payments', 'fines'], ['billed', 'received', 'upcoming', 'fines']],
    [[], []],
    [['rentals', 'customers'], []],
  ])('a manager holding %j sees %j', (keys, views) => {
    expect(financeViewsFor(canViewFor(viewerOn(...(keys as string[]))))).toEqual(views);
  });

  it('a non-manager sees every view', () => {
    expect(financeViewsFor(() => true)).toEqual(['billed', 'received', 'upcoming', 'fines']);
  });
});

describe('viewer grants hide the actions, never the numbers', () => {
  it('a viewer on payments may see Received and may not act', () => {
    const perms = viewerOn('payments');
    expect(financeViewsFor(canViewFor(perms))).toContain('received');
    expect(canEditFor('manager', perms)('payments')).toBe(false);
  });

  it('an editor on payments may act on payments, and on a plan only with rentals too', () => {
    const payOnly = editor('payments');
    expect(canEditFor('manager', payOnly)('payments')).toBe(true);
    // Plan actions run through payment-plan-manage, which asks for rentals.
    expect(canEditFor('manager', payOnly)('payments') && canEditFor('manager', payOnly)('rentals')).toBe(false);
    const both = editor('payments', 'rentals');
    expect(canEditFor('manager', both)('payments') && canEditFor('manager', both)('rentals')).toBe(true);
  });

  it('the read-only role sees every view and may do nothing', () => {
    expect(financeViewsFor(() => true)).toHaveLength(4);
    for (const key of ['payments', 'invoices', 'fines', 'rentals']) {
      expect(canEditFor('viewer')(key), key).toBe(false);
    }
  });
});
