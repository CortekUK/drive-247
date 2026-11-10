/**
 * The v2 rail's Finances row (`/finances`) is the Invoices screen: FinancesView
 * renders InvoicesTab and refuses anyone without the `invoices` grant. Until
 * 2026-11-10 the route had no ROUTE_TO_TAB entry, so every manager saw the row
 * and the route opened for all of them — straight into "You don't have access
 * to Invoices." (QA B8.5: "Log in as the manager → show only those pages").
 *
 * As in integrations-route-permissions.test.ts, these run the SHIPPED
 * `canAccessRoute` against the SHIPPED route table.
 */
import { describe, it, expect } from 'vitest';
import { ROUTE_TO_TAB, getTabKeysForRoute } from '@/lib/permissions';
import { compileExpression, liftDeclaration } from '../helpers/edge-source';
import { permissionsHookSource, editor, type Perm, type Role } from '../helpers/permissions-source';

const canAccessRouteFor = (role: Role | null, permissions: Perm[] = []) =>
  compileExpression<
    (
      appUser: unknown,
      permissions: Perm[],
      getTabKeysForRoute: (p: string) => string[],
    ) => (pathname: string) => boolean
  >(
    ['appUser', 'permissions', 'getTabKeysForRoute'],
    [
      liftDeclaration(permissionsHookSource, 'isManager'),
      liftDeclaration(permissionsHookSource, 'canView'),
      liftDeclaration(permissionsHookSource, 'canAccessRoute'),
    ],
    'canAccessRoute',
  )(role === null ? {} : { role }, permissions, getTabKeysForRoute);

describe('/finances sits under the invoices grant', () => {
  it('maps to invoices, the grant the screen itself checks', () => {
    expect(ROUTE_TO_TAB['/finances']).toBe('invoices');
    expect(getTabKeysForRoute('/finances')).toEqual(['invoices']);
  });

  it('opens for a manager who holds invoices', () => {
    const guard = canAccessRouteFor('manager', editor('invoices'));
    expect(guard('/finances')).toBe(true);
  });

  it('is refused to a manager given only vehicles, customers and rentals — the B8.5 manager', () => {
    const guard = canAccessRouteFor('manager', editor('vehicles', 'customers', 'rentals'));
    expect(guard('/finances')).toBe(false);
  });

  it('is refused to a manager given payments but not invoices — payments keeps its own route', () => {
    const guard = canAccessRouteFor('manager', editor('payments'));
    expect(guard('/finances')).toBe(false);
    expect(guard('/payments')).toBe(true);
  });

  it('stays open for every non-manager role', () => {
    for (const role of ['head_admin', 'admin', 'ops', 'viewer'] as Role[]) {
      expect(canAccessRouteFor(role)('/finances')).toBe(true);
    }
  });
});

describe('the rail and the guard agree on /integrations', () => {
  it('a manager with only settings.payments may be shown the row the route opens', () => {
    // The rail decides with `getTabKeysForRoute(...).some(canView)`, so both
    // grants count — a primary-key-only lookup hid the row from this manager.
    const keys = getTabKeysForRoute('/integrations');
    const held = new Set(['settings', 'settings.payments']);
    expect(keys.some((k) => held.has(k))).toBe(true);
    expect(canAccessRouteFor('manager', editor('settings', 'settings.payments'))('/integrations')).toBe(true);
  });

  it('a manager with none of them is neither shown the row nor let in', () => {
    const keys = getTabKeysForRoute('/integrations');
    const held = new Set(['vehicles', 'customers', 'rentals']);
    expect(keys.some((k) => held.has(k))).toBe(false);
    expect(canAccessRouteFor('manager', editor('vehicles', 'customers', 'rentals'))('/integrations')).toBe(false);
  });
});
