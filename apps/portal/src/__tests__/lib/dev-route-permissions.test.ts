/**
 * `/dev` and the manager permission model.
 *
 * `useManagerPermissions().canAccessRoute` FAILS OPEN: a route with no entry in
 * `ROUTE_TO_TAB` is treated as allowed for every manager, whatever their
 * grants. So the developer page — which carries a Supabase DELETE and resets
 * operator-facing state — has to be mapped explicitly, and mapped to a key no
 * manager can ever hold.
 *
 * The route guard is lifted from the shipped hook source (see
 * `helpers/permissions-source.ts` for why) and compiled against the real
 * `getTabKeyForRoute`, so these tests answer for the code as it is, not for a
 * copy of it.
 */

import { describe, it, expect } from 'vitest';

import {
  ROUTE_TO_TAB,
  SETTINGS_SUB_TAB_KEYS,
  TAB_KEYS,
  getTabKeyForRoute,
} from '@/lib/permissions';
import { compileExpression, liftDeclaration, readEdgeSource } from '../helpers/edge-source';
import { permissionsHookSource, editor, type Perm, type Role } from '../helpers/permissions-source';

/** The real `canAccessRoute`, bound to a role and a set of permission rows. */
const canAccessRouteFor = (role: Role | null, permissions: Perm[] = []) =>
  compileExpression<
    (
      appUser: unknown,
      permissions: Perm[],
      getTabKeyForRoute: (p: string) => string | null,
    ) => (pathname: string) => boolean
  >(
    ['appUser', 'permissions', 'getTabKeyForRoute'],
    [
      liftDeclaration(permissionsHookSource, 'isManager'),
      liftDeclaration(permissionsHookSource, 'canView'),
      liftDeclaration(permissionsHookSource, 'canAccessRoute'),
    ],
    'canAccessRoute',
  )(role === null ? {} : { role }, permissions, getTabKeyForRoute);

/** Every grant a super admin could possibly hand a manager. */
const EVERY_GRANT: Perm[] = editor(...TAB_KEYS, ...SETTINGS_SUB_TAB_KEYS);

describe('/dev is mapped', () => {
  it('has an explicit ROUTE_TO_TAB entry — the omission is the risk, not the entry', () => {
    expect(ROUTE_TO_TAB['/dev']).toBeTruthy();
    expect(getTabKeyForRoute('/dev')).toBe(ROUTE_TO_TAB['/dev']);
    // Nested paths under it inherit the same key.
    expect(getTabKeyForRoute('/dev/anything')).toBe(ROUTE_TO_TAB['/dev']);
  });

  it('does not accidentally claim neighbouring routes', () => {
    expect(getTabKeyForRoute('/devices')).toBeNull();
    expect(getTabKeyForRoute('/development')).toBeNull();
  });

  it('maps to a key that is NOT grantable — absent from TAB_KEYS and the settings sub-keys', () => {
    const key = ROUTE_TO_TAB['/dev'];
    expect((TAB_KEYS as readonly string[]).includes(key)).toBe(false);
    expect((SETTINGS_SUB_TAB_KEYS as readonly string[]).includes(key)).toBe(false);
  });

  it('…and the edge functions that write manager_permissions refuse that key too', () => {
    // Both writers validate against a hardcoded ALLOWED_TAB_KEYS. If either
    // ever lists the dev key, a manager could be granted the page.
    const key = ROUTE_TO_TAB['/dev'];
    for (const fn of ['update-manager-permissions', 'admin-create-user']) {
      const src = readEdgeSource(`${fn}/index.ts`);
      const allowed = liftDeclaration(src, 'ALLOWED_TAB_KEYS');
      expect(allowed, `${fn} must not allow '${key}'`).not.toMatch(new RegExp(`['"]${key}['"]`));
    }
  });
});

describe('canAccessRoute("/dev") — lifted from the shipped hook', () => {
  it('is refused to a manager holding every grant that exists', () => {
    expect(canAccessRouteFor('manager', EVERY_GRANT)('/dev')).toBe(false);
    expect(canAccessRouteFor('manager', EVERY_GRANT)('/dev/anything')).toBe(false);
  });

  it('is refused to a manager with no grants at all', () => {
    expect(canAccessRouteFor('manager', [])('/dev')).toBe(false);
  });

  it('would have been ALLOWED for that same manager if the route were unmapped — the trap this closes', () => {
    // Prove the fail-open behaviour is real, so the mapping above is doing
    // work: hand the compiled guard a resolver that knows nothing about /dev.
    const unmapped = compileExpression<
      (
        appUser: unknown,
        permissions: Perm[],
        getTabKeyForRoute: (p: string) => string | null,
      ) => (pathname: string) => boolean
    >(
      ['appUser', 'permissions', 'getTabKeyForRoute'],
      [
        liftDeclaration(permissionsHookSource, 'isManager'),
        liftDeclaration(permissionsHookSource, 'canView'),
        liftDeclaration(permissionsHookSource, 'canAccessRoute'),
      ],
      'canAccessRoute',
    )({ role: 'manager' }, [], () => null);
    expect(unmapped('/dev')).toBe(true);
  });

  it('is untouched for non-manager roles — the page’s own gates decide for them', () => {
    for (const role of ['head_admin', 'admin', 'ops', 'viewer'] as Role[]) {
      expect(canAccessRouteFor(role)('/dev'), role).toBe(true);
    }
  });

  it('did not change the answer for any other mapped route', () => {
    // A manager granted everything can still reach every real route.
    const guard = canAccessRouteFor('manager', EVERY_GRANT);
    for (const route of Object.keys(ROUTE_TO_TAB)) {
      if (route === '/dev') continue;
      expect(guard(route), route).toBe(true);
    }
  });
});
