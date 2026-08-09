/**
 * The portal's permission primitives, lifted out of `use-manager-permissions.ts`
 * and made callable — the shared rig behind every test that asks "may this role
 * press this button?".
 *
 * WHY IT IS ITS OWN FILE
 * `canEdit` is not self-contained. It closes over three bindings declared beside
 * it in the hook — `READ_ONLY_ROLES`, `isReadOnlyRole` and `isManager` — and
 * `compileExpression` compiles a lifted declaration in ISOLATION, so anything it
 * references is a free variable in the synthesised scope. Two test files used to
 * lift `canEdit` alone with `['isManager', 'permissions']` as the parameter list.
 * That worked only while `canEdit` happened to reference nothing else; the moment
 * a role guard was added to it, both files died with
 * `ReferenceError: isReadOnlyRole is not defined`.
 *
 * The fix is NOT to hand the compiled scope a hand-written `role === 'viewer'`.
 * That would move the role model into the test, and the test would then keep
 * passing after someone widened, narrowed or deleted the real one — which is the
 * precise failure mode `edge-source.ts` exists to prevent.
 *
 * So: lift the whole chain. `READ_ONLY_ROLES`, `isManager`, `isReadOnlyRole` and
 * `canEdit` are all taken from the shipped source and compiled together, and the
 * only things injected are the two genuine runtime inputs — the `appUser` row and
 * the manager's permission rows. Add a role to `READ_ONLY_ROLES` in the hook and
 * these tests change answer without anyone editing them; rename or inline any of
 * the four and the lift throws rather than silently passing against a stale copy.
 */

import { readPortalSource, liftDeclaration, compileExpression } from './edge-source';

/** The roles `app_users.role` can carry (see `components/users/add-user-dialog.tsx`). */
export type Role = 'head_admin' | 'admin' | 'manager' | 'ops' | 'viewer';

export type Perm = { tab_key: string; access_level: 'viewer' | 'editor' };

/** The shipped hook source, exported so tests can also assert ON it. */
export const permissionsHookSource = readPortalSource('hooks/use-manager-permissions.ts');

/**
 * The declarations `canEdit` / `canEditSettings` depend on, in dependency order.
 * Lifted fresh per call so a test never sees another test's compiled closure.
 */
const roleModelSnippets = (): string[] => [
  liftDeclaration(permissionsHookSource, 'READ_ONLY_ROLES'),
  liftDeclaration(permissionsHookSource, 'isManager'),
  liftDeclaration(permissionsHookSource, 'isReadOnlyRole'),
];

/**
 * The real `useManagerPermissions().canEdit`, bound to a role and a set of
 * manager permission rows.
 *
 * `role` is threaded through as `appUser` — the same shape the hook reads — so
 * both `isManager` and `isReadOnlyRole` are derived by the shipped expressions
 * rather than by the caller. `null` models a signed-in user whose profile has no
 * role at all.
 */
export const canEditFor = (role: Role | null, permissions: Perm[] = []) =>
  compileExpression<(appUser: unknown, permissions: Perm[]) => (tabKey: string) => boolean>(
    ['appUser', 'permissions'],
    [...roleModelSnippets(), liftDeclaration(permissionsHookSource, 'canEdit')],
    'canEdit',
  )(role === null ? {} : { role }, permissions);

/** Convenience builders for permission rows. */
export const editor = (...tabs: string[]): Perm[] =>
  tabs.map((tab_key) => ({ tab_key, access_level: 'editor' }));

export const viewerOn = (...tabs: string[]): Perm[] =>
  tabs.map((tab_key) => ({ tab_key, access_level: 'viewer' }));
