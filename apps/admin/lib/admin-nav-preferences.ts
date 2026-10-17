'use client';

/**
 * Each super admin's own sidebar: the order of its rows, the default rows they
 * hid, and the extra pages they added (Customise sidebar).
 *
 * The same idea as the portal's nav preferences (apps/portal/src/lib/
 * nav-preferences.ts), for a flat sidebar: one list, no groups. Stored per
 * USER in `admin_nav_preferences` (RLS: your own row only) — see
 * supabase/migrations/20261017130000_admin_nav_preferences.sql.
 *
 * Fails to the default: a missing row, a read error, or a page this build no
 * longer has all leave the sidebar exactly as it ships.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AdminNavPreferences {
  /** The rows shown, top to bottom, by href. */
  order: string[];
  /** Default rows the user took off. New default pages are NOT in here, so they still appear. */
  hidden: string[];
}

/** Rows that are always in the sidebar and cannot be hidden. */
export const PERMANENT_ADMIN_HREFS: readonly string[] = ['/admin/dashboard'];

export function parseAdminNavPreferences(raw: unknown): AdminNavPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const order = strings(r.order);
  if (order.length === 0) return null;
  return { order, hidden: strings(r.hidden) };
}

/**
 * The sidebar rows for these preferences: the saved order (dropping pages that
 * no longer exist), then any default page the user has neither placed nor
 * hidden — a page added in a later release — so nothing new is ever lost.
 */
export function applyAdminNavPreferences<T extends { href: string }>(
  defaults: T[],
  extras: T[],
  prefs: AdminNavPreferences | null,
): T[] {
  if (!prefs) return defaults;
  const byHref = new Map<string, T>();
  for (const item of [...defaults, ...extras]) byHref.set(item.href, item);

  const out: T[] = [];
  const seen = new Set<string>();
  for (const href of prefs.order) {
    const item = byHref.get(href);
    if (item && !seen.has(href)) {
      out.push(item);
      seen.add(href);
    }
  }
  for (const item of defaults) {
    if (seen.has(item.href) || prefs.hidden.includes(item.href)) continue;
    if (PERMANENT_ADMIN_HREFS.includes(item.href)) out.unshift(item);
    else out.push(item);
    seen.add(item.href);
  }
  return out;
}

export function useAdminNavPreferences(appUserId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['admin-nav-preferences', appUserId ?? null];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('admin_nav_preferences')
        .select('preferences')
        .eq('app_user_id', appUserId)
        .maybeSingle();
      if (error) throw error;
      return parseAdminNavPreferences(data?.preferences);
    },
    enabled: !!appUserId,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (preferences: AdminNavPreferences | null) => {
      if (!appUserId) throw new Error('Not signed in');
      if (preferences === null) {
        // Reset: no row means the sidebar as it ships.
        const { error } = await (supabase as any).from('admin_nav_preferences').delete().eq('app_user_id', appUserId);
        if (error) throw error;
        return null;
      }
      const { error } = await (supabase as any)
        .from('admin_nav_preferences')
        .upsert(
          { app_user_id: appUserId, preferences, updated_at: new Date().toISOString() },
          { onConflict: 'app_user_id' },
        );
      if (error) throw error;
      return preferences;
    },
    // Paint the new sidebar at once.
    onSuccess: (preferences) => queryClient.setQueryData(queryKey, preferences),
  });

  return {
    preferences: query.data ?? null,
    isLoading: query.isLoading,
    isUnavailable: query.isError,
    save: save.mutateAsync,
    isSaving: save.isPending,
  };
}
