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

export function useManagerPermissions() {
  const { appUser } = useAuth();
  const isManager = appUser?.role === 'manager';

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
   * Check if manager has editor access to a tab.
   * Non-managers always return true.
   */
  const canEdit = (tabKey: string): boolean => {
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
   * Check if manager has editor access to a specific settings sub-tab.
   * Non-managers always return true.
   */
  const canEditSettings = (tabValue: string): boolean => {
    if (!isManager) return true;
    if (!canEdit('settings')) return false;
    const settingsKey = SETTINGS_VALUE_TO_KEY[tabValue];
    if (!settingsKey) return true;
    return permissions.some(p => p.tab_key === settingsKey && p.access_level === 'editor');
  };

  return {
    permissions,
    isManager,
    isLoading,
    canView,
    canEdit,
    canAccessRoute,
    canViewSettings,
    canEditSettings,
  };
}
