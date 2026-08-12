import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/stores/auth-store';
import { getTabKeyForRoute, SETTINGS_VALUE_TO_KEY } from '@/lib/permissions';

export interface ManagerPermission {
  id: string;
  app_user_id: string;
  tab_key: string;
  access_level: 'viewer' | 'editor';
}

/**
 * Roles whose entire definition is "may look, may not change".
 *
 * `viewer` is labelled "Viewer - Read-only access" in the users UI (see
 * `components/users/add-user-dialog.tsx` and `(dashboard)/users/page.tsx`), so
 * every mutation control in the portal is a bug when it renders for one.
 *
 * `ops` ("Operations - Day-to-day operations") is deliberately NOT in this set.
 * It is a working role — login sends it to /vehicles — and `canEdit` is the gate
 * on Add Vehicle, Add Rental, Add Payment, fines, reminders and the CMS across
 * the whole portal. Denying it here would strip an ops user of their day job in
 * every tenant, which is a far larger change than the hole being closed. Where a
 * single action must be narrower than "not read-only" (the deposit-hold refresh,
 * for instance) the call site already gates on `isAdmin()` instead.
 */
const READ_ONLY_ROLES: ReadonlySet<string> = new Set(['viewer']);

export function useManagerPermissions() {
  const { appUser } = useAuth();
  const isManager = appUser?.role === 'manager';
  /**
   * True only for a role that is read-only BY DEFINITION.
   *
   * Note a super admin never lands here: the auth store rewrites their role to
   * 'head_admin' when it loads the profile.
   */
  const isReadOnlyRole = !!appUser?.role && READ_ONLY_ROLES.has(appUser.role);

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['manager-permissions', appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manager_permissions')
        .select('*')
        .eq('app_user_id', appUser!.id);

      if (error) {
        console.error('Error fetching manager permissions:', error);
        return [];
      }
      return data as ManagerPermission[];
    },
    enabled: !!appUser?.id && isManager,
  });

  /**
   * Check if manager has any access (viewer or editor) to a tab.
   * Non-managers always return true.
   */
  const canView = (tabKey: string): boolean => {
    if (!isManager) return true;
    return permissions.some(p => p.tab_key === tabKey);
  };

  /**
   * Check whether the current user may EDIT within a tab.
   *
   * Answers for every role, not just managers:
   *   - a read-only role (`viewer`) is always false — it may look, never write;
   *   - a manager is false unless they hold an *editor* grant on the tab;
   *   - every other role (head_admin, admin, ops, and super admins, whom the
   *     auth store presents as head_admin) is true, exactly as before.
   *
   * This used to open with `if (!isManager) return true;`, which answered a
   * question about MANAGERS and so handed `true` to a `viewer` — the role whose
   * whole definition is read-only. Every write control in the portal is gated on
   * this function, including "Check with Stripe" on the rental page, which
   * corrects `rentals.deposit_hold_status` and is what re-opens the deposit
   * placement paths. This is UX gating only; the server-side gate lives in each
   * edge function (see verify-deposit-hold's auth block).
   */
  const canEdit = (tabKey: string): boolean => {
    if (isReadOnlyRole) return false;
    if (!isManager) return true;
    return permissions.some(p => p.tab_key === tabKey && p.access_level === 'editor');
  };

  /**
   * Check if the manager can access a given route path.
   * Non-managers always return true.
   */
  const canAccessRoute = (pathname: string): boolean => {
    if (!isManager) return true;
    // Dashboard is always accessible
    if (pathname === '/') return true;
    // Users page is never accessible to managers
    if (pathname === '/users' || pathname.startsWith('/users/')) return false;
    // Subscription page is always accessible (for billing)
    if (pathname === '/subscription') return true;

    const tabKey = getTabKeyForRoute(pathname);
    if (!tabKey) return true; // Unknown routes are allowed
    return canView(tabKey);
  };

  /**
   * Check if manager can view a specific settings sub-tab (by its value e.g. 'general', 'branding').
   * Non-managers always return true.
   */
  const canViewSettings = (tabValue: string): boolean => {
    if (!isManager) return true;
    // Must have settings parent permission first
    if (!canView('settings')) return false;
    const settingsKey = SETTINGS_VALUE_TO_KEY[tabValue];
    if (!settingsKey) return true;
    return permissions.some(p => p.tab_key === settingsKey);
  };

  /**
   * Check whether the current user may edit a specific settings sub-tab.
   * Same role model as `canEdit` — a read-only role is false everywhere,
   * a manager needs the editor grant, everyone else is unchanged.
   */
  const canEditSettings = (tabValue: string): boolean => {
    if (isReadOnlyRole) return false;
    if (!isManager) return true;
    if (!canEdit('settings')) return false;
    const settingsKey = SETTINGS_VALUE_TO_KEY[tabValue];
    if (!settingsKey) return true;
    return permissions.some(p => p.tab_key === settingsKey && p.access_level === 'editor');
  };

  return {
    permissions,
    isManager,
    /** True when the signed-in role may never write (currently: `viewer`). */
    isReadOnlyRole,
    isLoading,
    canView,
    canEdit,
    canAccessRoute,
    canViewSettings,
    canEditSettings,
  };
}
