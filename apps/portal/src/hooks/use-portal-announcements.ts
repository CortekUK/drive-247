'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/stores/auth-store';
import { useV2 } from '@/lib/v2-context';
import { isLeanTenant } from '@/lib/lean-areas';
import {
  ANNOUNCEMENTS_POLL_MS,
  ANNOUNCEMENTS_STALE_MS,
  ANNOUNCEMENT_RPC,
  normalizePortalAnnouncementRow,
  type AnnouncementEvent,
  type PortalAnnouncement,
} from '@/lib/announcements/contract';

/**
 * Portal reader for announcements written in the super admin (Announcements page).
 *
 * ONE query per tenant + staff user, shared by every surface: the layout mounts this
 * hook in its body (so the fetch starts while the gate skeleton is still up), and the
 * system banner, the dialog host and the dashboard's feature deck each call it again
 * and read the same cache entry.
 *
 * WHAT IT READS. `get_portal_announcements` does the targeting, the ordering and the
 * repeat clock on the server (see ops/portal_announcements.sql): rows arrive already
 * filtered to this tenant (all / picked tenants / live smart filter), active only, in
 * display order, with `is_due` computed from this user's stored dismissal. Nothing
 * here re-derives any of that. The tables themselves have no tenant-staff policy, so
 * this RPC is the only way in.
 *
 * REACH.
 *   - SYSTEM rows are read for every tenant, v1 and v2 chrome alike: the real cases
 *     (a tenant without Stripe, a UAE migration) are v1 tenants. With nothing active
 *     and targeted, every surface renders nothing, so other tenants see no change.
 *   - FEATURE rows are read only where the v2 dashboard exists (`useV2('dashboard')`
 *     AND the lean-tenant slug list, failing closed). Everywhere else the RPC is
 *     asked for `['system']` only, so no feature row ever crosses the wire there.
 *
 * DELIVERY is polling, never realtime or cron: on mount, on window focus, and every
 * ANNOUNCEMENTS_POLL_MS while the tab is visible. That is what makes a smart filter
 * "live" from the tenant's side: a tenant who connects Stripe stops receiving the
 * Stripe notice on the next read.
 *
 * FAILURE renders nothing. `retry: false`, one `console.warn` per failed read, and the
 * error is THROWN so React Query can report `error`: a read that never succeeded
 * shows nothing, while a later failed refetch keeps the last good rows (a hard
 * blocker must not flicker off and on over a transient blip). A database without the
 * RPC yet (PGRST202 / 42883) is just such an error.
 *
 * DISMISSAL lives in the database (per app_user per tenant). The session maps below
 * only make a close feel instant: the moment a user dismisses something it is hidden
 * everywhere at once, and it stays hidden even if a refetch races the event write.
 * It stays hidden only until the server has the dismissal on record; from then on the
 * server's `is_due` and its repeat clock decide again, so "show again after 1 day"
 * still comes back in a tab left open for days. No localStorage anywhere.
 */

export const PORTAL_ANNOUNCEMENTS_KEY = 'portal-announcements';

export function portalAnnouncementsQueryKey(
  tenantId: string | undefined,
  appUserId: string | undefined,
  featuresEnabled: boolean,
): readonly ['portal-announcements', string | undefined, string | undefined, 'system' | 'system+feature'] {
  return [PORTAL_ANNOUNCEMENTS_KEY, tenantId, appUserId, featuresEnabled ? 'system+feature' : 'system'] as const;
}

