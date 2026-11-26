'use client';

import { useEffect, useRef } from 'react';

import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import {
  TOUR_WRITE_EVENT,
  isTourSyncPaused,
  localWriteTime,
  mergeServerRows,
  serverKeyFor,
  setTourSyncReady,
  type ServerTourRow,
} from '@/lib/tour-sync';

/** Wait this long for the first pull before letting the tours start anyway. */
const PULL_TIMEOUT_MS = 4000;

/**
 * Mirrors the tours' browser state to `user_tour_progress` (see
 * `lib/tour-sync.ts`). Renders nothing. Mounted once, in the dashboard layout.
 */
export function TourSync({ enabled }: { enabled: boolean }) {
  const { appUser } = useAuth();
  const { tenant } = useTenant();
  const appUserId = appUser?.id ?? null;
  const tenantId = tenant?.id ?? null;
  // The table is missing or refused us: stop trying for this page load.
  const offline = useRef(false);

  useEffect(() => {
    if (!enabled || !appUserId || !tenantId) return;
    let cancelled = false;
    setTourSyncReady(false);

    const push = async (key: string) => {
      if (offline.current || isTourSyncPaused()) return;
      const tourKey = serverKeyFor(key, appUserId);
      if (!tourKey) return;
      let value: string | null = null;
      try {
        value = window.localStorage.getItem(key);
      } catch {
        return;
      }
      const { error } = await (supabase as any).from('user_tour_progress').upsert(
        {
          app_user_id: appUserId,
          tenant_id: tenantId,
          tour_key: tourKey,
          value,
          updated_at: localWriteTime(key) ?? new Date().toISOString(),
        },
        { onConflict: 'app_user_id,tour_key' },
      );
      if (error) offline.current = true;
    };

    const pull = async () => {
      if (isTourSyncPaused()) return;
      const { data, error } = await (supabase as any)
        .from('user_tour_progress')
        .select('tour_key, value, updated_at')
        .eq('app_user_id', appUserId)
        .eq('tenant_id', tenantId);
      if (cancelled) return;
      if (error) {
        offline.current = true;
        return;
      }
      const newerHere = mergeServerRows((data ?? []) as ServerTourRow[], appUserId);
      for (const key of newerHere) void push(key);
    };

    const timeout = setTimeout(() => {
      if (!cancelled) setTourSyncReady(true);
    }, PULL_TIMEOUT_MS);
    pull()
      .catch(() => {
        offline.current = true;
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setTourSyncReady(true);
      });

    const onWrite = (event: Event) => {
      const key = (event as CustomEvent<{ key: string }>).detail?.key;
      if (key) void push(key);
    };
    window.addEventListener(TOUR_WRITE_EVENT, onWrite);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      window.removeEventListener(TOUR_WRITE_EVENT, onWrite);
    };
  }, [enabled, appUserId, tenantId]);

  return null;
}
