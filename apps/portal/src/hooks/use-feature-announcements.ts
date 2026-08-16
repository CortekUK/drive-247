'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Portal-side reader for `feature_announcements` — the same platform-wide table
 * the booking app already shows to customers, surfaced here for operator staff.
 *
 * Two things differ from the customer side, both deliberate:
 *
 * 1. Dismissal is local, not stored. `customer_announcement_views` is keyed to
 *    `customer_user_id`, and portal staff are `app_users` — there is no row for
 *    them and creating one is a migration, which this branch cannot do. So a
 *    dismissal persists in localStorage per browser, the same approach the
 *    sidebar promo already uses. A staff member who switches machines sees the
 *    card again; that is the accepted cost of not touching the schema.
 *
 * 2. Audience is filtered here. The table is read by both apps, so an
 *    announcement aimed at renters would otherwise appear on an operator's
 *    dashboard. See AUDIENCE below.
 */

export type AnnouncementSeverity = 'major' | 'minor' | 'critical' | 'info';

export interface FeatureAnnouncement {
  id: string;
  title: string;
  summary: string | null;
  body_html: string | null;
  image_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  severity: AnnouncementSeverity;
  published_at: string | null;
  expires_at: string | null;
  sort_priority: number;
  audience_filter: unknown;
}

const STORAGE_KEY = 'portal:announcements:dismissed';

/**
 * AUDIENCE — an announcement is shown in the portal when its `audience_filter`
 * is null (meaning "everyone", which is how the booking app already treats it)
 * or when its `apps` array names "portal".
 *
 * Tag an announcement as operator-only with:
 *   audience_filter = '{"apps": ["portal"]}'
 * and renter-only with:
 *   audience_filter = '{"apps": ["booking"]}'
 *
 * Untagged rows deliberately fall through to both apps rather than neither, so
 * nothing silently stops being announced. If you would rather the portal show
 * only explicitly-tagged rows, drop the `filter == null` arm below.
 */
function isForPortal(filter: unknown): boolean {
  if (filter == null) return true;
  const apps = (filter as { apps?: unknown })?.apps;
  if (!Array.isArray(apps)) return true;
  return apps.includes('portal');
}

function readDismissed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function useFeatureAnnouncements() {
  // Starts empty and hydrates in an effect so server and first client render
  // agree. Nothing renders before the query resolves, so there is no flash of a
  // card that was already dismissed.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setHydrated(true);
  }, []);

  const { data = [], isLoading } = useQuery({
    queryKey: ['portal-feature-announcements'],
    queryFn: async (): Promise<FeatureAnnouncement[]> => {
      // RLS already restricts this to published, active, in-window rows; the
      // filters are repeated for clarity and so a policy change cannot quietly
      // widen what the dashboard shows.
      const { data, error } = await supabase
        .from('feature_announcements')
        .select(
          'id, title, summary, body_html, image_url, cta_label, cta_url, severity, published_at, expires_at, sort_priority, audience_filter'
        )
        .eq('status', 'published')
        .eq('is_active', true)
        .order('sort_priority', { ascending: false })
        .order('published_at', { ascending: false });

      if (error) throw error;

      const now = Date.now();
      return ((data || []) as any[]).filter((a) => {
        if (a.published_at && new Date(a.published_at).getTime() > now) return false;
        if (a.expires_at && new Date(a.expires_at).getTime() <= now) return false;
        return isForPortal(a.audience_filter);
      }) as FeatureAnnouncement[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const visible = useMemo(
    () => (hydrated ? data.filter((a) => !dismissed.includes(a.id)) : []),
    [data, dismissed, hydrated]
  );

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full or blocked localStorage must not stop the card going away.
      }
      return next;
    });
  }, []);

  /** Bring every dismissed announcement back — used by the "Show again" action. */
  const restore = useCallback(() => {
    setDismissed([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    announcements: visible,
    hasDismissed: hydrated && dismissed.length > 0 && data.length > 0,
    isLoading: isLoading || !hydrated,
    dismiss,
    restore,
  };
}