export interface PortalAnnouncementsState {
  /** 'loading' also while disabled (no tenant or appUser yet). 'error' only if it never succeeded. */
  status: 'loading' | 'error' | 'ready';
  /** kind='system', server order, is_due already merged with this session's local dismissals. [] unless ready. */
  system: PortalAnnouncement[];
  /** kind='feature', server order, ALL targeted active features (due or not). [] unless ready AND featuresEnabled. */
  features: PortalAnnouncement[];
  /** useV2('dashboard') && isLeanTenant(tenant?.slug). When false the RPC is called with p_kinds=['system']. */
  featuresEnabled: boolean;
  /** Fire-and-forget. Never throws, never retries. Optimistic: dismissed / dont_show_again / soft cta_clicked
   *  set is_due=false (and dont_show_again_at) for that id+revision until a refetch shows the server has
   *  recorded it (a new dismissed_at); after that the server's is_due and repeat clock decide. */
  recordEvent: (announcement: PortalAnnouncement, event: AnnouncementEvent) => void;
}

// ─── Session state (module level: one page load) ────────────────────────────
// Keyed `${tenantId}:${appUserId}`, so a super admin moving between tenants in one
// tab, or a sign-out/sign-in as someone else, never inherits another key's state.

interface LocalHide {
  revision: number;
  /** Local ISO time of a `dont_show_again`, else null. */
  dontShowAgainAt: string | null;
  /**
   * The server's `dismissed_at` on the row the user closed. Every write that hides
   * (dismissed, dont_show_again, a soft cta_clicked) stamps a NEW `dismissed_at`, so a
   * refetch carrying any other non-null value means the write is on record. Compared
   * by value, never against the local clock, which may be skewed.
   */
  serverDismissedAt: string | null;
}

const hiddenBySession = new Map<string, Map<string, LocalHide>>();
const shownSentBySession = new Map<string, Set<string>>();

let sessionVersion = 0;
const sessionListeners = new Set<() => void>();

function subscribeSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

const readSessionVersion = () => sessionVersion;

function bumpSession() {
  sessionVersion += 1;
  sessionListeners.forEach((listener) => listener());
}

/** Tests only: clears the module-level session maps. */
export function __resetPortalAnnouncementSession(): void {
  hiddenBySession.clear();
  shownSentBySession.clear();
  bumpSession();
}

const isHardSystem = (a: PortalAnnouncement) => a.kind === 'system' && a.blocking === 'hard';

function applyLocalHide(a: PortalAnnouncement, hidden: Map<string, LocalHide> | undefined): PortalAnnouncement {
  if (!hidden || isHardSystem(a)) return a;
  const hide = hidden.get(a.id);
  // A revision bump ("show it again to everyone") outranks a local dismissal of the
  // older revision, exactly as it outranks the stored one on the server.
  if (!hide || hide.revision !== a.revision) return a;
  // The server has recorded this dismissal (or a later one): hand back to its is_due.
  if (a.dismissed_at !== null && a.dismissed_at !== hide.serverDismissedAt) return a;
  return {
    ...a,
    is_due: false,
    dont_show_again_at: hide.dontShowAgainAt ?? a.dont_show_again_at,
  };
}

// Stable empties, so consumers' effects keyed on these arrays do not re-run.
const NO_ROWS: PortalAnnouncement[] = [];

