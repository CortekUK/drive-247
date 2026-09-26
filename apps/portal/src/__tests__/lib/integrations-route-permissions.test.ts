/**
 * A manager responsible for PAYMENTS must be able to reach Stripe onboarding on
 * a v2 tenant.
 *
 * On v2 the Settings → Payments tab is hidden (`lean-areas.ts`
 * SETTINGS_TAB_AREAS.payments) because `/integrations` replaces it — that board
 * is where Stripe Connect onboarding lives. But the hidden tab's grant is
 * `settings.payments` while the route's grant is `settings.integrations`, so a
 * manager given payments and nothing else could reach NEITHER: the tab is gone,
 * the route refused. For a brand-new tenant that means no way to connect Stripe
 * and therefore no way to take money — found by an adversarial review of the
 * v2-for-new-signups work on 2026-09-18, before it could bite anyone.
 *
 * These tests execute the SHIPPED `canAccessRoute` (lifted out of
 * use-manager-permissions.ts) against the SHIPPED route table, so they answer
 * for the code as it is rather than for a paraphrase of it.
 */

import { describe, it, expect } from 'vitest';

import {
  ROUTE_ALSO_ALLOWED_BY,
  ROUTE_TO_TAB,
  getTabKeysForRoute,
} from '@/lib/permissions';
import { compileExpression, liftDeclaration } from '../helpers/edge-source';
import { permissionsHookSource, editor, type Perm, type Role } from '../helpers/permissions-source';

/** The real `canAccessRoute`, bound to a role and a set of permission rows. */
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

describe('/integrations accepts either grant', () => {
  it('resolves to both keys, primary first', () => {
    expect(getTabKeysForRoute('/integrations')).toEqual([
      'settings.integrations',
      'settings.payments',
    ]);
  });

  it('keeps the primary mapping intact — this widens, it does not replace', () => {
    expect(ROUTE_TO_TAB['/integrations']).toBe('settings.integrations');
    expect(ROUTE_ALSO_ALLOWED_BY['/integrations']).toEqual(['settings.payments']);
  });

  it('lets a manager with ONLY settings.payments in — the lockout this fixes', () => {
    const guard = canAccessRouteFor('manager', editor('settings', 'settings.payments'));
    expect(guard('/integrations')).toBe(true);
  });

  it('lets a manager with ONLY settings.integrations in — unchanged behaviour', () => {
    const guard = canAccessRouteFor('manager', editor('settings', 'settings.integrations'));
    expect(guard('/integrations')).toBe(true);
  });

  it('still refuses a manager holding NEITHER grant', () => {
    const guard = canAccessRouteFor('manager', editor('settings', 'settings.general', 'rentals'));
    expect(guard('/integrations')).toBe(false);
  });

  it('does not leak the widening to any other route', () => {
    // settings.payments alone must not open the rest of the board's neighbours.
    const guard = canAccessRouteFor('manager', editor('settings', 'settings.payments'));
    for (const route of ['/cms', '/audit-logs', '/insights', '/pl-dashboard', '/dev']) {
      expect(guard(route), route).toBe(false);
    }
  });

  it('is irrelevant to non-managers, who are gated by the route itself', () => {
    for (const role of ['head_admin', 'admin', 'ops', 'viewer'] as Role[]) {
      expect(canAccessRouteFor(role)('/integrations'), role).toBe(true);
    }
  });

  it('nested paths under /integrations inherit both keys', () => {
    expect(getTabKeysForRoute('/integrations/stripe')).toEqual([
      'settings.integrations',
      'settings.payments',
    ]);
  });

  it('no other route gained an alternative grant by accident', () => {
    // If this list grows, it should grow deliberately: every entry is a route
    // that can be opened by a grant written for a DIFFERENT screen.
    // `/finances` joined deliberately (Sep 25 2026): it replaced Payments,
    // Invoices and Fines on the canary, so any of the three grants opens it —
    // pinned in finances-permissions.test.ts.
    expect(Object.keys(ROUTE_ALSO_ALLOWED_BY)).toEqual(['/integrations', '/finances']);
  });
});
