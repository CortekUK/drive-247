'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Portal-side reader for `feature_announcements` — the same platform-wide table
 * the booking app already shows to customers, surfaced here for operator staff.
 *
 * TENANT ISOLATION: this is the one query in the v2 dashboard with NO
 * `tenant_id` filter, and that is correct rather than an oversight.
 * `feature_announcements` has no `tenant_id` column (verified against
 * production) — it is platform news written by Drive247 for every operator.
 * It is also one of the tables that DOES have RLS enabled, with a policy
 * restricting `authenticated` to published, active, in-window rows.
 *
 * Two things differ from the customer side, both deliberate:
 *
 * 1. Dismissal is local, not stored. `customer_announcement_views` is keyed to
 *    `customer_user_id`, and portal staff are `app_users` — there is no row for
 *    them and creating one is a migration, which this area does not need. So a
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

/* ─── Dev-only preview rows ───────────────────────────────────────────────────
 *
 * There is very little in the table, so the carousel has nothing to fan. These
 * exist purely so the component can be looked at with a full deck.
 *
 * They are NOT written to the database — seeding fake announcements would put
 * invented product news in front of real operators. `process.env.NODE_ENV` is
 * inlined by Next at build time, so in a production bundle `PREVIEW_ENABLED` is
 * a literal `false` and the branch that reads this array can never run. The
 * array itself should also be tree-shaken out, being referenced only from that
 * dead branch, but the guarantee that matters is the first one: these never
 * reach a tenant.
 *
 * Delete this block once there are real rows worth fanning.
 */
const PREVIEW_ENABLED = process.env.NODE_ENV !== 'production';

const PREVIEW_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    id: 'preview-fleet-calendar',
    title: 'Fleet Calendar',
    summary:
      'Every vehicle against every date on one timeline — see the whole fleet at a glance.',
    body_html:
      '<p>Drag across any row to block a range of dates. Weekend and holiday surcharges show inline as a strip above the grid, so you can see what a day is actually priced at before you commit to it.</p><p>Bookings, blocks and maintenance windows all sit on the same row, which means a clash is visible rather than something you find out about at handover.</p>',
    image_url: null,
    cta_label: 'Open the calendar',
    cta_url: '/blocked-dates',
    severity: 'major',
    published_at: null,
    expires_at: null,
    sort_priority: 100,
    audience_filter: null,
  },
  {
    id: 'preview-auto-extension',
    title: 'Auto-Renew',
    summary: 'Weekly renters renew themselves, charged upfront each period.',
    body_html:
      '<p>A rental set to auto-renew charges the next period upfront from the customer’s saved card. If that card fails, they get a pay-link instead and the rental pauses rather than silently lapsing.</p><p>Set the cadence per rental — weekly, fortnightly or monthly — and skip or move any single occurrence without breaking the schedule.</p>',
    image_url: null,
    cta_label: 'See how it works',
    cta_url: '/rentals',
    severity: 'major',
    published_at: null,
    expires_at: null,
    sort_priority: 90,
    audience_filter: null,
  },
  {
    id: 'preview-deposit-holds',
    title: 'Deposit Holds',
    summary: 'Holds now refresh themselves before Stripe expires them.',
    body_html:
      '<p>A Stripe authorisation lapses after seven days. On a longer rental that meant the deposit was quietly gone by the time the car came back.</p><p>Holds are now extended automatically ahead of that deadline, using extended authorisation where the connected account supports it. Nothing to do — but it is worth checking any rental that started before this shipped.</p>',
    image_url: null,
    cta_label: 'Review your holds',
    cta_url: '/payments',
    severity: 'critical',
    published_at: null,
    expires_at: null,
    sort_priority: 80,
    audience_filter: null,
  },
  {
    id: 'preview-whatsapp',
    title: 'WhatsApp',
    summary: 'Send collection details, lockbox codes and photos over WhatsApp.',
    body_html:
      '<p>Collection instructions, the lockbox code and up to ten photos go out as a single WhatsApp message instead of a chain of texts.</p><p>Falls back to SMS automatically when a number is not reachable on WhatsApp.</p>',
    image_url: null,
    cta_label: null,
    cta_url: null,
    severity: 'minor',
    published_at: null,
    expires_at: null,
    sort_priority: 70,
    audience_filter: null,
  },
];

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

  // Preview rows lead, so the deck is visible without dismissing the real one.
  const pool = useMemo(
    () => (PREVIEW_ENABLED ? [...PREVIEW_ANNOUNCEMENTS, ...data] : data),
    [data]
  );

  const visible = useMemo(
    () => (hydrated ? pool.filter((a) => !dismissed.includes(a.id)) : []),
    [pool, dismissed, hydrated]
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
    hasDismissed: hydrated && dismissed.length > 0 && pool.length > 0,
    isLoading: isLoading || !hydrated,
    dismiss,
    restore,
  };
}