export function usePortalAnnouncements(): PortalAnnouncementsState {
  const { tenant } = useTenant();
  const { appUser } = useAuth();
  const v2Dashboard = useV2('dashboard');
  const featuresEnabled = v2Dashboard && isLeanTenant(tenant?.slug);

  const tenantId: string | undefined = tenant?.id || undefined;
  const appUserId: string | undefined = appUser?.id || undefined;

  const query = useQuery({
    queryKey: portalAnnouncementsQueryKey(tenantId, appUserId, featuresEnabled),
    queryFn: async (): Promise<PortalAnnouncement[]> => {
      const { data, error } = await (supabase as any).rpc(ANNOUNCEMENT_RPC.read, {
        p_tenant_id: tenantId,
        p_kinds: featuresEnabled ? ['system', 'feature'] : ['system'],
      });
      if (error) {
        console.warn('[announcements] could not load portal announcements', error.message);
        throw error;
      }
      const rows: unknown[] = Array.isArray(data) ? data : [];
      return rows
        .map(normalizePortalAnnouncementRow)
        .filter((row): row is PortalAnnouncement => row !== null);
    },
    enabled: !!tenantId && !!appUserId,
    staleTime: ANNOUNCEMENTS_STALE_MS,
    refetchInterval: ANNOUNCEMENTS_POLL_MS,
    refetchIntervalInBackground: false,
    // Overrides the portal-wide `false` (app/providers.tsx): coming back to the tab
    // is the cheapest moment to notice a new outage notice or a cleared filter.
    refetchOnWindowFocus: true,
    // A failure that can succeed on a later poll will; one that cannot (the RPC is
    // not installed) must not cost four round trips per mount.
    retry: false,
  });

  const version = useSyncExternalStore(subscribeSession, readSessionVersion, readSessionVersion);
  const sessionKey = tenantId && appUserId ? `${tenantId}:${appUserId}` : null;
  const data = query.data;

  const { system, features } = useMemo(() => {
    if (data === undefined) return { system: NO_ROWS, features: NO_ROWS };
    const hidden = sessionKey ? hiddenBySession.get(sessionKey) : undefined;
    const merged = data.map((a) => applyLocalHide(a, hidden));
    const systemRows = merged.filter((a) => a.kind === 'system');
    const featureRows = featuresEnabled ? merged.filter((a) => a.kind === 'feature') : NO_ROWS;
    return {
      system: systemRows.length ? systemRows : NO_ROWS,
      features: featureRows.length ? featureRows : NO_ROWS,
    };
    // `version` is the re-render signal for the session maps above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sessionKey, featuresEnabled, version]);

  const status: PortalAnnouncementsState['status'] =
    data !== undefined ? 'ready' : query.isError ? 'error' : 'loading';

  const recordEvent = useCallback(
    (announcement: PortalAnnouncement, event: AnnouncementEvent) => {
      if (!tenantId || !appUserId || !announcement?.id) return;
      const key = `${tenantId}:${appUserId}`;

      if (event === 'shown') {
        // Once per page load per id+revision: a banner re-rendering, a dialog that
        // yields to a gate and comes back, or the card being opened twice is still
        // one impression.
        let sent = shownSentBySession.get(key);
        if (!sent) {
          sent = new Set();
          shownSentBySession.set(key, sent);
        }
        const tag = `${announcement.id}:${announcement.revision}`;
        if (sent.has(tag)) return;
        sent.add(tag);
      } else if (
        !isHardSystem(announcement) &&
        (event === 'dismissed' || event === 'dont_show_again' || event === 'cta_clicked')
      ) {
        // Hide BEFORE the write, and tell every consumer at once, so the banner, the
        // dialog host and the deck agree on the very next render.
        let hidden = hiddenBySession.get(key);
        if (!hidden) {
          hidden = new Map();
          hiddenBySession.set(key, hidden);
        }
        const previous = hidden.get(announcement.id);
        hidden.set(announcement.id, {
          revision: announcement.revision,
          dontShowAgainAt:
            event === 'dont_show_again'
              ? new Date().toISOString()
              : previous && previous.revision === announcement.revision
                ? previous.dontShowAgainAt
                : null,
          serverDismissedAt: announcement.dismissed_at ?? null,
        });
        bumpSession();
      }

      // Fire and forget: no invalidation (the optimistic hide already happened and the
      // next poll brings the server's view), no retry, never a thrown error.
      try {
        Promise.resolve(
          (supabase as any).rpc(ANNOUNCEMENT_RPC.event, {
            p_announcement_id: announcement.id,
            p_tenant_id: tenantId,
            p_event: event,
          }),
        )
          .then((result: { error?: { message?: string } | null } | null | undefined) => {
            if (result?.error) {
              console.warn('[announcements] could not record announcement event', event, result.error.message);
            }
          })
          .catch(() => {});
      } catch {
        // A client that throws synchronously must not take the page down with it.
      }
    },
    [tenantId, appUserId],
  );

  return { status, system, features, featuresEnabled, recordEvent };
}
