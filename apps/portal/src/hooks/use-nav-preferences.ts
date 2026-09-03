import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/stores/auth-store";
import { useTenant } from "@/contexts/TenantContext";
import {
  EMPTY_NAV_PREFERENCES,
  parseNavPreferences,
  type NavPreferences,
} from "@/lib/nav-preferences";

/**
 * The logged-in user's sidebar arrangement.
 *
 * Per USER, not per tenant: my sidebar is mine, and a head admin setting a
 * default for their whole team is a different feature. The row is keyed on
 * `app_users.id`, which is also what the table's RLS matches on, so a user can
 * only ever read and write their own.
 *
 * Stored in its own table rather than a column on `app_users` for one specific
 * reason: letting a user UPDATE their own `app_users` row would need an RLS
 * policy over that row, and Postgres row policies cannot be scoped to a single
 * column — the same policy that let them save a sidebar order would let them
 * edit their own `role` and `is_active`.
 *
 * Both statements below also carry an explicit `tenant_id` predicate on top of
 * `app_user_id`. RLS is OFF on the core tables in this project, so the tenant
 * filter is the boundary, not a convenience: a read keyed on a single column is
 * one mistyped id away from returning another operator's row. `app_user_id` is
 * already unique here, so the extra predicate costs nothing and cannot narrow a
 * legitimate result — a user's `app_users` row belongs to exactly one tenant.
 */
export function useNavPreferences() {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const appUserId = appUser?.id ?? null;
  const tenantId = tenant?.id ?? null;
  // Keyed on both, so switching tenant can never serve the previous tenant's
  // cached arrangement out of React Query.
  const queryKey = ["nav-preferences", appUserId, tenantId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("user_nav_preferences")
        .select("preferences")
        .eq("app_user_id", appUserId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw error;
      return parseNavPreferences(data?.preferences);
    },
    enabled: !!appUserId && !!tenantId,
    staleTime: 5 * 60_000,
    // The sidebar renders on every page. A user with no saved arrangement is
    // the common case and produces no row, so there is nothing to retry for.
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (preferences: NavPreferences) => {
      if (!appUserId) throw new Error("Not signed in");
      if (!tenantId) throw new Error("No tenant");
      const { error } = await (supabase as any)
        .from("user_nav_preferences")
        .upsert(
          {
            app_user_id: appUserId,
            tenant_id: tenantId,
            preferences,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "app_user_id" }
        );
      if (error) throw error;
      return preferences;
    },
    // Paint the new arrangement immediately — the sidebar is the thing the
    // user is looking at while they save, so waiting on a round-trip to
    // reorder it reads as the save having failed.
    onSuccess: (preferences) => queryClient.setQueryData(queryKey, preferences),
  });

  return {
    // A failed read must not wipe out the sidebar or lock the user into a
    // half-applied arrangement — fall back to "no customisation", which is
    // exactly the stock sidebar.
    preferences: query.data ?? EMPTY_NAV_PREFERENCES,
    isLoading: query.isLoading,
    /** The preferences store could not be reached (offline, or not migrated yet). */
    isUnavailable: query.isError,
    save: save.mutateAsync,
    isSaving: save.isPending,
  };
}
